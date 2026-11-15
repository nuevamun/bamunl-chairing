// Local-first sync. The browser copy is always the working copy; this pushes new events to Supabase in
// batches whenever it can and pulls the committees the signed-in chair is assigned to.
// Events are insert-only and keyed by a client-made id, so a retried or duplicated batch changes nothing.
import { supabase } from './supabase';
import { store } from './store';
import { DEFAULT_CONFIG, type Committee, type Ev } from './engine';

// Logins are the league admin's: a username the master created, mapped to a made-up address (see league-admin/src/lib/auth.ts).
const toEmail = (u: string) => `${u.trim().toLowerCase()}@users.bamunl.org`;

const SYNCED = 'chairing:synced';      // ids of events the database already has
const LINKED = 'chairing:linked';      // committees that exist in the database
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
  return store.all().filter((c) => linked.has(c.id)).reduce((n, c) => n + c.events.filter((e) => !done.has(e.id)).length, 0);
}

export async function signIn(username: string, password: string) {
  if (!supabase) return 'Sync is not set up.';
  const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(username), password });
  if (error) return 'That username and password don’t match.';
  const { data: m } = await supabase.from('members').select('role').eq('user_id', data.user.id).maybeSingle();
  if (!m) { await supabase.auth.signOut(); return 'That login isn’t set up for anything yet. Ask the league.'; }
  await sync();
  return '';
}
export async function signOut() { await supabase?.auth.signOut(); set({ state: 'signed-out', who: undefined }); }

let running = false;
export async function sync() {
  if (!supabase || running) return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return set({ state: 'signed-out', who: undefined, pending: 0 });
  running = true; set({ state: 'syncing', who: user.email ?? '' });
  try {
    await pull();
    await push();
    set({ state: 'idle', pending: pendingCount(), message: undefined });
  } catch (e: any) {
    set({ state: 'error', pending: pendingCount(), message: navigator.onLine ? String(e?.message ?? e) : 'Offline. Changes are kept here and sent when you reconnect.' });
  } finally { running = false; }
}

async function me() {
  const { data } = await supabase!.from('members').select('role, school_id').maybeSingle();
  return data as { role: 'admin' | 'school'; school_id: string | null } | null;
}

async function pull() {
  const db = supabase!;
  // Row-level security returns only this school's committees (the master gets all of them).
  const cs = await db.from('ch_committees').select('id, name, conference, config').order('created_at');
  if (cs.error) throw cs.error;
  const ids = (cs.data ?? []).map((c) => c.id as string);
  wr(LINKED, [...new Set([...rd(LINKED), ...ids])]);
  if (!ids.length) return;
  const [ds, es] = await Promise.all([
    db.from('ch_delegates').select('id, committee_id, name').in('committee_id', ids).order('sort'),
    db.from('ch_events').select('id, t, type, body, committee_id').in('committee_id', ids).order('t').limit(20000),
  ]);
  for (const r of [ds, es]) if (r.error) throw r.error;
  const synced = new Set(rd(SYNCED));
  for (const row of cs.data ?? []) {
    const mine = store.get(row.id);
    const remoteDel = (ds.data ?? []).filter((d) => d.committee_id === row.id).map((d) => ({ id: d.id, name: d.name }));
    const remoteEv = (es.data ?? []).filter((x) => x.committee_id === row.id).map(fromRow);
    remoteEv.forEach((x) => synced.add(x.id));
    const c: Committee = mine ?? { id: row.id, name: row.name, conference: row.conference ?? '', config: { ...DEFAULT_CONFIG, ...(row.config ?? {}) }, delegates: [], events: [] };
    const have = new Set(c.events.map((x) => x.id));
    c.events = [...c.events, ...remoteEv.filter((x) => !have.has(x.id))].sort((a, b) => a.t - b.t);
    const haveD = new Set(c.delegates.map((d) => d.id));
    c.delegates = [...c.delegates, ...remoteDel.filter((d) => !haveD.has(d.id))];
    store.put(c);
  }
  wr(SYNCED, [...synced]);
}

async function push() {
  const db = supabase!;
  const who = await me();
  // A committee made on this device joins the database under the signed-in school.
  // The master has no school, so a committee they make stays on this device.
  const linked = new Set(rd(LINKED));
  if (who?.school_id) {
    for (const c of store.all().filter((x) => !linked.has(x.id))) {
      const { error } = await db.from('ch_committees').upsert({ id: c.id, school_id: who.school_id, name: c.name, conference: c.conference, config: c.config }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      linked.add(c.id);
    }
    wr(LINKED, [...linked]);
  }
  // Name, conference and settings edits.
  let hashes: Record<string, string> = {};
  try { hashes = JSON.parse(localStorage.getItem('chairing:meta') ?? '{}'); } catch { /* start over */ }
  for (const c of store.all().filter((x) => linked.has(x.id))) {
    const meta = JSON.stringify({ n: c.name, f: c.conference, g: c.config });
    if (hashes[c.id] === meta) continue;
    const { error } = await db.from('ch_committees').update({ name: c.name, conference: c.conference, config: c.config }).eq('id', c.id);
    if (error) throw error;
    hashes[c.id] = meta;
  }
  try { localStorage.setItem('chairing:meta', JSON.stringify(hashes)); } catch { /* ignore */ }

  const done = new Set(rd(SYNCED));
  for (const c of store.all().filter((x) => linked.has(x.id))) {
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
  for (const c of store.all()) {
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
  let t: number | undefined;
  const later = () => { clearTimeout(t); t = window.setTimeout(sync, 3000); };
  addEventListener('chairing:dirty', () => { set({ pending: pendingCount() }); later(); });
  addEventListener('online', sync);
  setInterval(sync, 60_000);
  sync();
}
