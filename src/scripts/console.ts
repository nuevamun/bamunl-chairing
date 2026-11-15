// The chair console: the back of the room. Everything here writes events; nothing mutates state directly.
import { store } from '../lib/store';
import { derive, statsFor, elapsed, clock, ev, uid, effective, AWARD_CATEGORIES, NOTE_TAGS, type Committee, type State, type Attendance } from '../lib/engine';
import { h, $ } from '../lib/ui';

const id = location.pathname.split('/')[2];
const app = document.getElementById('app')!;
const tools = document.getElementById('bar-tools')!;
type Tab = 'floor' | 'roll' | 'delegates' | 'setup';
let tab: Tab = 'floor';
let menu = false;                     // the tab row stays out of sight on the Floor until the chair asks for it
let picked: string | null = null;     // delegate open on the Delegates tab
let c: Committee | undefined;
let s: State;

const push = (type: string, rest: Record<string, any> = {}) => { store.append(id, ev(type, rest)); render(); };
const nameOf = (d: string) => c!.delegates.find((x) => x.id === d)?.name ?? '?';
const here = (d: string) => (s.attendance[d] ?? 'absent') !== 'absent';
const btn = (label: string, fn: () => void, cls = 'btn btn--ghost btn--sm', extra: Record<string, any> = {}) => h('button', { type: 'button', class: cls, onclick: fn, ...extra }, label);
const num = (name: string, v: number, label: string) => h('label', { class: 'field field--tight' }, h('span', null, label), h('input', { type: 'number', name, value: v, min: 0, step: 1, inputmode: 'numeric' }));

let clockEl: HTMLElement | null = null, barEl: HTMLElement | null = null, capEl: HTMLElement | null = null;

function speakerCard() {
  const sp = s.speaking;
  clockEl = h('div', { class: 'clock', role: 'timer' }, '0:00');
  barEl = h('div', { class: 'bar-fill' });
  capEl = h('div', { class: 'caucus-clock muted' });
  const mode = s.mode;
  const list = mode.kind === 'mod' ? s.lists.mod : s.lists.gsl;
  const modeBar = h('div', { class: 'modebar' },
    h('strong', null, mode.kind === 'gsl' ? (s.closed ? 'Speakers list (closed)' : 'Speakers list') : mode.label),
    mode.kind !== 'gsl' ? btn('End caucus', () => push('end_caucus')) : null, capEl);

  const note = h('input', { type: 'text', placeholder: 'Quick note on this speaker', 'aria-label': 'Quick note on this speaker', autocomplete: 'off' }) as HTMLInputElement;
  const body = sp
    ? [h('div', { class: 'speaker-name' }, nameOf(sp.d)), clockEl, h('div', { class: 'meter' }, barEl),
       h('div', { class: 'btn-row' },
         sp.since != null ? btn('Pause', () => push('pause')) : btn('Resume', () => push('resume'), 'btn btn--primary btn--sm'),
         btn('Stop', () => push('stop', { how: 'done' }), 'btn btn--primary btn--sm'),
         btn('Yield to chair', () => push('stop', { how: 'chair' })),
         btn('Yield to questions', () => push('stop', { how: 'questions' }))),
       h('form', { class: 'inline-note', onsubmit: (e: Event) => { e.preventDefault(); if (note.value.trim()) { push('note', { d: sp.d, text: note.value.trim(), tag: '' }); } } }, note, h('button', { class: 'btn btn--ghost btn--sm' }, 'Add note'))]
    : [h('div', { class: 'speaker-name muted' }, mode.kind === 'unmod' ? 'Unmoderated caucus' : 'No one speaking'),
       mode.kind === 'unmod' ? null : h('div', { class: 'btn-row' },
         btn(list.length ? `Start ${nameOf(list[0])}` : 'Start next', () => list[0] && push('start', { d: list[0] }), 'btn btn--primary', { disabled: list.length ? null : true }))];
  return h('section', { class: 'card speaker-card' }, modeBar, ...body);
}


