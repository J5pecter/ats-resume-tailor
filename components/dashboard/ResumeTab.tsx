"use client";

import { useState } from "react";
import { RotateCcw, Wand2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { DualInput } from "@/components/shared/DualInput";
import { GapAnalysisPanel } from "@/components/resume/GapAnalysisPanel";
import { ResumePreview } from "@/components/resume/ResumePreview";
import { ApiError, postJson } from "@/lib/client/api";
import type { MatchAnalysis } from "@/lib/schema/analysis";
import type { ResumeDoc } from "@/lib/schema/resume";
import type { ChangeLogEntry } from "@/lib/schema/tailor";

export interface ResumeState {
  id: string;
  label: string;
  doc: ResumeDoc;
}

export interface TailorOutcome {
  tailoredResumeId: string;
  version: number;
  resume: ResumeDoc;
  changeLog: ChangeLogEntry[];
  analysis: MatchAnalysis;
  projectedAtsScore: number;
  remainingGaps: string[];
  evidence: {
    checkedBullets: number;
    checkedSkills: number;
    /** True when the issues were removed from the document, false when merely re-verified. */
    dropped: boolean;
    issues: {
      kind: "bullet" | "skill";
      where: string;
      text: string;
      reason: string;
      overlap: number;
    }[];
  };
  forbiddenKeywordHits: { term: string; where: string }[];
  /**
   * Present only when this came back from /api/workspace rather than from a
   * generation in this session. A restored document is indistinguishable from
   * a fresh one on screen otherwise, and the dashboard opens straight onto it
   * — which reads as "it just generated" when nothing ran at all.
   */
  restored?: { generatedAt: string };
  forbiddenRemoved?: { kind: "bullet" | "skill"; where: string; text: string; term: string }[];
  retention?: {
    originalBullets: number;
    keptBullets: number;
    originalSkills: number;
    keptSkills: number;
    substantialLoss: boolean;
    dropped: { kind: "bullet" | "skill" | "role"; where: string; text: string }[];
  };
}

export function ResumeTab({
  jdId,
  resume,
  analysis,
  onParsed,
  onAnalysed,
  onTailored,
  llmReady,
}: {
  jdId: string | null;
  resume: ResumeState | null;
  analysis: MatchAnalysis | null;
  onParsed: (resume: ResumeState | null) => void;
  onAnalysed: (analysis: MatchAnalysis | null) => void;
  onTailored: (outcome: TailorOutcome) => void;
  llmReady: boolean;
}) {
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!jdId) {
    return (
      <Alert tone="info" title="Start with the job description">
        Add a job description on the first tab. Everything here is measured
        against it, so there is nothing to compare your resume to yet.
      </Alert>
    );
  }

  async function parseAndAnalyse() {
    setParsing(true);
    setError(null);
    try {
      const parsed = await postJson<{ id: string; label: string; resume: ResumeDoc }>(
        "/api/resume",
        { rawText },
      );
      onParsed({ id: parsed.id, label: parsed.label, doc: parsed.resume });

      setParsing(false);
      setAnalysing(true);
      const result = await postJson<{ analysis: MatchAnalysis }>("/api/analyze", {
        jobDescriptionId: jdId,
        sourceResumeId: parsed.id,
      });
      onAnalysed(result.analysis);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not read that resume.");
    } finally {
      setParsing(false);
      setAnalysing(false);
    }
  }

  async function generate() {
    // Unreachable as the tabs stand — the button only renders once both exist.
    // It says so anyway, because a bare `return` here would present as a dead
    // button if that ever stopped being true, and a dead button is the hardest
    // kind of failure to report.
    if (!resume || !jdId) {
      setError(
        "Pick a job description and a resume first — both are needed before anything can be rewritten.",
      );
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const outcome = await postJson<TailorOutcome>("/api/tailor", {
        jobDescriptionId: jdId,
        sourceResumeId: resume.id,
      });
      onTailored(outcome);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generation failed. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  if (resume) {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1.5">
                <CardTitle>Your resume, as parsed</CardTitle>
                <CardDescription>
                  Check that nothing was mangled on the way in. This is the source
                  every generated bullet will be traced back to.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onParsed(null);
                  onAnalysed(null);
                  setRawText("");
                }}
              >
                <RotateCcw className="size-4" />
                Replace
              </Button>
            </CardHeader>
            <CardContent>
              <div className="max-h-[36rem] overflow-y-auto rounded-md bg-muted/60 p-3">
                <ResumePreview resume={resume.doc} />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>Gap analysis</CardTitle>
              <CardDescription>
                How an ATS would score you against this posting today.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {analysing ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  Comparing your resume against the requirement profile…
                </div>
              ) : analysis ? (
                <>
                  <div className="max-h-[32rem] overflow-y-auto pr-1">
                    <GapAnalysisPanel analysis={analysis} />
                  </div>
                  {error ? <Alert tone="error">{error}</Alert> : null}
                  <Button className="w-full" onClick={() => void generate()} disabled={generating}>
                    {generating ? <Spinner /> : <Wand2 className="size-4" />}
                    {generating ? "Rewriting…" : "Generate tailored resume"}
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Nothing from the missing list will be added. Every new bullet
                    is checked against your original text before it is saved.
                  </p>
                </>
              ) : (
                <Alert tone="warning">
                  The analysis did not complete. Replace the resume and try again.
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your resume</CardTitle>
        <CardDescription>
          Paste or upload your current resume. It gets parsed as-is — no rewriting
          at this stage — and then measured against the job description.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <DualInput
          label="your resume"
          value={rawText}
          onChange={setRawText}
          minChars={120}
          busy={parsing || analysing}
          disabled={!llmReady}
          placeholder="Paste your full resume — every role, every bullet, every metric. Anything you leave out cannot be used, because the system will not invent it."
          submitLabel={analysing ? "Analysing…" : "Parse and analyse"}
          onSubmit={() => void parseAndAnalyse()}
        />
      </CardContent>
    </Card>
  );
}
