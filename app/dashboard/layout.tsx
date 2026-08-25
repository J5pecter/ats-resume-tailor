import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/** /dashboard is unreachable while logged out (§Phase 1 acceptance). */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  return <>{children}</>;
}
