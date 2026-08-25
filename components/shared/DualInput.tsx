"use client";

import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, uploadFile } from "@/lib/client/api";
import { cn } from "@/lib/utils";

/**
 * Paste or upload, on both tab 1 and tab 2 (§1.2).
 *
 * Uploads are extracted server-side and the resulting text lands in the same
 * textarea, so a bad extraction is always visible and always editable before
 * it is submitted. That is the escape hatch for two-column PDFs (§10 point 1).
 */
export function DualInput({
  value,
  onChange,
  placeholder,
  label,
  minChars,
  busy,
  disabled,
  submitLabel,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  minChars: number;
  busy: boolean;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filename, setFilename] = useState<string | null>(null);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    setUploadError(null);
    setWarnings([]);
    setUploading(true);
    try {
      const result = await uploadFile(file);
      onChange(result.text);
      setFilename(result.filename);
      setWarnings(result.warnings);
    } catch (err) {
      setFilename(null);
      setUploadError(err instanceof ApiError ? err.message : "That file could not be read.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const chars = value.trim().length;
  const tooShort = chars > 0 && chars < minChars;
  const canSubmit = chars >= minChars && !busy && !uploading && !disabled;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "rounded-lg border border-dashed p-3 transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Paste {label} below, or drop a .pdf, .docx or .txt file here.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || disabled}
          >
            {uploading ? <Spinner /> : <FileUp className="size-4" />}
            {uploading ? "Reading file…" : "Choose file"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>

        {filename ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{filename}</span>
            <span>extracted into the box below — check it reads correctly.</span>
            <button
              type="button"
              aria-label="Clear extracted text"
              className="rounded p-0.5 hover:bg-accent"
              onClick={() => {
                setFilename(null);
                setWarnings([]);
                onChange("");
              }}
            >
              <X className="size-3.5" />
            </button>
          </p>
        ) : null}
      </div>

      {uploadError ? <Alert tone="error">{uploadError}</Alert> : null}

      {warnings.map((warning) => (
        <Alert key={warning} tone="warning" title="Check this extraction">
          {warning}
        </Alert>
      ))}

      <Textarea
        // A placeholder is not a label: it disappears on focus and is skipped
        // by some screen readers. This is the field's actual accessible name.
        aria-label={`Paste ${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-64 font-mono text-[13px] leading-relaxed"
        spellCheck={false}
        disabled={disabled}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {chars.toLocaleString()} characters
          {tooShort ? ` — at least ${minChars.toLocaleString()} needed` : ""}
        </p>
        <Button onClick={onSubmit} disabled={!canSubmit}>
          {busy ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
