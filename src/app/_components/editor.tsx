"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { TailoredResume } from "@/lib/backend";

/**
 * The tailored resume as a document you type into.
 *
 * Everything is always editable rather than click-to-edit: a resume is a thing
 * you rewrite, not a record you occasionally amend, and a mode switch between
 * reading and editing is one more thing to discover. Fields are borderless
 * until hovered or focused, so it reads as a page and behaves as a form.
 *
 * Edits are tracked by key so the verification stamp can stay honest. The
 * truth guard checked what the model wrote; it has no opinion on what you type,
 * and the UI says which lines are which rather than implying the whole document
 * was verified.
 */

/* ------------------------------------------------------------ primitives -- */

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

function Field({
  value,
  onChange,
  className = "",
  placeholder,
  multiline = true,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => autosize(ref.current), [value]);

  const shared =
    "w-full resize-none bg-transparent outline-none rounded-[2px] " +
    "hover:bg-paper-sunk/60 focus:bg-paper-sunk/80 focus:ring-1 focus:ring-rule-strong " +
    "transition-colors px-1 -mx-1";

  if (!multiline) {
    return (
      <input
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${shared} ${className}`}
      />
    );
  }
  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        autosize(e.target);
      }}
      className={`${shared} overflow-hidden ${className}`}
    />
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded-[2px] px-1 font-mono text-[0.6875rem] leading-none text-ink-faint opacity-0 transition hover:text-stamp group-hover:opacity-100 focus:opacity-100"
    >
      ×
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint underline underline-offset-4 hover:text-stamp"
    >
      {children}
    </button>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h3 className="mt-6 border-b border-rule-strong pb-1 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink">
      {children}
    </h3>
  );
}

/* ----------------------------------------------------------------- state -- */

export type EditorState = {
  doc: TailoredResume;
  editedKeys: Set<string>;
};

export function useResumeEditor(initial: TailoredResume) {
  const [doc, setDoc] = useState<TailoredResume>(initial);
  const [editedKeys, setEditedKeys] = useState<Set<string>>(new Set());

  const reset = useCallback((next: TailoredResume) => {
    setDoc(next);
    setEditedKeys(new Set());
  }, []);

  /** Structural changes (adding or removing a line) count as edits too. */
  const patch = useCallback((key: string, mutate: (draft: TailoredResume) => void) => {
    setDoc((prev) => {
      const draft = structuredClone(prev);
      mutate(draft);
      return draft;
    });
    setEditedKeys((prev) => new Set(prev).add(key));
  }, []);

  return { doc, editedKeys, patch, reset };
}

/* ---------------------------------------------------------------- editor -- */

export function ResumeEditor({
  doc,
  editedKeys,
  patch,
  name,
  contactLine,
}: {
  doc: TailoredResume;
  editedKeys: Set<string>;
  patch: (key: string, mutate: (draft: TailoredResume) => void) => void;
  name: string;
  contactLine: string;
}) {
  const [newSkill, setNewSkill] = useState<Record<number, string>>({});
  const edited = (key: string) => editedKeys.has(key);

  return (
    <article className="bg-paper-raised px-8 py-10 shadow-[0_1px_0_var(--rule),0_0_0_1px_var(--rule)] sm:px-12">
      <header className="text-center">
        <p className="font-display text-3xl leading-tight text-ink">{name}</p>
        {contactLine && (
          <p className="mt-1 font-mono text-[0.6875rem] text-ink-muted">{contactLine}</p>
        )}
        <Field
          ariaLabel="Headline"
          multiline={false}
          value={doc.headline}
          onChange={(v) => patch("headline", (d) => void (d.headline = v))}
          className="mt-2 text-center text-[0.9375rem] text-ink-muted"
          placeholder="Headline"
        />
      </header>

      {/* summary */}
      {doc.summary.text !== undefined && (
        <section>
          <Heading>Summary</Heading>
          <Field
            ariaLabel="Summary"
            value={doc.summary.text}
            onChange={(v) => patch("summary", (d) => void (d.summary.text = v))}
            className={`mt-2 text-[0.875rem] leading-relaxed ${edited("summary") ? "text-ink" : ""}`}
            placeholder="Summary"
          />
        </section>
      )}

      {/* skills */}
      {doc.skills.length > 0 && (
        <section>
          <Heading>Technical Skills</Heading>
          <div className="mt-2 space-y-2">
            {doc.skills.map((group, gi) => (
              <div key={gi} className="group flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <span className="inline-flex shrink-0 items-baseline">
                  <input
                    aria-label={`Skill group ${gi + 1} name`}
                    value={group.category}
                    onChange={(e) =>
                      patch(`skills.${gi}.category`, (d) => void (d.skills[gi].category = e.target.value))
                    }
                    style={{ width: `${Math.max(5, group.category.length + 1)}ch` }}
                    className="rounded-[2px] bg-transparent px-1 -mx-1 text-[0.875rem] font-medium outline-none transition-colors hover:bg-paper-sunk/60 focus:bg-paper-sunk/80"
                  />
                  <span className="text-ink-faint">:</span>
                </span>

                {group.items.map((item, ii) => (
                  <span
                    key={ii}
                    className="group/chip inline-flex items-center gap-0.5 rounded-[2px] bg-paper-sunk px-1.5 py-0.5 text-[0.8125rem]"
                  >
                    {item}
                    <button
                      type="button"
                      aria-label={`Remove ${item}`}
                      onClick={() =>
                        patch(`skills.${gi}`, (d) => void d.skills[gi].items.splice(ii, 1))
                      }
                      className="font-mono text-[0.625rem] leading-none text-ink-faint hover:text-stamp"
                    >
                      ×
                    </button>
                  </span>
                ))}

                <input
                  aria-label={`Add a skill to ${group.category}`}
                  value={newSkill[gi] ?? ""}
                  placeholder="+ add"
                  onChange={(e) => setNewSkill((p) => ({ ...p, [gi]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const value = (newSkill[gi] ?? "").trim();
                    if (!value) return;
                    patch(`skills.${gi}`, (d) => void d.skills[gi].items.push(value));
                    setNewSkill((p) => ({ ...p, [gi]: "" }));
                  }}
                  className="w-20 bg-transparent px-1 text-[0.8125rem] outline-none placeholder:text-ink-faint focus:bg-paper-sunk"
                />
                <RemoveButton
                  label={`Remove the ${group.category} group`}
                  onClick={() => patch("skills", (d) => void d.skills.splice(gi, 1))}
                />
              </div>
            ))}
          </div>
          <AddButton
            onClick={() =>
              patch("skills", (d) =>
                d.skills.push({ category: "New group", items: [], source_ids: [] }),
              )
            }
          >
            + skill group
          </AddButton>
        </section>
      )}

      {/* experience */}
      {doc.experience.length > 0 && (
        <section>
          <Heading>Experience</Heading>
          {doc.experience.map((exp, ei) => (
            <div key={exp.source_id} className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Field
                  ariaLabel={`Role ${ei + 1} title`}
                  multiline={false}
                  value={exp.title}
                  onChange={(v) =>
                    patch(`exp.${ei}.title`, (d) => void (d.experience[ei].title = v))
                  }
                  className="w-auto flex-1 text-[0.9375rem] font-medium"
                />
                <span className="font-mono text-[0.6875rem] text-ink-faint">
                  {exp.start_date} - {exp.end_date}
                </span>
              </div>
              <p className="text-[0.8125rem] text-ink-muted">
                {[exp.company, exp.location].filter(Boolean).join(" · ")}
              </p>

              <ul className="mt-2 space-y-1.5">
                {exp.bullets.map((bullet, bi) => {
                  const key = `exp.${ei}.b.${bi}`;
                  return (
                    <li key={bi} className="group flex items-start gap-1.5">
                      <span
                        aria-hidden
                        className={`mt-[0.45rem] h-1 w-1 shrink-0 rounded-full ${
                          edited(key) ? "bg-caution" : "bg-ink"
                        }`}
                        title={edited(key) ? "Edited by you, not verified" : undefined}
                      />
                      <Field
                        ariaLabel={`Role ${ei + 1} bullet ${bi + 1}`}
                        value={bullet.text}
                        onChange={(v) =>
                          patch(key, (d) => void (d.experience[ei].bullets[bi].text = v))
                        }
                        className="text-[0.875rem] leading-relaxed"
                      />
                      <RemoveButton
                        label={`Remove bullet ${bi + 1}`}
                        onClick={() =>
                          patch(`exp.${ei}`, (d) => void d.experience[ei].bullets.splice(bi, 1))
                        }
                      />
                    </li>
                  );
                })}
              </ul>
              <AddButton
                onClick={() =>
                  patch(`exp.${ei}`, (d) =>
                    d.experience[ei].bullets.push({ text: "", source_ids: [], keywords: [] }),
                  )
                }
              >
                + bullet
              </AddButton>
            </div>
          ))}
        </section>
      )}

      {/* projects */}
      {doc.projects.length > 0 && (
        <section>
          <Heading>Projects</Heading>
          {doc.projects.map((proj, pi) => (
            <div key={proj.source_id} className="mt-4">
              <Field
                ariaLabel={`Project ${pi + 1} name`}
                multiline={false}
                value={proj.name}
                onChange={(v) => patch(`proj.${pi}.name`, (d) => void (d.projects[pi].name = v))}
                className="text-[0.9375rem] font-medium"
              />
              <ul className="mt-1.5 space-y-1.5">
                {proj.bullets.map((bullet, bi) => {
                  const key = `proj.${pi}.b.${bi}`;
                  return (
                    <li key={bi} className="group flex items-start gap-1.5">
                      <span
                        aria-hidden
                        className={`mt-[0.45rem] h-1 w-1 shrink-0 rounded-full ${
                          edited(key) ? "bg-caution" : "bg-ink"
                        }`}
                      />
                      <Field
                        ariaLabel={`Project ${pi + 1} bullet ${bi + 1}`}
                        value={bullet.text}
                        onChange={(v) =>
                          patch(key, (d) => void (d.projects[pi].bullets[bi].text = v))
                        }
                        className="text-[0.875rem] leading-relaxed"
                      />
                      <RemoveButton
                        label={`Remove project bullet ${bi + 1}`}
                        onClick={() =>
                          patch(`proj.${pi}`, (d) => void d.projects[pi].bullets.splice(bi, 1))
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* education */}
      {doc.education.length > 0 && (
        <section>
          <Heading>Education</Heading>
          {doc.education.map((edu, i) => (
            <div key={edu.source_id} className="mt-2">
              <Field
                ariaLabel={`Education ${i + 1} degree`}
                multiline={false}
                value={edu.degree}
                onChange={(v) => patch(`edu.${i}`, (d) => void (d.education[i].degree = v))}
                className="text-[0.875rem] font-medium"
              />
              <p className="text-[0.8125rem] text-ink-muted">
                {[edu.institution, edu.dates].filter(Boolean).join(" · ")}
              </p>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
