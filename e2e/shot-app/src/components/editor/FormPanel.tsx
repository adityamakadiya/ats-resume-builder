"use client";

/**
 * The document as a thing you type into.
 *
 * Always editable rather than click-to-edit. A resume is rewritten, not
 * occasionally amended, and a reading mode you have to leave is one more thing
 * to discover before you can fix a typo. Fields are borderless until hover or
 * focus, so the column reads as a page and behaves as a form.
 *
 * Two things are deliberately not editable. Company, title and dates on an
 * experience block are refused by `validateOps` in `@ats/core`, because a
 * promoted title is the fastest way to lose an offer and a recruiter checks it
 * first. Rather than let someone type into a field that will be rejected on
 * save, those render as text with the reason attached.
 *
 * Every keystroke becomes a `replace` op before it becomes state, so the
 * character you just typed is undoable on its own terms and the traced badge
 * learns about it at the same moment the score does.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { SECTION_KEYS, type ResumeDoc, type SectionKey } from "@ats/templates";
import { pointer } from "@/lib/editor/doc";

/* ------------------------------------------------------------ primitives -- */

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

const FIELD =
  "w-full resize-none rounded-md bg-transparent px-1 -mx-1 outline-none transition-colors " +
  "hover:bg-paper-sunk/70 focus:bg-paper-sunk";

