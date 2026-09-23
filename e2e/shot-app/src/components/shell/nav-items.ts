import type { LucideIcon } from "lucide-react";
import {
  FileText,
  Gauge,
  Mail,
  MessagesSquare,
  Route,
  Target,
} from "lucide-react";

/**
 * The navigation, including the parts that do not exist yet.
 *
 * Phase 2 items are shown rather than hidden, disabled rather than dead, and
 * each one carries the reason in a tooltip. Hiding them would make the
 * product look smaller than it is; linking them would make it look finished
 * when it is not. A greyed row with an honest sentence is the only version of
 * this that is true on both counts.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Present means disabled, and this is the sentence shown on hover/focus. */
  unavailable?: string;
};

export const PRIMARY_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Gauge },
  { label: "My Resumes", href: "/resumes", icon: FileText },
];

export const PHASE_TWO_NAV: NavItem[] = [
  {
    label: "Applications",
    href: "/applications",
    icon: Route,
    unavailable: "Tracking where each tailored resume was sent. Phase 2.",
  },
  {
    label: "Cover letters",
    href: "/cover-letters",
    icon: Mail,
    unavailable:
      "Cover letters drawn from the same traced facts. Phase 2, because a letter that invents is worse than no letter.",
  },
  {
    label: "Interview prep",
    href: "/interview",
    icon: MessagesSquare,
    unavailable: "Questions generated from the gap analysis. Phase 2.",
  },
  {
    label: "Skill gaps",
    href: "/gaps",
    icon: Target,
    unavailable:
      "The standing view of what postings ask for that you cannot yet evidence. Phase 2.",
  },
];
