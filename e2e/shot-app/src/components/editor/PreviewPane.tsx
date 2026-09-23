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
 * Page count comes from `fitToPages`, which walks the density ladder and stops
 * at the first rung that fits. When nothing fits it says so rather than
 * quietly clipping a bullet, which is the one failure the candidate would
 * never find out about before sending it.
 *
 * THE LADDER HAS TO BE MEASURED ON THE SHEET ITSELF. `fitToPages` reads
 * `--page-h` off the element it is given and sets `data-density` on it, and
 * both of those live on the template's own `.rz` article, not on a wrapper
 * around it. Measuring the wrapper meant the rung it chose was immediately
 * overridden by the article's own `data-density="0"`, so a two-page document
 * was reported as two pages without ever being asked to become one. The
 * element is found by its class, the rung that fits comes back as state, and
 * it is handed to the template as a prop so React's next render agrees with
 * the attribute the ladder left behind.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitToPages, getTemplate, type Density, type ResumeDoc } from "@ats/templates";
import "@ats/templates/print.css";

const PAGE_W = 794;
const PAGE_H = 1123;

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

export function PreviewPane({ doc, templateId, zoom, onZoom }: PreviewPaneProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ pages: 1, fits: true, density: 0 });
  const [available, setAvailable] = useState(PAGE_W);

  const template = getTemplate(templateId);
  const Template = template.component;

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
    const next = fitToPages(sheet, 1);
    setFit((current) =>
      current.pages === next.pages &&
      current.fits === next.fits &&
      current.density === next.density
        ? current
        : next,
    );
  }, []);

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

        {/* The rung the ladder settled on, so "one page" is never a mystery. */}
        {fit.density > 0 && (
          <span
            title="The density ladder tightened margins and spacing to keep this on one page. Body type never goes below 9pt."
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

      {!fit.fits && (
        <p className="border-b border-rule bg-[color:var(--refused-soft)] px-4 py-2.5 text-[0.8125rem] leading-snug text-[color:var(--refused)]">
          This does not fit on one page even at the tightest setting. Cut a bullet rather than
          send a resume with a page two that is three lines long.
        </p>
      )}

      {!template.atsSafe && template.warning && (
        <p className="border-b border-rule bg-caution-soft px-4 py-2 text-[0.8125rem] leading-snug text-caution">
          {template.warning}
        </p>
      )}

      <div ref={frameRef} className="min-h-0 flex-1 overflow-auto bg-paper-sunk p-4">
        <div
          className="mx-auto rounded-sm shadow-[0_4px_24px_-10px_rgba(15,23,42,0.28)]"
          style={{ width: PAGE_W * scale, height: PAGE_H * fit.pages * scale }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              width: PAGE_W,
            }}
          >
            {/* A resume is printed on white paper and judged on white paper,
                so the sheet is white whatever the chrome around it is. */}
            <div ref={sheetRef} aria-hidden="true" className="bg-white text-black">
              <Template doc={doc} density={asDensity(fit.density)} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
