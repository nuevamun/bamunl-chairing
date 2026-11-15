// Where committees live. Today: this browser (localStorage), shared between the chair console and the
// projector window with a BroadcastChannel, so no network is needed in a bad-wifi committee room.
// Later: a Supabase adapter implements the same Store and syncs batches of events when online.
import type { Committee, Ev } from './engine';

export interface Store {
  all(): Committee[];
  get(id: string): Committee | undefined;
  put(c: Committee): void;
  remove(id: string): void;
  append(id: string, e: Ev): Committee | undefined;
  subscribe(fn: () => void): void;
}

const KEY = 'chairing:v1';
const read = (): Committee[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
};

class LocalStore implements Store {
  private chan: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chairing') : null;
  private fns: Array<() => void> = [];
  constructor() {
    this.chan?.addEventListener('message', () => this.fns.forEach((f) => f()));
    addEventListener('storage', (e) => { if (e.key === KEY) this.fns.forEach((f) => f()); });
  }
  private write(list: Committee[]) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked: the session stays in memory only */ }
    this.chan?.postMessage("changed");
    dispatchEvent(new Event("chairing:dirty"));
  }
  all() { return read(); }
  get(id: string) { return read().find((c) => c.id === id); }
  put(c: Committee) { const l = read(); const i = l.findIndex((x) => x.id === c.id); if (i >= 0) l[i] = c; else l.push(c); this.write(l); }
  remove(id: string) { this.write(read().filter((c) => c.id !== id)); }
  append(id: string, e: Ev) { const c = this.get(id); if (!c) return; c.events.push(e); this.put(c); return c; }
  subscribe(fn: () => void) { this.fns.push(fn); }
}

export const store: Store = new LocalStore();
