"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { FileText, ShieldCheck, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postJson } from "@/lib/client/api";

export function AuthShell({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:items-center">
        <Pitch />
        <Card className="shadow-lg">
          <CardContent className="p-6">
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signup">Sign up</TabsTrigger>
                <TabsTrigger value="login">Log in</TabsTrigger>
              </TabsList>
              <TabsContent value="signup">
                <CredentialsForm mode="signup" googleEnabled={googleEnabled} />
              </TabsContent>
              <TabsContent value="login">
                <CredentialsForm mode="login" googleEnabled={googleEnabled} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Pitch() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">ATS Resume Tailor</h1>
        <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
          Paste a job description and your existing resume. Get back a rewritten,
          ATS-optimised version aimed at that specific role — then refine it in
          conversation and export it as .docx or .pdf.
        </p>
      </div>

      <ul className="space-y-4">
        <Feature
          icon={ShieldCheck}
          title="It will not invent anything"
          body="Every generated bullet carries the fragment of your original resume it came from, and that link is verified after generation. Bullets that cannot be traced are dropped, not shipped."
        />
        <Feature
          icon={Sparkles}
          title="Honest about gaps"
          body="When the job asks for something you genuinely do not have, it is reported as a gap rather than papered over. You should be able to defend every line in an interview."
        />
        <Feature
          icon={FileText}
          title="Single-column, parser-safe exports"
          body="No tables, no sidebars, no graphics, standard section headings, selectable text. The formats an ATS can actually read."
        />
      </ul>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

function CredentialsForm({
  mode,
  googleEnabled,
}: {
  mode: "signup" | "login";
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === "signup") {
        await postJson("/api/auth/register", { fullName, email, password });
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError(
          mode === "login"
            ? "That email and password do not match an account."
            : "Account created, but sign-in failed. Try logging in.",
        );
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-4">
      {mode === "signup" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${mode}-name`}>Full name</Label>
          <Input
            id={`${mode}-name`}
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-email`}>Email</Label>
        <Input
          id={`${mode}-email`}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-password`}>Password</Label>
        <Input
          id={`${mode}-password`}
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Spinner /> : null}
        {mode === "signup" ? "Create account" : "Log in"}
      </Button>

      {googleEnabled ? (
        <>
          <div className="relative py-1 text-center">
            <span className="relative z-10 bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
              or
            </span>
            <span className="absolute inset-x-0 top-1/2 block h-px bg-border" aria-hidden />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          >
            <GoogleMark />
            Continue with Google
          </Button>
        </>
      ) : null}

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Your resume stays in your own database. It is never logged, and you can
        delete everything from the dashboard.
      </p>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.56-5.15 3.56-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3a7.2 7.2 0 0 1-10.73-3.78H1.34v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.33 14.31a7.2 7.2 0 0 1 0-4.6V6.62H1.34a12 12 0 0 0 0 10.78l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.34 6.62l3.99 3.09A7.2 7.2 0 0 1 12 4.75Z"
      />
    </svg>
  );
}
