/**
 * The template catalogue.
 *
 * Every entry says what it costs as well as what it looks like. A two-column
 * resume is genuinely handsome and genuinely riskier, and a picker that shows
 * only the first half of that sentence is selling the candidate a rejection
 * they will never be told about.
 */

import { Compact } from "./templates/Compact";
import { Modern } from "./templates/Modern";
import { Standard } from "./templates/Standard";
import type { TemplateMeta } from "./types";

export const TEMPLATES: Record<string, TemplateMeta> = {
  standard: {
    id: "standard",
    name: "Standard",
    blurb: "Clean single column. The safest choice for any parser.",
    categories: ["ats", "simple"],
    columns: 1,
    atsSafe: true,
    component: Standard,
  },
  compact: {
    id: "compact",
    name: "Compact",
    blurb: "Single column, tighter. Fits more on one page.",
    categories: ["ats", "simple"],
    columns: 1,
    atsSafe: true,
    component: Compact,
  },
  modern: {
    id: "modern",
    name: "Modern",
    blurb: "Two columns with a sidebar for contact and skills.",
    categories: ["two-column"],
    columns: 2,
    atsSafe: false,
    component: Modern,
    warning:
      "Two columns look sharp, but many parsers read them out of order. We read them correctly. The employer's ATS may not.",
  },
};

export const DEFAULT_TEMPLATE_ID = "standard";

export function getTemplate(id: string | undefined | null): TemplateMeta {
  const found = id ? TEMPLATES[id] : undefined;
  return found ?? (TEMPLATES[DEFAULT_TEMPLATE_ID] as TemplateMeta);
}

export function templateList(): TemplateMeta[] {
  return Object.values(TEMPLATES);
}
