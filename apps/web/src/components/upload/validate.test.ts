/**
 * Validation tests.
 *
 * These assert the *message*, not just the rejection. A validator that
 * refuses a 20MB file without saying so is only half the feature, and the
 * half that is missing is the half the user needs.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_BYTES,
  formatBytes,
  validateDrop,
  validateResumeFile,
} from "./validate";

/** A File of a given size without allocating that many bytes. */
function fakeFile(name: string, size: number, type = ""): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateResumeFile", () => {
  it("rejects a 20MB PDF and says how big it is and what the limit is", () => {
    const result = validateResumeFile(
      fakeFile("cv.pdf", 20 * 1024 * 1024, "application/pdf")
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("too-large");
    expect(result.reason).toContain("cv.pdf");
    expect(result.reason).toContain("20 MB");
    expect(result.reason).toContain("10 MB");
    // Says what to do about it, not only what went wrong.
    expect(result.remedy).toMatch(/re-export|compress/i);
  });

  it("rejects a .txt file, naming the format it got and the ones it takes", () => {
    const result = validateResumeFile(
      fakeFile("resume.txt", 4_000, "text/plain")
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("wrong-type");
    expect(result.reason).toContain("resume.txt");
    expect(result.reason).toContain("TXT");
    expect(result.reason).toMatch(/PDF or DOCX/);
    expect(result.remedy).toContain("PDF");
    // Plain text gets its own explanation of why it is not enough.
    expect(result.remedy).toMatch(/layout/i);
  });

  it("accepts a normal PDF", () => {
    const result = validateResumeFile(
      fakeFile("rohan-iyer.pdf", 240_000, "application/pdf")
    );
    expect(result).toMatchObject({ ok: true, kind: "pdf" });
  });

  it("accepts a DOCX whose browser-reported MIME type is blank", () => {
    // Safari has been known to send "" for .docx. Rejecting on that would
    // reject real resumes, so the extension is what decides.
    const result = validateResumeFile(fakeFile("cv.docx", 90_000, ""));
    expect(result).toMatchObject({ ok: true, kind: "docx" });
  });

  it("rejects a file at zero bytes separately from a file that is too big", () => {
    const result = validateResumeFile(fakeFile("cv.pdf", 0, "application/pdf"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("empty");
  });

  it("accepts a file exactly on the limit", () => {
    const result = validateResumeFile(
      fakeFile("cv.pdf", MAX_BYTES, "application/pdf")
    );
    expect(result.ok).toBe(true);
  });

  it("points a .doc at Save As rather than just refusing", () => {
    const result = validateResumeFile(fakeFile("old.doc", 50_000));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.remedy).toContain(".docx");
  });
});

describe("validateDrop", () => {
  it("refuses a multi-file drop and says why", () => {
    const result = validateDrop([
      fakeFile("a.pdf", 1000, "application/pdf"),
      fakeFile("b.pdf", 1000, "application/pdf"),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("2 files");
    expect(result.remedy).toMatch(/just the resume/i);
  });

  it("handles an empty drop", () => {
    const result = validateDrop([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("empty");
  });
});

describe("formatBytes", () => {
  it("keeps one decimal under 10MB and drops it above", () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(512)).toBe("512 B");
  });
});
