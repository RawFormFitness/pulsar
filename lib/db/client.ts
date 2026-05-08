// lib/db/client.ts
//
// Server-only Supabase client factories used by lib/db helpers.
//
// Why this file exists:
//   * lib/supabase/{client,server,middleware}.ts handle browser auth.
//   * lib/db/* helpers run on the server (Server Actions, route handlers,
//     importer, analytics engine). They need an authenticated server client
//     OR a service-role client for trusted writes.
//   * Service-role keys MUST NEVER ship to the browser. The `server-only`
//     import below makes accidental client-bundle inclusion a build error.
//
// Each helper in lib/db/* takes a `SupabaseClient<Database>` so callers can
// inject either flavor. RLS scoping is still enforced via the (gymId, ...)
// signature — defense in depth.

import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type DbClient = SupabaseClient<Database>;

/**
 * Authenticated server client. RLS applies; queries are filtered to the
 * current user's gym(s) via the gym_members join in policy SQL. Use this
 * for read paths from Server Components / Server Actions.
 */
export async function createServerDbClient(): Promise<DbClient> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component path — middleware refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. BYPASSES RLS. Use ONLY in trusted server code that
 * itself enforces gym_id scoping (importer, analytics engine background
 * jobs). Never import this from anything that can be reached by a browser
 * bundle.
 *
 * Throws at import time if the secret is missing — fail fast.
 */
export function createServiceRoleDbClient(): DbClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Service-role client requires the service-role key.",
    );
  }
  return createSupabaseClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