let refocusAdd = false;
type Opt = { id: string; name: string; off: boolean; note: string };
/** Type to filter, arrows and Enter to choose, click works too. `onPick` gets the chosen option. */
function combo(all: Opt[], onPick: (o: Opt) => void, label: string, placeholder: string, refocus = false) {
  const input = h('input', { type: 'text', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-label': label, placeholder, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const box = h('ul', { class: 'combo-list', role: 'listbox', hidden: true });
  let items: Opt[] = [];
  let active = 0;
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    items = all.filter((d) => !q || d.name.toLowerCase().includes(q))
      .sort((x, y) => Number(x.off) - Number(y.off) || Number(!x.name.toLowerCase().startsWith(q)) - Number(!y.name.toLowerCase().startsWith(q)) || x.name.localeCompare(y.name));
    active = Math.max(0, items.findIndex((d) => !d.off));
    box.replaceChildren(...items.map((d, i) => h('li', { role: 'option', 'aria-disabled': String(d.off), class: 'opt' + (d.off ? ' opt--off' : '') + (i === active ? ' opt--on' : ''),
      onmousedown: (e: Event) => { e.preventDefault(); if (!d.off) pick(d); } }, h('span', null, d.name), d.note ? h('small', null, d.note) : null)));
    if (!items.length) box.replaceChildren(h('li', { class: 'opt opt--off' }, 'No match'));
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  const pick = (d: Opt) => { box.hidden = true; onPick(d); };
  const move = (by: number) => {
    const ok = items.map((d, i) => (d.off ? -1 : i)).filter((i) => i >= 0);
    if (!ok.length) return;
    const at = ok.indexOf(active); active = ok[(at + by + ok.length) % ok.length];
    [...box.children].forEach((li, i) => { li.classList.toggle('opt--on', i === active); if (i === active) (li as HTMLElement).scrollIntoView({ block: 'nearest' }); });
  };
  input.addEventListener('focus', paint);
  input.addEventListener('input', paint);
  input.addEventListener('blur', () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden) paint(); else move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); const d = items[active]; if (d && !d.off && !box.hidden) pick(d); }
    else if (e.key === 'Escape') { input.blur(); }
  });
  if (refocus) queueMicrotask(() => input.focus());
  return Object.assign(h('div', { class: 'combo' }, input, box), { input });
}

const delegateOpts = (list: string[] = []): Opt[] => c!.delegates.map((d) => {
  const queued = list.includes(d.id), speaking = s.speaking?.d === d.id, absent = !here(d.id);
  return { id: d.id, name: d.name, off: queued || speaking, note: queued ? 'on the list' : speaking ? 'speaking' : absent ? 'absent' : '' };
});

/** Tap a delegate to put them on the list, tap again to take them off. Numbers show the order they will be called. */
function takeNames(key: 'gsl' | 'mod', list: string[]) {
  if (!c!.delegates.length) return null;
  const chips = c!.delegates.map((d) => {
    const at = list.indexOf(d.id);
    const spoke = s.speeches.filter((x) => x.d === d.id && x.mode === key).length;
    const speaking = s.speaking?.d === d.id;
    return h('button', { type: 'button', class: 'chip-btn' + (at >= 0 ? ' chip-btn--on' : '') + (!here(d.id) ? ' chip-btn--away' : ''), 'aria-pressed': String(at >= 0), disabled: speaking ? true : null,
      onclick: () => push(at >= 0 ? 'drop' : 'add', { d: d.id }) },
      at >= 0 ? h('b', { class: 'chip-n' }, String(at + 1)) : null, d.name, spoke ? h('small', null, `×${spoke}`) : null);
  });
  return h('details', { class: 'names', open: key === 'mod' }, h('summary', null, 'Take names'), h('div', { class: 'chip-grid' }, ...chips));
}

function listCard() {
  const mode = s.mode;
  if (mode.kind === 'unmod') return h('section', { class: 'card' }, h('h2', null, 'speakers list'), h('p', { class: 'empty' }, 'Not used in an unmoderated caucus.'));
  const key = mode.kind === 'mod' ? 'mod' : 'gsl';
  const list = s.lists[key];
  const wasAdding = refocusAdd; refocusAdd = false;
  const picker = combo(delegateOpts(list), (o) => { refocusAdd = true; push('add', { d: o.id }); }, 'Add a delegate to the list', 'Type a name to add…', wasAdding);
  const names = takeNames(key, list);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, mode.kind === 'mod' ? 'moderated list' : 'speakers list'), h('span', { class: 'muted' }, `${s.speakTime}s each`)),
    s.closed && key === 'gsl' ? h('p', { class: 'flash' }, 'List is closed.') : picker,
    s.closed && key === 'gsl' ? null : names,
    h('ol', { class: 'queue-list' }, ...list.map((d, i) => h('li', null,
      h('span', { class: 'qn' }, nameOf(d)),
      btn('Start', () => push('start', { d }), 'btn btn--primary btn--xs'),
      btn('↑', () => push('move', { d, by: -1 }), 'btn btn--ghost btn--xs', { 'aria-label': `Move ${nameOf(d)} up`, disabled: i === 0 ? true : null }),
      btn('↓', () => push('move', { d, by: 1 }), 'btn btn--ghost btn--xs', { 'aria-label': `Move ${nameOf(d)} down`, disabled: i === list.length - 1 ? true : null }),
      btn('Remove', () => push('drop', { d }), 'btn btn--ghost btn--xs'))),
      list.length ? null : h('li', { class: 'empty' }, 'Empty')));
}

