"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, History, MessageSquare, Save, Send, Undo2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBar } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ChangeLogPanel } from "@/components/resume/ChangeLogPanel";
import { ResumePreview } from "@/components/resume/ResumePreview";
import { ApiError, downloadExport, getJson, patchJson, postJson } from "@/lib/client/api";
import type { ResumeDoc } from "@/lib/schema/resume";
import type { ChangeLogEntry } from "@/lib/schema/tailor";
import type { TailorOutcome } from "./ResumeTab";

interface VersionRow {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
}

interface RefineResponse {
  applied: boolean;
  tailoredResumeId?: string;
  version?: number;
  resume?: ResumeDoc;
  changesApplied?: { section: string; before: string; after: string }[];
  needsVerification?: string[];
  warnings?: string[];
  needsClarification?: string;
  drift?: { path: string; before: string; after: string }[];
  error?: string;
}

export function RefineTab({
  outcome,
  onOutcomeChange,
}: {
  outcome: TailorOutcome | null;
  onOutcomeChange: (next: TailorOutcome) => void;
}) {
  const [draft, setDraft] = useState<ResumeDoc | null>(outcome?.resume ?? null);
  const [instruction, setInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);
  const [feedback, setFeedback] = useState<RefineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);

  const tailoredId = outcome?.tailoredResumeId ?? null;

  // Adjust derived state during render: when a refinement, rollback or save
  // replaces the document, the editable draft follows it.
  const [syncedFrom, setSyncedFrom] = useState(outcome?.resume ?? null);
  if (outcome?.resume !== syncedFrom) {
    setSyncedFrom(outcome?.resume ?? null);
    setDraft(outcome?.resume ?? null);
  }

  const loadVersions = useCallback(async () => {
    if (!tailoredId) return;
    try {
      const result = await getJson<{ versions: VersionRow[] }>(
        `/api/tailored/${tailoredId}/versions`,
      );
      setVersions(result.versions);
    } catch {
      /* version history is supplementary — never block the editor on it */
    }
  }, [tailoredId]);

  useEffect(() => {
    if (!tailoredId) return;
    let cancelled = false;

    void (async () => {
      try {
        const result = await getJson<{ versions: VersionRow[] }>(
          `/api/tailored/${tailoredId}/versions`,
        );
        if (!cancelled) setVersions(result.versions);
      } catch {
        /* supplementary — never block the editor on it */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tailoredId]);

  if (!outcome || !draft) {
    return (
      <Alert tone="info" title="Nothing to refine yet">
        Generate a tailored resume on the previous tab and it will open here.
      </Alert>
    );
  }

  const restoredNote = outcome.restored ? (
    <Alert tone="info" title="Reopened from your last session">
      This is the version generated on{" "}
      <strong>{formatGeneratedAt(outcome.restored.generatedAt)}</strong>, not a new
      one — reopened either because you came back to it or because you picked it
      from <strong>Saved work</strong>. To produce a fresh version, go back to{" "}
      <strong>Resume</strong> and press <strong>Generate tailored resume</strong> —
      or refine this one below, which also saves a new version.
    </Alert>
  ) : null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(outcome.resume);

  async function saveEdits() {
    if (!tailoredId || !draft) return;
    setSavingEdits(true);
    setError(null);
    try {
      const result = await patchJson<{ saved: boolean; tailoredResumeId: string; version: number }>(
        `/api/tailored/${tailoredId}`,
        { resume: draft },
      );
      if (result.saved && outcome) {
        onOutcomeChange({
          ...outcome,
          tailoredResumeId: result.tailoredResumeId,
          version: result.version,
          resume: draft,
          changeLog: [],
        });
        await loadVersions();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Those edits could not be saved.");
    } finally {
      setSavingEdits(false);
    }
  }

  async function refine() {
    if (!tailoredId || !outcome) return;
    setRefining(true);
    setError(null);
    setFeedback(null);
    try {
      const result = await postJson<RefineResponse>("/api/refine", {
        tailoredResumeId: tailoredId,
        instruction,
      });
      setFeedback(result);

      if (result.applied && result.resume && result.tailoredResumeId && result.version) {
        onOutcomeChange({
          ...outcome,
          tailoredResumeId: result.tailoredResumeId,
          version: result.version,
          resume: result.resume,
          changeLog: (result.changesApplied ?? []).map<ChangeLogEntry>((c) => ({
            section: c.section,
            changeType: "reworded",
            before: c.before,
            after: c.after,
            rationale: instruction,
            keywordsTargeted: [],
          })),
        });
        setInstruction("");
        await loadVersions();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That refinement failed.");
    } finally {
      setRefining(false);
    }
  }

  async function rollback(versionId: string) {
    if (!tailoredId || !outcome) return;
    setError(null);
    try {
      const result = await postJson<{
        tailoredResumeId: string;
        version: number;
        resume: ResumeDoc;
        restoredFrom: number;
      }>(`/api/tailored/${tailoredId}/versions`, { restoreId: versionId });

      onOutcomeChange({
        ...outcome,
        tailoredResumeId: result.tailoredResumeId,
        version: result.version,
        resume: result.resume,
        changeLog: [],
      });
      await loadVersions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rollback failed.");
    }
  }

  async function exportAs(format: "docx" | "pdf") {
    if (!tailoredId) return;
    setExporting(format);
    setError(null);
    try {
      await downloadExport(tailoredId, format);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-5">
      {restoredNote}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:items-start">
        {/* ── left: live preview ─────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Live preview</h3>
              <Badge variant="neutral">v{outcome.version}</Badge>
              {dirty ? <Badge variant="warning">unsaved edits</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Click any line to edit it directly.
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg bg-muted/60 p-3">
            <ResumePreview resume={draft} onChange={setDraft} />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
            <Button onClick={() => void saveEdits()} disabled={!dirty || savingEdits} size="sm">
              {savingEdits ? <Spinner /> : <Save className="size-4" />}
              Save version
            </Button>
            <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportAs("docx")}
              disabled={exporting !== null}
            >
              {exporting === "docx" ? <Spinner /> : <Download className="size-4" />}
              Export .docx
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportAs("pdf")}
              disabled={exporting !== null}
            >
              {exporting === "pdf" ? <Spinner /> : <Download className="size-4" />}
              Export .pdf
            </Button>
            {dirty ? (
              <p className="ml-auto text-xs text-muted-foreground">
                Exports use the last saved version — save first.
              </p>
            ) : null}
          </div>

          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>

        {/* ── right: instruct, changes, history ──────────────────────── */}
        <div className="space-y-4 xl:sticky xl:top-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="size-4" />
                Tell it what to change
              </CardTitle>
              <CardDescription>
                One instruction at a time. Anything you did not ask for is
                treated as a bug and discarded.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                aria-label="Refinement instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Make the summary shorter. Emphasise stakeholder management more. Rewrite bullet 3 of the ARSSBL role."
                className="min-h-24"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && instruction.trim().length > 2) {
                    e.preventDefault();
                    void refine();
                  }
                }}
              />
              <Button
                className="w-full"
                onClick={() => void refine()}
                disabled={refining || instruction.trim().length < 3}
              >
                {refining ? <Spinner /> : <Send className="size-4" />}
                {refining ? "Applying…" : "Apply change"}
              </Button>

              {feedback ? <RefineFeedback feedback={feedback} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Tabs defaultValue="changes">
                <TabsList className="m-3 grid w-[calc(100%-1.5rem)] grid-cols-3">
                  <TabsTrigger value="changes">Changes</TabsTrigger>
                  <TabsTrigger value="gaps">Gaps</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="changes" className="mt-0 max-h-[30rem] overflow-y-auto p-3 pt-0">
                  <ChangeLogPanel entries={outcome.changeLog} />
                </TabsContent>

                <TabsContent value="gaps" className="mt-0 max-h-[30rem] space-y-4 overflow-y-auto p-3 pt-0">
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium">Projected ATS score</span>
                      <span className="font-mono text-lg font-semibold tabular-nums">
                        {Math.round(outcome.projectedAtsScore)}
                      </span>
                    </div>
                    <ScoreBar value={outcome.projectedAtsScore} />
                    <p className="text-xs text-muted-foreground">
                      Was {Math.round(outcome.analysis.atsScore)} before tailoring.
                    </p>
                  </div>

                  <EvidenceSummary evidence={outcome.evidence} />

                  <RetentionSummary retention={outcome.retention} />

                  {outcome.forbiddenRemoved?.length ? (
                    <Alert
                      tone="warning"
                      title={`${outcome.forbiddenRemoved.length} claim(s) removed for citing a gap keyword`}
                    >
                      The rewrite attached a keyword from the missing list to work
                      your resume does not evidence. Those claims were removed
                      rather than shipped:
                      <ul className="mt-1.5 space-y-1">
                        {outcome.forbiddenRemoved.map((r, i) => (
                          <li key={i} className="text-xs">
                            <Badge variant="destructive" className="mr-1.5 align-middle">
                              {r.term}
                            </Badge>
                            <span className="text-muted-foreground">{r.where}</span> — {r.text}
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  ) : null}

                  {outcome.forbiddenKeywordHits.length ? (
                    <Alert tone="error" title="Gap keywords still present">
                      {outcome.forbiddenKeywordHits.map((h) => h.term).join(", ")} — you cannot
                      currently evidence these. Remove them before you send this out.
                    </Alert>
                  ) : null}

                  {outcome.remainingGaps.length ? (
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-medium">Still missing</h4>
                      <ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">
                        {outcome.remainingGaps.map((gap, i) => (
                          <li key={i} className="flex gap-2">
                            <span aria-hidden className="text-border">•</span>
                            <span>{gap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="history" className="mt-0 max-h-[30rem] overflow-y-auto p-3 pt-0">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <History className="size-3.5" />
                    Every change writes a new version. Nothing is overwritten.
                  </div>
                  <ol className="space-y-1.5">
                    {versions.map((version) => {
                      const current = version.id === tailoredId;
                      return (
                        <li
                          key={version.id}
                          className="flex items-center gap-3 rounded-md border border-border p-2.5"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            v{version.version}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm" title={version.note ?? ""}>
                            {version.note ?? "—"}
                          </span>
                          {current ? (
                            <Badge variant="neutral">current</Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void rollback(version.id)}
                            >
                              <Undo2 className="size-3.5" />
                              Restore
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Reports the evidence check in the two situations it runs in, which mean
 * different things: straight after generation the failing claims were removed
 * from the saved document, whereas on reload nothing is removed — the stored
 * document is simply re-verified, and anything that fails is unverified rather
 * than rejected. Conflating the two would either alarm the user about a
 * deletion that did not happen, or reassure them about one that did.
 */
function EvidenceSummary({ evidence }: { evidence: TailorOutcome["evidence"] }) {
  const { checkedBullets, checkedSkills, dropped, issues } = evidence;
  const total = checkedBullets + checkedSkills;

  if (issues.length === 0) {
    if (total === 0) return null;
    return (
      <Alert tone="success" title="Evidence check passed">
        All {checkedBullets} bullet{checkedBullets === 1 ? "" : "s"} and {checkedSkills} skill
        {checkedSkills === 1 ? "" : "s"} trace back to your original resume.
      </Alert>
    );
  }

  return (
    <Alert
      tone="warning"
      title={
        dropped
          ? `${issues.length} claim${issues.length === 1 ? "" : "s"} rejected`
          : `${issues.length} claim${issues.length === 1 ? "" : "s"} could not be verified`
      }
    >
      {dropped
        ? "These could not be traced back to your original resume, so they were dropped rather than shipped:"
        : "These are in the document but no longer trace back to your original resume. Nothing was removed — check you can defend each one:"}
      <ul className="mt-1.5 space-y-1">
        {issues.map((issue, i) => (
          <li key={i} className="text-xs">
            <Badge variant="neutral" className="mr-1.5 align-middle">
              {issue.kind}
            </Badge>
            <span className="font-medium text-foreground">{issue.where}</span> — {issue.text}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/**
 * What the rewrite left out.
 *
 * Trimming for length is legitimate, but it has to be visible: the candidate is
 * the only one who knows whether a dropped bullet was the one that mattered,
 * and they can only put it back if they are told it went.
 */
function RetentionSummary({ retention }: { retention: TailorOutcome["retention"] }) {
  if (!retention || retention.dropped.length === 0) {
    if (!retention || retention.originalBullets === 0) return null;
    return (
      <Alert tone="success" title="Nothing was left behind">
        All {retention.originalBullets} bullets and {retention.originalSkills} skills from
        your resume are present, reordered for this role.
      </Alert>
    );
  }

  const bullets = retention.dropped.filter((d) => d.kind === "bullet");
  const skills = retention.dropped.filter((d) => d.kind === "skill");
  const roles = retention.dropped.filter((d) => d.kind === "role");

  return (
    <Alert
      tone={retention.substantialLoss ? "warning" : "info"}
      title={`${retention.keptBullets} of ${retention.originalBullets} bullets, ${retention.keptSkills} of ${retention.originalSkills} skills kept`}
    >
      These were in your resume but are not in the tailored version. If any
      matter for this role, add them back with the instruction box or by editing
      the preview directly.

      {roles.length ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-foreground">Roles dropped</p>
          <ul className="mt-1 space-y-1">
            {roles.map((d, i) => (
              <li key={i} className="text-xs">{d.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {bullets.length ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-foreground">Bullets dropped ({bullets.length})</p>
          <ul className="mt-1 space-y-1">
            {bullets.map((d, i) => (
              <li key={i} className="text-xs">
                <span className="text-muted-foreground">{d.where}</span> — {d.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {skills.length ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-foreground">Skills dropped ({skills.length})</p>
          <p className="mt-1 text-xs">{skills.map((d) => d.text).join(", ")}</p>
        </div>
      ) : null}
    </Alert>
  );
}

function RefineFeedback({ feedback }: { feedback: RefineResponse }) {
  if (feedback.needsClarification) {
    return (
      <Alert tone="info" title="Needs one more detail">
        {feedback.needsClarification}
      </Alert>
    );
  }

  if (!feedback.applied) {
    return (
      <Alert tone="warning" title="Nothing was saved">
        {feedback.error ?? "That instruction did not change the document."}
        {feedback.drift?.length ? (
          <ul className="mt-1.5 space-y-1 text-xs">
            {feedback.drift.map((d, i) => (
              <li key={i}>
                <span className="font-mono">{d.path}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      <Alert tone="success" title="Applied">
        {(feedback.changesApplied ?? []).length} field(s) changed.
      </Alert>
      {feedback.needsVerification?.length ? (
        <Alert tone="warning" title="Confirm these are true">
          <ul className="mt-1 space-y-1">
            {feedback.needsVerification.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {feedback.warnings?.length ? (
        <Alert tone="info" title="Tradeoffs">
          <ul className="mt-1 space-y-1">
            {feedback.warnings.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Date only, in the reader's locale. The exact minute is noise; what matters
 * is whether this is from today or from last week.
 */
function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an earlier session";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
