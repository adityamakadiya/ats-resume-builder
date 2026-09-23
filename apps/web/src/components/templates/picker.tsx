"use client";

/**
 * The template picker.
 *
 * Two decisions worth stating.
 *
 * FIRST, the warning is not a disclaimer. A two-column resume is genuinely
 * the best looking thing in the catalogue and genuinely the one most likely
 * to be read out of order by the employer's parser. Every competitor puts
 * that in a footnote, or nowhere. Here it sits inside the card, above the
 * fold, in the caution colour, and it is repeated in the detail panel next
 * to the button that commits to it. Someone choosing it should be choosing
 * it knowingly.
 *
 * SECOND, the grid is a radiogroup, not a row of buttons. Arrow keys move
 * between templates, Space and Enter select, and the selected one is the only
 * tab stop, which is what a radio group is for and what a set of eight
 * tabbable cards is not.
 */

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { TemplateCategory, TemplateMeta } from "@ats/templates";
import { rich } from "@ats/templates/fixtures";
import { TemplateThumbnail } from "./thumbnail";
import { Button } from "@/components/ui/button";

export type TemplatePickerProps = {
  templates: TemplateMeta[];
  defaultTemplateId: string;
  /** Called with the chosen id. The parent owns the write. */
  onConfirm?: (templateId: string) => void;
  /** Set while the parent's write is in flight, and named in the button. */
  busyStep?: string | null;
  /** Shown above the action when the parent's write failed. */
  error?: { reason: string; remedy: string } | null;
};

type Filter = { id: "all" | TemplateCategory; label: string; hint: string };

const FILTERS: Filter[] = [
  { id: "all", label: "All", hint: "Every template" },
  { id: "ats", label: "Parser safe", hint: "Read correctly by every parser we test" },
  { id: "simple", label: "Simple", hint: "Single column, conservative" },
  { id: "two-column", label: "Two column", hint: "Sidebar layouts, with the caveat" },
];

