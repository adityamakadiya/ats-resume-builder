// @vitest-environment jsdom
//
// Declared in the file rather than by a config glob: vitest 5 removed
// `environmentMatchGlobs`.

/**
 * The panel has to make four things visible that the chip cloud could not:
 * which terms the posting actually insists on, which of those is worth most,
 * where a term should land, and which gaps are not editing problems at all.
 * It has to do that without blurring the one distinction the old panel got
 * right, which is whose claim a term is.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GapAnalysis } from "@ats/core";
import {
  SAMPLE_DOC,
  SAMPLE_FACTS,
  SAMPLE_GAPS,
  SAMPLE_JOB,
  SAMPLE_REPORT,
} from "@/lib/editor/fixtures";
import { suggestionsFor } from "@/lib/editor/gaps";
import { KeywordGapPanel } from "./KeywordGapPanel";

afterEach(cleanup);

function panel(gaps: GapAnalysis | null = SAMPLE_GAPS) {
  const onApply = vi.fn();
  render(
    <KeywordGapPanel
      job={SAMPLE_JOB}
      facts={SAMPLE_FACTS}
      doc={SAMPLE_DOC}
      report={SAMPLE_REPORT}
      gaps={gaps}
      onApply={onApply}
    />,
  );
  return onApply;
}

describe("KeywordGapPanel", () => {
  it("groups by what the posting insists on, required first", () => {
    panel();

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent ?? "");

    expect(headings[0]).toMatch(/Required/);
    expect(headings.some((h) => /Preferred/.test(h))).toBe(true);

    // gRPC is required here and Terraform is not, so gRPC is above it in the
    // document order, which is the order a reader works down.
    const body = document.body.textContent ?? "";
    expect(body.indexOf("gRPC")).toBeLessThan(body.indexOf("Terraform"));
  });

  it("shows what each term is worth, and shows the computed figure", () => {
    panel();

    const grpc = suggestionsFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT, SAMPLE_GAPS)
      .find((s) => s.term === "gRPC");
    if (!grpc || grpc.delta === null) throw new Error("expected a scored gRPC suggestion");

    const row = screen.getByRole("button", { name: /gRPC/ }).closest("li");
    if (!row) throw new Error("expected the chip to sit in a row");

    const worth = within(row).getByLabelText(/^Worth /);
    expect(worth.textContent).toMatch(new RegExp(`\\+${grpc.delta.toFixed(1)} pts`));
    expect(document.body.textContent).toMatch(/computed against this document, not estimated/i);
  });

  it("states how hard the posting leans on a term", () => {
    panel();
    // Terraform is weighted 2 of 5 in the posting; the meter says so to a
    // screen reader as well as to the eye.
    const row = screen.getByRole("button", { name: /Terraform/ }).closest("li");
    if (!row) throw new Error("expected a Terraform row");
    expect(within(row).getByRole("img", { name: /Weighted 2 of 5/i })).toBeTruthy();
  });

  it("keeps green and amber meaning opposite things", () => {
    panel();

    const recoverable = screen.getByRole("button", { name: /gRPC/ });
    const missing = screen.getByRole("button", { name: /Rust/ });

    expect(recoverable.getAttribute("data-kind")).toBe("recoverable");
    expect(missing.getAttribute("data-kind")).toBe("missing");

    expect(recoverable.className).toMatch(/traced/);
    expect(recoverable.className).not.toMatch(/caution/);
    expect(missing.className).toMatch(/caution/);
    expect(missing.className).not.toMatch(/traced/);

    expect(recoverable.getAttribute("title")).toMatch(/already claims this/i);
    expect(missing.getAttribute("title")).toMatch(/only if you can defend it/i);

    // The amber rule is stated in words, not only in colour.
    expect(screen.getByText(/It counts as a hand edit/i)).toBeTruthy();

    // The banned word, and the phrase that replaced it.
    expect(document.body.textContent).not.toMatch(/verified/i);
    expect(document.body.textContent).toMatch(/traced to your resume/i);
  });

  it("offers the line the resume already wrote, beside the skills list", () => {
    const onApply = panel();

    const row = screen.getByRole("button", { name: /Terraform/ }).closest("li");
    if (!row) throw new Error("expected a Terraform row");

    const alternative = within(row).getByRole("button", { name: /skills list/i });
    expect(within(row).getByText(/Lands in a line you already wrote/i)).toBeTruthy();

    expect(onApply).not.toHaveBeenCalled();
    return userEvent.setup()
      .click(alternative)
      .then(() => {
        expect(onApply).toHaveBeenCalledTimes(1);
        const [suggestion, placement] = onApply.mock.calls[0];
        expect(suggestion.term).toBe("Terraform");
        expect(placement.kind).toBe("skills");
      });
  });

  it("applies the best placement when the chip itself is clicked", async () => {
    const onApply = panel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Terraform/ }));

    const [suggestion, placement] = onApply.mock.calls[0];
    expect(suggestion.term).toBe("Terraform");
    expect(placement).toBe(suggestion.placements[0]);
    // Restoring the original bullet outscores appending to a list here, and
    // what it puts back carries the source id it came with.
    expect(placement.kind).toBe("bullet");
    expect(placement.traced).toBe(true);
    expect(placement.ops[0].value.source_ids).toEqual(["E1.B5"]);
  });

  it("never offers a bullet for a term the resume does not state", () => {
    panel();
    const row = screen.getByRole("button", { name: /Rust/ }).closest("li");
    if (!row) throw new Error("expected a Rust row");
    expect(within(row).queryByText(/Lands in a line you already wrote/i)).toBeNull();
    expect(within(row).getByText(/Lands in the skills list/i)).toBeTruthy();
  });

  it("presents a blocking gap as a fact, never as something to click", () => {
    const blocking: GapAnalysis = {
      ...SAMPLE_GAPS,
      missing: [
        { jd_term: "Rust", severity: "blocking", note: "Five years of Rust is the bar." },
      ],
    };
    panel(blocking);

    expect(screen.queryByRole("button", { name: /Rust/ })).toBeNull();

    const heading = screen.getByRole("heading", { name: /Not an editing task/i });
    const block = heading.parentElement;
    if (!block) throw new Error("expected a block around the heading");
    expect(within(block).getByText(/Five years of Rust is the bar/)).toBeTruthy();
    expect(within(block).queryAllByRole("button")).toHaveLength(0);
  });

  it("says nothing at all when there is no posting", () => {
    const { container } = render(
      <KeywordGapPanel
        job={null}
        facts={SAMPLE_FACTS}
        doc={SAMPLE_DOC}
        report={SAMPLE_REPORT}
        gaps={SAMPLE_GAPS}
        onApply={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
