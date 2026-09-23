// @vitest-environment jsdom
//
// The environment is declared in the file rather than left to a config glob:
// vitest 5 dropped `environmentMatchGlobs`, and a docblock cannot silently
// stop applying when the config is refactored.

/**
 * The empty state has one job: tell a first-time user what to do next.
 * So the test checks that it does, rather than that it renders.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResumesEmptyState } from "./empty-state";

afterEach(cleanup);

describe("ResumesEmptyState", () => {
  it("renders a heading and the three steps that follow", () => {
    render(<ResumesEmptyState />);

    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toMatch(/upload the resume you already have/i);
  });

  it("offers both a primary action and the alternative path", () => {
    render(<ResumesEmptyState />);

    const upload = screen.getByRole("link", { name: /upload your resume/i });
    expect(upload.getAttribute("href")).toBe("/start");

    const blank = screen.getByRole("link", { name: /blank template/i });
    expect(blank.getAttribute("href")).toBe("/start/template");
  });

  it("says the score is computed rather than estimated", () => {
    render(<ResumesEmptyState />);
    expect(screen.getByText(/computed by formula/i)).toBeTruthy();
  });

  it("never claims a line is verified", () => {
    const { container } = render(<ResumesEmptyState />);
    expect(container.textContent?.toLowerCase()).not.toContain("verified");
    expect(container.textContent?.toLowerCase()).toContain("traced");
  });
});
