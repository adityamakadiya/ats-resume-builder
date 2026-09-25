"use client";

/**
 * "I did do that, it just wasn't on my resume."
 *
 * The guard refuses a claim when no fact supports it, which is correct and,
 * on its own, a dead end: the claim is very often true and the resume simply
 * never mentioned it. A product that can only say no leaves the candidate
 * with a lower score and nothing to do about it.
 *
 * So the refusal becomes a question. The user names the role and writes the
 * sentence in their own words, it enters the ledger as theirs, and from then
 * on the rewrite may cite it and the score may count it.
 *
 * WHAT THIS IS CAREFUL ABOUT
 *
 * It asks for a sentence rather than a checkbox. "Did you use Kubernetes?
 * [yes]" would harvest a keyword; asking where and what they did with it
 * produces a line somebody can defend in an interview, which is the only
 * kind worth putting on a resume. The placeholder shows the shape.
 *
 * And it never claims the result is traced. The line is the user's word,
 * the provenance count goes on excluding it, and the dialog says so before
 * they write rather than after.
 */

import { useEffect, useRef, useState } from "react";
import type { ResumeFacts } from "@ats/core";

export type AttestTarget = { term: string } | null;

export function AttestDialog({
  target,
  facts,
  onClose,
  onAttest,
}: {
  target: AttestTarget;
  facts: ResumeFacts;
  onClose: () => void;
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
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (target) {
      setText("");
      setGroupId(groups[0]?.id ?? "");
      area.current?.focus();
    }
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

  const term = target.term;
  const ready = text.trim().length >= 20 && groupId !== "";

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
        <h2
          id="attest-title"
          className="mt-1 font-display text-[1.25rem] font-semibold text-ink"
        >
          Where did you use {term}?
        </h2>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-muted">
          The posting asks for it and your resume never mentions it, so we would not
          claim it for you. If you have actually done it, say where and what you did,
          and it becomes something we can use.
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
                onChange={(event) => setGroupId(event.target.value)}
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
              <span className="label">What you did with it</span>
              <textarea
                ref={area}
                rows={3}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={`Ran ${term} in production for the billing service, including the rollout and the on-call for it.`}
                className="rounded-md border border-rule-strong bg-paper px-3 py-2 text-[0.9375rem] leading-snug text-ink"
              />
              <span className="text-[0.75rem] leading-snug text-ink-faint">
                One sentence, the way you would say it out loud in an interview. A
                keyword on its own is not evidence of anything.
              </span>
            </label>

            {/*
              Said before they type, not after. This is the one place the
              product stops being able to vouch for a line, and burying that
              under the button would make the provenance count a surprise.
            */}
            <p className="mt-3 border-l-2 border-caution pl-3 text-[0.75rem] leading-snug text-caution">
              This will be your claim, not your resume&rsquo;s. We will use it, and the
              provenance count will go on saying the uploaded file does not contain it,
              because it does not.
            </p>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  onAttest({ groupId, text: text.trim() });
                  onClose();
                }}
                className="rounded-md bg-stamp px-4 py-2 text-[0.9375rem] font-medium text-paper-raised disabled:opacity-50"
              >
                Add it as mine
              </button>
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
