// The forward-facing screen: what delegates see. Never shows notes, scores or any per-delegate feedback.
import { store } from '../lib/store';
import { derive, elapsed, clock, type Committee } from '../lib/engine';
import { h } from '../lib/ui';

const id = location.pathname.split('/')[2];
const app = document.getElementById('app')!;
let c: Committee | undefined = store.get(id);

const clockEl = h('div', { class: 'big-clock', role: 'timer' }, '0:00');
const barEl = h('div', { class: 'bar-fill' });

function render() {
  c = store.get(id);
  if (!c) { app.replaceChildren(h('p', { class: 'big-name' }, '—')); return; }
  const s = derive(c);
  const name = (d: string) => c!.delegates.find((x) => x.id === d)?.name ?? '';
  const kids: Array<HTMLElement | null> = [h('div', { class: 'd-head' }, h('span', null, c.name), h('span', { class: 'mode' },
    s.mode.kind === 'gsl' ? (s.closed ? 'Speakers list (closed)' : 'Speakers list') : s.mode.label))];
  if (s.floor) {
    const p = Object.entries(s.floor.params).map(([k, v]) => {
      const f = c!.config.motions.find((m) => m.key === s.floor!.key)?.fields.find((x) => x.key === k);
      return `${f?.label ?? k}: ${v}${f?.unit ? ' ' + f.unit : ''}`;
    }).join(' · ');
    kids.push(h('div', { class: 'floor' }, h('div', { class: 'tag' }, 'On the floor'), h('div', { class: 'floor-name' }, s.floor.label), p ? h('div', { class: 'floor-p' }, p) : null));
  }
  if (s.mode.kind === 'unmod') {
    kids.push(h('div', { class: 'speaker' }, h('div', { class: 'big-name' }, 'Unmoderated caucus'), clockEl));
  } else if (s.speaking) {
    kids.push(h('div', { class: 'speaker' }, h('div', { class: 'tag' }, 'Speaking'), h('div', { class: 'big-name' }, name(s.speaking.d)), clockEl, h('div', { class: 'meter' }, barEl)));
  } else {
    kids.push(h('div', { class: 'speaker idle' }, h('div', { class: 'big-name' }, '—')));
  }
  const next = (s.mode.kind === 'mod' ? s.lists.mod : s.lists.gsl).slice(0, 5);
  if (next.length && s.mode.kind !== 'unmod') {
    kids.push(h('div', { class: 'queue' }, h('div', { class: 'tag' }, 'Next'), h('ol', null, ...next.map((d) => h('li', null, name(d))))));
  }
  app.replaceChildren(...(kids.filter(Boolean) as HTMLElement[]));
  tick();
}

function tick() {
  if (!c) return;
  const s = derive(c);
  const now = Date.now();
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
