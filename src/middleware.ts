// Every page and API route needs a login: a league admin login (a row in `members`: subadmins and the master)
// or a conference-only login (a row in ch_conference_logins). Only /login is open.
import { defineMiddleware } from 'astro:middleware';
import { userClient } from './lib/server';

export const onRequest = defineMiddleware(async ({ request, cookies, locals, url, redirect }, next) => {
  if (!import.meta.env.PUBLIC_SUPABASE_URL || !import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) return new Response('Not configured', { status: 503 });
  const db = userClient(request, cookies);
  locals.db = db as any;
  locals.who = null;

  const { data } = await db.auth.getUser();                     // asks Supabase, so a forged cookie fails
  if (data.user) {
    const { data: m } = await db.from('members').select('role, school_id').eq('user_id', data.user.id).maybeSingle();
    if (m) locals.who = { id: data.user.id, kind: 'member', role: m.role, schoolId: m.school_id, conferenceId: null };
    else {
      const { data: l } = await db.from('ch_conference_logins').select('conference_id').eq('user_id', data.user.id).maybeSingle();
      if (l) locals.who = { id: data.user.id, kind: 'conference', role: null, schoolId: null, conferenceId: l.conference_id };
    }
  }

  if (url.pathname === '/sw.js') return next();      // the service worker file is public (on Vercel it is served before this runs)
  const open = url.pathname === '/login';
  if (!locals.who && !open) return url.pathname.startsWith('/api/') ? new Response('Sign in first', { status: 401 }) : redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  if (locals.who && open) return redirect('/');
  const res = await next();
  try { res.headers.set('Cache-Control', 'private, no-store'); } catch { /* immutable response */ }
  return res;
});
