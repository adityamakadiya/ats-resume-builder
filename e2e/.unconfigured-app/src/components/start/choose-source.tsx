"use client";

/**
 * The fork: bring a resume, or begin one.
 *
 * The reference product puts these two side by side as equal twins. They are
 * not equal. Almost everyone arriving here has a resume already, and the
 * product is much better at rewriting one than at conjuring one, so the
 * upload panel is the wider column, carries the recommendation, and gets the
 * stamp. The blank path is still a first-class route, just an honest second
 * choice rather than a false symmetry.
 *
 * The upload posts as soon as a file passes validation. Making someone pick
 * a file and then press a second button is a step that exists only to make
 * the developer's state machine simpler.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ArrowRight, FilePlus2 } from "lucide-react";
import { Dropzone, type UploadPhase } from "@/components/upload/dropzone";
import { Button } from "@/components/ui/button";

export function ChooseSource() {
  const router = useRouter();
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });

  const upload = useCallback(
    async (file: File) => {
      setPhase({ kind: "busy", step: `Uploading ${file.name}` });

      const body = new FormData();
      body.set("file", file);

      let response: Response;
      try {
        response = await fetch("/api/start/upload", { method: "POST", body });
      } catch {
        setPhase({
          kind: "failed",
          reason: "The upload did not reach the server.",
          remedy: "Check your connection and drop the file again.",
        });
        return;
      }

      let payload: {
        ok?: boolean;
        documentId?: string;
        reason?: string;
        remedy?: string;
      };
      try {
        payload = await response.json();
      } catch {
        setPhase({
          kind: "failed",
          reason: `The server answered with ${response.status} and no explanation.`,
          remedy: "Try again. If it keeps happening, check the server logs.",
        });
        return;
      }

      if (!response.ok || !payload.ok || !payload.documentId) {
        setPhase({
          kind: "failed",
          reason: payload.reason ?? "The upload was refused.",
          remedy: payload.remedy ?? "Try a different file, or try again in a moment.",
        });
        return;
      }

      setPhase({ kind: "busy", step: "Stored. Opening the template picker" });
      router.push(`/start/template?document=${encodeURIComponent(payload.documentId)}`);
    },
    [router]
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:gap-6">
      {/* ------------------------------------------------------ upload -- */}
      <section
        aria-labelledby="upload-heading"
        className="sheet relative flex flex-col rounded-xs p-5 sm:p-6"
      >
        <span
          aria-hidden="true"
          className="absolute -top-px left-5 h-0.5 w-12 bg-stamp sm:left-6"
        />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label">Recommended</p>
            <h2
              id="upload-heading"
              className="mt-1.5 font-display text-2xl leading-none text-ink sm:text-3xl"
            >
              Upload the resume you have
            </h2>
          </div>
        </div>
        <p className="mt-2.5 max-w-[46ch] text-[0.875rem] leading-relaxed text-ink-muted">
          It does not need tidying first. We read it into individual facts,
          each one addressed back to the line it came from, and every rewrite
          after this point cites those addresses.
        </p>

        <div className="mt-5 flex-1">
          <Dropzone onAccept={upload} phase={phase} />
        </div>
      </section>

      {/* ----------------------------------------------------- scratch -- */}
      <section
        aria-labelledby="scratch-heading"
        className="sheet flex flex-col rounded-xs p-5 sm:p-6"
      >
        <p className="label">Nothing to upload</p>
        <h2
          id="scratch-heading"
          className="mt-1.5 font-display text-2xl leading-none text-ink sm:text-3xl"
        >
          Start from scratch
        </h2>
        <p className="mt-2.5 text-[0.875rem] leading-relaxed text-ink-muted">
          Pick a template and fill it in yourself. You keep the formatting,
          the page fitting and the computed score.
        </p>

        <ul className="mt-5 space-y-2.5 border-t border-rule pt-5">
          {[
            "No document to trace against, so the rewrite tools stay off until you add one.",
            "You can upload a resume later and the two will be merged.",
            "The score still works. It reads the document, not the upload.",
          ].map((line) => (
            <li key={line} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">
              <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-rule-strong" />
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-6">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => router.push("/start/template")}
            disabled={phase.kind === "busy"}
            className="w-full gap-2 rounded-xs border-rule-strong bg-paper-raised py-5 text-[0.9375rem] text-ink hover:bg-paper-sunk"
          >
            <FilePlus2 aria-hidden="true" />
            Choose a blank template
            <ArrowRight aria-hidden="true" className="ml-auto size-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
