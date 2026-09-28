"use client";

/**
 * The real template, at true size, scaled down.
 *
 * Not a screenshot and not an approximation: the component out of
 * `@ats/templates` renders the live document at A4 and is scaled with a
 * transform, so the line breaks, the widow at the foot of page one and the
 * density rung are the ones the PDF will have. A preview that is only roughly
 * the output is worse than none, because it is believed.
 *
 * Page count comes from `fitToTarget`, which walks the density ladder against
 * a target taken from the document rather than a fixed one page. When nothing
 * fits it says so rather than quietly clipping a bullet, which is the one
 * failure the candidate would never find out about before sending it.
 *
 * THE BUDGET USED TO BE HARDCODED. `fitToPages(sheet, 1)` meant every
 * document was measured against a single page, so a candidate with six roles
 * and twelve years was walked down to 9pt type and then shown a red banner
 * telling them to cut a bullet. Two pages is right for that resume, and the
 * tailor prompt has always asked for one to two pages, so the renderer was
 * the part that was wrong. The target now comes from `targetPagesFor(doc)`
 * and a second page is preferred over the bottom rungs of the ladder.
 *
 * THE LADDER HAS TO BE MEASURED ON THE SHEET ITSELF. The fitter reads
 * `--page-h` off the element it is given and sets `data-density` on it, and
 * both of those live on the template's own `.rz` article, not on a wrapper
 * around it. Measuring the wrapper meant the rung it chose was immediately
 * overridden by the article's own `data-density="0"`, so a two-page document
 * was reported as two pages without ever being asked to become one. The
 * element is found by its class, the rung that fits comes back as state, and
 * it is handed to the template as a prop so React's next render agrees with
 * the attribute the ladder left behind.
 *
 * PAGES ARE DRAWN AS PAGES. The frame used to be one continuous sheet of
 * height PAGE_H * pages with nothing marking the join, so a heading orphaned
 * at the foot of page one was invisible until the PDF was downloaded. Each
 * page is now its own sheet with a gutter and a number under it. The article
 * is only laid out once and each sheet is a window onto a different part of
 * it, offset by `translateY`, so the pages cannot disagree with each other or
 * with what gets printed.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fitToTarget,
  getTemplate,
  targetPagesFor,
  type Density,
  type FitResult,
  type ResumeDoc,
} from "@ats/templates";
import "@ats/templates/print.css";

const PAGE_W = 794;
const PAGE_H = 1123;

/** The gap between two sheets, in unscaled page pixels. About 8mm of air. */
const GUTTER = 30;

function asDensity(rung: number): Density {
  const clamped = Math.min(4, Math.max(0, Math.round(rung)));
  return clamped as Density;
}

export type PreviewPaneProps = {
  doc: ResumeDoc;
  templateId: string;
  zoom: number;
  onZoom: (zoom: number) => void;
};

const INITIAL_FIT: FitResult = {
  pages: 1,
  fits: true,
  density: 0,
  target: 1,
  overTarget: false,
  comfortable: true,
};

