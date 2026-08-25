"use client";

import { ArrowRight, CircleDashed, CircleCheck, CircleX, OctagonAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScoreBar } from "@/components/ui/progress";
import type { MatchAnalysis } from "@/lib/schema/analysis";

/**
 * The gap analysis, shown before generation (§1.2, tab 2).
 *
 * Partials are given the most space on purpose: they are the highest-value
 * fixes, because they are the only ones the rewrite can honestly close.
 */
export function GapAnalysisPanel({ analysis }: { analysis: MatchAnalysis }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold">Simulated ATS match</h3>
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {Math.round(analysis.atsScore)}
            <span className="text-sm text-muted-foreground">/100</span>
          </span>
        </div>
        <ScoreBar value={analysis.atsScore} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Weighted keyword coverage before tailoring. Matched keywords count in
          full, partials count half.
        </p>
      </div>

      {analysis.blockers.length ? (
        <Alert tone="error" title="Hard filters you do not currently meet">
          <ul className="mt-1 space-y-1">
            {analysis.blockers.map((blocker, i) => (
              <li key={i} className="flex gap-2">
                <OctagonAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">{blocker.filter}</span>
                  {blocker.candidateStatus ? ` — ${blocker.candidateStatus}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {analysis.topThreeFixes.length ? (
        <section className="rounded-lg border border-border bg-muted/50 p-4">
          <h4 className="text-sm font-semibold">Highest-value fixes</h4>
          <ol className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            {analysis.topThreeFixes.map((fix, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-xs text-muted-foreground">{i + 1}.</span>
                <span>{fix}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Bucket
        icon={CircleDashed}
        tone="warning"
        title="Partial"
        count={analysis.partial.length}
        blurb="You have adjacent or transferable experience, but the exact term is missing. Tailoring will surface these using the evidence below."
      >
        <ul className="space-y-3">
          {analysis.partial
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((item) => (
              <li key={item.term} className="rounded-md border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{item.term}</span>
                  <Badge variant="neutral">weight {item.weight}</Badge>
                </div>
                {item.closestEvidence ? (
                  <p className="mt-1.5 border-l-2 border-border pl-2.5 text-xs italic leading-relaxed text-muted-foreground">
                    {item.closestEvidence}
                  </p>
                ) : null}
                {item.howToSurface ? (
                  <p className="mt-1.5 flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                    <ArrowRight className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span>{item.howToSurface}</span>
                  </p>
                ) : null}
              </li>
            ))}
        </ul>
      </Bucket>

      <Bucket
        icon={CircleX}
        tone="destructive"
        title="Missing"
        count={analysis.missing.length}
        blurb="No supporting evidence at all. These will not be added to your resume — they are honest gaps."
      >
        <ul className="space-y-2">
          {analysis.missing
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((item) => (
              <li key={item.term} className="text-sm leading-relaxed">
                <span className="font-medium">{item.term}</span>
                {item.honestNote ? (
                  <span className="text-muted-foreground"> — {item.honestNote}</span>
                ) : null}
              </li>
            ))}
        </ul>
      </Bucket>

      <Bucket
        icon={CircleCheck}
        tone="success"
        title="Matched"
        count={analysis.matched.length}
        blurb="Already demonstrated in your resume."
      >
        <div className="flex flex-wrap gap-1.5">
          {analysis.matched
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((item) => (
              <Badge key={item.term} variant="success" title={item.evidence}>
                {item.term}
              </Badge>
            ))}
        </div>
      </Bucket>
    </div>
  );
}

function Bucket({
  icon: Icon,
  tone,
  title,
  count,
  blurb,
  children,
}: {
  icon: React.ElementType;
  tone: "success" | "warning" | "destructive";
  title: string;
  count: number;
  blurb: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  const colour =
    tone === "success"
      ? "text-[var(--success)]"
      : tone === "warning"
        ? "text-[var(--warning)]"
        : "text-destructive";

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${colour}`} aria-hidden />
        <h4 className="text-sm font-semibold">
          {title} <span className="text-muted-foreground">({count})</span>
        </h4>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{blurb}</p>
      {children}
    </section>
  );
}