const paramText = (m: { key: string; params: Record<string, number> }) => {
  const fields = c!.config.motions.find((x) => x.key === m.key)?.fields ?? [];
  return Object.entries(m.params).filter(([, v]) => v > 0 || m.key !== 'other').map(([k, v]) => {
    const f = fields.find((x) => x.key === k);
    return `${f?.label ?? k} ${v}${f?.unit ? ' ' + f.unit : ''}`;
  }).join(' · ');
};

function motionCard() {
  // Propose: a motion goes into the pool. Nothing has to be voted on straight away.
  const type = h('select', { name: 'type', 'aria-label': 'Motion' }, ...c!.config.motions.map((m) => h('option', { value: m.key }, m.label))) as HTMLSelectElement;
  const name = h('input', { type: 'text', name: 'name', placeholder: 'What is the motion?', autocomplete: 'off', 'aria-label': 'Motion name' }) as HTMLInputElement;
  const nameField = h('label', { class: 'field field--tight field--wide' }, h('span', null, 'Name'), name);
  const fields = h('div', { class: 'fields fields--3' });
  let by = '';
  const byBox = h('div', { class: 'field field--tight' }, h('span', null, 'Proposed by (optional)'));
  const drawBy = () => {
    const pickerEl = combo(delegateOpts().map((o) => ({ ...o, off: false })), (o) => { by = o.id; pickerEl.input.value = o.name; }, 'Proposed by', 'Type a name…');
    pickerEl.input.addEventListener('input', () => { by = ''; });
    byBox.replaceChildren(byBox.firstChild!, pickerEl);
  };
  const draw = () => {
    const m = c!.config.motions.find((x) => x.key === type.value)!;
    nameField.hidden = m.key !== 'other';
    const fs = m.key === 'other' && !m.fields.length ? [{ key: 'time', label: 'Time', unit: 'min' as const, def: 0 }] : m.fields;
    fields.replaceChildren(...fs.map((f) => num(f.key, f.def, `${f.label}${f.unit ? ' (' + f.unit + ')' : ''}`)));
  };
  type.onchange = draw; draw(); drawBy();

  const form = h('form', { class: 'form', onsubmit: (e: Event) => {
    e.preventDefault();
    const params: Record<string, number> = {};
    fields.querySelectorAll('input').forEach((i) => { params[(i as HTMLInputElement).name] = +(i as HTMLInputElement).value || 0; });
    if (type.value === 'other' && !name.value.trim()) { name.focus(); return; }
    push('floor', { key: type.value, params, by, ...(type.value === 'other' ? { name: name.value.trim() } : {}) });
  } }, type, nameField, fields, byBox, h('button', { class: 'btn btn--primary btn--sm' }, 'Propose'));

  // The pool: pick which to take up, and say whether it passed or failed.
  const pool = s.proposed.map((m, i) => {
    const yes = h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: 'For', 'aria-label': 'For' }) as HTMLInputElement;
    const no = h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Against', 'aria-label': 'Against' }) as HTMLInputElement;
    const ab = h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Abstain', 'aria-label': 'Abstain' }) as HTMLInputElement;
    const decide = (result: 'passed' | 'failed') => push('vote', { target: m.id, result, yes: +yes.value || 0, no: +no.value || 0, abstain: +ab.value || 0 });
    return h('li', { class: 'proposal' },
      h('div', { class: 'proposal-top' }, h('strong', null, m.label), h('span', { class: 'muted' }, [paramText(m), m.by ? `by ${nameOf(m.by)}` : '', i === 0 && s.proposed.length > 1 ? 'first in order' : ''].filter(Boolean).join(' · '))),
      h('div', { class: 'proposal-votes' }, yes, no, ab),
      h('div', { class: 'btn-row' }, btn('Passed', () => decide('passed'), 'btn btn--primary btn--sm'), btn('Failed', () => decide('failed')), btn('Withdraw', () => push('withdraw', { target: m.id }))));
  });
  return h('section', { class: 'card' }, h('h2', null, 'motions'), form,
    pool.length ? h('div', { class: 'pool' }, h('div', { class: 'card-head' }, h('h3', null, 'proposed'), s.proposed.length > 1 ? btn('Clear all', () => push('clear_proposed'), 'btn btn--ghost btn--xs') : null), h('ul', { class: 'proposals' }, ...pool),
      h('p', { class: 'muted small' }, 'Vote counts are optional.')) : null,
    history());
}

