import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, statsFor, newCommittee, passes, motionTypes } from '../src/lib/engine.ts';

const mk = () => { const c = newCommittee('UNSC'); c.delegates = [{ id: 'a', name: 'France' }, { id: 'b', name: 'Peru' }]; return c; };
let n = 0;
const E = (c, t, type, rest = {}) => c.events.push({ id: 'e' + n++, t, type, ...rest });

test('time left on the table = allotted - used, pauses excluded', () => {
  const c = mk();
  E(c, 0, 'add', { d: 'a' }); E(c, 0, 'add', { d: 'b' });
  E(c, 1000, 'start', { d: 'a' });
  E(c, 21000, 'pause'); E(c, 51000, 'resume'); E(c, 61000, 'stop', { how: 'chair' });   // 20s + 10s used
  const s = derive(c); const st = statsFor(c, s);
  assert.equal(s.speeches[0].used, 30);
  assert.equal(st[0].left, 30);
  assert.equal(st[0].yieldedToChair, 1);
  assert.equal(st[1].listedNotCalled, 1);
});

test('going over is tracked, not negative', () => {
  const c = mk(); E(c, 0, 'start', { d: 'a' }); E(c, 70000, 'stop', { how: 'done' });
  const sp = derive(c).speeches[0]; assert.equal(sp.left, 0); assert.equal(sp.over, 10);
});

test('undo cancels an event', () => {
  const c = mk(); E(c, 0, 'add', { d: 'a' }); const id = c.events[0].id; E(c, 1, 'undo', { target: id });
  assert.deepEqual(derive(c).lists.gsl, []);
});

test('mod caucus passes, uses its own list and per-speaker time; ends back to gsl', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 } }); E(c, 1, 'vote', { yes: 8, no: 2 });
  let s = derive(c); assert.equal(s.mode.kind, 'mod');
  E(c, 2, 'add', { d: 'a' }); E(c, 3, 'start', { d: 'a' }); E(c, 4000, 'stop', {});
  s = derive(c); assert.equal(s.speeches[0].allotted, 45); assert.equal(s.speeches[0].mode, 'mod');
  E(c, 5, 'end_caucus'); assert.equal(derive(c).mode.kind, 'gsl');
});

test('failed motion changes nothing; 2/3 majority', () => {
  const c = mk(); E(c, 0, 'floor', { key: 'close' }); E(c, 1, 'vote', { yes: 3, no: 5 });
  const s = derive(c); assert.equal(s.closed, false); assert.equal(s.motions[0].result, 'failed');
  assert.equal(passes('twothirds', 6, 3), true); assert.equal(passes('twothirds', 5, 3), false);
});

test('several motions can be open; the chair picks which passes or fails', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a' });
  E(c, 1, 'floor', { key: 'unmod', params: { total: 5 } });
  const ids = c.events.map((e) => e.id);
  let s = derive(c);
  assert.equal(s.proposed.length, 2);
  assert.equal(s.proposed[0].key, 'unmod');           // precedence order, not order proposed
  E(c, 2, 'vote', { target: ids[0], result: 'failed' });   // no counts needed
  s = derive(c);
  assert.equal(s.proposed.length, 1); assert.equal(s.mode.kind, 'gsl');
  assert.equal(s.motions[0].result, 'failed'); assert.equal(s.motions[0].by, 'a');
  E(c, 3, 'clear_proposed'); s = derive(c);
  assert.equal(s.proposed.length, 0); assert.equal(s.motions.at(-1).result, 'withdrawn');
});

test('amending changes the details and the owner, and is kept in the record', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a' });
  const id = c.events[0].id;
  E(c, 1, 'amend', { target: id, params: { total: 5, per: 30 }, by: 'b' });
  let s = derive(c);
  assert.deepEqual(s.proposed[0].params, { total: 5, per: 30 });
  assert.equal(s.proposed[0].by, 'b'); assert.equal(s.proposed[0].amended, true);
  E(c, 2, 'vote', { target: id, result: 'passed' });
  s = derive(c);
  assert.equal(s.mode.total, 300); assert.equal(s.mode.per, 30);       // the amended numbers are what took effect
  assert.equal(s.motions[0].by, 'b'); assert.equal(s.motions[0].amended, true);
  E(c, 3, 'undo', { target: c.events[1].id });                         // undo of the amend restores the original
  assert.equal(derive(c).mode.total, 600);
});

test('a moderated caucus opens the list without starting the clock; the proposer picks first or last', () => {
  const c = mk();
  c.delegates.push({ id: 'z', name: 'Chad' });
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a' }); E(c, 1, 'vote', { result: 'passed' });
  let s = derive(c);
  assert.equal(s.mode.kind, 'mod'); assert.equal(s.mode.startedAt, null); assert.equal(s.mode.slot, '');
  E(c, 2, 'add', { d: 'b' });
  E(c, 3, 'proposer_slot', { slot: 'last' });
  E(c, 4, 'add', { d: 'z' });                                  // someone added later still goes before the proposer
  s = derive(c);
  assert.deepEqual(s.lists.mod, ['b', 'z', 'a']);
  assert.equal(s.mode.startedAt, null);                         // still not started
  E(c, 5, 'start', { d: 'b' });
  assert.equal(derive(c).mode.startedAt, 5);                    // the clock starts with the first speaker
});
test('proposer can speak first, or skip', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 5, per: 30 }, by: 'a' }); E(c, 1, 'vote', { result: 'passed' });
  E(c, 2, 'add', { d: 'b' }); E(c, 3, 'proposer_slot', { slot: 'first' });
  assert.deepEqual(derive(c).lists.mod, ['a', 'b']);
  const d = mk();
  E(d, 0, 'floor', { key: 'mod', params: { total: 5, per: 30 }, by: 'a' }); E(d, 1, 'vote', { result: 'passed' }); E(d, 2, 'proposer_slot', { slot: 'none' });
  assert.deepEqual(derive(d).lists.mod, []);
});

test('motion types run most to least disruptive, "other" last, and old committees get the new types', () => {
  const old = { speakTime: 60, majority: 'simple', motions: [{ key: 'close', label: 'Close the speakers list', effect: 'close', fields: [] }, { key: 'mod', label: 'Moderated caucus', effect: 'mod', fields: [] }, { key: 'custom', label: 'Our own', effect: 'none', fields: [] }] };
  const keys = motionTypes(old).map((m) => m.key);
  assert.deepEqual(keys, ['suspend', 'adjourn', 'unmod', 'mod', 'speaktime', 'close', 'custom', 'other']);
  assert.equal(motionTypes(old).find((m) => m.key === 'close').label, 'Close the speakers list');   // their own version wins
});
