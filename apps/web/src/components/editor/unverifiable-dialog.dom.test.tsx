// @vitest-environment jsdom
//
// Declared in the file rather than by a config glob: vitest 5 removed
// `environmentMatchGlobs`.

/**
 * The refusal has to read as a refusal.
 *
 * These assertions are about copy as much as markup, because the copy is the
 * feature. The dialog must show the claim that was refused, the source fact it
 * failed against, and both ways out, and it must never tell the user that
 * something broke.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SAMPLE_DOC, SAMPLE_FACTS, SAMPLE_TRUTH } from "@/lib/editor/fixtures";
import { UnverifiableDialog } from "./UnverifiableDialog";

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof UnverifiableDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onDrop = vi.fn();

  render(
    <UnverifiableDialog
      open
      violations={[{ index: 0, violation: SAMPLE_TRUTH.violations[0]! }]}
      doc={SAMPLE_DOC}
      facts={SAMPLE_FACTS}
      onClose={onClose}
      onDrop={onDrop}
      {...overrides}
    />,
  );

  return { onClose, onDrop };
}

describe("UnverifiableDialog", () => {
  it("shows the refused claim, the source fact and the action left on it", () => {
    setup();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    // What the model tried to claim.
    expect(
      screen.getByText(/delivering a tenfold reduction in p99 read latency/i),
    ).toBeTruthy();

    // What the source fact actually says, resolved through the source ids.
    expect(screen.getByText(/dropping p99 read latency from 840ms to 96ms/i)).toBeTruthy();

    // Why it was refused, in words rather than an error code.
    expect(screen.getByText(/We will not invent a figure, or round one up/i)).toBeTruthy();

    // Both ways forward.
    expect(screen.getByRole("button", { name: "Drop it" })).toBeTruthy();
  });

  it("never says the app failed, and never says verified", () => {
    setup();
    const text = screen.getByRole("dialog").textContent ?? "";

    expect(text).toMatch(/Refused, not failed/);
    expect(text).not.toMatch(/\bverified\b/i);
    expect(text).not.toMatch(/something went wrong|try again later/i);
  });

  it("drops by index, and offers no route to a panel that is gone", async () => {
    const user = userEvent.setup();
    const { onDrop } = setup();

    /*
      "Tell me the real number" used to hand a pre-written question to the
      chat panel. The chat is no longer on this screen, so the button was
      removed rather than left pointing nowhere. Asserted, because a dead
      control here would be offered at exactly the moment somebody is
      trying to fix a refusal.
    */
    expect(screen.queryByRole("button", { name: /tell me the real number/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Drop it" }));
    expect(onDrop).toHaveBeenCalledWith(0);
  });

  it("closes on escape", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when there is nothing to refuse", () => {
    const { container } = render(
      <UnverifiableDialog
        open
        violations={[]}
        doc={SAMPLE_DOC}
        facts={SAMPLE_FACTS}
        onClose={() => {}}
        onDrop={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
