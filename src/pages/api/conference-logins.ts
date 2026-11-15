// Create, reset and remove conference-only logins. Uses the service key, so every request is checked first:
// signed in as a league admin login, from this site, and owning the conference (see mayManage).
import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/server';
import { adminEmail, confEmail, checkNew, isTaken, mayManage, MIN_PASSWORD, MAX_PASSWORD, MAX_PER_CONFERENCE } from '../../lib/logins';

export const prerender = false;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function body(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin) return null;                 // only this site may call it
  try { return await request.json(); } catch { return null; }
}

/** The caller must be a league admin login that owns this conference. Returns an error response, or null if fine. */
async function gate(locals: App.Locals, conferenceId: string) {
  const who = locals.who;
  if (!who || who.kind !== 'member' || !who.role) return json({ error: 'Only the club that owns this conference can do that.' }, 403);
  const { data: conf } = await locals.db.from('ch_conferences').select('id, school_id').eq('id', conferenceId).maybeSingle();   // row-level security: only what they may see
  if (!conf) return json({ error: 'Conference not found.' }, 404);
  if (!mayManage({ role: who.role, school_id: who.schoolId }, conf.school_id)) return json({ error: 'Only the club that owns this conference can do that.' }, 403);
  return null;
}

// Make one.
export const POST: APIRoute = async ({ request, locals, url }) => {
  const b = await body(request, url.origin);
  if (!b) return json({ error: 'Bad request.' }, 400);
  const conferenceId = String(b.conferenceId ?? ''), username = String(b.username ?? '').trim().toLowerCase(), password = String(b.password ?? '');
  const denied = await gate(locals, conferenceId); if (denied) return denied;
  const bad = checkNew(username, password); if (bad) return json({ error: bad }, 400);

  const sc = serviceClient();
  const { count } = await sc.from('ch_conference_logins').select('user_id', { count: 'exact', head: true }).eq('conference_id', conferenceId);
  if ((count ?? 0) >= MAX_PER_CONFERENCE) return json({ error: `A conference can have at most ${MAX_PER_CONFERENCE} logins.` }, 400);
  // Keep the two kinds of login apart: the same name can't be both an admin login and a conference login.
  const { data: clash } = await sc.from('members').select('user_id').eq('email', adminEmail(username)).maybeSingle();
  if (clash) return json({ error: 'That username is taken.' }, 409);

  const made = await sc.auth.admin.createUser({ email: confEmail(username), password, email_confirm: true });
  if (made.error || !made.data.user) return isTaken(made.error) ? json({ error: 'That username is taken.' }, 409) : json({ error: 'Could not create the login.' }, 500);
  const row = await sc.from('ch_conference_logins').insert({ user_id: made.data.user.id, conference_id: conferenceId, username, created_by: locals.who!.id });
  if (row.error) {
    await sc.auth.admin.deleteUser(made.data.user.id);          // undo, so no orphan account is left behind
    return row.error.code === '23505' ? json({ error: 'That username is taken.' }, 409) : json({ error: 'Could not create the login.' }, 500);
  }
  return json({ ok: true, username });
};

async function target(locals: App.Locals, userId: string) {
  const sc = serviceClient();
  const { data: l } = await sc.from('ch_conference_logins').select('user_id, conference_id').eq('user_id', userId).maybeSingle();
  if (!l) return { sc, error: json({ error: 'Login not found.' }, 404) };
  const denied = await gate(locals, l.conference_id);
  return { sc, error: denied };
}

// Reset a password. Anyone signed in as that login is signed out.
export const PATCH: APIRoute = async ({ request, locals, url }) => {
  const b = await body(request, url.origin);
  if (!b) return json({ error: 'Bad request.' }, 400);
  const userId = String(b.userId ?? ''), password = String(b.password ?? '');
  const { sc, error } = await target(locals, userId); if (error) return error;
  if (password.length < MIN_PASSWORD || new TextEncoder().encode(password).length > MAX_PASSWORD) return json({ error: `Passwords need ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.` }, 400);
  const r = await sc.auth.admin.updateUserById(userId, { password });
  if (r.error) return json({ error: 'Could not change the password.' }, 500);
  await sc.rpc('revoke_sessions', { uid: userId });   // league migration 4
  return json({ ok: true });
};

// Remove one. Its row goes with it.
export const DELETE: APIRoute = async ({ request, locals, url }) => {
  const b = await body(request, url.origin);
  if (!b) return json({ error: 'Bad request.' }, 400);
  const { sc, error } = await target(locals, String(b.userId ?? '')); if (error) return error;
  const r = await sc.auth.admin.deleteUser(String(b.userId));
  return r.error ? json({ error: 'Could not remove the login.' }, 500) : json({ ok: true });
};
