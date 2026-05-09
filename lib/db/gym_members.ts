// lib/db/gym_members.ts
//
// Helpers for the auth.user → gym mapping. RLS on this table only lets a
// user see their OWN membership rows.

import type { DbClient } from "./client";
import type { Database } from "./types";

export type GymMember = Database["public"]["Tables"]["gym_members"]["Row"];
export type GymMemberRole = "owner" | "admin" | "staff" | "viewer";

/**
 * Returns the membership row for (userId, gymId), or null if the user is
 * not a member of that gym. Used by server-side authorization checks before
 * delegating to RLS.
 */
export async function getGymMembership(
  client: DbClient,
  gymId: string,
  userId: string,
): Promise<GymMember | null> {
  const { data, error } = await client
    .from("gym_members")
    .select("*")
    .eq("gym_id", gymId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * All gyms the currently-authenticated user is a member of. The userId is
 * derived from the session (auth.getUser()) — there is no userId argument
 * on purpose, so a service-role caller cannot use this helper to list any
 * other user's memberships. Throws if there is no session.
 *
 * This is the auth bootstrap path: a user has to discover which gyms they
 * belong to before any gymId-scoped query can run. Most code paths already
 * know their gym and should use the (client, gymId, ...) helpers instead.
 *
 * Not paginated: a single user belongs to a small number of gyms (one in
 * v1 per the "no multi-user roles" out-of-scope item). The PostgREST
 * 1,000-row cap is not in play here.
 */
export async function listMembershipsForCurrentUser(
  client: DbClient,
): Promise<GymMember[]> {
  const {
    data: { user },
    error: authErr,
  } = await client.auth.getUser();
  if (authErr) throw authErr;
  if (!user) {
    throw new Error(
      "listMembershipsForCurrentUser requires an authenticated session. " +
        "Service-role callers must query gym_members directly with explicit gym_id scoping.",
    );
  }

  const { data, error } = await client
    .from("gym_members")
    .select("*")
    .eq("user_id", user.id);

  if (error) throw error;
  return data ?? [];
}

/**
 * Insert a gym_members row. Service-role only in v1.
 */
export async function addGymMember(
  client: DbClient,
  gymId: string,
  userId: string,
  role: GymMemberRole = "owner",
): Promise<GymMember> {
  const { data, error } = await client
    .from("gym_members")
    .insert({ gym_id: gymId, user_id: userId, role })
    .select()
    .single();

  if (error) throw error;
  return data;
}
