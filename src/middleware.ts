// Every page and API route needs a league admin login (a row in `members`): subadmins and the master.
// Only /login is open. Nothing about a committee is in the page itself, but the shell is still closed.
import { defineMiddleware } from 'astro:middleware';
import { createServerClient } from '@supabase/ssr';

export const onRequest = defineMiddleware(async ({ request, cookies, url, redirect }, next) => {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL, key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !key) return new Response('Not configured', { status: 503 });

  const db = createServerClient(supabaseUrl, key, {
    cookies: {
      getAll() {
        return (request.headers.get('cookie') ?? '').split(/;\s*/).filter(Boolean).map((c) => {
          const i = c.indexOf('=');
          return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) };
        });
      },
      setAll(list) {
        // The browser client reads the session too (to sync), so these can't be HttpOnly.
        for (const { name, value, options } of list) cookies.set(name, value, { ...options, path: '/', secure: import.meta.env.PROD, sameSite: 'lax', maxAge: options?.maxAge === 0 ? 0 : 60 * 60 * 24 * 7 });
      },
    },
  });

  let ok = false;
  const { data } = await db.auth.getUser();                     // asks Supabase, so a forged cookie fails
  if (data.user) {
    const { data: m } = await db.from('members').select('role').eq('user_id', data.user.id).maybeSingle();
    ok = !!m;
  }

  const open = url.pathname === '/login';
  if (!ok && !open) return redirect('/login');
  if (ok && open) return redirect('/');
  const res = await next();
  try { res.headers.set('Cache-Control', 'private, no-store'); } catch { /* immutable response */ }
  return res;
});
