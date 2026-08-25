"use client";

import { Trash2 } from "lucide-react";
import { EditableText } from "./EditableText";
import { HEADINGS, formatDateRange } from "@/lib/export/layout";
import type { ResumeDoc } from "@/lib/schema/resume";

/**
 * Live preview of the tailored resume, section by section, exactly as it will
 * export (§1.2, tab 3).
 *
 * Section order, heading text and date formatting come from
 * lib/export/layout.ts — the same module the DOCX and PDF writers use — so
 * what is on screen and what lands in the file cannot drift apart.
 */
export function ResumePreview({
  resume,
  onChange,
}: {
  resume: ResumeDoc;
  onChange?: (next: ResumeDoc) => void;
}) {
  const editable = Boolean(onChange);

  function update(mutate: (draft: ResumeDoc) => void) {
    if (!onChange) return;
    const draft = structuredClone(resume);
    mutate(draft);
    onChange(draft);
  }

  const contactParts = [
    resume.contact.location,
    resume.contact.phone,
    resume.contact.email,
    resume.contact.linkedin,
    resume.contact.portfolio,
  ].filter((part) => (part ?? "").trim().length > 0);

  return (
    <article
      className="mx-auto w-full max-w-[8.27in] bg-white p-[0.7in] text-[10.5pt] leading-[1.35] text-black shadow-sm ring-1 ring-black/10"
      style={{ fontFamily: "var(--font-resume)" }}
      aria-label="Tailored resume preview"
    >
      <header className="text-center">
        <h1 className="text-[14pt] font-bold">
          <EditableText
            label="full name"
            value={resume.contact.fullName}
            placeholder="Your name"
            onChange={editable ? (v) => update((d) => void (d.contact.fullName = v)) : undefined}
          />
        </h1>
        <p className="text-[10.5pt]">
          <EditableText
            label="headline"
            value={resume.contact.headline}
            placeholder="Professional headline"
            onChange={editable ? (v) => update((d) => void (d.contact.headline = v)) : undefined}
          />
        </p>
        {/* Contact details live in the body, never a header — ATS parsers skip headers. */}
        <p className="mt-1 text-[9.5pt] text-[#333]">
          {editable ? (
            <ContactEditor resume={resume} update={update} />
          ) : (
            contactParts.join("  |  ")
          )}
        </p>
      </header>

      {resume.summary || editable ? (
        <Section title={HEADINGS.summary}>
          <p>
            <EditableText
              label="professional summary"
              multiline
              value={resume.summary}
              placeholder="Two to four sentences positioning you for this role."
              onChange={editable ? (v) => update((d) => void (d.summary = v)) : undefined}
            />
          </p>
        </Section>
      ) : null}

      {resume.coreSkills.length ? (
        <Section title={HEADINGS.skills}>
          <div className="space-y-[2px]">
            {resume.coreSkills.map((group, gi) => (
              <p key={gi}>
                <span className="font-bold">
                  <EditableText
                    label={`skill group ${gi + 1} name`}
                    value={group.category}
                    onChange={
                      editable ? (v) => update((d) => void (d.coreSkills[gi].category = v)) : undefined
                    }
                  />
                  {": "}
                </span>
                <EditableText
                  label={`${group.category} skills`}
                  multiline
                  value={group.skills.map((s) => s.name).join(", ")}
                  onChange={
                    editable
                      ? (v) =>
                          update((d) => {
                            // A skill the user did not rename keeps the
                            // evidence it was generated with; anything they
                            // type in is their own assertion and carries none.
                            const existing = new Map(
                              d.coreSkills[gi].skills.map((s) => [
                                s.name.toLowerCase(),
                                s.sourceEvidence,
                              ]),
                            );
                            d.coreSkills[gi].skills = v
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean)
                              .map((name) => ({
                                name,
                                sourceEvidence: existing.get(name.toLowerCase()) ?? "",
                              }));
                          })
                      : undefined
                  }
                />
              </p>
            ))}
          </div>
        </Section>
      ) : null}

      {resume.experience.length ? (
        <Section title={HEADINGS.experience}>
          <div className="space-y-[7px]">
            {resume.experience.map((exp, ei) => (
              <div key={ei}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 flex-1 font-bold">
                    <EditableText
                      label={`company ${ei + 1}`}
                      value={exp.company}
                      onChange={
                        editable ? (v) => update((d) => void (d.experience[ei].company = v)) : undefined
                      }
                    />
                    {" — "}
                    <EditableText
                      label={`role at ${exp.company}`}
                      value={exp.role}
                      onChange={
                        editable ? (v) => update((d) => void (d.experience[ei].role = v)) : undefined
                      }
                    />
                  </p>
                  <p className="shrink-0 text-[9.5pt] whitespace-nowrap">
                    {formatDateRange(exp.startDate, exp.endDate)}
                  </p>
                </div>

                {exp.location || exp.context ? (
                  <p className="text-[9.5pt] text-[#444]">
                    {[exp.location, exp.context].filter(Boolean).join("  |  ")}
                  </p>
                ) : null}

                <ul className="mt-[2px] space-y-[2px]">
                  {exp.bullets.map((bullet, bi) => (
                    <li key={bi} className="group flex gap-[6px]">
                      <span aria-hidden className="shrink-0">
                        •
                      </span>
                      <span className="min-w-0 flex-1">
                        <EditableText
                          label={`bullet ${bi + 1} of ${exp.role}`}
                          multiline
                          value={bullet.text}
                          onChange={
                            editable
                              ? (v) => update((d) => void (d.experience[ei].bullets[bi].text = v))
                              : undefined
                          }
                        />
                      </span>
                      {editable && exp.bullets.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Delete bullet ${bi + 1} of ${exp.role}`}
                          onClick={() =>
                            update((d) => {
                              d.experience[ei].bullets.splice(bi, 1);
                            })
                          }
                          className="mt-[2px] shrink-0 rounded p-0.5 text-[#999] opacity-0 transition-opacity hover:text-black focus-visible:opacity-100 group-hover:opacity-100 print:hidden"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {resume.projects?.length ? (
        <Section title={HEADINGS.projects}>
          <div className="space-y-[5px]">
            {resume.projects.map((project, pi) => (
              <div key={pi}>
                <p className="font-bold">
                  <EditableText
                    label={`project ${pi + 1} name`}
                    value={project.name}
                    onChange={
                      editable
                        ? (v) =>
                            update((d) => {
                              if (d.projects) d.projects[pi].name = v;
                            })
                        : undefined
                    }
                  />
                </p>
                <p className="flex gap-[6px]">
                  <span aria-hidden>•</span>
                  <span className="min-w-0 flex-1">
                    <EditableText
                      label={`project ${pi + 1} description`}
                      multiline
                      value={
                        project.stack?.length
                          ? `${project.description} Stack: ${project.stack.join(", ")}`
                          : project.description
                      }
                      onChange={
                        editable
                          ? (v) =>
                              update((d) => {
                                if (d.projects) {
                                  d.projects[pi].description = v;
                                  d.projects[pi].stack = [];
                                }
                              })
                          : undefined
                      }
                    />
                  </span>
                </p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {resume.education.length ? (
        <Section title={HEADINGS.education}>
          <div className="space-y-[4px]">
            {resume.education.map((edu, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 flex-1 font-bold">
                    <EditableText
                      label={`degree ${i + 1}`}
                      value={[edu.degree, edu.field].filter(Boolean).join(", ") || edu.institution}
                      onChange={
                        editable ? (v) => update((d) => void (d.education[i].degree = v)) : undefined
                      }
                    />
                  </p>
                  <p className="shrink-0 text-[9.5pt] whitespace-nowrap">{edu.endDate}</p>
                </div>
                <p className="text-[9.5pt] text-[#444]">
                  {[edu.institution, edu.score].filter(Boolean).join("  |  ")}
                </p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {resume.certifications?.length ? (
        <Section title={HEADINGS.certifications}>
          <ul className="space-y-[2px]">
            {resume.certifications.map((cert, i) => (
              <li key={i} className="flex gap-[6px]">
                <span aria-hidden>•</span>
                <span>
                  {cert.name}
                  {[cert.issuer, cert.date].filter(Boolean).length
                    ? ` (${[cert.issuer, cert.date].filter(Boolean).join(", ")})`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {resume.additional?.length ? (
        <Section title={HEADINGS.additional}>
          <div className="space-y-[2px]">
            {resume.additional.map((item, i) => (
              <p key={i}>
                <span className="font-bold">{item.label}: </span>
                <EditableText
                  label={item.label}
                  multiline
                  value={item.value}
                  onChange={
                    editable
                      ? (v) =>
                          update((d) => {
                            if (d.additional) d.additional[i].value = v;
                          })
                      : undefined
                  }
                />
              </p>
            ))}
          </div>
        </Section>
      ) : null}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-[11px]">
      <h2 className="mb-[4px] border-b border-[#999] pb-[2px] text-[11pt] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function ContactEditor({
  resume,
  update,
}: {
  resume: ResumeDoc;
  update: (mutate: (draft: ResumeDoc) => void) => void;
}) {
  const fields: { key: keyof ResumeDoc["contact"]; label: string }[] = [
    { key: "location", label: "location" },
    { key: "phone", label: "phone" },
    { key: "email", label: "email" },
    { key: "linkedin", label: "LinkedIn" },
    { key: "portfolio", label: "portfolio" },
  ];

  const set = (key: keyof ResumeDoc["contact"]) => (value: string) =>
    update((draft) => {
      (draft.contact[key] as string) = value;
    });

  // Empty fields are never rendered inline — an unfilled placeholder sitting
  // between separators reads as content, and the exporters drop it anyway.
  // They appear as explicit add affordances instead.
  const filled = fields.filter((f) => ((resume.contact[f.key] as string | undefined) ?? "").trim());
  const empty = fields.filter((f) => !((resume.contact[f.key] as string | undefined) ?? "").trim());

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
      {filled.map((field, i) => (
        <span key={field.key} className="inline-flex items-center gap-1">
          {i > 0 ? (
            <span aria-hidden className="text-[#bbb]">
              |
            </span>
          ) : null}
          <EditableText
            label={field.label}
            value={(resume.contact[field.key] as string | undefined) ?? ""}
            onChange={set(field.key)}
          />
        </span>
      ))}

      {empty.map((field) => (
        <span
          key={field.key}
          className="ml-1 inline-flex items-center text-[8.5pt] text-[#aaa] print:hidden"
        >
          <EditableText
            label={field.label}
            value=""
            placeholder={`+ ${field.label}`}
            onChange={set(field.key)}
          />
        </span>
      ))}
    </span>
  );
}
