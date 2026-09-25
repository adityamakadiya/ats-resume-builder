"use client";

/**
 * "I did do that, it just wasn't on my resume."
 *
 * The guard refuses a claim when no fact supports it, which is correct and,
 * alone, a dead end: the claim is often true and the resume simply never
 * said it. This is how the user supplies what is missing.
 *
 * THE TOOL WRITES THE SENTENCE. The first version of this asked them to
 * compose the bullet, which hands the hardest part of the job back to the
 * person who came here to avoid doing it. They know what they did; turning
 * it into the register a resume uses is the product's work. So they give a
 * few words, press the button, and get a line they can put in as it stands.
 *
 * WHAT KEEPS IT HONEST. The generator may only use what they typed - no
 * invented metric, no second technology, no scale they did not mention -
 * and the result is stored as an attested fact, never counted as traced.
 * Both halves are said here, before they write, and again on the badge
 * afterwards. A tool that writes your resume for you and a tool that makes
 * things up are separated by exactly this rule.
 */

import { useEffect, useRef, useState } from "react";
import type { ResumeFacts } from "@ats/core";

export type AttestTarget = { term: string } | null;

type Draft = { text: string; confident: boolean; note: string };

export function AttestDialog({
  target,
  facts,
  onClose,
  onAttest,
}: {
  target: AttestTarget;
  facts: ResumeFacts;
  onClose: () => void;
  /** Stores the fact and places the line. */
  onAttest: (input: { groupId: string; text: string }) => void;
}) {
  const groups = [
    ...facts.experience.map((e) => ({
      id: e.id,
      label: [e.title, e.company].filter(Boolean).join(" · ") || e.id,
    })),
    ...facts.projects.map((p) => ({ id: p.id, label: p.name || p.id })),
  ];

  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const term = target?.term ?? "";

  useEffect(() => {
    if (!target) return;
    setNote("");
    setDraft(null);
    setProblem(null);
    setGroupId(groups[0]?.id ?? "");
    area.current?.focus();
    // Only when the dialog opens on a new term.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.term]);

  useEffect(() => {
    if (!target) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;

  async function write() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/suggest/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ term, groupId, note: note.trim(), facts }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok || body.ok !== true) {
        setProblem(
          typeof body.reason === "string" ? body.reason : `The writer answered ${response.status}.`,
        );
        return;
      }
      setDraft({
        text: String(body.text ?? ""),
        confident: body.confident !== false,
        note: typeof body.note === "string" ? body.note : "",
      });
    } catch {
      setProblem("Could not reach the writer.");
    } finally {
      setBusy(false);
    }
  }

  const enough = note.trim().length >= 8 && groupId !== "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attest-title"
        className="w-full max-w-lg rounded-lg border border-rule bg-paper-raised p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="label text-caution">Not in your resume</p>
        <h2 id="attest-title" className="mt-1 font-display text-[1.25rem] font-semibold text-ink">
          Where did you use {term}?
        </h2>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-muted">
          The posting asks for it and your resume never mentions it, so we would not claim
          it for you. Tell us roughly what you did and we will write the line.
        </p>

        {groups.length === 0 ? (
          <p className="mt-4 text-[0.875rem] text-caution">
            There is no role or project on this resume to attach it to yet.
          </p>
        ) : (
          <>
            <label className="mt-4 flex flex-col gap-1.5">
              <span className="label">Which role or project</span>
              <select
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value);
                  setDraft(null);
                }}
                className="rounded-md border border-rule-strong bg-paper px-3 py-2 text-[0.9375rem] text-ink"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 flex flex-col gap-1.5">
              <span className="label">What did you do with it</span>
              <textarea
                ref={area}
                rows={2}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setDraft(null);
                }}
                placeholder={`a few words is enough, e.g. "ran the billing service on it and did the rollout"`}
                className="rounded-md border border-rule-strong bg-paper px-3 py-2 text-[0.9375rem] leading-snug text-ink"
              />
              <span className="text-[0.75rem] leading-snug text-ink-faint">
                Your words only. We will not add a number, a scale or a second technology
                you did not mention, because you are the one who has to defend it.
              </span>
            </label>

            {draft && (
              <div className="mt-3 rounded-md border border-traced/40 bg-traced-soft/40 p-3">
                <p className="label text-traced">The line</p>
                <p className="mt-1 text-[0.9375rem] leading-snug text-ink">{draft.text}</p>
                {draft.note && (
                  <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-muted">{draft.note}</p>
                )}
                {!draft.confident && (
                  <p className="mt-1.5 text-[0.75rem] leading-snug text-caution">
                    Thin, on what you gave us. Add a detail above and write it again if you
                    want more from it.
                  </p>
                )}
              </div>
            )}

            {problem && (
              <p role="alert" className="mt-3 text-[0.8125rem] text-[color:var(--refused)]">
                {problem}
              </p>
            )}

            <p className="mt-3 border-l-2 border-caution pl-3 text-[0.75rem] leading-snug text-caution">
              This becomes your claim, not your resume&rsquo;s. The provenance count will go
              on saying the uploaded file does not contain it, because it does not.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!enough || busy}
                onClick={write}
                className="rounded-md border border-rule-strong px-3.5 py-2 text-[0.9375rem] text-ink disabled:opacity-50"
              >
                {busy ? "Writing" : draft ? "Write it again" : "Write the line"}
              </button>

              {draft && (
                <button
                  type="button"
                  onClick={() => {
                    onAttest({ groupId, text: draft.text });
                    onClose();
                  }}
                  className="rounded-md bg-stamp px-4 py-2 text-[0.9375rem] font-medium text-paper-raised"
                >
                  Add it to my resume
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="text-[0.875rem] text-ink-muted underline underline-offset-2"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
