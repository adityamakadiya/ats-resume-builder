/**
 * The contact block, which went missing from every saved run.
 *
 * `TailoredResume` has no contact field, deliberately: a model rewrites
 * bullets and must never touch a phone number. `resume_versions.doc_json`
 * is read back as a `ResumeDoc`, which does carry one. Writing the first
 * straight into the second dropped the candidate's name, email, phone and
 * links from the stored document on every single tailoring run.
 *
 * Nothing caught it because nothing failed. The store merges the contact
 * back on the client, so the editor was correct for as long as the tab
 * stayed open; the loss appeared only on reload, or in a PDF downloaded
 * after one. This test reads the row that was actually written rather than
 * what the caller was handed back.
 */

import { describe, expect, it } from "vitest";
import type { ServerClient } from "@/lib/supabase/server";
import { persistRun, type PersistInput } from "./persist";

const CONTACT = {
  name: "ADITYA MAKADIYA",
  email: "adityamakadiya01@gmail.com",
  phone: "+91 97379 32872",
  location: "Ahmedabad, India",
  links: [{ label: "github.com/adityamakadiya", url: "https://github.com/adityamakadiya" }],
};

/** Captures the rows written, and succeeds at everything. */
function recordingClient() {
  const rows: Array<{ table: string; row: Record<string, unknown> }> = [];
  let n = 0;

  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          rows.push({ table, row });
          return {
            select: () => ({
              single: async () => ({ data: { id: `id-${++n}` }, error: null }),
            }),
          };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
        upsert: async () => ({ error: null }),
      };
    },
  };

  return { client: client as unknown as ServerClient, rows };
}

function input(overrides: Partial<PersistInput> = {}): PersistInput {
  const { client } = recordingClient();
  return {
    supabase: client,
    jdText: "Senior Backend Engineer",
    sourceNote: "pasted",
    job: { title: "Senior Backend Engineer", company: "Razorpay", keywords: [] } as never,
    gaps: {} as never,
    tailored: {
      headline: "Software Engineer, Backend Platform",
      summary: { text: "Ships payment integrations.", source_ids: [] },
      skills: [],
      experience: [],
      projects: [],
      education: [],
      certifications: [],
      other_sections: [],
      section_order: [],
      rewrite_notes: [],
    } as never,
    contact: CONTACT,
    truth: { passed: true, error_count: 0, warning_count: 0, violations: [] },
    report: { overall: 23, sub_scores: {}, matched_keywords: [] } as never,
    ...overrides,
  };
}

function versionDoc(rows: Array<{ table: string; row: Record<string, unknown> }>) {
  const version = rows.find((r) => r.table === "resume_versions");
  if (!version) throw new Error("no resume_versions row was written at all");
  return version.row.doc_json as Record<string, unknown>;
}

describe("persistRun writes a document somebody could send to an employer", () => {
  it("stores the contact block the tailored resume does not carry", async () => {
    const { client, rows } = recordingClient();
    const result = await persistRun(input({ supabase: client, resumeId: "r1" }));

    expect(result.persisted).toBe(true);
    // The row, not the return value: the return value never had this bug.
    expect(versionDoc(rows).contact).toEqual(CONTACT);
  });

  it("keeps the rewritten content alongside it", async () => {
    const { client, rows } = recordingClient();
    await persistRun(input({ supabase: client, resumeId: "r1" }));

    const doc = versionDoc(rows);
    expect(doc.headline).toBe("Software Engineer, Backend Platform");
    expect(doc.summary).toEqual({ text: "Ships payment integrations.", source_ids: [] });
  });

  it("does not let a rewrite overwrite the contact details", async () => {
    const { client, rows } = recordingClient();
    // A tailored resume that has somehow grown a contact of its own. The
    // extracted one is the only one with any authority.
    const forged = { ...input().tailored, contact: { name: "SOMEONE ELSE" } };
    await persistRun(input({ supabase: client, resumeId: "r1", tailored: forged as never }));

    expect((versionDoc(rows).contact as { name: string }).name).toBe("ADITYA MAKADIYA");
  });
});
