// The whole session is an append-only list of events. Everything the screens show is derived from it,
// so undo is just another event, the projector and the chair console can never disagree, and the log
// can be synced to a database later without changing any of this.

export type Delegate = { id: string; name: string };

export type MotionField = { key: string; label: string; unit: 'min' | 's' | ''; def: number };
export type MotionType = {
  key: string;
  label: string;
  /** What passing it does. 'none' just records it. */
  effect: 'mod' | 'unmod' | 'roundrobin' | 'openlist' | 'votingbloc' | 'speaktime' | 'close' | 'none';
  /** Overrides the committee's voting rule for this motion, e.g. moving into voting bloc needs two-thirds. */
  majority?: 'simple' | 'twothirds';
  fields: MotionField[];
  /** Asks what the motion is about. Moderated caucuses do by default. */
  topic?: boolean;
};
export const hasTopic = (m: Pick<MotionType, 'effect' | 'topic'> | undefined) => m?.topic ?? m?.effect === 'mod';
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
  // Most disruptive first. The order is the precedence, so the buttons and the pending list follow it.
  motions: [
    { key: 'votingbloc', label: 'Move into voting bloc', effect: 'votingbloc', majority: 'twothirds', fields: [] },
    { key: 'unmod', label: 'Unmoderated caucus', effect: 'unmod', fields: [{ key: 'total', label: 'Total', unit: 'min', def: 10 }] },
    { key: 'mod', label: 'Moderated caucus', effect: 'mod', fields: [{ key: 'total', label: 'Total', unit: 'min', def: 10 }, { key: 'per', label: 'Per speaker', unit: 's', def: 60 }] },
    { key: 'roundrobin', label: 'Round robin', effect: 'roundrobin', fields: [{ key: 'per', label: 'Per speaker', unit: 's', def: 45 }] },
    { key: 'openlist', label: 'Open the speakers list', effect: 'openlist', fields: [] },
    { key: 'other', label: 'Other motion', effect: 'none', fields: [{ key: 'time', label: 'Time', unit: 'min', def: 0 }] },
  ],
};

/** Motions an earlier version offered. Not shown any more, but old committees' records still use them. */
const LEGACY_MOTIONS: MotionType[] = [
  { key: 'suspend', label: 'Suspend the meeting', effect: 'none', fields: [{ key: 'time', label: 'Time', unit: 'min', def: 0 }] },
  { key: 'adjourn', label: 'Adjourn the meeting', effect: 'none', fields: [] },
  { key: 'speaktime', label: 'Change speaking time', effect: 'speaktime', fields: [{ key: 'per', label: 'Per speaker', unit: 's', def: 45 }] },
  { key: 'close', label: 'Close the speakers list', effect: 'close', fields: [] },
];

/**
 * The motion types in precedence order, most disruptive first. Committees saved before a type existed
 * still get it, and a type a conference added of its own goes after the standard ones.
 */
export function motionTypes(config: Config): MotionType[] {
  const mine = new Map(config.motions.map((m) => [m.key, m]));
  // Standard types always use the current fields and defaults; a committee saved earlier keeps only its own tweaks.
  const std = DEFAULT_CONFIG.motions.map((d) => ({ ...d, ...(mine.get(d.key) ?? {}), fields: d.fields }));
  const retired = new Set(LEGACY_MOTIONS.map((m) => m.key));
  const own = config.motions.filter((m) => !DEFAULT_CONFIG.motions.some((d) => d.key === m.key) && !retired.has(m.key));
  const other = std.filter((m) => m.key === 'other'), rest = std.filter((m) => m.key !== 'other');
  return [...rest, ...own, ...other];       // "other" is always last
}
/** Every type that may appear in a record: the ones on offer plus retired ones, so old committees still read correctly. */
export function allTypes(config: Config): MotionType[] {
  const on = motionTypes(config);
  return [...on, ...config.motions.filter((m) => !on.some((x) => x.key === m.key)), ...LEGACY_MOTIONS.filter((m) => !on.some((x) => x.key === m.key) && !config.motions.some((x) => x.key === m.key))];
}
/** The rule that decides this motion: its own, else the committee's. */
export const majorityFor = (config: Config, key: string) => allTypes(config).find((m) => m.key === key)?.majority ?? config.majority;

