/**
 * The conversion from extracted facts to the document the user first sees.
 *
 * This runs before anything has been tailored, which makes it the one place
 * where "the resume on screen is the resume you uploaded" is either true or
 * quietly false. Every test here is about that sentence.
 */

import { describe, expect, it } from "vitest";
import type { ResumeFacts } from "@ats/core";

import { factRows, factsToDocument } from "./ingest";

function facts(overrides: Partial<ResumeFacts> = {}): ResumeFacts {
  return {
    contact: {
      name: "Rohan Iyer",
      email: "rohan@example.com",
      phone: "+91 98765 43210",
      location: "Pune, India",
      links: [{ label: "GitHub", url: "https://github.com/rohaniyer" }],
    },
    headline: "Backend Engineer",
    summary: "Backend engineer with six years on payments.",
    experience: [
      {
        id: "E1",
        company: "Meridian Payments",
        title: "Senior Backend Engineer",
        location: "Pune",
        start_date: "Mar 2023",
        end_date: "Present",
        bullets: [
          { id: "E1.B1", text: "Rebuilt the settlement pipeline around Kafka." },
          { id: "E1.B2", text: "Cut p99 read latency from 840ms to 96ms." },
        ],
        tech: ["Kafka", "PostgreSQL"],
      },
    ],
    projects: [],
    education: [
      { id: "ED1", institution: "COEP", degree: "B.E. Computer", dates: "2015 - 2019", details: "" },
    ],
    skills: [{ id: "S1", category: "Languages", items: ["Go", "TypeScript"] }],
    certifications: [],
    other_sections: [],
    total_years_experience: 6,
    ...overrides,
  } as ResumeFacts;
}

describe("factsToDocument", () => {
  it("copies bullet text through verbatim", () => {
    const doc = factsToDocument(facts());
    const bullets = doc.experience[0]!.bullets.map((b) => b.text);

    // Not "improved", not re-punctuated, not re-cased. The product's whole
    // claim is that it does not change what you said without being asked.
    expect(bullets).toEqual([
      "Rebuilt the settlement pipeline around Kafka.",
      "Cut p99 read latency from 840ms to 96ms.",
    ]);
  });

  it("gives every line the source id that lets it be traced", () => {
    const doc = factsToDocument(facts());

    expect(doc.experience[0]!.bullets[0]!.source_ids).toEqual(["E1.B1"]);
    expect(doc.experience[0]!.bullets[1]!.source_ids).toEqual(["E1.B2"]);
    expect(doc.summary.source_ids).toEqual(["SUMMARY"]);
    expect(doc.skills[0]!.source_ids).toEqual(["S1"]);
  });

  it("carries the contact block, because an unreachable candidate is unhireable", () => {
    const doc = factsToDocument(facts());

    expect(doc.contact.name).toBe("Rohan Iyer");
    expect(doc.contact.email).toBe("rohan@example.com");
    expect(doc.contact.links).toHaveLength(1);
  });

  it("preserves employment details exactly", () => {
    const role = factsToDocument(facts()).experience[0]!;

    expect(role.company).toBe("Meridian Payments");
    expect(role.title).toBe("Senior Backend Engineer");
    expect(role.start_date).toBe("Mar 2023");
    expect(role.end_date).toBe("Present");
  });

  it("orders only the sections that have something in them", () => {
    const doc = factsToDocument(facts());

    expect(doc.section_order).toEqual(["summary", "skills", "experience", "education"]);
    // Projects and certifications are empty, so they do not get a heading.
    expect(doc.section_order).not.toContain("projects");
    expect(doc.section_order).not.toContain("certifications");
  });

  it("survives a resume with almost nothing in it", () => {
    const sparse = factsToDocument(
      facts({
        summary: "",
        headline: "",
        experience: [],
        education: [],
        skills: [],
      })
    );

    expect(sparse.section_order).toEqual([]);
    expect(sparse.summary.source_ids).toEqual([]);
    expect(sparse.experience).toEqual([]);
    expect(sparse.contact.name).toBe("Rohan Iyer");
  });

  it("writes no rewrite notes, because nothing has been rewritten", () => {
    expect(factsToDocument(facts()).rewrite_notes).toEqual([]);
  });
});

describe("factRows", () => {
  it("marks everything as coming from the document", () => {
    const rows = factRows(facts(), "doc-1");
    expect(rows.every((r) => r.origin === "document")).toBe(true);
    expect(rows.every((r) => r.document_id === "doc-1")).toBe(true);
    // No owner is sent: 0009_single_user.sql defaults user_id to
    // app.owner_id(), so a row carrying one would be the application
    // deciding something the database already decided.
    expect(rows.every((r) => !("user_id" in r))).toBe(true);
  });

  it("produces one citable row per fact id", () => {
    const keys = factRows(facts(), "d").map((r) => r.fact_key);

    expect(keys).toContain("SUMMARY");
    expect(keys).toContain("HEADLINE");
    expect(keys).toContain("E1");
    expect(keys).toContain("E1.B1");
    expect(keys).toContain("E1.B2");
    expect(keys).toContain("ED1");
    expect(keys).toContain("S1");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("drops empty text rather than writing a fact that says nothing", () => {
    const rows = factRows(facts({ summary: "", headline: "" }), "d");
    expect(rows.map((r) => r.fact_key)).not.toContain("SUMMARY");
    expect(rows.map((r) => r.fact_key)).not.toContain("HEADLINE");
  });

  it("attaches a role's technologies to its bullets, so the guard can see them", () => {
    const bullet = factRows(facts(), "d").find((r) => r.fact_key === "E1.B1");
    expect(bullet?.entities_json.technologies).toEqual(["Kafka", "PostgreSQL"]);
  });
});
