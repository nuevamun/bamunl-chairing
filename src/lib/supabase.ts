// Browser client. The publishable key (sb_publishable_…, the successor to the anon key) is public by design; row-level security (supabase/schema.sql) is the lock.
// Without the two env values the app runs local-only and every sync call is a no-op.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = !!(url && key);
export const supabase: SupabaseClient | null = configured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
