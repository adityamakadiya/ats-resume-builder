/** @vitest-environment jsdom */
//
// Declared in the file rather than by a config glob: vitest 5 removed
// `environmentMatchGlobs`. There is no global RTL cleanup either, hence the
// afterEach below.

/**
 * The cut list is a set of delete buttons over somebody's career, so the two
 * things that must be true on screen are that the cheapest one is the one
 * they read first, and that pressing it removes exactly the line shown and
 * nothing else.
 *
 * No score is hardcoded. The costs come from `cutsFor` against the sample
 * run, and the assertions compare rows to each other rather than to numbers.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleRun } from "@/lib/editor/fixtures";
import { cutsFor } from "@/lib/editor/trim";
import { useEditorStore } from "@/lib/store/editor";
import { CutList } from "./CutList";

afterEach(cleanup);

function list() {
  useEditorStore.getState().init(sampleRun("test"));
  const store = useEditorStore.getState();
  const cuts = cutsFor(store.job, store.facts, store.doc, store.report);
  render(<CutList cuts={cuts} onApply={(ops, label) => store.applyUserOps(ops, label, [])} />);
  return cuts;
}

describe("CutList", () => {
  it("renders nothing at all when there is nothing worth cutting", () => {
    const { container } = render(<CutList cuts={[]} onApply={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("puts the cheapest cut at the top, where the reader stops", () => {
    const cuts = list();
    const rows = [...document.querySelectorAll("[data-cut]")];

    expect(rows.length).toBe(cuts.length);
    const costs = rows.map((r) => Number(r.getAttribute("data-cost")));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it("says free in words rather than leaving a zero to be interpreted", () => {
    const cuts = list();
    if (cuts.some((c) => c.cost <= -0.05)) {
      expect(screen.getAllByText(/the score goes up/i).length).toBeGreaterThan(0);
    }
    if (cuts.some((c) => Math.abs(c.cost) < 0.05)) {
      expect(screen.getAllByText(/the score does not move/i).length).toBeGreaterThan(0);
    }
  });

  it("removes the line it showed, and undo puts it back", async () => {
    const user = userEvent.setup();
    const cuts = list();
    const first = cuts[0]!;

    const before = useEditorStore.getState().doc;
    await user.click(screen.getAllByRole("button", { name: /cut it/i })[0]!);

    const after = useEditorStore.getState().doc;
    expect(after).not.toBe(before);
    // The text that was on the row is off the page.
    expect(JSON.stringify(after)).not.toContain(first.text);

    useEditorStore.getState().undo();
    expect(JSON.stringify(useEditorStore.getState().doc)).toContain(first.text);
  });

  it("records a cut as an edit that can be seen in the history", async () => {
    const user = userEvent.setup();
    list();
    await user.click(screen.getAllByRole("button", { name: /cut it/i })[0]!);

    const past = useEditorStore.getState().history.past;
    expect(past[past.length - 1]!.label).toMatch(/^Cut /);
  });
});
