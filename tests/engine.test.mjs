import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, statsFor, newCommittee, passes, motionTypes, parseNames, checkMod, DEFAULT_CONFIG } from '../src/lib/engine.ts';

const mk = () => { const c = newCommittee('UNSC'); c.needsOpen = false;   // these tests start with a list already open, like committees made before lists had to be opened
  c.delegates = [{ id: 'a', name: 'France' }, { id: 'b', name: 'Peru' }]; return c; };
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
  const s = derive(c); assert.equal(s.gslOpen, true); assert.equal(s.motions[0].result, 'failed');
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

test('motion types run most to least disruptive, "other" last; retired ones stay out of the buttons but still read', () => {
  const old = { speakTime: 60, majority: 'simple', motions: [{ key: 'close', label: 'Close the speakers list', effect: 'close', fields: [] }, { key: 'mod', label: 'Moderated caucus', effect: 'mod', fields: [] }, { key: 'custom', label: 'Our own', effect: 'none', fields: [] }] };
  assert.deepEqual(motionTypes(old).map((m) => m.key), ['votingbloc', 'unmod', 'mod', 'roundrobin', 'openlist', 'custom', 'other']);
  assert.equal(motionTypes(old).find((m) => m.key === 'mod').label, 'Moderated caucus');
});

test('pasted lists become delegate names whatever the line breaks', () => {
  assert.deepEqual(parseNames('France\nPeru\nGhana'), ['France', 'Peru', 'Ghana']);
  assert.deepEqual(parseNames('France\r\nPeru\r\nGhana\r\n'), ['France', 'Peru', 'Ghana']);   // Windows
  assert.deepEqual(parseNames('France\rPeru\rGhana'), ['France', 'Peru', 'Ghana']);             // old Mac
  assert.deepEqual(parseNames('France\u2028Peru\u000bGhana'), ['France', 'Peru', 'Ghana']);       // Docs / Word soft breaks
  assert.deepEqual(parseNames('France\tPeru\tGhana'), ['France', 'Peru', 'Ghana']);               // a spreadsheet row
  assert.deepEqual(parseNames('1. France\n2) Peru\n- Ghana\n• Chad'), ['France', 'Peru', 'Ghana', 'Chad']);
  assert.deepEqual(parseNames('Korea, Republic of\nkorea, republic of\n  Cote   d\'Ivoire '), ['Korea, Republic of', "Cote d'Ivoire"]);
  assert.deepEqual(parseNames('  \n\n '), []);
});

test('a moderated caucus carries its topic from proposal through amendment into the running caucus', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a', topic: '  Water access  ' });
  const id = c.events[0].id;
  assert.equal(derive(c).proposed[0].topic, 'Water access');
  E(c, 1, 'amend', { target: id, topic: 'Clean water financing' });
  E(c, 2, 'vote', { target: id, result: 'passed' });
  const s = derive(c);
  assert.equal(s.mode.topic, 'Clean water financing'); assert.equal(s.motions[0].topic, 'Clean water financing');
});

