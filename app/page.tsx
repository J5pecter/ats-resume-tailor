import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/lib/auth";
import { signupCodeRequired } from "@/lib/signupGate";
import { AuthShell } from "@/components/auth/AuthShell";

export default async function HomePage() {
  const session = await auth();
  if (session?.user?.id) redirect("/dashboard");

  return <AuthShell googleEnabled={googleEnabled()} signupCodeRequired={signupCodeRequired()} />;
}
