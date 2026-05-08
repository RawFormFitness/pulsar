// app/(dashboard)/_lib/session.ts
//
// Server-only helpers used by dashboard pages and the layout to resolve
// the current user's gym from the authenticated Supabase session.
//
// Why this lives here (not in lib/): it's a thin glue layer over
// gym_members.listMembershipsForCurrentUser that's specific to the
// dashboard's "one gym at a time" UX. lib/db/ stays generic.
//
// Multi-tenancy: gymId is resolved from auth.getUser() → gym_members. We
// never accept gymId from the URL or request body. If the user belongs to
// multiple gyms we pick the lowest-id deterministically — the gym switcher
// is a v1.5 concern.

import "server-only";

import { redirect } from "next/navigation";
import {
  createServerDbClient,
  gymMembers as gymMembersDb,
  type DbClient,
} from "@/lib/db";

export type SessionGym = {
  client: DbClient;
  userId: string;
  gymId: string;
};

/**
 * Resolve the current session's gym. Redirects to /login if not signed in.
 * Throws if the user has no gym membership — the dashboard layout handles
 * that case explicitly with a friendlier UI; pages can let the throw
 * propagate.
 */
export async function requireSessionGym(): Promise<SessionGym> {
  const client = await createServerDbClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");

  const memberships = await gymMembersDb.listMembershipsForCurrentUser(client);
  if (memberships.length === 0) {
    throw new Error(
      "You are not a member of any gym. Contact your administrator.",
    );
  }
  const sorted = [...memberships].sort((a, b) =>
    a.gym_id.localeCompare(b.gym_id),
  );
  return { client, userId: user.id, gymId: sorted[0].gym_id };
}
