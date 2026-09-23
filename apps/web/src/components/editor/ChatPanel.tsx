"use client";

/**
 * The conversation, and the queue of things it has proposed.
 *
 * Two rules shape this panel.
 *
 * The first is that a wait always says what is being waited on. The pipeline
 * publishes named steps over the same stream as the tokens, and the ribbon at
 * the top of this panel is those step names. "Checking every rewritten line
 * traces back to a fact" tells the user what they are buying with the eight
 * seconds; a spinner tells them nothing and reads as a hang.
 *
 * The second is that the assistant never edits the document. It proposes, and
 * the proposal appears as a card with Accept and Decline on it. That is why
 * the transcript and the patch queue live in the same column: the reasoning
 * and the decision belong next to each other.
 *
 * The routes are being written by another agent. A 404 from any of them turns
 * into a line of transcript saying so, because half a product that admits what
 * is missing is more usable than one that throws.
 */

import { useEffect, useRef, useState } from "react";
import { STEP_LABEL, streamChat, type TailorEvent, type TailorStep } from "@/lib/editor/api";
import { PatchCard } from "./PatchCard";
import { useEditorStore } from "@/lib/store/editor";

const STEP_ORDER: TailorStep[] = ["gaps", "tailor", "guard", "score"];

function StepRibbon() {
  const steps = useEditorStore((s) => s.steps);
  const active = STEP_ORDER.filter((key) => steps[key] && steps[key] !== "waiting");
  if (active.length === 0) return null;

  return (
    <ol aria-live="polite" className="border-b border-rule px-4 py-2.5">
      {STEP_ORDER.map((key) => {
        const state = steps[key];
        if (!state || state === "waiting") return null;
        return (
          <li key={key} className="flex items-baseline gap-2 py-0.5">
            <span
              className={`font-mono text-[0.625rem] ${
                state === "done" ? "text-traced" : state === "failed" ? "text-stamp" : "text-stamp"
              }`}
            >
              {state === "done" ? "done" : state === "failed" ? "fail" : "..."}
            </span>
            <span
              className={`text-[0.8125rem] ${state === "running" ? "text-ink" : "text-ink-faint"}`}
            >
              {STEP_LABEL[key]}
            </span>
            {state === "running" && (
              <span aria-hidden="true" className="sweeping ml-auto h-px w-16 self-center" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Message({
  role,
  text,
  streaming,
}: {
  role: "you" | "assistant" | "system";
  text: string;
  streaming?: boolean;
}) {
  if (role === "system") {
    return (
      <li className="border-l-2 border-l-caution bg-caution-soft/40 px-3 py-2">
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">{text}</p>
      </li>
    );
  }

  return (
    <li className={role === "you" ? "pl-8" : ""}>
      <p className="label mb-1">{role === "you" ? "You" : "Tailor"}</p>
      <p
        className={`text-[0.875rem] leading-relaxed whitespace-pre-wrap ${
          role === "you" ? "text-ink-muted" : "text-ink"
        }`}
      >
        {text}
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.1em] animate-pulse bg-stamp"
          />
        )}
      </p>
    </li>
  );
}

export type ChatPanelProps = {
  /** A question written for the user by something else, such as the refusal dialog. */
  prefill: { text: string; nonce: number } | null;
};

export function ChatPanel({ prefill }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doc = useEditorStore((s) => s.doc);
  const messages = useEditorStore((s) => s.messages);
  const pendingPatches = useEditorStore((s) => s.pendingPatches);
  const streaming = useEditorStore((s) => s.streaming);
  const showChanges = useEditorStore((s) => s.showChanges);
  const resumeId = useEditorStore((s) => s.resumeId);
  const baseVersionId = useEditorStore((s) => s.baseVersionId);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    composerRef.current?.focus();
  }, [prefill]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, pendingPatches.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send() {
    const question = input.trim();
    if (!question || streaming) return;

    const store = useEditorStore.getState();
    setInput("");
    store.pushMessage({ role: "you", text: question });
    const replyId = store.pushMessage({ role: "assistant", text: "", streaming: true });
    store.setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of streamChat(
        { resumeId, versionId: baseVersionId, message: question },
        controller.signal,
      )) {
        handle(event, replyId);
      }
    } finally {
      const after = useEditorStore.getState();
      after.endMessage(replyId);
      after.setStreaming(false);
      abortRef.current = null;
    }
  }

  function handle(event: TailorEvent, replyId: string) {
    const store = useEditorStore.getState();
    switch (event.t) {
      case "step":
        store.setStep(event.step, event.state === "start" ? "running" : "done");
        return;
      case "token":
        store.appendToken(replyId, event.text);
        return;
      case "patch": {
        const id = store.stagePatch({ ops: event.ops, rationale: event.rationale });
        if (id === null) {
          store.pushMessage({
            role: "system",
            text: "A proposed change did not fit the document and was dropped rather than applied.",
          });
        }
        return;
      }
      case "guard":
        store.setStep("guard", event.repairing ? "running" : event.passed ? "done" : "failed");
        if (!event.repairing && !event.passed) {
          store.setTruth({
            passed: false,
            error_count: event.violations.length,
            warning_count: 0,
            violations: event.violations,
          });
        }
        return;
      case "score":
        // The header score is computed locally and stays authoritative.
        store.setStep("score", "done");
        return;
      case "done":
        store.setStep("score", "done");
        return;
      case "error":
        store.pushMessage({
          role: "system",
          text: event.hint ? `${event.message} ${event.hint}` : event.message,
        });
        return;
    }
  }

  const empty = messages.length === 0 && pendingPatches.length === 0;

  return (
    <section aria-label="Assistant" className="flex h-full min-h-0 flex-col">
      <StepRibbon />

      <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {empty ? (
          <div className="ruled mx-auto max-w-[36ch] py-8 text-center">
            <p className="font-display text-[1.375rem] leading-tight text-ink">
              Ask for a change.
            </p>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
              Anything proposed here arrives as a change you accept or decline. Nothing is
              written into the document behind your back, and nothing is invented: if the
              answer is not in your resume, you will be told so.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((message) => (
              <Message
                key={message.id}
                role={message.role}
                text={message.text}
                streaming={message.streaming}
              />
            ))}
          </ul>
        )}

        {pendingPatches.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="label">
              {pendingPatches.length} proposed {pendingPatches.length === 1 ? "change" : "changes"}
            </p>
            {pendingPatches.map((patch) => (
              <PatchCard
                key={patch.id}
                patch={patch}
                doc={doc}
                showChanges={showChanges}
                onToggleChanges={useEditorStore.getState().toggleShowChanges}
                onAccept={useEditorStore.getState().acceptPatch}
                onDecline={useEditorStore.getState().declinePatch}
              />
            ))}
          </div>
        )}
      </div>

      <form
        className="border-t border-rule px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="chat-composer" className="sr-only">
          Ask for a change to your resume
        </label>
        <textarea
          id="chat-composer"
          ref={composerRef}
          rows={2}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Tighten the second bullet at Meridian"
          className="w-full resize-none rounded-xs border border-rule bg-paper-raised px-2.5 py-2 text-[0.875rem] leading-relaxed outline-none placeholder:text-ink-faint focus:border-rule-strong"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="font-mono text-[0.625rem] tracking-wider text-ink-faint uppercase">
            {streaming ? "Answering" : "Cmd + Enter to send"}
          </span>
          <button
            type="submit"
            disabled={streaming || input.trim().length === 0}
            className="rounded-xs border border-ink bg-ink px-3 py-1 text-[0.8125rem] text-paper-raised transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
