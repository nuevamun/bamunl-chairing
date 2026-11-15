// Browser client. The session lives in cookies (not localStorage) so the server can check it before it
// serves any page: see src/middleware.ts. The publishable key (the successor to the anon key) is public
// by design; row-level security in the league project is the lock on the data.
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = !!(url && key);
export const supabase: SupabaseClient | null = configured && typeof document !== 'undefined' ? createBrowserClient(url!, key!) : null;