function Field({
  value,
  onChange,
  ariaLabel,
  className = "",
  placeholder,
  multiline = true,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => autosize(ref.current), [value]);

  if (!multiline) {
    return (
      <input
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} ${className}`}
      />
    );
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        autosize(e.target);
      }}
      className={`${FIELD} overflow-hidden ${className}`}
    />
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h3 className="mt-7 border-b border-rule-strong pb-1 font-mono text-[0.6875rem] tracking-[0.16em] text-ink uppercase">
      {children}
    </h3>
  );
}

/** A bullet marker that says who last touched the line. */
function Marker({ edited, traced }: { edited: boolean; traced: boolean }) {
  const title = edited
    ? "Edited by you. Not checked by the guard."
    : traced
      ? "Traced to a fact in your resume."
      : "No source recorded for this line.";

  return (
    <span
      title={title}
      aria-label={title}
      className={`mt-[0.45rem] h-1 w-1 shrink-0 rounded-full ${
        edited ? "bg-caution" : traced ? "bg-traced" : "bg-rule-strong"
      }`}
    />
  );
}

function TinyButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded-md px-1 font-mono text-[0.6875rem] leading-none text-ink-faint opacity-0 transition hover:text-stamp focus-visible:opacity-100 group-hover:opacity-100"
    >
      {children}
    </button>
  );
}

function AddLine({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 font-mono text-[0.625rem] tracking-wider text-ink-faint uppercase underline underline-offset-4 hover:text-stamp"
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- panel -- */

export type FormPanelProps = {
  doc: ResumeDoc;
  editedKeys: Set<string>;
  onEdit: (path: string, value: string, label: string) => void;
  onOps: (
    ops: Array<{ op: "add" | "remove" | "replace"; path: string; value?: unknown }>,
    label: string,
    keys?: string[],
  ) => void;
};

function sectionOrder(doc: ResumeDoc): SectionKey[] {
  const known = new Set<string>(SECTION_KEYS);
  const out: SectionKey[] = [];
  const seen = new Set<string>();

  for (const raw of doc.section_order ?? []) {
    const key = raw.trim().toLowerCase();
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as SectionKey);
  }
  for (const key of SECTION_KEYS) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function FormPanel({ doc, editedKeys, onEdit, onOps }: FormPanelProps) {
  const [draftSkill, setDraftSkill] = useState<Record<number, string>>({});
  const edited = (path: string) => editedKeys.has(path);

  const sections: Record<SectionKey, React.ReactNode> = {
    summary: (
      <section key="summary">
        <Heading>Summary</Heading>
        <div className="group mt-2 flex items-start gap-1.5">
          <Marker
            edited={edited(pointer("summary", "text"))}
            traced={doc.summary.source_ids.length > 0}
          />
          <Field
            ariaLabel="Summary"
            value={doc.summary.text}
            placeholder="Two or three lines about what you do."
            onChange={(v) => onEdit(pointer("summary", "text"), v, "Edited the summary")}
            className="text-[0.875rem] leading-relaxed"
          />
        </div>
      </section>
    ),

    skills: (
      <section key="skills">
        <Heading>Skills</Heading>
        <div className="mt-2 space-y-2">
          {doc.skills.map((group, gi) => (
            <div key={gi} className="group flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              <span className="inline-flex shrink-0 items-baseline">
                <input
                  aria-label={`Skill group ${gi + 1} name`}
                  value={group.category}
                  onChange={(e) =>
                    onEdit(
                      pointer("skills", gi, "category"),
                      e.target.value,
                      "Renamed a skill group",
                    )
                  }
                  style={{ width: `${Math.max(5, group.category.length + 1)}ch` }}
                  className={`${FIELD} text-[0.875rem] font-medium`}
                />
                <span aria-hidden="true" className="text-ink-faint">
                  :
                </span>
              </span>

              {group.items.map((item, ii) => (
                <span
                  key={ii}
                  className="inline-flex items-center gap-0.5 rounded-md bg-paper-sunk px-1.5 py-0.5 text-[0.8125rem]"
                >
                  {item}
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    onClick={() =>
                      onOps(
                        [{ op: "remove", path: pointer("skills", gi, "items", ii) }],
                        `Removed ${item}`,
                      )
                    }
                    className="font-mono text-[0.625rem] leading-none text-ink-faint hover:text-stamp"
                  >
                    x
                  </button>
                </span>
              ))}

              <input
                aria-label={`Add a skill to ${group.category}`}
                value={draftSkill[gi] ?? ""}
                placeholder="+ add"
                onChange={(e) => setDraftSkill((p) => ({ ...p, [gi]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const value = (draftSkill[gi] ?? "").trim();
                  if (!value) return;
                  onOps(
                    [{ op: "add", path: pointer("skills", gi, "items", "-"), value }],
                    `Added ${value}`,
                    [`asserted:${value}`],
                  );
                  setDraftSkill((p) => ({ ...p, [gi]: "" }));
                }}
                className="w-20 bg-transparent px-1 text-[0.8125rem] outline-none placeholder:text-ink-faint focus:bg-paper-sunk"
              />

              <TinyButton
                label={`Remove the ${group.category} group`}
                onClick={() => onOps([{ op: "remove", path: pointer("skills", gi) }], "Removed a skill group")}
              >
                x
              </TinyButton>
            </div>
          ))}
        </div>
        <AddLine
          onClick={() =>
            onOps(
              [
                {
                  op: "add",
                  path: pointer("skills", "-"),
                  value: { category: "New group", items: [], source_ids: [] },
                },
              ],
              "Added a skill group",
            )
          }
        >
          + skill group
        </AddLine>
      </section>
    ),

    experience: (
      <section key="experience">
        <Heading>Experience</Heading>
        {doc.experience.map((exp, ei) => (
          <div key={exp.source_id || ei} className="mt-4">
            {/*
              Read-only on purpose. `validateOps` refuses ops against company,
              title, start_date and end_date, so an editable field here would
              accept typing and then throw it away.
            */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p
                className="text-[0.9375rem] font-medium text-ink"
                title="Employment facts are guarded. Ask in chat if a title is wrong."
              >
                {exp.title}
              </p>
              <span className="font-mono text-[0.6875rem] text-ink-faint">
                {exp.start_date} - {exp.end_date}
              </span>
            </div>
            <p className="text-[0.8125rem] text-ink-muted">
              {[exp.company, exp.location].filter(Boolean).join(" · ")}
              <span className="ml-2 font-mono text-[0.625rem] tracking-wider text-ink-faint uppercase">
                guarded
              </span>
            </p>

            <ul className="mt-2 space-y-1.5">
              {exp.bullets.map((bullet, bi) => {
                const path = pointer("experience", ei, "bullets", bi, "text");
                return (
                  <li key={bi} className="group flex items-start gap-1.5">
                    <Marker edited={edited(path)} traced={bullet.source_ids.length > 0} />
                    <Field
                      ariaLabel={`${exp.company} bullet ${bi + 1}`}
                      value={bullet.text}
                      onChange={(v) => onEdit(path, v, `Edited a ${exp.company} bullet`)}
                      className="text-[0.875rem] leading-relaxed"
                    />
                    <TinyButton
                      label={`Remove ${exp.company} bullet ${bi + 1}`}
                      onClick={() =>
                        onOps(
                          [{ op: "remove", path: pointer("experience", ei, "bullets", bi) }],
                          "Removed a bullet",
                        )
                      }
                    >
                      x
                    </TinyButton>
                  </li>
                );
              })}
            </ul>
            <AddLine
              onClick={() =>
                onOps(
                  [
                    {
                      op: "add",
                      path: pointer("experience", ei, "bullets", "-"),
                      value: { text: "", source_ids: [], keywords: [] },
                    },
                  ],
                  "Added a bullet",
                  [pointer("experience", ei, "bullets", exp.bullets.length, "text")],
                )
              }
            >
              + bullet
            </AddLine>
          </div>
        ))}
      </section>
    ),

    projects: (
      <section key="projects">
        <Heading>Projects</Heading>
        {doc.projects.map((proj, pi) => (
          <div key={proj.source_id || pi} className="mt-4">
            <Field
              ariaLabel={`Project ${pi + 1} name`}
              multiline={false}
              value={proj.name}
              onChange={(v) => onEdit(pointer("projects", pi, "name"), v, "Renamed a project")}
              className="text-[0.9375rem] font-medium"
            />
            <ul className="mt-1.5 space-y-1.5">
              {proj.bullets.map((bullet, bi) => {
                const path = pointer("projects", pi, "bullets", bi, "text");
                return (
                  <li key={bi} className="group flex items-start gap-1.5">
                    <Marker edited={edited(path)} traced={bullet.source_ids.length > 0} />
                    <Field
                      ariaLabel={`${proj.name} bullet ${bi + 1}`}
                      value={bullet.text}
                      onChange={(v) => onEdit(path, v, "Edited a project bullet")}
                      className="text-[0.875rem] leading-relaxed"
                    />
                    <TinyButton
                      label={`Remove ${proj.name} bullet ${bi + 1}`}
                      onClick={() =>
                        onOps(
                          [{ op: "remove", path: pointer("projects", pi, "bullets", bi) }],
                          "Removed a project bullet",
                        )
                      }
                    >
                      x
                    </TinyButton>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    ),

    education: (
      <section key="education">
        <Heading>Education</Heading>
        {doc.education.map((edu, i) => (
          <div key={edu.source_id || i} className="mt-2.5">
            <Field
              ariaLabel={`Education ${i + 1} degree`}
              multiline={false}
              value={edu.degree}
              onChange={(v) => onEdit(pointer("education", i, "degree"), v, "Edited a degree")}
              className="text-[0.875rem] font-medium"
            />
            <p className="text-[0.8125rem] text-ink-muted">
              {[edu.institution, edu.dates].filter(Boolean).join(" · ")}
            </p>
          </div>
        ))}
      </section>
    ),

    certifications: (
      <section key="certifications">
        <Heading>Certifications</Heading>
        <ul className="mt-2 space-y-1.5">
          {doc.certifications.map((cert, i) => {
            const path = pointer("certifications", i, "text");
            return (
              <li key={cert.source_id || i} className="group flex items-start gap-1.5">
                <Marker edited={edited(path)} traced={Boolean(cert.source_id)} />
                <Field
                  ariaLabel={`Certification ${i + 1}`}
                  value={cert.text}
                  onChange={(v) => onEdit(path, v, "Edited a certification")}
                  className="text-[0.875rem] leading-relaxed"
                />
                <TinyButton
                  label={`Remove certification ${i + 1}`}
                  onClick={() =>
                    onOps([{ op: "remove", path: pointer("certifications", i) }], "Removed a certification")
                  }
                >
                  x
                </TinyButton>
              </li>
            );
          })}
        </ul>
      </section>
    ),
  };

  return (
    <div className="pb-10">
      <header>
        <p className="font-display text-[1.75rem] leading-tight text-ink">{doc.contact.name}</p>
        <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-muted">
          {[doc.contact.email, doc.contact.phone, doc.contact.location]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
        <Field
          ariaLabel="Headline"
          multiline={false}
          value={doc.headline}
          placeholder="Headline"
          onChange={(v) => onEdit(pointer("headline"), v, "Edited the headline")}
          className="mt-1.5 text-[0.9375rem] text-ink-muted"
        />
      </header>

      {sectionOrder(doc).map((key) => sections[key])}

      {doc.other_sections.map((sec, si) => (
        <section key={sec.source_id || si}>
          <Heading>{sec.heading}</Heading>
          <ul className="mt-2 space-y-1.5">
            {sec.bullets.map((bullet, bi) => {
              const path = pointer("other_sections", si, "bullets", bi, "text");
              return (
                <li key={bi} className="group flex items-start gap-1.5">
                  <Marker edited={edited(path)} traced={bullet.source_ids.length > 0} />
                  <Field
                    ariaLabel={`${sec.heading} item ${bi + 1}`}
                    value={bullet.text}
                    onChange={(v) => onEdit(path, v, `Edited ${sec.heading}`)}
                    className="text-[0.875rem] leading-relaxed"
                  />
                  <TinyButton
                    label={`Remove ${sec.heading} item ${bi + 1}`}
                    onClick={() =>
                      onOps(
                        [{ op: "remove", path: pointer("other_sections", si, "bullets", bi) }],
                        "Removed a line",
                      )
                    }
                  >
                    x
                  </TinyButton>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
