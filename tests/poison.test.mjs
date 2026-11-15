// Red team: events written straight into the database by someone hostile (or a bug) must never be able to crash the
// console for everyone who opens that committee, or smuggle in wrong state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, newCommittee, statsFor, evaluate, recommend, clock, elapsed, DEFAULT_WEIGHTS, motionTypes, effective } from '../src/lib/engine.ts';

const junk = [null, undefined, NaN, Infinity, -Infinity, -1, 0, 1e308, -1e308, '', 'x', '__proto__', 'constructor', [], [1, 2], {}, { a: 1 }, true, false, 'z'.repeat(5000), { __proto__: { polluted: true } }, JSON.parse('{"__proto__":{"polluted":"yes"}}')];
const TYPES = ['attend', 'add', 'drop', 'move', 'start', 'pause', 'resume', 'stop', 'floor', 'withdraw', 'clear_proposed', 'vote', 'amend', 'caucus_start', 'caucus_pause', 'caucus_resume', 'proposer_slot', 'end_caucus', 'note', 'score', 'undo', 'nonsense', '__proto__', ''];
const FIELDS = ['d', 's', 'by', 'key', 'params', 'name', 'topic', 'target', 'result', 'yes', 'no', 'slot', 'how', 'to', 'allotted', 'text', 'tag', 'cat', 'v', 'note', 'abstain'];
let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

test('hostile events never crash the derived state or the numbers built on it', () => {
  for (let run = 0; run < 600; run++) {
    const c = newCommittee('UNSC'); c.needsOpen = rnd() < 0.5;
    c.delegates = [{ id: 'a', name: 'France' }, { id: 'b', name: 'Peru' }];
    for (let i = 0; i < 40; i++) {
      const e = { id: pick([`e${i}`, 'dup', 1, null]), t: pick([i * 1000, NaN, null, 'soon', -5, 1e15]), type: pick(TYPES) };
      for (const f of FIELDS) if (rnd() < 0.4) e[f] = pick([...junk, 'a', 'b', 'mod', 'unmod', 'roundrobin', 'openlist', 'votingbloc', 'passed', 'first', 'last', { total: pick(junk), per: pick(junk), time: pick(junk) }]);
      c.events.push(e);
    }
    let s;
    assert.doesNotThrow(() => { s = derive(c); effective(c.events); }, `derive threw (run ${run})`);
    assert.doesNotThrow(() => { statsFor(c, s); recommend(evaluate(c, s, DEFAULT_WEIGHTS), s); motionTypes(c.config); clock(NaN); clock(Infinity); elapsed(s.speaking, Date.now()); }, `a derived helper threw (run ${run})`);
    assert.equal({}.polluted, undefined, 'prototype was polluted');
    assert.equal(Object.prototype.polluted, undefined);
  }
});

test('a hostile committee config cannot crash motion lookups', () => {
  for (const config of [{}, { motions: null }, { motions: 'x' }, { motions: [null, 1, {}, { key: null }] }, { weights: 'x' }, { speakTime: 'NaN', majority: 'x', motions: [] }]) {
    const c = newCommittee('X'); c.config = config; c.delegates = [{ id: 'a', name: 'A' }];
    assert.doesNotThrow(() => { motionTypes({ speakTime: 60, majority: 'simple', motions: Array.isArray(config.motions) ? config.motions.filter(Boolean) : [] }); });
  }
});
