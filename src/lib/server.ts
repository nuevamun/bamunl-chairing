import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

const url = () => import.meta.env.PUBLIC_SUPABASE_URL as string;
const key = () => import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;

/** Acts as the signed-in person, so row-level security applies. */
export function userClient(request: Request, cookies: AstroCookies) {
  return createServerClient(url(), key(), {
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
}

/** Bypasses row-level security. Only for creating and removing conference logins, after checking who is asking. Never sent to a browser. */
export const serviceClient = () => {
  const k = import.meta.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url(), k, { auth: { persistSession: false } });
};