/** Everything proposed so far, newest first. Lives under the motions form so it needs no tab of its own. */
function history() {
  if (!s.motions.length) return null;
  const rows = [...s.motions].reverse().map((m) => h('li', { class: 'past' },
    h('span', { class: 'past-name' }, m.label, h('span', { class: 'muted' }, [paramText(m), m.by ? `by ${nameOf(m.by)}` : ''].filter(Boolean).map((x) => ' · ' + x).join(''))),
    h('span', { class: 'past-res past-res--' + m.result }, m.result === 'withdrawn' ? 'not voted' : m.result,
      m.result !== 'withdrawn' && (m.yes || m.no || m.abstain) ? ` ${m.yes}–${m.no}–${m.abstain}` : '')));
  return h('details', { class: 'pool', open: s.motions.length <= 6 }, h('summary', null, `Proposed so far (${s.motions.length})`), h('ul', { class: 'pasts' }, ...rows));
}

function floorTab() {
  return h('div', { class: 'grid-floor' }, speakerCard(), motionCard(), listCard());
}

function rollTab() {
  const rows = c!.delegates.map((d) => {
    const a: Attendance = s.attendance[d.id] ?? 'absent';
    const b = (v: Attendance, label: string) => h('button', { type: 'button', class: 'seg' + (a === v ? ' seg--on' : ''), 'aria-pressed': String(a === v), onclick: () => push('attend', { d: d.id, s: v }) }, label);
    return h('div', { class: 'r' }, h('strong', null, d.name), h('div', { class: 'segs' }, b('present', 'Present'), b('pv', 'Present and voting'), b('absent', 'Absent')));
  });
  const all = btn('Mark everyone present', () => c!.delegates.forEach((d) => store.append(id, ev('attend', { d: d.id, s: 'present' }))) || render());
  const n = Object.values(s.attendance).filter((a) => a !== 'absent').length;
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'roll call'), h('span', { class: 'muted' }, `${n} of ${c!.delegates.length}`), all),
    c!.delegates.length ? h('div', { class: 'rows' }, ...rows) : h('p', { class: 'empty' }, 'Add delegates under Setup.'));
}

function delegatesTab() {
  const stats = statsFor(c!, s);
  const th = (t: string) => h('th', null, t);
  const table = h('div', { class: 'sheet-wrap' }, h('table', { class: 'sheet' },
    h('thead', null, h('tr', null, th('Delegate'), th('Speeches'), th('Time used'), th('Left on the table'), th('Over'), th('Yielded to chair'), th('Listed, not called'), th('Notes'))),
    h('tbody', null, ...stats.map((st) => h('tr', { class: st.d === picked ? 'sel' : '' },
      h('td', { class: 'name' }, h('button', { type: 'button', class: 'linkish', onclick: () => { picked = st.d; render(); } }, nameOf(st.d))),
      h('td', { class: 'num' }, String(st.speeches)), h('td', { class: 'num' }, clock(st.used)),
      h('td', { class: 'num' }, st.speeches ? clock(st.left) + (st.avgUsedPct != null ? ` (${100 - st.avgUsedPct}%)` : '') : '—'),
      h('td', { class: 'num' }, st.over ? clock(st.over) : '—'),
      h('td', { class: 'num' }, String(st.yieldedToChair)), h('td', { class: 'num' }, String(st.listedNotCalled)),
      h('td', { class: 'num' }, String(s.notes.filter((n) => n.d === st.d).length)))),
      c!.delegates.length ? null : h('tr', null, h('td', { colspan: 8, class: 'empty' }, 'No delegates yet.')))));
  return h('div', { class: 'stack' }, table, picked ? detail(picked) : null);
}

