import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { sendMagicLink, signInWithPassword } from "./actions";

type SearchParams = Promise<{
  tab?: string;
  sent?: string;
  error?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { tab, sent, error } = await searchParams;
  const activeTab = tab === "password" ? "password" : "magic";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Pulsar</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <Tabs defaultValue={activeTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="magic">Magic Link</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>

          <TabsContent value="magic" className="space-y-3 pt-4">
            <form action={sendMagicLink} className="space-y-3">
              <Input
                type="email"
                name="email"
                placeholder="you@yourgym.com"
                autoComplete="email"
                required
              />
              <Button type="submit" className="w-full">
                Send magic link
              </Button>
            </form>
            {activeTab === "magic" && sent && (
              <p className="text-sm text-center text-muted-foreground">
                Check your inbox — we just sent you a sign-in link.
              </p>
            )}
            {activeTab === "magic" && error && (
              <p className="text-sm text-center text-destructive">{error}</p>
            )}
          </TabsContent>

          <TabsContent value="password" className="space-y-3 pt-4">
            <form action={signInWithPassword} className="space-y-3">
              <Input
                type="email"
                name="email"
                placeholder="you@yourgym.com"
                autoComplete="email"
                required
              />
              <Input
                type="password"
                name="password"
                placeholder="Password"
                autoComplete="current-password"
                required
              />
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
            {activeTab === "password" && error && (
              <p className="text-sm text-center text-destructive">{error}</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
