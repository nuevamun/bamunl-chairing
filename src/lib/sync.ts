// Local-first sync. The browser copy is always the working copy; this pushes new events to Supabase in
// batches whenever it can and pulls the committees the signed-in chair is assigned to.
// Events are insert-only and keyed by a client-made id, so a retried or duplicated batch changes nothing.
import { supabase } from './supabase';
import { store } from './store';
import { DEFAULT_CONFIG, TRASH_DAYS, type Committee, type Ev } from './engine';

// Logins are the league admin's: a username the master created, mapped to a made-up address (see league-admin/src/lib/auth.ts).
import { adminEmail, confEmail } from './logins';

const SYNCED = 'chairing:synced';      // ids of events the database already has
const LINKED = 'chairing:linked';
const CLINKED = 'chairing:clinked';    // conferences that exist in the database      // committees that exist in the database
const rd = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; } };
const wr = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export type Status = { state: 'off' | 'signed-out' | 'idle' | 'syncing' | 'error'; who?: string; pending: number; message?: string };
let status: Status = { state: supabase ? 'signed-out' : 'off', pending: 0 };
const fns: Array<(s: Status) => void> = [];
const set = (p: Partial<Status>) => { status = { ...status, ...p }; fns.forEach((f) => f(status)); };
export const onStatus = (f: (s: Status) => void) => { fns.push(f); f(status); };

const toBody = (e: Ev) => { const { id, t, type, ...body } = e; return body; };
const fromRow = (r: any): Ev => ({ id: r.id, t: new Date(r.t).getTime(), type: r.type, ...r.body });

function pendingCount() {
  const done = new Set(rd(SYNCED)); const linked = new Set(rd(LINKED));
  return store.everything().filter((c) => linked.has(c.id)).reduce((n, c) => n + c.events.filter((e) => !done.has(e.id)).length, 0);
}

export async function signIn(username: string, password: string) {
  if (!supabase) return 'Sync is not set up.';
  // Two kinds of login: a league admin login, or a conference-only login. They have different address endings.
  let r = await supabase.auth.signInWithPassword({ email: adminEmail(username), password });
  if (r.error) r = await supabase.auth.signInWithPassword({ email: confEmail(username), password });
  if (r.error || !r.data.user) return 'That username and password don’t match.';
  const who = await me();
  if (!who) { await supabase.auth.signOut(); return 'That login isn’t set up for anything yet. Ask the league.'; }
  await sync();
  return '';
}
export async function signOut() {
  // Send anything still waiting, then clear this device so the next person to sign in can't see this one's committees.
  try { await sync(); } catch { /* offline: those changes are lost, and the next sign-in says so */ }
  wipeLocal();
  await supabase?.auth.signOut();
  set({ state: 'signed-out', who: undefined });
}

const LOCAL_KEYS = ['chairing:v1', 'chairing:confs:v1', SYNCED, LINKED, CLINKED, 'chairing:meta', 'chairing:cmeta', 'chairing:me', 'chairing:schools', 'chairing:owner'];
function wipeLocal() { for (const k of LOCAL_KEYS) try { localStorage.removeItem(k); } catch { /* ignore */ } }

let running = false;
export async function sync() {
  if (!supabase || running) return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return set({ state: 'signed-out', who: undefined, pending: 0 });
  // A different person on this device? Never show them the last person's committees.
  try {
    const prev = localStorage.getItem('chairing:owner');
    if (prev && prev !== user.id) { wipeLocal(); location.reload(); return; }
    localStorage.setItem('chairing:owner', user.id);
  } catch { /* ignore */ }
  running = true; set({ state: 'syncing', who: user.email?.replace(/@.*/, '') ?? '' });
  try {
    if ((await me())?.role === 'admin') await pullSchools();
    await pushConferences();
    await pushCommittees();     // first, so a local delete or restore isn't overwritten by the pull
    await pull();
    await purge();
    await pushEvents();
    set({ state: 'idle', pending: pendingCount(), message: undefined });
  } catch (e: any) {
    set({ state: 'error', pending: pendingCount(), message: navigator.onLine ? String(e?.message ?? e) : 'Offline. Changes are kept here and sent when you reconnect.' });
  } finally { running = false; }
}

const ME = 'chairing:me', SCHOOLS = 'chairing:schools';
/** Who is signed in, as last seen: a subadmin owns one school, the master has none and can see every school's work. */
export function session(): { role: 'admin' | 'school' | 'conference' | null; schoolId: string | null; conferenceId: string | null } {
  try { const m = JSON.parse(localStorage.getItem(ME) ?? 'null'); return m ? { conferenceId: null, ...m } : { role: null, schoolId: null, conferenceId: null }; } catch { return { role: null, schoolId: null, conferenceId: null }; }
}
export function schools(): Array<{ id: string; name: string }> { try { return JSON.parse(localStorage.getItem(SCHOOLS) ?? '[]'); } catch { return []; } }
export const schoolName = (id?: string) => schools().find((x) => x.id === id)?.name ?? '';

