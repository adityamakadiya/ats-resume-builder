// @vitest-environment jsdom
//
// Declared in the file rather than by a config glob: vitest 5 removed
// `environmentMatchGlobs`.

/**
 * The two places the product's honesty is visible as pixels.
 *
 * The chips must not let a term the resume already claims and a term it has
 * never mentioned look like the same offer, and clicking the second one must
 * leave a mark. The badge must report that mark, in the caution colour, with
 * a sentence saying the guard did not check it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleRun } from "@/lib/editor/fixtures";
import { useEditorStore } from "@/lib/store/editor";
import { SuggestionChips } from "./SuggestionChips";
import { TracedBadge } from "./TracedBadge";

afterEach(cleanup);

function chips() {
  useEditorStore.getState().init(sampleRun("test"));
  const store = useEditorStore.getState();
  render(<SuggestionChips report={store.report} doc={store.doc} onAdd={store.addSuggestion} />);
}

describe("SuggestionChips", () => {
  it("separates what is already yours from what you would be asserting", () => {
    chips();

    const recoverable = screen.getByRole("button", { name: /gRPC/ });
    const missing = screen.getByRole("button", { name: /Rust/ });

    expect(recoverable.getAttribute("data-kind")).toBe("recoverable");
    expect(missing.getAttribute("data-kind")).toBe("missing");

    // Different colours, and the class list is what carries them.
    expect(recoverable.className).toMatch(/traced/);
    expect(recoverable.className).not.toMatch(/caution/);
    expect(missing.className).toMatch(/caution/);
    expect(missing.className).not.toMatch(/traced/);

    // Different promises.
    expect(recoverable.getAttribute("title")).toMatch(/already claims this/i);
    expect(missing.getAttribute("title")).toMatch(/only if you can defend it/i);
    expect(screen.getByText(/It counts as a hand edit/i)).toBeTruthy();
  });

  it("counts an amber chip as a hand edit and a green one as free", async () => {
    const user = userEvent.setup();
    chips();

    await user.click(screen.getByRole("button", { name: /gRPC/ }));
    expect(useEditorStore.getState().editedKeys.size).toBe(0);

    await user.click(screen.getByRole("button", { name: /Rust/ }));
    expect(useEditorStore.getState().editedKeys.has("asserted:Rust")).toBe(true);
  });
});

describe("TracedBadge", () => {
  it("changes what it says once a line has been hand-edited", () => {
    const { rerender } = render(
      <TracedBadge traced={12} total={12} editedCount={0} refusedCount={0} />,
    );

    const before = document.body.textContent ?? "";
    expect(before).toMatch(/12 of 12 lines traced to your resume/);
    expect(before).toMatch(/0\s*hand-edited by you/);
    expect(before).not.toMatch(/guard did not check/i);

    rerender(<TracedBadge traced={12} total={12} editedCount={1} refusedCount={0} />);

    const after = document.body.textContent ?? "";
    expect(after).toMatch(/1\s*hand-edited by you/);
    expect(after).toMatch(/The guard did not check that one/);
    expect(after).not.toMatch(/verified/i);
  });

  it("reports refusals without offering a route to a dialog that is gone", () => {
    render(<TracedBadge traced={10} total={12} editedCount={0} refusedCount={2} />);

    // The count still has to be here: it is the number that says the
    // document on screen is shorter than the rewrite wanted it to be.
    // Scoped to its own sentence, because "2" also appears in "10 of 12".
    const note = screen.getByText(/refused, listed above/i);
    expect(note.textContent).toMatch(/\b2\b/);

    /*
      Not a button. This used to open the refusal dialog. The refusals are
      a section higher up the same column now, so a link here would send
      the reader backwards past what they were already shown, and a button
      with no handler would do nothing at all.
    */
    expect(screen.queryByRole("button", { name: /refused/i })).toBeNull();
  });
});
