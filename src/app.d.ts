import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '$lib/domain';
import type { AuthUser } from '$lib/server/neon-auth';

declare global {
  namespace App {
    interface Locals {
      /**
       * Request-scoped Data API client. Every query runs under the caller's
       * RLS. Only its query half is used; auth goes through
       * `$lib/server/neon-auth`.
       */
      supabase: SupabaseClient;
      /**
       * The Neon Auth session token, already verified against the auth server
       * in `hooks.server.ts`. Null when there is no valid session. Passed back
       * to Neon Auth by /admin/users, which acts on the director's authority.
       */
      session: string | null;
      user: AuthUser | null;
      /**
       * Read from `profiles`, for UI shaping only. Authorization is RLS —
       * see CLAUDE.md invariant 1. Never branch on this to permit a write.
       */
      role: UserRole | null;
      fullName: string | null;
    }
  }
}

export {};
