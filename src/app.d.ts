import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { UserRole } from '$lib/domain';

declare global {
  namespace App {
    interface Locals {
      /** Request-scoped client. Every query runs under the caller's RLS. */
      supabase: SupabaseClient;
      /**
       * Validates the JWT against the auth server. Use this, never
       * `getSession()` alone — the cookie is user-controlled and its
       * unverified payload must not gate anything.
       */
      safeGetSession(): Promise<{ session: Session | null; user: User | null }>;
      session: Session | null;
      user: User | null;
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