export type Ev = { id: string; t: number; type: string; [k: string]: any };
export type Committee = { id: string; name: string; conference: string; config: Config; delegates: Delegate[]; events: Ev[]; conferenceId?: string; /** committees made now start with no speakers list; older ones keep the list they had */ needsOpen?: boolean; /** ms; set when deleted, kept for TRASH_DAYS so it can be restored */ deletedAt?: number };
export const TRASH_DAYS = 30;
/** A conference holds committees. Deleting one hides its committees too; restoring brings them back. */
export type Conference = { id: string; name: string; /** the club (school) that owns it; subadmins see only their own club's, the master sees all */ schoolId?: string; deletedAt?: number };

export type Attendance = 'present' | 'pv' | 'absent';
export type Mode = { kind: 'gsl' } | { kind: 'mod'; total: number; per: number; /** null until the caucus clock starts: with the first speaker, or when the chair starts it */ startedAt: number | null; label: string; /** what the caucus is about */ topic: string; /** who proposed it, and whether they chose to speak first or last ('' = not chosen yet) */ proposer: string; slot: '' | 'first' | 'last' | 'none'; /** when they chose last, they stay at the end of the list */ lastD: string; /** a round robin: everyone present speaks once, no caucus clock */ rr?: boolean }
  | { kind: 'voting'; startedAt: number; label: string } | { kind: 'unmod'; total: number; startedAt: number; label: string };
export type Speech = {
  id: string; d: string; allotted: number; used: number; left: number; over: number;
  end: 'done' | 'chair' | 'delegate' | 'questions'; to?: string; mode: 'gsl' | 'mod'; t: number;
};
export type Floor = { id: string; key: string; label: string; params: Record<string, number>; note: string; by: string; topic?: string; /** changed after it was proposed */ amended?: boolean };
export type MotionRecord = Floor & { yes: number; no: number; abstain: number; result: 'passed' | 'failed' | 'withdrawn'; t: number };
export type Note = { id: string; d: string; text: string; tag: string; t: number };
export type Score = { d: string; cat: string; v: number };
export type Speaking = { d: string; allotted: number; acc: number; since: number | null; mode: 'gsl' | 'mod'; start: number };

