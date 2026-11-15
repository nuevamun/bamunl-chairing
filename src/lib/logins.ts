// Rules for conference-only logins. Pure, so they're tested (tests/logins.test.mjs).
// These logins live in Supabase auth under their own address ending, so they never collide with the
// league admin's (`@users.bamunl.org`), and they have no row in the admin's `members` table.
export const ADMIN_DOMAIN = 'users.bamunl.org';
export const CONF_DOMAIN = 'chairing.bamunl.org';
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72;           // bcrypt ignores everything past 72 bytes
export const MAX_PER_CONFERENCE = 25;

export const adminEmail = (u: string) => `${u.trim().toLowerCase()}@${ADMIN_DOMAIN}`;
export const confEmail = (u: string) => `${u.trim().toLowerCase()}@${CONF_DOMAIN}`;
export const usernameOf = (email: string) => email.replace(new RegExp(`@(${ADMIN_DOMAIN}|${CONF_DOMAIN.replace(/\./g, '\\.')})$`), '');

export function checkNew(username: string, password: string): string {
  if (!USERNAME_RE.test(username)) return 'Usernames are 3 to 30 letters, numbers, dots, dashes or underscores.';
  if (password.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD) return `Passwords can be at most ${MAX_PASSWORD} characters.`;
  return '';
}

/** Only the master, or the subadmin of the club that owns the conference, may manage its logins. A conference-only login may not. */
export function mayManage(member: { role: 'admin' | 'school'; school_id: string | null } | null, conferenceSchoolId: string | null) {
  if (!member) return false;
  if (member.role === 'admin') return true;
  return !!member.school_id && member.school_id === conferenceSchoolId;
}
