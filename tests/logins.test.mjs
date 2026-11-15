import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNew, mayManage, adminEmail, confEmail, usernameOf, isTaken } from '../src/lib/logins.ts';

test('usernames and passwords are checked', () => {
  assert.equal(checkNew('chair.one', 'longenough'), '');
  assert.notEqual(checkNew('AB', 'longenough'), '');
  assert.notEqual(checkNew('has space', 'longenough'), '');
  assert.notEqual(checkNew('chair', 'short'), '');
  assert.notEqual(checkNew('chair', 'x'.repeat(73)), '');
});
test('only the owning club or the master may manage a conference\'s logins', () => {
  assert.equal(mayManage({ role: 'admin', school_id: null }, 's1'), true);
  assert.equal(mayManage({ role: 'school', school_id: 's1' }, 's1'), true);
  assert.equal(mayManage({ role: 'school', school_id: 's2' }, 's1'), false);
  assert.equal(mayManage({ role: 'school', school_id: null }, null), false);
  assert.equal(mayManage(null, 's1'), false);            // a conference-only login has no member row
});
test('the two kinds of login never share an address', () => {
  assert.notEqual(adminEmail('sam'), confEmail('sam'));
  assert.equal(usernameOf(confEmail('Sam')), 'sam'); assert.equal(usernameOf(adminEmail('sam')), 'sam');
});

test('the same name typed differently is the same login', () => {
  assert.equal(confEmail('  Sam '), confEmail('sam'));
  assert.equal(adminEmail('SAM'), adminEmail('sam'));
  assert.notEqual(checkNew('sаm', 'longenough'), '');    // a Cyrillic "а" is refused: only plain a-z, 0-9 . _ -
  assert.notEqual(checkNew('s.m', 'longenough') === '' && confEmail('s.m') === confEmail('sm'), true);   // dots matter: s.m and sm are different logins
});
test('a taken address is recognised however Supabase words it', () => {
  assert.equal(isTaken({ code: 'email_exists' }), true);
  assert.equal(isTaken({ status: 422 }), true);
  assert.equal(isTaken({ message: 'A user with this email address has already been registered' }), true);
  assert.equal(isTaken({ message: 'boom', status: 500 }), false);
  assert.equal(isTaken(null), false);
});
