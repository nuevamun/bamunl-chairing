// The forward-facing screen: what delegates see. Never shows notes, scores or any per-delegate feedback.
import { store } from '../lib/store';
import { derive, elapsed, clock, allTypes, majorityFor, modCapacity, type Committee } from '../lib/engine';
import { h, mount } from '../lib/ui';

const id = location.pathname.split('/')[2];
const app = document.getElementById('app')!;
let c: Committee | undefined = store.get(id);

const clockEl = h('div', { class: 'big-clock', role: 'timer' }, '0:00');
const barEl = h('div', { class: 'bar-fill' });

function render() {
  c = store.get(id);
  if (!c) { mount(app, h('p', { class: 'big-name' }, '—')); return; }
  const s = derive(c);
  const name = (d: string) => c!.delegates.find((x) => x.id === d)?.name ?? '';
  // Top right says what the room is doing. Before any list or caucus is open it says nothing.
  const doing = s.mode.kind === 'gsl' ? (s.gslOpen ? 'Speakers list' : '')
    : s.mode.kind === 'mod' ? `${s.mode.topic ? `${s.mode.label}: ${s.mode.topic}` : s.mode.label}${modCapacity(s.mode) === Infinity ? '' : ` · ${s.mode.spoke} of ${modCapacity(s.mode)}`}`
    : s.mode.label;
  const kids: Array<HTMLElement | null> = [h('div', { class: 'd-head' }, h('span', null, c.name), h('span', { class: 'mode' }, doing))];
  if (s.proposed.length) {
    const text = (m: typeof s.proposed[number]) => Object.entries(m.params).filter(([, v]) => v > 0 || m.key !== 'other').map(([k, v]) => {
      const f = allTypes(c!.config).find((x) => x.key === m.key)?.fields.find((x) => x.key === k);
      return `${f?.label ?? k} ${v}${f?.unit ? ' ' + f.unit : ''}`;
    }).join(' · ');
    kids.push(h('div', { class: 'floor' }, h('div', { class: 'tag' }, s.proposed.length > 1 ? 'Proposed motions' : 'On the floor'),
      ...s.proposed.map((m) => h('div', { class: 'floor-row' }, h('span', { class: 'floor-name' }, m.label), [text(m), m.topic ? `Topic: ${m.topic}` : '', majorityFor(c!.config, m.key) === 'twothirds' && c!.config.majority !== 'twothirds' ? 'Two-thirds majority' : ''].filter(Boolean).join(' · ') ? h('span', { class: 'floor-p' }, [text(m), m.topic ? `Topic: ${m.topic}` : '', majorityFor(c!.config, m.key) === 'twothirds' && c!.config.majority !== 'twothirds' ? 'Two-thirds majority' : ''].filter(Boolean).join(' · ')) : null))));
  }
  if (s.mode.kind === 'voting') {
    kids.push(h('div', { class: 'speaker' }, h('div', { class: 'big-name' }, s.mode.label)));
  } else if (s.mode.kind === 'unmod') {
    kids.push(h('div', { class: 'speaker' }, h('div', { class: 'big-name' }, 'Unmoderated caucus'), clockEl));
  } else if (s.speaking) {
    kids.push(h('div', { class: 'speaker' }, h('div', { class: 'tag' }, 'Speaking'), h('div', { class: 'big-name' }, name(s.speaking.d)), clockEl, h('div', { class: 'meter' }, barEl)));
  } else {
    kids.push(h('div', { class: 'speaker idle' }, h('div', { class: 'big-name' }, '—')));
  }
  const next = (s.mode.kind === 'mod' ? s.lists.mod : s.gslOpen ? s.lists.gsl : []).slice(0, 5);
  if (next.length && s.mode.kind !== 'unmod' && s.mode.kind !== 'voting') {
    kids.push(h('div', { class: 'queue' }, h('div', { class: 'tag' }, 'Next'), h('ol', null, ...next.map((d) => h('li', null, name(d))))));
  }
  mount(app, ...(kids.filter(Boolean) as HTMLElement[]));
  tick();
}

function tick() {
  if (!c) return;
  const s = derive(c);
  const now = Date.now();
  if (s.mode.kind === 'voting') return;
  if (s.mode.kind === 'unmod') {
    clockEl.textContent = clock(s.mode.total - (now - s.mode.startedAt) / 1000);
    return;
  }
  if (!s.speaking) return;
  const left = s.speaking.allotted - elapsed(s.speaking, now);
  clockEl.textContent = clock(Math.ceil(left));
  clockEl.classList.toggle('low', left <= 10);
  clockEl.classList.toggle('out', left <= 0);
  barEl.style.width = `${Math.max(0, Math.min(100, (left / s.speaking.allotted) * 100))}%`;
}

render();
store.subscribe(render);
setInterval(tick, 250);
