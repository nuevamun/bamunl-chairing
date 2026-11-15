// Where conferences and committees live. Today: this browser (localStorage), shared between the chair console
// and the projector window with a BroadcastChannel, so no network is needed in a bad-wifi committee room.
// sync.ts copies it to and from Supabase whenever it can.
import { uid, type Committee, type Conference, type Ev } from './engine';

const CK = 'chairing:v1';          // committees
const FK = 'chairing:confs:v1';    // conferences
const rd = <T>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; } };

class Store {
  private chan: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chairing') : null;
  private fns: Array<() => void> = [];
  constructor() {
    this.chan?.addEventListener('message', () => this.fns.forEach((f) => f()));
    addEventListener('storage', (e) => { if (e.key === CK || e.key === FK) this.fns.forEach((f) => f()); });
  }
  private write(key: string, list: unknown[]) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage full or blocked: stays in memory only */ }
    this.chan?.postMessage('changed');
    dispatchEvent(new Event('chairing:dirty'));
  }
  subscribe(fn: () => void) { this.fns.push(fn); }

  // ---- committees ----
  /** Not deleted, and not inside a deleted conference. Pass a conference id to narrow it. */
  all(conferenceId?: string): Committee[] {
    const gone = new Set(this.confTrash().map((f) => f.id));
    return rd<Committee>(CK).filter((c) => !c.deletedAt && !(c.conferenceId && gone.has(c.conferenceId)) && (!conferenceId || c.conferenceId === conferenceId));
  }
  /** Deleted committees whose conference still exists, so Restore has somewhere to put them. */
  trash(conferenceId?: string): Committee[] {
    const gone = new Set(this.confTrash().map((f) => f.id));
    return rd<Committee>(CK).filter((c) => c.deletedAt && !(c.conferenceId && gone.has(c.conferenceId)) && (!conferenceId || c.conferenceId === conferenceId));
  }
  everything() { return rd<Committee>(CK); }
  get(id: string) { return rd<Committee>(CK).find((c) => c.id === id); }   // includes deleted ones, so an old link still opens
  put(c: Committee) { const l = rd<Committee>(CK); const i = l.findIndex((x) => x.id === c.id); if (i >= 0) l[i] = c; else l.push(c); this.write(CK, l); }
  /** Permanent. Only the 30-day purge and "delete now" call this. */
  remove(id: string) { this.write(CK, rd<Committee>(CK).filter((c) => c.id !== id)); }
  softDelete(id: string) { const c = this.get(id); if (c) { c.deletedAt = Date.now(); this.put(c); } }
  restore(id: string) { const c = this.get(id); if (c) { delete c.deletedAt; this.put(c); } }
  append(id: string, e: Ev) { const c = this.get(id); if (!c) return; c.events.push(e); this.put(c); return c; }

  // ---- conferences ----
  confs(): Conference[] { return rd<Conference>(FK).filter((f) => !f.deletedAt); }
  confTrash(): Conference[] { return rd<Conference>(FK).filter((f) => f.deletedAt); }
  confEverything() { return rd<Conference>(FK); }
  conf(id: string) { return rd<Conference>(FK).find((f) => f.id === id); }
  putConf(f: Conference) { const l = rd<Conference>(FK); const i = l.findIndex((x) => x.id === f.id); if (i >= 0) l[i] = f; else l.push(f); this.write(FK, l); }
  softDeleteConf(id: string) { const f = this.conf(id); if (f) { f.deletedAt = Date.now(); this.putConf(f); } }
  restoreConf(id: string) { const f = this.conf(id); if (f) { delete f.deletedAt; this.putConf(f); } }
  /** Permanent: the conference and every committee in it. */
  removeConf(id: string) {
    this.write(CK, rd<Committee>(CK).filter((c) => c.conferenceId !== id));
    this.write(FK, rd<Conference>(FK).filter((f) => f.id !== id));
  }
  newConf(name: string, schoolId?: string): Conference { const f: Conference = { id: uid(), name, schoolId }; this.putConf(f); return f; }

  /** Committees made before conferences existed carried a conference name as text. Gives each one a real conference. */
  migrate() {
    const loose = rd<Committee>(CK).filter((c) => !c.conferenceId);
    if (!loose.length) return;
    const byName = new Map(this.confEverything().map((f) => [f.name.toLowerCase(), f]));
    for (const c of loose) {
      const name = c.conference?.trim() || 'My committees';
      let f = byName.get(name.toLowerCase());
      if (!f) { f = this.newConf(name); byName.set(name.toLowerCase(), f); }
      c.conferenceId = f.id; c.conference = f.name;
      this.put(c);
    }
  }
}

export const store = new Store();