export type State = {
  attendance: Record<string, Attendance>;
  lists: { gsl: string[]; mod: string[] };
  /** The general speakers list exists only once a motion has opened it. A moderated caucus has its own order of speaking. */
  gslOpen: boolean;
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
    attendance: {}, lists: { gsl: [], mod: [] }, gslOpen: !c.needsOpen, speakTime: c.config.speakTime, mode: { kind: 'gsl' },
    speaking: null, proposed: [], speeches: [], motions: [], notes: [], scores: [], listed: {}, eventCount: 0,
  };
  const key = (): 'gsl' | 'mod' => (s.mode.kind === 'mod' ? 'mod' : 'gsl');
  /** Keeps a proposer who chose "last" at the end of the moderated list, however others are added or moved. */
  const settle = () => {
    if (s.mode.kind !== 'mod' || !s.mode.lastD) return;
    const i = s.lists.mod.indexOf(s.mode.lastD);
    if (i >= 0) { s.lists.mod.splice(i, 1); s.lists.mod.push(s.mode.lastD); }
  };
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
        if ((k === 'mod' || s.gslOpen) && !s.lists[k].includes(e.d)) { s.lists[k].push(e.d); s.listed[e.d] = (s.listed[e.d] ?? 0) + 1; }
        settle();
        break;
      }
      case 'drop':
        s.lists.gsl = s.lists.gsl.filter((x) => x !== e.d); s.lists.mod = s.lists.mod.filter((x) => x !== e.d);
        if (s.mode.kind === 'mod' && s.mode.lastD === e.d) s.mode.lastD = '';
        break;
      case 'move': {
        const k = key(); const a = s.lists[k]; const i = a.indexOf(e.d); const j = i + e.by;
        if (i >= 0 && j >= 0 && j < a.length) { [a[i], a[j]] = [a[j], a[i]]; }
        settle();
        break;
      }
      case 'start': {
        if (s.speaking) finish(e, 'done');
        const k = key();
        s.lists[k] = s.lists[k].filter((x) => x !== e.d);
        const allotted = e.allotted ?? (s.mode.kind === 'mod' ? s.mode.per : s.speakTime);
        s.speaking = { d: e.d, allotted, acc: 0, since: e.t, mode: k, start: e.t };
        if (s.mode.kind === 'mod' && s.mode.startedAt == null) s.mode.startedAt = e.t;   // the caucus clock starts with its first speaker
        break;
      }
      case 'pause': if (s.speaking?.since != null) { s.speaking.acc += e.t - s.speaking.since; s.speaking.since = null; } break;
      case 'resume': if (s.speaking && s.speaking.since == null) s.speaking.since = e.t; break;
      case 'stop': finish(e, e.how ?? 'done', e.to); break;
      case 'floor': {
        const type = allTypes(c.config).find((m) => m.key === e.key);
        s.proposed.push({ id: e.id, key: e.key, label: (e.name && String(e.name).trim()) || type?.label || e.key, params: e.params ?? {}, note: e.note ?? '', by: e.by ?? '', topic: String(e.topic ?? '').trim() });
        const rank = (m: Floor) => { const i = allTypes(c.config).findIndex((x) => x.key === m.key); return i < 0 ? 999 : i; };
        s.proposed.sort((x, y) => rank(x) - rank(y));   // stable: same kind stays in the order proposed
        break;
      }
      case 'amend': {
        // Changing a motion's details also changes whose it is: the person who proposed the amendment now owns it.
        const f = s.proposed.find((m) => m.id === e.target);
        if (!f) break;
        if (e.params) f.params = { ...e.params };
        if (e.name && String(e.name).trim()) f.label = String(e.name).trim();
        if (e.by) f.by = e.by;
        if (e.topic !== undefined) f.topic = String(e.topic).trim();
        f.amended = true;
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
        const ok = e.result ? e.result === 'passed' : passes(majorityFor(c.config, f.key), e.yes ?? 0, e.no ?? 0);
        s.motions.push({ ...f, yes: e.yes ?? 0, no: e.no ?? 0, abstain: 0, result: ok ? 'passed' : 'failed', t: e.t });   // procedural motions have no abstentions
        s.proposed = s.proposed.filter((m) => m !== f);
        if (!ok) break;
        // Something passed, so the floor is reset: motions still waiting are moot and are logged as not voted.
        for (const rest of s.proposed) s.motions.push({ ...rest, yes: 0, no: 0, abstain: 0, result: 'withdrawn', t: e.t });
        s.proposed = [];
        const type = allTypes(c.config).find((m) => m.key === f.key);
        if (type?.effect === 'mod') { s.mode = { kind: 'mod', total: (f.params.total ?? 0) * 60, per: f.params.per ?? 45, startedAt: null, label: f.label, topic: f.topic ?? '', proposer: f.by, slot: f.by ? '' : 'none', lastD: '' }; s.lists.mod = []; }
        else if (type?.effect === 'roundrobin') {
          // Everyone present speaks once, in the committee's order. If nobody has been marked present yet, everyone.
          const here = c.delegates.filter((d) => (s.attendance[d.id] ?? 'absent') !== 'absent');
          const all = (here.length ? here : c.delegates).map((d) => d.id);
          s.mode = { kind: 'mod', total: 0, per: f.params.per ?? 45, startedAt: null, label: f.label, topic: '', proposer: '', slot: 'none', lastD: '', rr: true };
          s.lists.mod = all; all.forEach((d) => { s.listed[d] = (s.listed[d] ?? 0) + 1; });
        }
        else if (type?.effect === 'unmod') s.mode = { kind: 'unmod', total: (f.params.total ?? 0) * 60, startedAt: e.t, label: f.label };
        else if (type?.effect === 'votingbloc') { if (s.speaking) finish(e, 'done'); s.mode = { kind: 'voting', startedAt: e.t, label: f.label }; }
        else if (type?.effect === 'openlist') { if (s.speaking?.mode === 'mod') finish(e, 'done'); s.gslOpen = true; s.mode = { kind: 'gsl' }; }
        else if (type?.effect === 'speaktime') s.speakTime = f.params.per ?? s.speakTime;
        else if (type?.effect === 'close') s.gslOpen = false;
        break;
      }
      case 'caucus_start': if (s.mode.kind === 'mod' && s.mode.startedAt == null) s.mode.startedAt = e.t; break;
      case 'proposer_slot': {
        // The proposer of a moderated caucus speaks first, speaks last, or neither.
        if (s.mode.kind !== 'mod' || s.mode.slot || !s.mode.proposer) break;
        const d = s.mode.proposer;
        s.mode.slot = e.slot;
        s.lists.mod = s.lists.mod.filter((x) => x !== d);
        if (e.slot === 'first') s.lists.mod.unshift(d);
        else if (e.slot === 'last') { s.lists.mod.push(d); s.mode.lastD = d; }
        if (e.slot !== 'none') s.listed[d] = (s.listed[d] ?? 0) + 1;
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
  return { id: uid(), name, conference, conferenceId, needsOpen: true, config: structuredClone(DEFAULT_CONFIG), delegates: [], events: [] };
}
export const ev = (type: string, rest: Record<string, any> = {}): Ev => ({ id: uid(), t: Date.now(), type, ...rest });