async function me() {
  const { data } = await supabase!.from('members').select('role, school_id').maybeSingle();
  const m = data as { role: 'admin' | 'school'; school_id: string | null } | null;
  let kept: object | null = null;
  if (m) kept = { role: m.role, schoolId: m.school_id };
  else {
    const { data: l } = await supabase!.from('ch_conference_logins').select('conference_id').maybeSingle();
    if (l) kept = { role: 'conference', schoolId: null, conferenceId: l.conference_id };
  }
  if (kept) try { localStorage.setItem(ME, JSON.stringify(kept)); } catch { /* ignore */ }
  return kept ? (m ?? { role: 'conference' as const, school_id: null }) : null;
}

/** The master picks a school when adding a conference, and sees whose each one is. */
async function pullSchools() {
  const { data } = await supabase!.from('schools').select('id, name').order('name');
  if (data) try { localStorage.setItem(SCHOOLS, JSON.stringify(data)); } catch { /* ignore */ }
}

/** Deleted more than TRASH_DAYS ago: gone for good. A conference takes its committees, their delegates and logs with it (on delete cascade). */
async function purge() {
  const cutoff = Date.now() - TRASH_DAYS * 86_400_000;
  for (const f of store.confTrash().filter((x) => (x.deletedAt ?? Infinity) < cutoff)) {
    const { error } = await supabase!.from('ch_conferences').delete().eq('id', f.id);
    if (!error) store.removeConf(f.id);
  }
  for (const c of store.trash().filter((x) => (x.deletedAt ?? Infinity) < cutoff)) {
    const { error } = await supabase!.from('ch_committees').delete().eq('id', c.id);
    if (!error) store.remove(c.id);
  }
}

async function pull() {
  const db = supabase!;
  // Row-level security returns only this school's conferences and committees (the master gets all of them).
  const fs = await db.from('ch_conferences').select('id, name, school_id, deleted_at').order('created_at');
  if (fs.error) throw fs.error;
  for (const f of fs.data ?? []) store.putConf({ id: f.id, name: f.name, schoolId: f.school_id, deletedAt: f.deleted_at ? new Date(f.deleted_at).getTime() : undefined }, true);
  wr(CLINKED, [...new Set([...rd(CLINKED), ...(fs.data ?? []).map((f) => f.id as string)])]);
  const cs = await db.from('ch_committees').select('id, name, conference, conference_id, config, deleted_at').order('created_at');
  if (cs.error) throw cs.error;
  const rows = cs.data ?? [];
  const ids = rows.map((c) => c.id as string);
  wr(LINKED, [...new Set([...rd(LINKED), ...ids])]);
  if (!ids.length) return;
  const [ds, es] = await Promise.all([
    db.from('ch_delegates').select('id, committee_id, name').in('committee_id', ids).order('sort'),
    db.from('ch_events').select('id, t, type, body, committee_id').in('committee_id', ids).order('t').limit(20000),
  ]);
  for (const r of [ds, es]) if (r.error) throw r.error;
  const synced = new Set(rd(SYNCED));
  for (const row of rows) {
    const mine = store.get(row.id);
    const deletedAt = row.deleted_at ? new Date(row.deleted_at).getTime() : undefined;
    const remoteDel = (ds.data ?? []).filter((d) => d.committee_id === row.id).map((d) => ({ id: d.id, name: d.name }));
    const remoteEv = (es.data ?? []).filter((x) => x.committee_id === row.id).map(fromRow);
    remoteEv.forEach((x) => synced.add(x.id));
    const c: Committee = mine ?? { id: row.id, name: row.name, conference: row.conference ?? '', config: { ...DEFAULT_CONFIG, ...(row.config ?? {}) }, delegates: [], events: [], deletedAt, conferenceId: row.conference_id ?? undefined };
    c.deletedAt = deletedAt;
    if (row.conference_id) c.conferenceId = row.conference_id;     // the database wins; local edits were sent first (see sync)
    const have = new Set(c.events.map((x) => x.id));
    c.events = [...c.events, ...remoteEv.filter((x) => !have.has(x.id))].sort((a, b) => a.t - b.t);
    const haveD = new Set(c.delegates.map((d) => d.id));
    c.delegates = [...c.delegates, ...remoteDel.filter((d) => !haveD.has(d.id))];
    store.put(c, true);
  }
  wr(SYNCED, [...synced]);
}

