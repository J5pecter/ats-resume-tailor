"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getJson } from "@/lib/client/api";

/**
 * A short list of things the user has already given the app, so they do not
 * have to give them again.
 *
 * `GET /api/jd` and `GET /api/resume` have existed since the beginning and
 * nothing ever called them: every visit made you paste the job description
 * again and re-upload the CV, and each re-parse spent a model call producing
 * something already stored.
 *
 * Deliberately unobtrusive. Pasting something new is still the primary action
 * and stays where it was; this sits underneath and is empty on first use, when
 * a list of nothing would only be noise.
 */
export interface SavedItem {
  id: string;
  label: string;
  createdAt: string;
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function SavedPicker<T>({
  title,
  endpoint,
  extract,
  onPick,
  busy,
  /** Hidden for the item already loaded — offering to reopen it says nothing. */
  excludeId,
}: {
  title: string;
  endpoint: string;
  /** Generic in T so the caller keeps whatever the row carries, fully typed. */
  extract: (payload: unknown) => (SavedItem & { value: T })[];
  onPick: (item: SavedItem & { value: T }) => void;
  busy: boolean;
  excludeId?: string | null;
}) {
  const [items, setItems] = useState<(SavedItem & { value: T })[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson(endpoint)
      .then((payload) => {
        if (!cancelled) setItems(extract(payload));
      })
      // Reusing saved work is a convenience; failing to list it must never
      // block the primary path, which is pasting something new.
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
    // extract is defined inline by callers; depending on it would refetch every
    // render. The endpoint is the only thing that identifies this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const shown = (items ?? []).filter((i) => i.id !== excludeId).slice(0, 8);
  if (shown.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <History className="size-3.5" aria-hidden />
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((item) => (
          <Button
            key={item.id}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onPick(item)}
            className="h-auto max-w-full py-1"
            title={item.label}
          >
            <span className="truncate">{item.label}</span>
            <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">
              {when(item.createdAt)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
