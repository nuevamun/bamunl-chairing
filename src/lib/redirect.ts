/**
 * Where to go after signing in. Only a path on this site. Anything that could mean another site is refused: browsers
 * delete tabs and line breaks from a URL before reading it, so "/<tab>/evil.com" becomes "//evil.com". We refuse control
 * characters, whitespace and backslashes outright, then check the result still lands on our own origin.
 */
export function safeNext(wanted: string | null | undefined, origin = 'https://site.invalid'): string {
  const v = String(wanted ?? '');
  if (!v.startsWith('/') || v.startsWith('//') || /[\u0000-\u001f\u007f-\u009f\s\\]/.test(v)) return '/';
  try { if (new URL(v, origin).origin !== new URL(origin).origin) return '/'; } catch { return '/'; }
  return v;
}