async function pushConferences() {
  const db = supabase!;
  const who = await me();
  if (who?.role === 'conference') return;    // a conference-only login can't create or rename conferences
  const linked = new Set(rd(CLINKED));
  let hashes: Record<string, string> = {};
  try { hashes = JSON.parse(localStorage.getItem('chairing:cmeta') ?? '{}'); } catch { /* start over */ }
  for (const f of store.confEverything()) {
    const row = { name: f.name, deleted_at: f.deletedAt ? new Date(f.deletedAt).toISOString() : null };
    const owner = f.schoolId ?? who?.school_id;
    if (!owner) continue;                   // a master-made conference with no school picked stays on this device
    if (!linked.has(f.id)) {
      const { error } = await db.from('ch_conferences').upsert({ id: f.id, school_id: owner, ...row }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      linked.add(f.id);
    } else if (hashes[f.id] !== JSON.stringify(row)) {
      const { error } = await db.from('ch_conferences').update(row).eq('id', f.id);
      if (error) throw error;
    }
    hashes[f.id] = JSON.stringify(row);
  }
  wr(CLINKED, [...linked]);
  try { localStorage.setItem('chairing:cmeta', JSON.stringify(hashes)); } catch { /* ignore */ }
}

async function pushCommittees() {
  const db = supabase!;
  const who = await me();
  // A committee made on this device joins the database under the signed-in school.
  // The master has no school, so a committee they make stays on this device.
  const linked = new Set(rd(LINKED));
  {
    for (const c of store.everything().filter((x) => !linked.has(x.id))) {
      const owner = (c.conferenceId && store.conf(c.conferenceId)?.schoolId) || who?.school_id;
      if (!owner) continue;
      const { error } = await db.from('ch_committees').upsert({ id: c.id, school_id: owner, name: c.name, conference: c.conference, conference_id: c.conferenceId ?? null, config: c.config, deleted_at: c.deletedAt ? new Date(c.deletedAt).toISOString() : null }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      linked.add(c.id);
    }
    wr(LINKED, [...linked]);
  }
  // Name, conference and settings edits.
  let hashes: Record<string, string> = {};
  try { hashes = JSON.parse(localStorage.getItem('chairing:meta') ?? '{}'); } catch { /* start over */ }
  for (const c of store.everything().filter((x) => linked.has(x.id))) {
    const meta = JSON.stringify({ n: c.name, f: c.conference, g: c.config, x: c.deletedAt ?? null, k: c.conferenceId ?? null });
    if (hashes[c.id] === meta) continue;
    const { error } = await db.from('ch_committees').update({ name: c.name, conference: c.conference, conference_id: c.conferenceId ?? null, config: c.config, deleted_at: c.deletedAt ? new Date(c.deletedAt).toISOString() : null }).eq('id', c.id);
    if (error) throw error;
    hashes[c.id] = meta;
  }
  try { localStorage.setItem('chairing:meta', JSON.stringify(hashes)); } catch { /* ignore */ }
}

async function pushEvents() {
  const db = supabase!;
  const linked = new Set(rd(LINKED));
  const done = new Set(rd(SYNCED));
  for (const c of store.everything().filter((x) => linked.has(x.id) && !x.deletedAt)) {
    if (c.delegates.length) {
      const { error } = await db.from('ch_delegates').upsert(c.delegates.map((d, i) => ({ id: d.id, committee_id: c.id, name: d.name, sort: i })), { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
    }
    const todo = c.events.filter((e) => !done.has(e.id));
    for (let i = 0; i < todo.length; i += 200) {
      const chunk = todo.slice(i, i + 200);
      const { error } = await db.from('ch_events').upsert(chunk.map((e) => ({ id: e.id, committee_id: c.id, t: new Date(e.t).toISOString(), type: e.type, body: toBody(e) })), { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      chunk.forEach((e) => done.add(e.id));
      wr(SYNCED, [...done]);
    }
  }
}

/** Call once per page. Syncs now, again shortly after any local change, when the network returns, and every minute. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Early local builds used short ids; the database needs UUIDs. Rewrites them once, keeping every event's delegate link. */
function fixIds() {
  for (const c of store.everything()) {
    const map = new Map<string, string>();
    for (const d of c.delegates) if (!UUID.test(d.id)) { const n = crypto.randomUUID(); map.set(d.id, n); d.id = n; }
    const badCommittee = !UUID.test(c.id);
    if (!map.size && !badCommittee) continue;
    for (const e of c.events) if (e.d && map.has(e.d)) e.d = map.get(e.d);
    if (badCommittee) { store.remove(c.id); c.id = crypto.randomUUID(); }
    store.put(c);
    if (badCommittee && location.pathname.startsWith('/c/')) location.replace(`/c/${c.id}`);
  }
}

export function startSync() {
  if (!supabase) return;
  fixIds();
  store.migrate();
  let t: number | undefined;
  const later = () => { clearTimeout(t); t = window.setTimeout(sync, 3000); };
  addEventListener('chairing:dirty', () => { set({ pending: pendingCount() }); later(); });
  addEventListener('online', sync);
  setInterval(sync, 60_000);
  sync();
}

/** Checks the signed-in person's password again (for deletes). Returns '' if it's right, otherwise a message. */
export async function verifyPassword(password: string): Promise<string> {
  if (!supabase) return 'Sign in to delete.';
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) return 'Sign in to delete.';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? 'That password doesn’t match.' : '';
}
