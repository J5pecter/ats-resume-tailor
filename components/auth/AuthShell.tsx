"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowLeft, FileText, KeyRound, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, postJson } from "@/lib/client/api";

/**
 * Sign-up and the two ways to sign in.
 *
 * Signup is open to anyone. What used to be an invite code is now an emailed
 * one: a shared secret protects an instance only until the first person passes
 * it on, whereas proving you can read mail at the address you typed has to be
 * done by each person separately, and leaves a record of who did it.
 *
 * Both signup and code-login are two steps, and the second step never asks for
 * the address again — retyping it is how people end up with a code for one
 * address and a form submitting another.
 */

export function AuthShell({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:items-center">
        <Pitch />
        <Card className="shadow-lg">
          <CardContent className="p-5 sm:p-6">
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signup">Sign up</TabsTrigger>
                <TabsTrigger value="login">Log in</TabsTrigger>
              </TabsList>
              <TabsContent value="signup">
                <SignUpForm googleEnabled={googleEnabled} />
              </TabsContent>
              <TabsContent value="login">
                <LogInForm googleEnabled={googleEnabled} />
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

function CodeField({
  id,
  value,
  onChange,
  sentTo,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  sentTo: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Code from your email</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={6}
        value={value}
        // Digits only: people paste codes with stray spaces around them, and a
        // rejection for that would be maddening and entirely our fault.
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder="6 digits"
        className="text-lg tracking-[0.4em]"
      />
      <p className="text-xs text-muted-foreground">
        Sent to <strong>{sentTo}</strong>. It lasts 10 minutes.
      </p>
    </div>
  );
}

function GoogleBlock({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
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
  );
}

const PRIVACY_NOTE = (
  <p className="text-center text-xs leading-relaxed text-muted-foreground">
    Your resume stays in your own database. It is never logged, and you can
    delete everything from the dashboard.
  </p>
);

// ─────────────────────────────── sign up ───────────────────────────────

function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"details" | "code">("details");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await postJson("/api/auth/otp", { email, purpose: "signup" });
      setStep("code");
      setNotice(`We emailed a code to ${email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that code.");
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await postJson("/api/auth/register", { fullName, email, password, code });
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Account created, but sign-in failed. Try logging in.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <form onSubmit={createAccount} className="mt-2 space-y-4">
        {notice ? <Alert tone="info">{notice}</Alert> : null}
        <CodeField id="signup-code" value={code} onChange={setCode} sentTo={email} />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" className="w-full" disabled={busy || code.length < 6}>
          {busy ? <Spinner /> : null}
          Confirm and create account
        </Button>
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep("details")}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void requestCode()}
          >
            Send another code
          </Button>
        </div>
        {PRIVACY_NOTE}
      </form>
    );
  }

  return (
    <form onSubmit={requestCode} className="mt-2 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="signup-name">Full name</Label>
        <Input
          id="signup-name"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Your name"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <p className="text-xs text-muted-foreground">
          We send a code here to confirm it is yours.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Spinner /> : <Mail className="size-4" />}
        Email me a code
      </Button>

      <GoogleBlock enabled={googleEnabled} />
      {PRIVACY_NOTE}
    </form>
  );
}

// ──────────────────────────────── log in ────────────────────────────────

function LogInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "code">("password");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done(result: { error?: string } | undefined, failure: string) {
    if (result?.error) {
      setError(failure);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function withPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      done(
        await signIn("credentials", { email, password, redirect: false }),
        // Deliberately covers three cases at once — wrong password, no such
        // account, unverified address. Saying which would tell a stranger
        // whether an address is registered here.
        "That email and password do not match a confirmed account.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await postJson("/api/auth/otp", { email, purpose: "login" });
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that code.");
    } finally {
      setBusy(false);
    }
  }

  async function withCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      done(
        await signIn("otp", { email, code, redirect: false }),
        "That code is not correct, or it has expired.",
      );
    } finally {
      setBusy(false);
    }
  }

  const switcher = (
    <button
      type="button"
      className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
      onClick={() => {
        setMode(mode === "password" ? "code" : "password");
        setStep("email");
        setError(null);
        setCode("");
      }}
    >
      {mode === "password"
        ? "Or get a one-time code by email instead"
        : "Or sign in with your password instead"}
    </button>
  );

  if (mode === "code") {
    return (
      <form onSubmit={step === "email" ? requestCode : withCode} className="mt-2 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="login-otp-email">Email</Label>
          <Input
            id="login-otp-email"
            type="email"
            autoComplete="email"
            required
            // Locked once a code is out, so the code and the form cannot end up
            // describing two different addresses.
            disabled={step === "code"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {step === "code" ? (
          <>
            <CodeField id="login-code" value={code} onChange={setCode} sentTo={email} />
            <p className="text-xs text-muted-foreground">
              If that address has an account, the code is on its way. Nothing
              arrives for an address that does not.
            </p>
          </>
        ) : null}

        {error ? <Alert tone="error">{error}</Alert> : null}

        <Button
          type="submit"
          className="w-full"
          disabled={busy || (step === "code" && code.length < 6)}
        >
          {busy ? <Spinner /> : <KeyRound className="size-4" />}
          {step === "email" ? "Email me a code" : "Sign in"}
        </Button>

        {step === "code" ? (
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep("email")}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void requestCode()}
            >
              Send another code
            </Button>
          </div>
        ) : null}

        {switcher}
        <GoogleBlock enabled={googleEnabled} />
        {PRIVACY_NOTE}
      </form>
    );
  }

  return (
    <form onSubmit={withPassword} className="mt-2 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
        />
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Spinner /> : null}
        Log in
      </Button>

      {switcher}
      <GoogleBlock enabled={googleEnabled} />
      {PRIVACY_NOTE}
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