test('when a motion passes, the rest of the floor is reset and logged as not voted', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'unmod', params: { total: 5 } }); E(c, 1, 'floor', { key: 'mod', params: { total: 10, per: 45 } });
  const first = c.events[0].id;
  E(c, 2, 'vote', { target: first, result: 'passed' });
  const s = derive(c);
  assert.equal(s.proposed.length, 0); assert.equal(s.mode.kind, 'unmod');
  assert.deepEqual(s.motions.map((m) => m.result), ['passed', 'withdrawn']);
});
test('a failed motion leaves the rest of the floor alone', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'unmod', params: { total: 5 } }); E(c, 1, 'floor', { key: 'mod', params: { total: 10, per: 45 } });
  E(c, 2, 'vote', { target: c.events[0].id, result: 'failed' });
  assert.equal(derive(c).proposed.length, 1);
});
test('round robin lists everyone present once, with no caucus clock', () => {
  const c = mk(); c.delegates.push({ id: 'z', name: 'Chad' });
  E(c, 0, 'attend', { d: 'a', s: 'present' }); E(c, 1, 'attend', { d: 'z', s: 'pv' });      // Peru absent
  E(c, 2, 'floor', { key: 'roundrobin', params: { per: 30 } }); E(c, 3, 'vote', { result: 'passed' });
  const s = derive(c);
  assert.deepEqual(s.lists.mod, ['a', 'z']); assert.equal(s.mode.rr, true); assert.equal(s.mode.per, 30);
});
test('opening the speakers list ends a caucus and reopens a closed list', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'close' }); E(c, 1, 'vote', { result: 'passed' });
  assert.equal(derive(c).gslOpen, false);
  E(c, 2, 'floor', { key: 'openlist' }); E(c, 3, 'vote', { result: 'passed' });
  const s = derive(c); assert.equal(s.gslOpen, true); assert.equal(s.mode.kind, 'gsl');
});
test('moving into voting bloc takes two-thirds when decided by counts', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'votingbloc' }); E(c, 1, 'vote', { yes: 5, no: 3 });          // simple majority would pass; two-thirds does not
  assert.equal(derive(c).mode.kind, 'gsl'); assert.equal(derive(c).motions[0].result, 'failed');
  E(c, 2, 'floor', { key: 'votingbloc' }); E(c, 3, 'vote', { yes: 6, no: 3 });
  assert.equal(derive(c).mode.kind, 'voting');
});

test('a moderated caucus must be a whole number of speeches', () => {
  assert.equal(checkMod(10, 60), ''); assert.equal(checkMod(10, 30), ''); assert.equal(checkMod(9, 45), ''); assert.equal(checkMod(5, 20), '');
  const bad = checkMod(10, 45);
  assert.match(bad, /10 min doesn’t divide into 45 s speeches/);
  assert.match(bad, /9 or 12 min/);                                  // totals that work with 45 s
  assert.match(bad, /40, 50, 60 s per speaker|30, 40, 50 s|40, 50/);   // speech lengths that work with 10 min
  assert.notEqual(checkMod(2, 90), ''); assert.notEqual(checkMod(1, 120), '');   // longer than the caucus
  assert.notEqual(checkMod(0, 45), '');
});
test('the default moderated caucus is itself valid', () => {
  const mod = DEFAULT_CONFIG.motions.find((m) => m.key === 'mod');
  assert.equal(checkMod(mod.fields[0].def, mod.fields[1].def), '');
  const old = { speakTime: 60, majority: 'simple', motions: [{ key: 'mod', label: 'Moderated caucus', effect: 'mod', fields: [{ key: 'per', def: 45 }] }] };
  const fixed = motionTypes(old).find((m) => m.key === 'mod');
  assert.equal(checkMod(fixed.fields[0].def, fixed.fields[1].def), '');   // an older saved 10|45 default is replaced
});

test('a new committee has no speakers list until a motion opens it; a moderated caucus has its own order of speaking', () => {
  const c = newCommittee('UNSC'); c.delegates = [{ id: 'a', name: 'France' }, { id: 'b', name: 'Peru' }];
  E(c, 0, 'add', { d: 'a' });
  assert.equal(derive(c).gslOpen, false); assert.deepEqual(derive(c).lists.gsl, []);      // nothing to add to yet
  E(c, 1, 'floor', { key: 'openlist' }); E(c, 2, 'vote', { result: 'passed' });
  E(c, 3, 'add', { d: 'a' });
  assert.equal(derive(c).gslOpen, true); assert.deepEqual(derive(c).lists.gsl, ['a']);
  E(c, 4, 'floor', { key: 'mod', params: { total: 10, per: 60 }, by: '' }); E(c, 5, 'vote', { result: 'passed' });
  E(c, 6, 'add', { d: 'b' });
  const s = derive(c);
  assert.deepEqual(s.lists.mod, ['b']); assert.deepEqual(s.lists.gsl, ['a']);               // separate lists
});
test('a caucus works before any speakers list is open', () => {
  const c = newCommittee('UNSC'); c.delegates = [{ id: 'a', name: 'France' }];
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 60 } }); E(c, 1, 'vote', { result: 'passed' }); E(c, 2, 'add', { d: 'a' });
  assert.deepEqual(derive(c).lists.mod, ['a']);
  E(c, 3, 'end_caucus'); assert.equal(derive(c).gslOpen, false);
});
