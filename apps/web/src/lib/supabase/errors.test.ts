/**
 * Every one of these codes reached a user as a raw Postgres sentence before
 * this file existed, and each cost a round trip to work out what it meant.
 * The tests assert the translation says what to DO, not what happened.
 */

import { describe, expect, it } from "vitest";
import { describeDbError, isSchemaBehind } from "./errors";

describe("describeDbError", () => {
  it("turns an RLS refusal into the migration that fixes it", () => {
    // The one that matters most. After auth was removed there is no session
    // for a policy to check, so this fires on every write, and the raw text
    // sends the reader hunting for a permissions setting that is not there.
    const d = describeDbError(
      { code: "42501", message: 'new row violates row-level security policy for table "jobs"' },
      "Saving the job"
    );

    expect(d.reason).toContain("row-level security");
    expect(d.remedy).toContain("0009");
    expect(d.remedy).toMatch(/APPLY_ALL|db push/);
    // Not the user's fault and not fixed by retrying: it is the server that
    // is behind, so it is a 503 rather than a 4xx.
    expect(d.status).toBe(503);
  });

  it("distinguishes a missing table from a missing column", () => {
    const table = describeDbError({ code: "42P01" }, "Listing resumes");
    const column = describeDbError({ code: "42703" }, "Saving the extraction");

    expect(table.reason).toContain("table does not exist");
    expect(column.reason).toContain("column");
    // Both are the same cause and both point at the same fix.
    expect(table.remedy).toMatch(/APPLY_ALL|db push/);
    expect(column.remedy).toMatch(/APPLY_ALL|db push/);
  });

  it("does not tell someone to retry what retrying cannot fix", () => {
    const fk = describeDbError({ code: "23503" }, "Creating the resume");

    expect(fk.remedy).not.toMatch(/try again|retry/i);
    expect(fk.remedy).toContain("Start again from the upload");
    expect(fk.status).toBe(422);
  });

  it("falls back to the driver's own message rather than swallowing it", () => {
    const d = describeDbError({ code: "08006", message: "connection failure" }, "Saving");

    expect(d.remedy).toContain("connection failure");
    expect(d.remedy).toContain("safe to try again");
    expect(d.status).toBe(502);
  });

  it("survives a null error without inventing a cause", () => {
    const d = describeDbError(null, "Saving");
    expect(d.reason).toContain("could not be completed");
    expect(d.status).toBe(502);
  });

  it("names the operation it was given, so the message is specific", () => {
    expect(describeDbError({ code: "42501" }, "Storing the file").reason).toContain(
      "Storing the file"
    );
  });
});

describe("isSchemaBehind", () => {
  it.each(["42501", "42P01", "42703"])("%s means a migration has not run", (code) => {
    expect(isSchemaBehind({ code })).toBe(true);
  });

  it.each(["23503", "23505", "08006"])("%s is a real error, not a missing migration", (code) => {
    expect(isSchemaBehind({ code })).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isSchemaBehind(null)).toBe(false);
    expect(isSchemaBehind(undefined)).toBe(false);
  });
});
