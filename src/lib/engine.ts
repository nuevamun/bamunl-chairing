// The whole session is an append-only list of events. Everything the screens show is derived from it,
// so undo is just another event, the projector and the chair console can never disagree, and the log
// can be synced to a database later without changing any of this.

export type Delegate = { id: string; name: string };

export type MotionField = { key: string; label: string; unit: 'min' | 's' | ''; def: number };
export type MotionType = {
  key: string;
  label: string;
  /** What passing it does. 'none' just records it. */
  effect: 'mod' | 'unmod' | 'speaktime' | 'close' | 'none';
  fields: MotionField[];
};
export type Config = {
  /** Seconds each speaker gets on the general speakers list. */
  speakTime: number;
  majority: 'simple' | 'twothirds';
  /** In order of precedence, most disruptive first. Conferences differ, so this is data, not code. */
  motions: MotionType[];
};

export const DEFAULT_CONFIG: Config = {
  speakTime: 60,
  majority: 'simple',
  motions: [
    { key: 'unmod', label: 'Unmoderated caucus', effect: 'unmod', fields: [{ key: 'total', label: 'Total', unit: 'min', def: 10 }] },
    { key: 'mod', label: 'Moderated caucus', effect: 'mod', fields: [{ key: 'total', label: 'Total', unit: 'min', def: 10 }, { key: 'per', label: 'Per speaker', unit: 's', def: 45 }] },
    { key: 'speaktime', label: 'Change speaking time', effect: 'speaktime', fields: [{ key: 'per', label: 'Per speaker', unit: 's', def: 45 }] },
    { key: 'close', label: 'Close the speakers list', effect: 'close', fields: [] },
    { key: 'other', label: 'Other motion', effect: 'none', fields: [{ key: 'time', label: 'Time', unit: 'min', def: 0 }] },
  ],
};

export type Ev = { id: string; t: number; type: string; [k: string]: any };
export type Committee = { id: string; name: string; conference: string; config: Config; delegates: Delegate[]; events: Ev[]; conferenceId?: string; /** ms; set when deleted, kept for TRASH_DAYS so it can be restored */ deletedAt?: number };
export const TRASH_DAYS = 30;
/** A conference holds committees. Deleting one hides its committees too; restoring brings them back. */
export type Conference = { id: string; name: string; /** the club (school) that owns it; subadmins see only their own club's, the master sees all */ schoolId?: string; deletedAt?: number };

export type Attendance = 'present' | 'pv' | 'absent';
export type Mode = { kind: 'gsl' } | { kind: 'mod'; total: number; per: number; startedAt: number; label: string } | { kind: 'unmod'; total: number; startedAt: number; label: string };
export type Speech = {
  id: string; d: string; allotted: number; used: number; left: number; over: number;
  end: 'done' | 'chair' | 'delegate' | 'questions'; to?: string; mode: 'gsl' | 'mod'; t: number;
};
export type Floor = { id: string; key: string; label: string; params: Record<string, number>; note: string; by: string };
export type MotionRecord = Floor & { yes: number; no: number; abstain: number; result: 'passed' | 'failed' | 'withdrawn'; t: number };
export type Note = { id: string; d: string; text: string; tag: string; t: number };
export type Score = { d: string; cat: string; v: number };
export type Speaking = { d: string; allotted: number; acc: number; since: number | null; mode: 'gsl' | 'mod'; start: number };

export type State = {
  attendance: Record<string, Attendance>;
  lists: { gsl: string[]; mod: string[] };
  closed: boolean;
  speakTime: number;
  mode: Mode;
  speaking: Speaking | null;
  /** Motions proposed and not yet decided, most disruptive first (the config's order is the precedence). */
  proposed: Floor[];
  speeches: Speech[];
  motions: MotionRecord[];
  notes: Note[];
  scores: Score[];
  listed: Record<string, number>;
  eventCount: number;
};

export const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

