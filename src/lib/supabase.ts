// Browser client. The session lives in cookies (not localStorage) so the server can check it before it
// serves any page: see src/middleware.ts. The publishable key (the successor to the anon key) is public
// by design; row-level security in the league project is the lock on the data.
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setClockOffset } from './engine';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = !!(url && key);
// Every reply carries the server's time (to the second). The median of a few readings, kept only when it is clearly
// off (over 2 s), becomes this device's correction. Small differences are left alone, so two windows on one computer
// never disagree with each other, and a projector laptop whose clock is a minute out still lines up.
const OFFSET_KEY = 'chairing:offset';
const samples: number[] = [];
try { setClockOffset(Number(localStorage.getItem(OFFSET_KEY)) || 0); } catch { /* none yet */ }
const timedFetch: typeof fetch = async (input, init) => {
  const t0 = Date.now();
  const res = await fetch(input, init);
  const t1 = Date.now();
  const server = Date.parse(res.headers.get('date') ?? '');
  if (!Number.isNaN(server)) {
    samples.push(server + 500 - (t0 + t1) / 2);          // the header is cut to the second, so the true time is about half a second later
    if (samples.length > 9) samples.shift();
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    const offset = Math.abs(median) > 2000 ? Math.round(median) : 0;
    setClockOffset(offset);
    try { localStorage.setItem(OFFSET_KEY, String(offset)); } catch { /* ignore */ }
  }
  return res;
};
export const supabase: SupabaseClient | null = configured && typeof document !== 'undefined' ? createBrowserClient(url!, key!, { global: { fetch: timedFetch } }) : null;
