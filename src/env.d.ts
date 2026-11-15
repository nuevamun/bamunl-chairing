/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    db: import('@supabase/supabase-js').SupabaseClient;
    /** Who is signed in: a league admin login ('member': master or subadmin) or a conference-only login. */
    who: { id: string; kind: 'member' | 'conference'; role: 'admin' | 'school' | null; schoolId: string | null; conferenceId: string | null } | null;
  }
}