/** Events that count: everything except what an `undo` cancelled, and the undo events themselves. */
export function effective(events: Ev[]): Ev[] {
  const dead = new Set(events.filter((e) => e.type === 'undo').map((e) => e.target));
  return events.filter((e) => e.type !== 'undo' && !dead.has(e.id));
}

export function passes(majority: Config['majority'], yes: number, no: number) {
  if (yes + no === 0) return false;
  return majority === 'twothirds' ? yes * 3 >= (yes + no) * 2 : yes > no;
}

export function derive(c: Committee): State {
  const s: State = {
    attendance: {}, lists: { gsl: [], mod: [] }, closed: false, speakTime: c.config.speakTime, mode: { kind: 'gsl' },
    speaking: null, proposed: [], speeches: [], motions: [], notes: [], scores: [], listed: {}, eventCount: 0,
  };
  const key = (): 'gsl' | 'mod' => (s.mode.kind === 'mod' ? 'mod' : 'gsl');
  const finish = (e: Ev, how: Speech['end'], to?: string) => {
    const sp = s.speaking;
    if (!sp) return;
    let used = sp.acc + (sp.since != null ? e.t - sp.since : 0);
    used = Math.max(0, Math.round(used / 1000));
    s.speeches.push({
      id: e.id, d: sp.d, allotted: sp.allotted, used, left: Math.max(0, sp.allotted - used), over: Math.max(0, used - sp.allotted),
      end: how, to, mode: sp.mode, t: sp.start,
    });
    s.speaking = null;
  };

  for (const e of effective(c.events)) {
    s.eventCount++;
    switch (e.type) {
      case 'attend': s.attendance[e.d] = e.s; break;
      case 'add': {
        const k = key();
        if (!s.closed && !s.lists[k].includes(e.d)) { s.lists[k].push(e.d); s.listed[e.d] = (s.listed[e.d] ?? 0) + 1; }
        break;
      }
      case 'drop': s.lists.gsl = s.lists.gsl.filter((x) => x !== e.d); s.lists.mod = s.lists.mod.filter((x) => x !== e.d); break;
      case 'move': {
        const k = key(); const a = s.lists[k]; const i = a.indexOf(e.d); const j = i + e.by;
        if (i >= 0 && j >= 0 && j < a.length) { [a[i], a[j]] = [a[j], a[i]]; }
        break;
      }
      case 'start': {
        if (s.speaking) finish(e, 'done');
        const k = key();
        s.lists[k] = s.lists[k].filter((x) => x !== e.d);
        const allotted = e.allotted ?? (s.mode.kind === 'mod' ? s.mode.per : s.speakTime);
        s.speaking = { d: e.d, allotted, acc: 0, since: e.t, mode: k, start: e.t };
        break;
      }
      case 'pause': if (s.speaking?.since != null) { s.speaking.acc += e.t - s.speaking.since; s.speaking.since = null; } break;
      case 'resume': if (s.speaking && s.speaking.since == null) s.speaking.since = e.t; break;
      case 'stop': finish(e, e.how ?? 'done', e.to); break;
      case 'floor': {
        const type = c.config.motions.find((m) => m.key === e.key);
        s.proposed.push({ id: e.id, key: e.key, label: (e.name && String(e.name).trim()) || type?.label || e.key, params: e.params ?? {}, note: e.note ?? '', by: e.by ?? '' });
        const rank = (m: Floor) => { const i = c.config.motions.findIndex((x) => x.key === m.key); return i < 0 ? 999 : i; };
        s.proposed.sort((x, y) => rank(x) - rank(y));   // stable: same kind stays in the order proposed
        break;
      }
      case 'withdraw': {
        const f = s.proposed.find((m) => m.id === e.target);
        if (f) { s.motions.push({ ...f, yes: 0, no: 0, abstain: 0, result: 'withdrawn', t: e.t }); s.proposed = s.proposed.filter((m) => m !== f); }
        break;
      }
      case 'clear_proposed':
        for (const f of s.proposed) s.motions.push({ ...f, yes: 0, no: 0, abstain: 0, result: 'withdrawn', t: e.t });
        s.proposed = [];
        break;
      case 'vote': {
        // The chair says whether it passed. Counts are optional; with counts and no stated result the majority rule decides.
        const f = s.proposed.find((m) => m.id === e.target) ?? (e.target ? undefined : s.proposed[0]);
        if (!f) break;
        const ok = e.result ? e.result === 'passed' : passes(c.config.majority, e.yes ?? 0, e.no ?? 0);
        s.motions.push({ ...f, yes: e.yes ?? 0, no: e.no ?? 0, abstain: e.abstain ?? 0, result: ok ? 'passed' : 'failed', t: e.t });
        s.proposed = s.proposed.filter((m) => m !== f);
        if (!ok) break;
        const type = c.config.motions.find((m) => m.key === f.key);
        if (type?.effect === 'mod') { s.mode = { kind: 'mod', total: (f.params.total ?? 0) * 60, per: f.params.per ?? 45, startedAt: e.t, label: f.label }; s.lists.mod = []; }
        else if (type?.effect === 'unmod') s.mode = { kind: 'unmod', total: (f.params.total ?? 0) * 60, startedAt: e.t, label: f.label };
        else if (type?.effect === 'speaktime') s.speakTime = f.params.per ?? s.speakTime;
        else if (type?.effect === 'close') s.closed = true;
        break;
      }
      case 'end_caucus': if (s.speaking?.mode === 'mod') finish(e, 'done'); s.mode = { kind: 'gsl' }; break;
      case 'note': s.notes.push({ id: e.id, d: e.d, text: e.text, tag: e.tag ?? '', t: e.t }); break;
      case 'score': {
        const i = s.scores.findIndex((x) => x.d === e.d && x.cat === e.cat);
        if (i >= 0) s.scores[i].v = e.v; else s.scores.push({ d: e.d, cat: e.cat, v: e.v });
        break;
      }
    }
  }
  return s;
}

