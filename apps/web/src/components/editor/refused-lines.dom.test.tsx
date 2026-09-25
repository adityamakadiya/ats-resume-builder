/** @vitest-environment jsdom */

/**
 * The modal this replaced was correct and unreadable, which for the feature
 * that is this product's whole argument is the same as being wrong. These
 * tests are about legibility rather than markup: a long claim gets cut, the
 * reason is one sentence, and the strikethrough that turned a six-line
 * paragraph into texture is gone.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TruthViolation } from "@ats/core";
import { RefusedLines } from "./RefusedLines";

const LONG =
  "Software Engineer in a product team building production web applications with " +
  "Next.js, React, TypeScript, Node.js, and Express.js. Builds end-to-end features " +
  "across Tailwind CSS interfaces, REST APIs, JSON Web Token authentication flows, " +
  "and Prisma-based relational data models.";

function violation(over: Partial<TruthViolation> = {}) {
  return {
    index: 0,
    violation: {
      code: "UNSUPPORTED_CLAIM",
      severity: "error",
      location: "Experience / Bacancy Technology / bullet 9",
      detail: "detail text",
      offending: "as features scaled",
      ...over,
    } as TruthViolation,
  };
}

// No global cleanup in this project's vitest setup, so the DOM accumulates
// across cases in a file and every getBy finds two of everything.
afterEach(cleanup);

describe("RefusedLines", () => {
  it("renders nothing when nothing was refused", () => {
    const { container } = render(<RefusedLines violations={[]} onDrop={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the refused claim and a reason a person can act on", () => {
    render(<RefusedLines violations={[violation()]} onDrop={() => {}} />);

    expect(screen.getByText(/as features scaled/)).toBeTruthy();
    expect(screen.getByText(/goes further than your resume does/i)).toBeTruthy();
  });

  it("cuts a long claim instead of printing the whole paragraph", () => {
    render(<RefusedLines violations={[violation({ offending: LONG })]} onDrop={() => {}} />);

    // The modal printed all of this, struck through, in a narrow column.
    const head = document.querySelector("[data-refused-head]")!;
    expect(head.textContent!.length).toBeLessThan(LONG.length);
    expect(head.textContent).toContain("…");
  });

  it("keeps the rest of a long claim reachable rather than dropping it", async () => {
    render(<RefusedLines violations={[violation({ offending: LONG })]} onDrop={() => {}} />);
    expect(screen.getByText(/full text/i)).toBeTruthy();
  });

  it("does not strike the text through", () => {
    const { container } = render(
      <RefusedLines violations={[violation({ offending: LONG })]} onDrop={() => {}} />,
    );
    // line-through on a paragraph is a texture, not a signal, and these are
    // already under a heading that says they were removed.
    expect(container.querySelector(".line-through")).toBeNull();
    expect(container.querySelector("s, del")).toBeNull();
  });

  it("shortens the location to the part that locates anything", () => {
    render(<RefusedLines violations={[violation()]} onDrop={() => {}} />);
    // "Experience / Bacancy Technology / bullet 9" -> the section name is
    // already obvious from the resume; the company and the bullet are not.
    expect(screen.getByText(/Bacancy Technology, bullet 9/)).toBeTruthy();
  });

  it("dismisses by the index it was given, not its position on screen", async () => {
    const onDrop = vi.fn();
    const user = userEvent.setup();
    render(
      <RefusedLines
        violations={[violation({ offending: "first" }), { ...violation({ offending: "second" }), index: 4 }]}
        onDrop={onDrop}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /dismiss/i })[1]!);
    expect(onDrop).toHaveBeenCalledWith(4);
  });
});
