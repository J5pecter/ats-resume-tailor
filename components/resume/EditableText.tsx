"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Click-to-edit text (§1.2, tab 3 — "click any field/bullet, edit inline").
 *
 * Commits on blur or Ctrl/Cmd+Enter, discards on Escape. When no onChange is
 * passed the field renders as plain text, so the same components serve the
 * read-only preview.
 */
export function EditableText({
  value,
  onChange,
  multiline = false,
  placeholder,
  className,
  label,
}: {
  value: string;
  onChange?: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [lastSynced, setLastSynced] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  // Adjust derived state during render rather than in an effect: when the
  // document changes underneath a field that is not being edited, the draft
  // follows it without an extra render pass.
  if (!editing && value !== lastSynced) {
    setLastSynced(value);
    setDraft(value);
  }

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    if (multiline && el instanceof HTMLTextAreaElement) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, multiline]);

  if (!onChange) {
    return (
      <span className={cn(className, !value && "text-[#999]")}>{value || placeholder}</span>
    );
  }

  function commit() {
    setEditing(false);
    const next = draft.replace(/\s+$/, "");
    setLastSynced(next);
    if (next !== value) onChange?.(next);
  }

  function cancel() {
    setDraft(value);
    setLastSynced(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={`Edit ${label}`}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={cn(
          "cursor-text rounded-sm outline-none transition-colors hover:bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] focus-visible:ring-2 focus-visible:ring-ring",
          !value && "text-[#999]",
          className,
        )}
      >
        {value || placeholder || "—"}
      </span>
    );
  }

  const shared = {
    value: draft,
    "aria-label": label,
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
    className: cn(
      "w-full rounded-sm border border-[var(--ring)] bg-[color-mix(in_oklab,var(--primary)_6%,white)] px-1 py-0.5 text-inherit outline-none",
      className,
    ),
  };

  return multiline ? (
    <textarea
      {...shared}
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      rows={2}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      className={cn(shared.className, "resize-none overflow-hidden")}
    />
  ) : (
    <input
      {...shared}
      ref={ref as React.RefObject<HTMLInputElement>}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}
