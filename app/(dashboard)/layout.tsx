// app/(dashboard)/layout.tsx
//
// Shared chrome for every dashboard page: header with the gym name, sign-out
// control, and an Import Data button that mounts the import wizard. Auth is
// enforced here once so descendant pages don't repeat the redirect.
//
// Multi-tenancy: the gym for the header is resolved from the authenticated
// session, not from a URL param. If a user belongs to multiple gyms we show
// the first deterministically (stable order). The gym switcher is a v1.5
// concern.
//
// Boundary: this server component reads the gym name (a fact, not a metric)
// via lib/db/. Charts/metric tiles never live in the layout — those go
// through the analytics-engine in the page server component, then flow into
// client components as props.

import { redirect } from "next/navigation";
import { UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  createServerDbClient,
  gyms as gymsDb,
  gymConfigs as gymConfigsDb,
  gymMembers as gymMembersDb,
} from "@/lib/db";
import { signOut } from "@/app/login/actions";
import { ImportDialog } from "@/components/import-dialog";

/**
 * Try to extract a gym display name from gym_configs.config — Level 2
 * override path. Falls back to gyms.name.
 */
function gymNameFromConfig(config: unknown): string | null {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const v = (config as Record<string, unknown>)["display_name"];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = await createServerDbClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) redirect("/login");

  const memberships = await gymMembersDb.listMembershipsForCurrentUser(client);
  if (memberships.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">No gym assigned</h1>
          <p className="text-sm text-muted-foreground">
            Your account is signed in but isn't a member of any gym yet.
            Contact your administrator.
          </p>
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </div>
      </main>
    );
  }

  const sorted = [...memberships].sort((a, b) =>
    a.gym_id.localeCompare(b.gym_id),
  );
  const gymId = sorted[0].gym_id;

  const [gym, config] = await Promise.all([
    gymsDb.getGym(client, gymId),
    gymConfigsDb.getGymConfigJson(client, gymId),
  ]);

  // Level 2: gym_configs.display_name overrides gyms.name; gyms.name is the
  // baseline. Never bake a specific gym name into copy.
  const displayName =
    gymNameFromConfig(config) ?? gym?.name ?? "Your gym";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Pulsar</div>
            <div className="truncate text-base font-semibold">
              {displayName}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ImportDialog>
              <Button>
                <UploadIcon />
                Import data
              </Button>
            </ImportDialog>
            <form action={signOut}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
