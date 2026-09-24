/**
 * Which models get a reasoning parameter.
 *
 * The rule is not cosmetic: a model that does not support it answers 400
 * rather than ignoring the field, so getting this wrong takes a whole step
 * of the pipeline offline. The failure is also invisible in review, because
 * the parameter looks harmless on every line it appears.
 */

import { describe, expect, it } from "vitest";
import { supportsReasoning } from "./profiles";

describe("supportsReasoning", () => {
  it.each(["gpt-5", "gpt-5-mini", "gpt-5.3-codex", "o1", "o3-mini", "o4-mini"])(
    "%s takes a reasoning effort",
    (model) => expect(supportsReasoning(model)).toBe(true)
  );

  it.each(["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-3.5-turbo"])(
    "%s does not, and must not be sent one",
    (model) => expect(supportsReasoning(model)).toBe(false)
  );

  it("errs toward omitting the parameter for a model it has never seen", () => {
    // Omitting it costs nothing: a model that could have reasoned and was
    // not asked to still answers. Sending it costs the whole call.
    expect(supportsReasoning("some-future-model")).toBe(false);
  });
});