/** Seconds the current speaker has used, counting a running clock up to `now`. */
export function elapsed(sp: Speaking | null, now: number) {
  if (!sp) return 0;
  return (sp.acc + (sp.since != null ? now - sp.since : 0)) / 1000;
}

export type Stat = {
  d: string; speeches: number; used: number; allotted: number; left: number; over: number;
  yieldedToChair: number; listedNotCalled: number; avgUsedPct: number | null;
};

/** Per-delegate numbers. "Left on the table" is allotted minus used, summed over finished speeches. */
export function statsFor(c: Committee, s: State): Stat[] {
  return c.delegates.map((dl) => {
    const mine = s.speeches.filter((x) => x.d === dl.id);
    const used = mine.reduce((a, x) => a + x.used, 0);
    const allotted = mine.reduce((a, x) => a + x.allotted, 0);
    const onList = s.lists.gsl.includes(dl.id) || s.lists.mod.includes(dl.id) ? 1 : 0;
    const dropped = Math.max(0, (s.listed[dl.id] ?? 0) - mine.length - onList);
    return {
      d: dl.id, speeches: mine.length, used, allotted,
      left: mine.reduce((a, x) => a + x.left, 0), over: mine.reduce((a, x) => a + x.over, 0),
      yieldedToChair: mine.filter((x) => x.end === 'chair').length,
      listedNotCalled: dropped + onList,
      avgUsedPct: allotted ? Math.round((Math.min(used, allotted) / allotted) * 100) : null,
    };
  });
}

export const clock = (sec: number) => {
  const n = Math.max(0, Math.round(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

export const AWARD_CATEGORIES = ['Substance', 'Procedure', 'Diplomacy', 'Collaboration', 'Speaking'];
export const NOTE_TAGS = ['Strength', 'Work on', 'Award', 'Follow up'];

export function newCommittee(name: string, conference = '', conferenceId?: string): Committee {
  return { id: uid(), name, conference, conferenceId, config: structuredClone(DEFAULT_CONFIG), delegates: [], events: [] };
}
export const ev = (type: string, rest: Record<string, any> = {}): Ev => ({ id: uid(), t: Date.now(), type, ...rest });
