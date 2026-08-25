"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AtsKeyword, JDProfile } from "@/lib/schema/jd";

/**
 * The requirement profile, shown back to the user for confirmation before it
 * drives the gap analysis and the rewrite (§1.2).
 *
 * Keywords are removable because a mis-extracted keyword propagates into every
 * downstream step, and the person reading the JD is a better judge than the
 * parser.
 */
export function JdProfileSummary({
  profile,
  onRemoveKeyword,
  onRemoveRequirement,
}: {
  profile: JDProfile;
  onRemoveKeyword?: (term: string) => void;
  onRemoveRequirement?: (kind: "mustHaves" | "niceToHaves", requirement: string) => void;
}) {
  const filters = [
    profile.hardFilters.minYears !== null ? `${profile.hardFilters.minYears}+ years` : null,
    profile.hardFilters.degree,
    profile.hardFilters.location,
    ...profile.hardFilters.certifications,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-lg font-semibold tracking-tight">{profile.roleTitle}</h3>
          {profile.company ? (
            <span className="text-sm text-muted-foreground">at {profile.company}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="neutral">{profile.seniority}</Badge>
          {profile.function ? <Badge variant="neutral">{profile.function}</Badge> : null}
          <Badge variant="neutral">{profile.tone} tone</Badge>
        </div>
      </header>

      {filters.length ? (
        <Section title="Hard filters" hint="Screening criteria you either meet or you do not.">
          <div className="flex flex-wrap gap-1.5">
            {filters.map((filter) => (
              <Badge key={filter} variant="outline">
                {filter}
              </Badge>
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <RequirementList
          title="Must-haves"
          hint="Signalled by required / must / minimum."
          items={profile.mustHaves}
          onRemove={onRemoveRequirement ? (r) => onRemoveRequirement("mustHaves", r) : undefined}
        />
        <RequirementList
          title="Nice-to-haves"
          hint="Signalled by preferred / bonus / plus."
          items={profile.niceToHaves}
          onRemove={onRemoveRequirement ? (r) => onRemoveRequirement("niceToHaves", r) : undefined}
        />
      </div>

      <Section
        title={`ATS keywords (${profile.atsKeywords.length})`}
        hint="Verbatim terms from the posting, weighted 1–5 by how central they are. Remove anything the parser got wrong."
      >
        <div className="flex flex-wrap gap-1.5">
          {profile.atsKeywords
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((keyword) => (
              <KeywordChip
                key={keyword.term}
                keyword={keyword}
                onRemove={onRemoveKeyword ? () => onRemoveKeyword(keyword.term) : undefined}
              />
            ))}
        </div>
      </Section>

      {profile.responsibilities.length ? (
        <Section title="Core responsibilities">
          <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            {profile.responsibilities.slice(0, 8).map((item, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-border">
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {profile.impliedPriorities.length ? (
        <Section title="Reading between the lines" hint="What the posting emphasises without saying outright.">
          <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            {profile.impliedPriorities.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-border">
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function RequirementList({
  title,
  hint,
  items,
  onRemove,
}: {
  title: string;
  hint?: string;
  items: { requirement: string; category: string }[];
  onRemove?: (requirement: string) => void;
}) {
  return (
    <Section title={`${title} (${items.length})`} hint={hint}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None extracted.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.requirement}
              className="group flex items-start gap-2 text-sm leading-relaxed"
            >
              <Badge variant="neutral" className="mt-0.5 shrink-0">
                {item.category}
              </Badge>
              <span className="min-w-0 flex-1">{item.requirement}</span>
              {onRemove ? (
                <button
                  type="button"
                  aria-label={`Remove ${item.requirement}`}
                  onClick={() => onRemove(item.requirement)}
                  className="mt-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function KeywordChip({ keyword, onRemove }: { keyword: AtsKeyword; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs"
      title={keyword.variants.length ? `Variants: ${keyword.variants.join(", ")}` : undefined}
    >
      <span
        aria-label={`weight ${keyword.weight} of 5`}
        className="font-mono text-[10px] text-muted-foreground"
      >
        {keyword.weight}
      </span>
      <span>{keyword.term}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove keyword ${keyword.term}`}
          onClick={onRemove}
          className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