export function PreviewPane({ doc, templateId, zoom, onZoom }: PreviewPaneProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<FitResult>(INITIAL_FIT);
  const [available, setAvailable] = useState(PAGE_W);

  const template = getTemplate(templateId);
  const Template = template.component;

  /*
    The target is a property of the career, not of the render, so it is
    derived from the document and only changes when the document does.
  */
  const target = useMemo(() => targetPagesFor(doc), [doc]);

  /*
    The measured element is the template's own article, because that is where
    the page height and the density custom properties are defined. Falling
    back to the wrapper keeps this from throwing in an environment with no
    layout at all; it just means the rung is whatever rung 0 measures as.
  */
  const measure = useCallback(() => {
    const wrapper = sheetRef.current;
    if (!wrapper) return;
    const sheet = wrapper.querySelector<HTMLElement>(".rz") ?? wrapper;
    const next = fitToTarget(sheet, target);
    setFit((current) =>
      current.pages === next.pages &&
      current.fits === next.fits &&
      current.density === next.density &&
      current.target === next.target &&
      current.overTarget === next.overTarget
        ? current
        : next,
    );
  }, [target]);

  // Re-measure whenever the document or the template changes.
  useLayoutEffect(() => {
    measure();
  }, [doc, templateId, measure]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const scale = (Math.min(available, PAGE_W) / PAGE_W) * zoom;
  const pageIndexes = Array.from({ length: Math.max(1, fit.pages) }, (_, index) => index);

  return (
    <section aria-label="Preview" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-rule bg-paper-sunk/50 px-4 py-2.5">
        <span className="label">Preview</span>

        <span
          className={`font-mono text-[0.6875rem] tabular-nums ${
            fit.fits ? "text-ink-faint" : "text-[color:var(--refused)]"
          }`}
        >
          {fit.pages} {fit.pages === 1 ? "page" : "pages"}
        </span>

        {/* The rung the ladder settled on, so the page count is never a mystery. */}
        {fit.density > 0 && (
          <span
            title={`The density ladder tightened margins and spacing to keep this to ${fit.target} ${
              fit.target === 1 ? "page" : "pages"
            }. Body type never goes below 9pt.`}
            className="font-mono text-[0.6875rem] tabular-nums text-ink-faint"
          >
            tightened to {fit.density}/4
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onZoom(zoom - 0.1)}
            className="rounded-md border border-rule px-1.5 py-0.5 font-mono text-[0.75rem] leading-none text-ink-muted hover:border-rule-strong hover:text-ink"
          >
            -
          </button>
          <span className="w-10 text-center font-mono text-[0.6875rem] tabular-nums text-ink-muted">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onZoom(zoom + 0.1)}
            className="rounded-md border border-rule px-1.5 py-0.5 font-mono text-[0.75rem] leading-none text-ink-muted hover:border-rule-strong hover:text-ink"
          >
            +
          </button>
        </div>
      </div>

      {/*
        Three outcomes, and only one of them is a problem. Over target at the
        bottom rung is the candidate's to fix. Over target because the fitter
        chose room is a note in the ordinary voice, because a second page is a
        normal thing for a senior resume to have and the old copy calling it a
        failure is what sent people off cutting real work off the page. A
        document that landed on its target says nothing at all.
      */}
      {!fit.fits ? (
        <p className="border-b border-rule bg-[color:var(--refused-soft)] px-4 py-2.5 text-[0.8125rem] leading-snug text-[color:var(--refused)]">
          This runs to {fit.pages} pages even at the tightest setting, and this resume is aimed at{" "}
          {fit.target === 1 ? "one page" : `${fit.target} pages`}. Cut the weakest bullets rather
          than send a page whose last one is three lines long.
        </p>
      ) : (
        fit.overTarget && (
          <p className="border-b border-rule bg-paper-sunk px-4 py-2.5 text-[0.8125rem] leading-snug text-ink-muted">
            Set across {fit.pages} pages. It would go on{" "}
            {fit.target === 1 ? "one page" : `${fit.target} pages`} only at a density that reads as
            cramped, and a comfortable second page is the better resume. Cut a few lines if you
            want it shorter.
          </p>
        )
      )}

      {!template.atsSafe && template.warning && (
        <p className="border-b border-rule bg-caution-soft px-4 py-2 text-[0.8125rem] leading-snug text-caution">
          {template.warning}
        </p>
      )}

      <div ref={frameRef} className="min-h-0 flex-1 overflow-auto bg-paper-sunk p-4">
        <div className="mx-auto" style={{ width: PAGE_W * scale }}>
          {pageIndexes.map((index) => (
            <div key={index} style={{ marginTop: index === 0 ? 0 : GUTTER * scale }}>
              {/*
                One window per page onto the same article. `overflow: hidden`
                plus a negative offset is what makes the break visible; the
                article itself is never cut, so the page break drawn here is
                the break the printer will make.
              */}
              <div
                className="overflow-hidden rounded-sm bg-white shadow-[0_4px_24px_-10px_rgba(15,23,42,0.28)]"
                style={{ width: PAGE_W * scale, height: PAGE_H * scale }}
              >
                <div
                  style={{
                    transform: `scale(${scale}) translateY(${-index * PAGE_H}px)`,
                    transformOrigin: "top left",
                    width: PAGE_W,
                  }}
                >
                  {/* A resume is printed on white paper and judged on white
                      paper, so the sheet is white whatever the chrome around
                      it is. */}
                  {/* `data-resume-sheet` is how the Download button finds the
                      page to print, and it goes on the first window only:
                      every window holds the whole article, so marking more
                      than one would give the printer a choice it must not
                      have. A query rather than lifted state because there is
                      exactly one preview and the toolbar has no other reason
                      to know this component exists. */}
                  <div
                    ref={index === 0 ? sheetRef : undefined}
                    data-resume-sheet={index === 0 ? "" : undefined}
                    aria-hidden="true"
                    className="bg-white text-black"
                  >
                    <Template doc={doc} density={asDensity(fit.density)} />
                  </div>
                </div>
              </div>

              {/* Printerly and quiet: a number under the sheet, the way a
                  proof sheet is numbered, not a chip floating over the page. */}
              <p className="pt-1.5 text-right font-mono text-[0.625rem] tabular-nums text-ink-faint">
                page {index + 1} of {fit.pages}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