/**
 * Turns pasted text into delegate names. Handles every kind of line break (Windows, old Mac, Word and Google Docs'
 * soft breaks), tab- or semicolon-separated rows from a spreadsheet, and list markers like "1." "-" "•".
 * Commas are left alone, since names like "Korea, Republic of" contain them. Duplicates are dropped.
 */
export function parseNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\r\n\u000b\u000c\u0085\u2028\u2029]+|\t+|;+/)) {
    const name = raw.replace(/^\s*(?:[-*•·▪‣–—]+|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name.slice(0, 120));
  }
  return out;
}

/**
 * A moderated caucus is a whole number of speeches: the total has to divide evenly by the per-speaker time.
 * 10 min with 45 s speakers is 13.3 speeches, which doesn't exist. Returns '' when fine, else what to try instead.
 */
export function checkMod(totalMin: number, perSec: number): string {
  const total = Math.round(totalMin * 60), per = Math.round(perSec);
  if (!(total > 0) || !(per > 0)) return 'Enter a total time and a time per speaker.';
  if (per > total) return `A ${per} s speech doesn’t fit in ${totalMin} min.`;
  if (total % per === 0) return '';
  const near = (list: number[], to: number, n: number) => [...list].sort((a, b) => Math.abs(a - to) - Math.abs(b - to) || a - b).slice(0, n).sort((a, b) => a - b);
  // Totals (whole minutes) that hold a whole number of these speeches.
  const totals: number[] = []; for (let m = 1; m <= 120; m++) if ((m * 60) % per === 0) totals.push(m);
  // Speech lengths (multiples of 5 s, up to 3 min) that divide this total.
  const pers: number[] = []; for (let sec = 5; sec <= 180; sec += 5) if (total % sec === 0) pers.push(sec);
  const t = near(totals, totalMin, 2), p = near(pers, per, 3);
  const bits = [t.length ? `a total of ${t.join(' or ')} min` : '', p.length ? `${p.join(', ')} s per speaker` : ''].filter(Boolean);
  return `${totalMin} min doesn’t divide into ${per} s speeches (${(total / per).toFixed(1)} speakers).${bits.length ? ` Try ${bits.join(', or ')}.` : ''}`;
}
