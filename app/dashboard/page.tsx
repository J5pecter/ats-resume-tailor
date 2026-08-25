import { auth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const label = session?.user?.name || session?.user?.email || "Signed in";
  return <DashboardShell userLabel={label} />;
}