function detail(d: string) {
  const st = statsFor(c!, s).find((x) => x.d === d)!;
  const tag = h('select', { 'aria-label': 'Tag' }, ...NOTE_TAGS.map((t) => h('option', { value: t }, t))) as HTMLSelectElement;
  const text = h('textarea', { rows: 3, 'aria-label': 'Feedback note' }) as HTMLTextAreaElement;
  const mine = s.speeches.filter((x) => x.d === d);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, nameOf(d)), btn('Close', () => { picked = null; render(); })),
    h('p', { class: 'muted' }, `${st.speeches} speeches · ${clock(st.used)} used of ${clock(st.allotted)} · ${clock(st.left)} left on the table`),
    h('div', { class: 'two' },
      h('div', null, h('h3', null, 'scores'), h('div', { class: 'scores' }, ...AWARD_CATEGORIES.map((cat) => {
        const cur = s.scores.find((x) => x.d === d && x.cat === cat)?.v ?? 0;
        return h('div', { class: 'score' }, h('span', null, cat), h('div', { class: 'segs' }, ...[1, 2, 3, 4, 5].map((v) => h('button', { type: 'button', class: 'seg' + (cur === v ? ' seg--on' : ''), 'aria-pressed': String(cur === v), 'aria-label': `${cat} ${v}`, onclick: () => push('score', { d, cat, v: cur === v ? 0 : v }) }, String(v)))));
      }))),
      h('div', null, h('h3', null, 'feedback'),
        h('form', { class: 'form', onsubmit: (e: Event) => { e.preventDefault(); if (text.value.trim()) push('note', { d, text: text.value.trim(), tag: tag.value }); } },
          tag, text, h('button', { class: 'btn btn--primary btn--sm' }, 'Save note')),
        h('ul', { class: 'notes' }, ...s.notes.filter((n) => n.d === d).reverse().map((n) => h('li', null, n.tag ? h('span', { class: 'chip' }, n.tag) : null, ' ', n.text))))),
    h('h3', null, 'speeches'),
    mine.length ? h('ul', { class: 'notes' }, ...mine.map((x) => h('li', null, `${clock(x.used)} of ${clock(x.allotted)}`, x.over ? `, ${clock(x.over)} over` : `, ${clock(x.left)} left`, x.end === 'chair' ? ', yielded to chair' : x.end === 'questions' ? ', yielded to questions' : '', x.mode === 'mod' ? ', moderated' : ''))) : h('p', { class: 'empty' }, 'None yet.'));
}

