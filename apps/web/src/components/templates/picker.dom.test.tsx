// @vitest-environment jsdom
//
// The environment is declared in the file rather than left to a config glob:
// vitest 5 dropped `environmentMatchGlobs`, and a docblock cannot silently
// stop applying when the config is refactored.

/**
 * The two-column warning is a product feature, so it is tested like one.
 *
 * Two assertions that matter beyond "the string is in the DOM":
 *   - it is present without expanding, hovering or selecting anything, so it
 *     cannot regress into a tooltip;
 *   - it is announced, not colour-only, so it survives a screen reader.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { DEFAULT_TEMPLATE_ID, TEMPLATES, templateList } from "@ats/templates";
import { TemplatePicker } from "./picker";

afterEach(cleanup);

const twoColumn = Object.values(TEMPLATES).find((template) => template.columns === 2);

describe("TemplatePicker", () => {
  it("has a two-column template in the registry that carries a warning", () => {
    // If this ever fails the rest of the file is testing nothing.
    expect(twoColumn).toBeDefined();
    expect(twoColumn?.warning).toBeTruthy();
    expect(twoColumn?.atsSafe).toBe(false);
  });

  it("shows the registry warning on the card, with no interaction first", () => {
    render(
      <TemplatePicker templates={templateList()} defaultTemplateId={DEFAULT_TEMPLATE_ID} />
    );

    const card = screen.getByRole("radio", { name: new RegExp(twoColumn!.name) });
    expect(within(card).getByText(twoColumn!.warning!)).toBeTruthy();
  });

  it("marks the warning up as a warning rather than relying on colour", () => {
    render(
      <TemplatePicker templates={templateList()} defaultTemplateId={DEFAULT_TEMPLATE_ID} />
    );

    const card = screen.getByRole("radio", { name: new RegExp(twoColumn!.name) });
    // "Warning: " is visually hidden and read aloud.
    expect(within(card).getByText("Warning:")).toBeTruthy();
  });

  it("repeats the warning in the detail panel once the template is selected", async () => {
    const user = userEvent.setup();
    render(
      <TemplatePicker templates={templateList()} defaultTemplateId={DEFAULT_TEMPLATE_ID} />
    );

    const preview = screen.getByRole("complementary", { name: /template preview/i });
    // The safe default is selected first, so the caution copy is not there yet.
    expect(within(preview).queryByText(twoColumn!.warning!)).toBeNull();

    await user.click(screen.getByRole("radio", { name: new RegExp(twoColumn!.name) }));

    expect(within(preview).getByText(twoColumn!.warning!)).toBeTruthy();
    // And the commit button now names the risky template.
    expect(
      within(preview).getByRole("button", { name: new RegExp(`Use ${twoColumn!.name}`) })
    ).toBeTruthy();
  });

  it("states the parser risk as a word, not only as a colour", async () => {
    const user = userEvent.setup();
    render(
      <TemplatePicker templates={templateList()} defaultTemplateId={DEFAULT_TEMPLATE_ID} />
    );

    const preview = screen.getByRole("complementary", { name: /template preview/i });
    expect(within(preview).getByText("Correct")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: new RegExp(twoColumn!.name) }));
    expect(within(preview).getByText("At risk")).toBeTruthy();
  });

  it("filters to the two-column category and keeps the warning visible there", async () => {
    const user = userEvent.setup();
    render(
      <TemplatePicker templates={templateList()} defaultTemplateId={DEFAULT_TEMPLATE_ID} />
    );

    await user.click(screen.getByRole("button", { name: /two column/i }));

    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText(twoColumn!.warning!)).toBeTruthy();
  });
});
