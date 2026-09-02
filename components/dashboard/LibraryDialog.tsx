"use client";

import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ApiError, getJson } from "@/lib/client/api";
import type { MatchAnalysis } from "@/lib/schema/analysis";
import type { ResumeDoc } from "@/lib/schema/resume";
import type { TailorOutcome } from "./ResumeTab";

/**
 * Everything the user has tailored, and a way back into any of it.
 *
 * The dashboard restores the most recent lineage on load. That is right for
 * the common case and useless for every other one: somebody applying to four
 * roles could reach exactly one of them, and the other three existed in the
 * database with no route to them from the interface.
 */

export interface TailoredSummary {
  id: string;
  version: number;
  versionCount: number;
  note: string | null;
  jobTitle: string;
  resumeLabel: string;
  updatedAt: string;
}

interface TailoredDetail {
  tailoredResumeId: string;
  version: number;
  resume: ResumeDoc;
  analysis: MatchAnalysis;
  changeLog: TailorOutcome["changeLog"];
  jobTitle: string;
  createdAt: string;
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LibraryDialog({ onOpen }: { onOpen: (outcome: TailorOutcome) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TailoredSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getJson<{ tailored: TailoredSummary[] }>("/api/tailored");
      setRows(result.tailored);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your saved work.");
    } finally {
      setLoading(false);
    }
  }

  async function openOne(id: string) {
    setOpening(id);
    setError(null);
    try {
      const doc = await getJson<TailoredDetail>(`/api/tailored/${id}`);
      onOpen({
        tailoredResumeId: doc.tailoredResumeId,
        version: doc.version,
        resume: doc.resume,
        changeLog: doc.changeLog ?? [],
        analysis: doc.analysis,
        // Reopened, not regenerated. The same marker /api/workspace sets, so
        // the editor says so rather than presenting old work as fresh.
        restored: { generatedAt: doc.createdAt },
        projectedAtsScore: 0,
        remainingGaps: [],
        evidence: { checkedBullets: 0, checkedSkills: 0, dropped: false, issues: [] },
        forbiddenKeywordHits: [],
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That document could not be opened.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Fetched on open rather than on mount: most sessions never need it,
        // and a stale list is worse than a brief spinner.
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <FolderOpen className="size-4" />
          Saved work
        </Button>
      </DialogTrigger>
      {/* The width is set on the primitive, so widening needs an explicit
          override rather than a max-width that never applies. */}
      <DialogContent
        className="w-[min(44rem,calc(100vw-2rem))]"
        title="Saved work"
        description="Every resume you have tailored. Opening one loads it into the editor — nothing is regenerated, and no model call is made."
      >
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : rows && rows.length === 0 ? (
            <Alert tone="info" title="Nothing saved yet">
              Tailor a resume and it will appear here, along with every later
              version of it.
            </Alert>
          ) : (
            (rows ?? []).map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium">{row.jobTitle}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.resumeLabel} · {when(row.updatedAt)}
                    {row.versionCount > 1 ? ` · ${row.versionCount} versions` : ""}
                  </p>
                  {row.note ? (
                    <p className="truncate text-xs text-muted-foreground">{row.note}</p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={opening !== null}
                  onClick={() => void openOne(row.id)}
                >
                  {opening === row.id ? <Loader2 className="size-4 animate-spin" /> : null}
                  Open
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Close
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