function setupTab() {
  const name = h('input', { type: 'text', value: c!.name }) as HTMLInputElement;
  const conf = h('input', { type: 'text', value: c!.conference }) as HTMLInputElement;
  const st = h('input', { type: 'number', value: c!.config.speakTime, min: 5, inputmode: 'numeric' }) as HTMLInputElement;
  const maj = h('select', null, h('option', { value: 'simple' }, 'Simple majority'), h('option', { value: 'twothirds' }, 'Two-thirds')) as HTMLSelectElement;
  maj.value = c!.config.majority;
  const bulk = h('textarea', { rows: 6, placeholder: 'One delegate per line' }) as HTMLTextAreaElement;
  return h('div', { class: 'stack' },
    h('form', { class: 'card form', onsubmit: (e: Event) => { e.preventDefault(); const n = store.get(id)!; n.name = name.value.trim() || n.name; n.conference = conf.value.trim(); n.config.speakTime = +st.value || 60; n.config.majority = maj.value as any; store.put(n); render(); } },
      h('h2', null, 'committee'),
      h('div', { class: 'fields' }, h('label', { class: 'field' }, h('span', null, 'Name'), name), h('label', { class: 'field' }, h('span', null, 'Conference'), conf),
        h('label', { class: 'field' }, h('span', null, 'Speaking time (s)'), st), h('label', { class: 'field' }, h('span', null, 'Voting'), maj)),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary' }, 'Save'))),
    h('form', { class: 'card form', onsubmit: (e: Event) => {
      e.preventDefault(); const n = store.get(id)!;
      for (const line of bulk.value.split('\n').map((x) => x.trim()).filter(Boolean)) if (!n.delegates.some((d) => d.name === line)) n.delegates.push({ id: uid(), name: line });
      store.put(n); render();
    } }, h('h2', null, 'delegates'), bulk, h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary' }, 'Add'))),
    h('section', { class: 'card' }, h('h2', null, 'delegates'), h('div', { class: 'rows' }, ...c!.delegates.map((d) => h('div', { class: 'r' }, h('span', null, d.name),
      btn('Remove', () => { if (confirm(`Remove ${d.name}? Their speeches and notes stay in the log.`)) { const n = store.get(id)!; n.delegates = n.delegates.filter((x) => x.id !== d.id); store.put(n); render(); } }, 'btn btn--danger btn--sm'))))),
    h('section', { class: 'card' }, h('h2', null, 'data'), h('div', { class: 'btn-row' },
      btn('Download JSON', () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' })), download: `${c!.name}.json` }); a.click(); }),
      btn('Delete committee', () => { if (confirm(`Delete ${c!.name} and its whole log?`)) { store.remove(id); location.href = '/'; } }, 'btn btn--danger btn--sm'))));
}

function drawTools() {
  const all = store.all();
  const sel = h('select', { 'aria-label': 'Committee' }, ...all.map((x) => h('option', { value: x.id }, x.name)), h('option', { value: '__all' }, 'All committees…')) as HTMLSelectElement;
  sel.value = id;
  sel.onchange = () => { location.href = sel.value === '__all' ? '/' : `/c/${sel.value}`; };
  const canUndo = effective(c!.events).length > 0;
  tools.replaceChildren(sel,
    btn('Undo', () => { const last = effective(store.get(id)!.events).at(-1); if (last) push('undo', { target: last.id }); }, 'btn btn--ghost btn--sm', { disabled: canUndo ? null : true }),
    h('a', { class: 'btn btn--primary btn--sm', href: `/c/${id}/display`, target: 'display' }, 'Open display'));
}

function render() {
  c = store.get(id);
  if (!c) { app.replaceChildren(h('div', { class: 'lead' }, h('h1', { class: 'title' }, 'not found'), h('a', { class: 'btn btn--primary', href: '/' }, 'All committees'))); return; }
  s = derive(c);
  drawTools();
  document.title = `${c.name} · BAMUNL Chairing`;
  const tabs: Array<[Tab, string]> = [['floor', 'Floor'], ['roll', 'Roll call'], ['delegates', 'Feedback'], ['setup', 'Setup']];
  const body = { floor: floorTab, roll: rollTab, delegates: delegatesTab, setup: setupTab }[tab]();
  const showTabs = menu || tab !== 'floor';
  // Hidden on purpose: feedback, scores and setup shouldn't be readable from across the room.
  app.replaceChildren(
    h('div', { class: 'lead' }, h('h1', { class: 'title' }, c.name.toLowerCase()), c.conference ? h('p', { class: 'subtitle' }, c.conference) : null),
    h('nav', { class: 'tabs', 'aria-label': 'Sections' },
      ...(showTabs ? tabs.map(([k, label]) => h('button', { type: 'button', class: 'tab' + (k === tab ? ' tab--on' : ''), 'aria-current': k === tab ? 'page' : null, onclick: () => { tab = k; menu = k !== 'floor'; if (k !== 'delegates') picked = null; render(); } }, label)) : []),
      h('button', { type: 'button', class: 'peek', 'aria-expanded': String(showTabs), 'aria-label': showTabs ? 'Hide sections' : 'Show sections', onclick: () => { if (showTabs) { tab = 'floor'; menu = false; picked = null; } else menu = true; render(); } }, showTabs ? 'Hide' : '·  ·  ·')),
    body);
  tick();
}

function tick() {
  if (!c || !clockEl) return;
  const now = Date.now();
  if (s.speaking) {
    const left = s.speaking.allotted - elapsed(s.speaking, now);
    clockEl.textContent = clock(Math.ceil(left));
    clockEl.classList.toggle('low', left <= 10);
    clockEl.classList.toggle('out', left <= 0);
    if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, (left / s.speaking.allotted) * 100))}%`;
  } else clockEl.textContent = '';
  if (capEl && (s.mode.kind === 'mod' || s.mode.kind === 'unmod')) capEl.textContent = `${clock(s.mode.total - (now - s.mode.startedAt) / 1000)} left in caucus`;
}

addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.key === 'Escape' && (menu || tab !== 'floor')) { menu = false; picked = null; tab = 'floor'; render(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
  if (e.code === 'Space' && s?.speaking && tab === 'floor') { e.preventDefault(); push(s.speaking.since != null ? 'pause' : 'resume'); }
});
render();
store.subscribe(render);
setInterval(tick, 250);
