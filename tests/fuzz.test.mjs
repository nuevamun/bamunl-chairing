// Random sessions: whatever the chair clicks, in whatever order, the derived state must stay sane and never throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, newCommittee, modCapacity, modTaken, evaluate, recommend, statsFor, DEFAULT_WEIGHTS } from '../src/lib/engine.ts';

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const KEYS = ['votingbloc', 'unmod', 'mod', 'roundrobin', 'openlist', 'other', 'suspend', 'close'];

function session(steps) {
  const c = newCommittee('UNSC');
  c.delegates = Array.from({ length: 8 }, (_, i) => ({ id: 'd' + i, name: 'D' + i }));
  let t = 0, n = 0;
  const E = (type, rest = {}) => c.events.push({ id: 'e' + n++, t: (t += 1 + Math.floor(rnd() * 90_000)), type, ...rest });
  const d = () => 'd' + Math.floor(rnd() * 8);
  for (let i = 0; i < steps; i++) {
    const r = rnd();
    if (r < 0.14) E('attend', { d: d(), s: pick(['present', 'pv', 'absent']) });
    else if (r < 0.34) E('add', { d: d() });
    else if (r < 0.40) E('drop', { d: d() });
    else if (r < 0.44) E('move', { d: d(), by: pick([-1, 1]) });
    else if (r < 0.56) E('start', { d: d() });
    else if (r < 0.60) E('pause'); else if (r < 0.64) E('resume');
    else if (r < 0.72) E('stop', { how: pick(['done', 'chair', 'questions']) });
    else if (r < 0.80) E('floor', { key: pick(KEYS), params: { total: pick([1, 2, 5, 10]), per: pick([30, 45, 60]), time: 3 }, by: rnd() < 0.5 ? d() : '', topic: 'x', name: 'n' });
    else if (r < 0.86 && c.events.length) E('vote', { target: pick(c.events.filter((e) => e.type === 'floor'))?.id, result: pick(['passed', 'failed']), yes: 3, no: 2 });
    else if (r < 0.88) E('amend', { target: pick(c.events.filter((e) => e.type === 'floor'))?.id, params: { total: 4, per: 60 }, by: d(), topic: 'y' });
    else if (r < 0.90) E('withdraw', { target: pick(c.events.filter((e) => e.type === 'floor'))?.id });
    else if (r < 0.92) E('proposer_slot', { slot: pick(['first', 'last', 'none']) });
    else if (r < 0.94) E('end_caucus');
    else if (r < 0.96) E('score', { d: d(), cat: pick(['Substance', 'Procedure', 'Diplomacy']), v: pick([0, 1, 3, 5]) });
    else if (r < 0.98) E('note', { d: d(), text: 'x', tag: '' });
    else if (c.events.length) E('undo', { target: pick(c.events).id });
  }
  return c;
}

test('random sessions never break the rules', () => {
  for (let run = 0; run < 400; run++) {
    const c = session(60 + Math.floor(rnd() * 120));
    const s = derive(c);                                          // must not throw
    for (const k of ['gsl', 'mod']) {
      assert.equal(new Set(s.lists[k]).size, s.lists[k].length, `duplicate in ${k} list (run ${run})`);
      for (const d of s.lists[k]) assert.ok(c.delegates.some((x) => x.id === d), 'unknown delegate on a list');
    }
    if (s.mode.kind === 'mod' && !s.mode.rr) {
      const cap = modCapacity(s.mode);
      if (cap !== Infinity) assert.ok(modTaken(s) <= cap, `caucus over its limit (run ${run}): ${modTaken(s)} of ${cap}`);
      assert.ok(s.mode.spoke >= 0);
    }
    for (const sp of s.speeches) { assert.ok(sp.used >= 0 && sp.left >= 0 && sp.over >= 0); assert.ok(sp.left === 0 || sp.over === 0); }
    assert.equal(s.proposed.length, new Set(s.proposed.map((m) => m.id)).size);
    // everything downstream of the state must be safe too
    const rows = evaluate(c, s, DEFAULT_WEIGHTS); recommend(rows, s); statsFor(c, s);
    for (const r of rows) assert.ok(r.total >= 0 && r.total <= 100.0001, `score out of range: ${r.total}`);
    // a motion can't be both pending and decided
    for (const m of s.motions) assert.ok(!s.proposed.some((p) => p.id === m.id), 'a decided motion is still pending');
  }
});

test('replaying the same log always gives the same state', () => {
  for (let run = 0; run < 60; run++) {
    const c = session(100);
    assert.deepEqual(JSON.parse(JSON.stringify(derive(c))), JSON.parse(JSON.stringify(derive(c))));
  }
});
