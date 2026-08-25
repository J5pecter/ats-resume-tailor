"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Briefcase, Check, FileText, LogOut, Trash2, Wand2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JobDescriptionTab, type JdState } from "./JobDescriptionTab";
import { ResumeTab, type ResumeState, type TailorOutcome } from "./ResumeTab";
import { RefineTab } from "./RefineTab";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { ApiError, getJson } from "@/lib/client/api";
import type { MatchAnalysis } from "@/lib/schema/analysis";
import { cn } from "@/lib/utils";

type TabKey = "jd" | "resume" | "refine";

interface StatusResponse {
  llm: { provider: string; model: string; ready: boolean; hint: string | null };
  googleEnabled: boolean;
  quota: { remaining: number; limit: number } | null;
}

interface WorkspaceResponse {
  jd: JdState | null;
  resume: ResumeState | null;
  analysis: MatchAnalysis | null;
  tailored: TailorOutcome | null;
}

export function DashboardShell({ userLabel }: { userLabel: string }) {
  const [tab, setTab] = useState<TabKey>("jd");
  const [jd, setJd] = useState<JdState | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null);
  const [outcome, setOutcome] = useState<TailorOutcome | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    void getJson<StatusResponse>("/api/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [outcome]);

  // A tailored resume is expensive to produce, so a reload restores the last
  // one rather than dropping the user back at an empty first tab.
  useEffect(() => {
    void getJson<WorkspaceResponse>("/api/workspace")
      .then((state) => {
        if (state.jd) setJd(state.jd);
        if (state.resume) setResume(state.resume);
        if (state.analysis) setAnalysis(state.analysis);
        if (state.tailored) {
          setOutcome(state.tailored);
          setTab("refine");
        } else if (state.resume) {
          setTab("resume");
        }
      })
      .catch(() => undefined)
      .finally(() => setRestoring(false));
  }, []);

  const llmReady = status?.llm.ready ?? true;

  if (restoring) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="w-full max-w-2xl space-y-3">
          <div className="skeleton h-9 w-64 rounded-md" />
          <div className="skeleton h-48 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Wand2 className="size-3.5" />
            </span>
            <span className="font-semibold tracking-tight">ATS Resume Tailor</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {status?.quota ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {status.quota.remaining}/{status.quota.limit} generations left this hour
              </span>
            ) : null}
            <span className="hidden text-sm text-muted-foreground md:inline">{userLabel}</span>
            <ChangePasswordDialog />
            <DeleteDataButton />
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
              <LogOut className="size-4" />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[92rem] flex-1 px-4 py-6 sm:px-6">
        {status && !status.llm.ready ? (
          <Alert tone="warning" title="Add a model key to get started" className="mb-5">
            {status.llm.hint}
            <p className="mt-1.5">
              The app is otherwise ready — signup, uploads and exports all work.
              Only the five model-backed steps need the key.
            </p>
          </Alert>
        ) : null}

        <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <StepTrigger value="jd" icon={Briefcase} label="Job description" done={Boolean(jd)} />
            <StepTrigger
              value="resume"
              icon={FileText}
              label="Resume"
              done={Boolean(outcome)}
              disabled={!jd}
            />
            <StepTrigger
              value="refine"
              icon={Wand2}
              label="Refine & export"
              done={false}
              disabled={!outcome}
            />
          </TabsList>

          <TabsContent value="jd">
            <JobDescriptionTab
              jd={jd}
              llmReady={llmReady}
              onParsed={(next) => {
                setJd(next);
                if (!next) {
                  setAnalysis(null);
                  setOutcome(null);
                }
              }}
              onContinue={() => setTab("resume")}
            />
          </TabsContent>

          <TabsContent value="resume">
            <ResumeTab
              jdId={jd?.id ?? null}
              resume={resume}
              analysis={analysis}
              llmReady={llmReady}
              onParsed={setResume}
              onAnalysed={setAnalysis}
              onTailored={(next) => {
                setOutcome(next);
                setTab("refine");
              }}
            />
          </TabsContent>

          <TabsContent value="refine">
            <RefineTab outcome={outcome} onOutcomeChange={setOutcome} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StepTrigger({
  value,
  icon: Icon,
  label,
  done,
  disabled,
}: {
  value: string;
  icon: React.ElementType;
  label: string;
  done: boolean;
  disabled?: boolean;
}) {
  return (
    <TabsTrigger value={value} disabled={disabled}>
      {done ? (
        <Check className="size-4 text-[var(--success)]" aria-hidden />
      ) : (
        <Icon className="size-4" aria-hidden />
      )}
      <span className={cn("truncate", disabled && "opacity-70")}>{label}</span>
    </TabsTrigger>
  );
}

function DeleteDataButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) throw new ApiError("Deletion failed.", res.status);
      await signOut({ callbackUrl: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed.");
      setBusy(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Trash2 className="size-4" />
          <span className="hidden sm:inline">Delete my data</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Delete everything?"
        description="This removes your account, every job description, every resume, every tailored version and every log entry. It cannot be undone."
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
            {busy ? "Deleting…" : "Delete everything"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
