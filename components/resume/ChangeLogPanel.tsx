"use client";

import { Badge } from "@/components/ui/badge";
import type { ChangeLogEntry } from "@/lib/schema/tailor";

/**
 * "What changed and why" (§5.4).
 *
 * This is a product feature, not debug output: it lets the user catch
 * overreach, and it is the difference between a tool and a black box.
 */
export function ChangeLogPanel({ entries }: { entries: ChangeLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No changes recorded for this version.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry, i) => (
        <li key={i} className="rounded-lg border border-border bg-card p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{entry.changeType}</Badge>
            <span className="text-sm font-medium">{entry.section}</span>
          </div>

          {entry.rationale ? (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {entry.rationale}
            </p>
          ) : null}

          {entry.before || entry.after ? (
            <div className="mt-2.5 space-y-1.5 text-xs leading-relaxed">
              {entry.before ? (
                <p className="border-l-2 border-destructive/50 pl-2.5 text-muted-foreground">
                  <span className="font-medium uppercase tracking-wide">Before</span> — {entry.before}
                </p>
              ) : null}
              {entry.after ? (
                <p className="border-l-2 border-[color-mix(in_oklab,var(--success)_60%,transparent)] pl-2.5">
                  <span className="font-medium uppercase tracking-wide text-muted-foreground">
                    After
                  </span>{" "}
                  — {entry.after}
                </p>
              ) : null}
            </div>
          ) : null}

          {entry.keywordsTargeted.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {entry.keywordsTargeted.map((keyword) => (
                <Badge key={keyword}>{keyword}</Badge>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
