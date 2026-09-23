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
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitToPages, getTemplate, type ResumeDoc } from "@ats/templates";
import "@ats/templates/print.css";

const PAGE_W = 794;
const PAGE_H = 1123;

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

  // Re-measure whenever the document, the template or the width changes.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    setFit(fitToPages(el, 1));
  }, [doc, templateId]);

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
      <div className="flex items-center gap-3 border-b border-rule px-4 py-2">
        <span className="label">Preview</span>

        <span
          className={`font-mono text-[0.6875rem] tabular-nums ${
            fit.fits ? "text-ink-faint" : "text-stamp"
          }`}
        >
          {fit.pages} {fit.pages === 1 ? "page" : "pages"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onZoom(zoom - 0.1)}
            className="rounded-xs border border-rule px-1.5 py-0.5 font-mono text-[0.75rem] leading-none text-ink-muted hover:border-rule-strong hover:text-ink"
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
            className="rounded-xs border border-rule px-1.5 py-0.5 font-mono text-[0.75rem] leading-none text-ink-muted hover:border-rule-strong hover:text-ink"
          >
            +
          </button>
        </div>
      </div>

      {!fit.fits && (
        <p className="border-b border-rule bg-stamp-soft px-4 py-2 text-[0.8125rem] leading-snug text-stamp">
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
          className="mx-auto shadow-[0_2px_24px_-12px_rgba(23,20,15,0.5)]"
          style={{ width: PAGE_W * scale, height: PAGE_H * fit.pages * scale }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              width: PAGE_W,
            }}
          >
            <div ref={sheetRef} aria-hidden="true" className="bg-white text-black">
              <Template doc={doc} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
