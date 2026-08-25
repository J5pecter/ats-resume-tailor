"use client";

import { useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { DualInput } from "@/components/shared/DualInput";
import { JdProfileSummary } from "@/components/resume/JdProfileSummary";
import { ApiError, patchJson, postJson } from "@/lib/client/api";
import type { JDProfile } from "@/lib/schema/jd";

export interface JdState {
  id: string;
  title: string;
  profile: JDProfile;
}

export function JobDescriptionTab({
  jd,
  onParsed,
  onContinue,
  llmReady,
}: {
  jd: JdState | null;
  onParsed: (jd: JdState | null) => void;
  onContinue: () => void;
  llmReady: boolean;
}) {
  const [rawText, setRawText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function parse() {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{ id: string; title: string; profile: JDProfile }>("/api/jd", {
        rawText,
        title: title.trim() || undefined,
      });
      onParsed({ id: result.id, title: result.title, profile: result.profile });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not read that job description.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(next: JDProfile) {
    if (!jd) return;
    const previous = jd;
    onParsed({ ...jd, profile: next });
    setSaving(true);
    try {
      await patchJson(`/api/jd/${jd.id}`, { profile: next });
    } catch (err) {
      onParsed(previous);
      setError(err instanceof ApiError ? err.message : "That edit could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (jd) {
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Requirement profile</CardTitle>
              <CardDescription>
                This is what the posting is actually screening for. Check it before
                it drives the rewrite — remove anything the parser got wrong.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onParsed(null);
                setRawText("");
              }}
            >
              <RotateCcw className="size-4" />
              Start over
            </Button>
          </CardHeader>
          <CardContent>
            <JdProfileSummary
              profile={jd.profile}
              onRemoveKeyword={(term) =>
                void saveProfile({
                  ...jd.profile,
                  atsKeywords: jd.profile.atsKeywords.filter((k) => k.term !== term),
                })
              }
              onRemoveRequirement={(kind, requirement) =>
                void saveProfile({
                  ...jd.profile,
                  [kind]: jd.profile[kind].filter((r) => r.requirement !== requirement),
                })
              }
            />
          </CardContent>
        </Card>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex items-center justify-end gap-3">
          {saving ? <Spinner /> : null}
          <Button onClick={onContinue}>
            Looks right — continue
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job description</CardTitle>
        <CardDescription>
          Paste the posting you are targeting, or upload it. It gets parsed into a
          requirement profile — must-haves, nice-to-haves, hard filters and the
          verbatim keywords an ATS will look for.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!llmReady ? (
          <Alert tone="warning" title="No model key configured">
            Parsing needs an API key. See the setup note at the top of the page.
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="jd-title">Label (optional)</Label>
          <Input
            id="jd-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Product Manager — Razorpay"
          />
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <DualInput
          label="the job description"
          value={rawText}
          onChange={setRawText}
          minChars={80}
          busy={busy}
          disabled={!llmReady}
          placeholder="Paste the full posting — responsibilities, requirements, everything. The more complete it is, the better the keyword extraction."
          submitLabel="Analyse job description"
          onSubmit={() => void parse()}
        />
      </CardContent>
    </Card>
  );
}