export function TemplatePicker({
  templates,
  defaultTemplateId,
  onConfirm,
  busyStep,
  error,
}: TemplatePickerProps) {
  const [filter, setFilter] = useState<Filter["id"]>("all");
  const [selectedId, setSelectedId] = useState(defaultTemplateId);
  const cardRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const visible = useMemo(
    () =>
      filter === "all"
        ? templates
        : templates.filter((template) => template.categories.includes(filter)),
    [templates, filter]
  );

  const selected =
    templates.find((template) => template.id === selectedId) ?? templates[0];

  function moveFocus(from: string, delta: number) {
    const index = visible.findIndex((template) => template.id === from);
    if (index === -1) return;
    const next = visible[(index + delta + visible.length) % visible.length];
    setSelectedId(next.id);
    cardRefs.current.get(next.id)?.focus();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_27rem]">
      <div>
        {/* ------------------------------------------------ filter chips -- */}
        <div
          role="group"
          aria-label="Filter templates by category"
          className="flex flex-wrap items-center gap-1.5"
        >
          {FILTERS.map((entry) => {
            const active = filter === entry.id;
            const category = entry.id;
            const count =
              category === "all"
                ? templates.length
                : templates.filter((template) => template.categories.includes(category))
                    .length;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                aria-pressed={active}
                title={entry.hint}
                className={[
                  "rounded-full border px-3 py-1 font-mono text-[0.6875rem] tracking-[0.1em] uppercase transition-colors",
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-rule-strong text-ink-muted hover:border-ink-faint hover:text-ink",
                ].join(" ")}
              >
                {entry.label}
                <span className={active ? "ml-1.5 opacity-60" : "ml-1.5 text-ink-faint"}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ------------------------------------------------------- grid -- */}
        {visible.length === 0 ? (
          <p className="mt-8 rounded-xs border border-dashed border-rule-strong px-4 py-8 text-center text-[0.875rem] text-ink-muted">
            No templates in that category yet. Choose All to see the other{" "}
            {templates.length}.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Resume template"
            className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
          >
            {visible.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                selected={template.id === selectedId}
                onSelect={() => setSelectedId(template.id)}
                onArrow={(delta) => moveFocus(template.id, delta)}
                registerRef={(node) => cardRefs.current.set(template.id, node)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ detail -- */}
      <aside className="lg:sticky lg:top-8 lg:self-start" aria-label="Template preview">
        <div className="sheet rounded-xs">
          <div className="border-b border-rule px-5 py-4">
            <p className="label">Live preview</p>
            <h2 className="mt-1.5 font-display text-2xl leading-none text-ink">
              {selected.name}
            </h2>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
              {selected.blurb}
            </p>
          </div>

          <div className="flex justify-center bg-paper-sunk px-5 py-5">
            <div className="border border-rule-strong shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
              <TemplateThumbnail template={selected} doc={rich} width={288} />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px border-y border-rule bg-rule">
            <Stat label="Columns" value={String(selected.columns)} />
            <Stat
              label="Parser read"
              value={selected.atsSafe ? "Correct" : "At risk"}
              tone={selected.atsSafe ? "traced" : "caution"}
            />
          </dl>

          {selected.warning ? (
            <TwoColumnWarning warning={selected.warning} className="m-5 mb-0" />
          ) : (
            <p className="m-5 mb-0 rounded-xs border-l-2 border-traced bg-traced-soft/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink">
              Every parser we test reads this layout in the order it is
              written.
            </p>
          )}

          <div className="p-5">
            {error ? (
              <p
                role="alert"
                className="mb-3 rounded-xs border-l-2 border-stamp bg-stamp-soft/60 px-3 py-2 text-[0.8125rem] leading-relaxed text-ink"
              >
                <span className="font-medium text-stamp">{error.reason}</span>{" "}
                {error.remedy}
              </p>
            ) : null}

            <Button
              type="button"
              size="lg"
              disabled={Boolean(busyStep)}
              onClick={() => onConfirm?.(selected.id)}
              className="w-full rounded-xs bg-stamp py-5 text-[0.9375rem] text-paper-raised hover:bg-stamp/90"
            >
              {busyStep ?? `Use ${selected.name}`}
            </Button>
            <p role="status" aria-live="polite" className="sr-only">
              {busyStep ?? ""}
            </p>
            <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-faint">
              You can change the template later without redoing any of the
              tailoring.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "traced" | "caution";
}) {
  const color =
    tone === "traced" ? "text-traced" : tone === "caution" ? "text-caution" : "text-ink";
  return (
    <div className="bg-paper-raised px-5 py-3">
      <dt className="label">{label}</dt>
      <dd className={`mt-1 font-mono text-[0.8125rem] ${color}`}>{value}</dd>
    </div>
  );
}

export function TwoColumnWarning({
  warning,
  className,
}: {
  warning: string;
  className?: string;
}) {
  return (
    <p
      className={`flex gap-2.5 rounded-xs border-l-2 border-caution bg-caution-soft/70 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink ${
        className ?? ""
      }`}
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-caution" />
      <span>
        <span className="sr-only">Warning: </span>
        {warning}
      </span>
    </p>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect,
  onArrow,
  registerRef,
}: {
  template: TemplateMeta;
  selected: boolean;
  onSelect: () => void;
  onArrow: (delta: number) => void;
  registerRef: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={registerRef}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          onArrow(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          onArrow(-1);
        }
      }}
      className={[
        "group flex flex-col overflow-hidden rounded-xs border text-left transition-colors",
        selected
          ? "border-stamp bg-paper-raised"
          : "border-rule bg-paper-raised hover:border-rule-strong",
      ].join(" ")}
    >
      <span className="relative flex justify-center overflow-hidden bg-paper-sunk px-4 pt-4">
        <span className="block border border-rule-strong">
          {/* Reveal the top 62% of the page: the header and first section is
              what distinguishes one template from another. */}
          <TemplateThumbnail template={template} doc={rich} width={208} reveal={0.62} />
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-paper-sunk to-transparent"
        />
        {selected ? (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-stamp text-paper-raised"
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
        ) : null}
      </span>

      <span className="flex flex-1 flex-col gap-1.5 border-t border-rule px-4 py-3.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-display text-xl leading-none text-ink">
            {template.name}
          </span>
          <span className="font-mono text-[0.625rem] tracking-[0.1em] text-ink-faint uppercase">
            {template.columns === 1 ? "1 col" : "2 col"}
          </span>
        </span>
        <span className="text-[0.8125rem] leading-relaxed text-ink-muted">
          {template.blurb}
        </span>
        {template.warning ? (
          <TwoColumnWarning warning={template.warning} className="mt-1.5" />
        ) : null}
      </span>
    </button>
  );
}
