/**
 * Fixtures.
 *
 * Invented people, for the same reason the backend's sample.py invents one: a
 * real resume checked into a repository is someone's phone number checked into
 * a repository.
 *
 * Three of them, because the failure modes are at the edges. `rich` is the
 * happy path. `sparse` is where empty-field handling either holds or produces
 * a dangling separator and a heading over nothing. `long` is where the density
 * ladder either finds a rung or has to admit it cannot.
 *
 * Everything here is ASCII. No em dashes, no curly quotes, no bullet glyphs in
 * text: markers are drawn by CSS. The render tests enforce it.
 */

import type { ResumeDoc, TailoredBullet } from "./types";

function b(...texts: string[]): TailoredBullet[] {
  return texts.map((text) => ({ text, source_ids: ["E1"], keywords: [] }));
}

/* ------------------------------------------------------------------ rich -- */

/** Senior engineer: several roles, projects, publications, certifications. */
export const rich: ResumeDoc = {
  contact: {
    name: "Rohan Iyer",
    email: "rohan.iyer@example.com",
    phone: "+91 98765 43210",
    location: "Pune, India",
    links: [
      { label: "github.com/rohaniyer", url: "https://github.com/rohaniyer" },
      { label: "linkedin.com/in/rohaniyer", url: "https://linkedin.com/in/rohaniyer" },
    ],
  },
  headline: "Backend Engineer | Distributed Systems | Payments",
  summary: {
    text:
      "Backend engineer with six years building payment and settlement systems on Go and Node.js. " +
      "Took a reconciliation pipeline from nightly batch to near real time, and owns the queue " +
      "infrastructure three product teams depend on.",
    source_ids: ["SUMMARY"],
  },
  skills: [
    { category: "Languages", items: ["Go", "TypeScript", "Python", "SQL"], source_ids: ["S1"] },
    {
      category: "Infrastructure",
      items: ["PostgreSQL", "Redis", "Kafka", "Docker", "Kubernetes", "AWS"],
      source_ids: ["S2"],
    },
    {
      category: "Practices",
      items: ["Distributed tracing", "Load testing", "CI/CD", "Incident response"],
      source_ids: ["S3"],
    },
  ],
  experience: [
    {
      source_id: "E1",
      company: "Meridian Payments",
      title: "Senior Backend Engineer",
      location: "Pune, India",
      start_date: "Mar 2023",
      end_date: "Present",
      bullets: b(
        "Rebuilt the settlement reconciliation pipeline around Kafka, cutting the close-of-day window from six hours to under twenty minutes.",
        "Introduced idempotency keys across the payments API, eliminating the duplicate-charge class of incident entirely.",
        "Profiled and reindexed the ledger database, dropping p99 read latency from 840ms to 96ms under production load.",
        "Mentored three engineers through their first on-call rotation and wrote the runbooks the team still uses.",
      ),
    },
    {
      source_id: "E2",
      company: "Harbourline Logistics",
      title: "Backend Engineer",
      location: "Bengaluru, India",
      start_date: "Jul 2021",
      end_date: "Feb 2023",
      bullets: b(
        "Designed the shipment tracking service handling 40k events per minute, using Redis streams for ordering guarantees.",
        "Migrated eleven services from a shared database to per-service schemas with no customer-visible downtime.",
        "Cut container image sizes by 70 percent and shortened the deploy cycle from eighteen minutes to five.",
      ),
    },
    {
      source_id: "E3",
      company: "Castille Analytics",
      title: "Software Engineer",
      location: "Remote",
      start_date: "Aug 2019",
      end_date: "Jun 2021",
      bullets: b(
        "Built the ingestion layer for a clickstream warehouse taking 2TB a day into partitioned Postgres.",
        "Replaced a hand-rolled scheduler with Airflow, halving the number of failed overnight jobs.",
      ),
    },
  ],
  projects: [
    {
      source_id: "P1",
      name: "Ledgerpeek",
      url: "https://github.com/rohaniyer/ledgerpeek",
      bullets: b(
        "Open-source double-entry ledger inspector, 900 stars, used as teaching material by two fintech bootcamps.",
      ),
    },
    {
      source_id: "P2",
      name: "Queuewatch",
      url: "",
      bullets: b("Kafka consumer lag dashboard that became the on-call first port of call across four teams."),
    },
  ],
  education: [
    {
      source_id: "ED1",
      institution: "College of Engineering, Pune",
      degree: "B.E. in Computer Engineering",
      dates: "2015 - 2019",
    },
  ],
  certifications: [
    { source_id: "C1", text: "AWS Certified Solutions Architect, Associate, 2024" },
    { source_id: "C2", text: "Certified Kubernetes Application Developer, 2022" },
  ],
  other_sections: [
    {
      source_id: "O1",
      heading: "Publications",
      bullets: b(
        "Exactly-once settlement without distributed transactions, PyCon India 2024, invited talk.",
        "Reindexing a live ledger, Meridian Engineering Blog, 2023.",
      ),
    },
  ],
  section_order: ["summary", "skills", "experience", "projects", "education", "certifications"],
  rewrite_notes: [],
};

/* ---------------------------------------------------------------- sparse -- */

/**
 * A fresher. Deliberately full of holes: no summary, no location, no links, no
 * projects, no certifications, no other sections, no dates on the education,
 * and a second role carrying no bullets at all. Everything a template can get
 * wrong by rendering an empty heading or a dangling separator is missing here.
 */
export const sparse: ResumeDoc = {
  contact: {
    name: "Ananya Shah",
    email: "ananya.shah@example.com",
    phone: "",
    location: "",
    links: [],
  },
  headline: "",
  summary: { text: "", source_ids: [] },
  skills: [{ category: "Languages", items: ["Java", "SQL"], source_ids: ["S1"] }],
  experience: [
    {
      source_id: "E1",
      company: "Trellis Software",
      title: "Software Engineering Intern",
      location: "",
      start_date: "Jan 2025",
      end_date: "Jun 2025",
      bullets: b(
        "Added pagination to the internal admin API and wrote the tests that covered it.",
        "Fixed defects in the customer import tool alongside the maintaining engineer.",
      ),
    },
    {
      source_id: "E2",
      company: "Campus Placement Cell",
      title: "Student Volunteer",
      location: "",
      start_date: "",
      end_date: "",
      bullets: [],
    },
  ],
  projects: [],
  education: [
    {
      source_id: "ED1",
      institution: "Gujarat Technological University",
      degree: "B.Tech in Information Technology",
      dates: "",
    },
  ],
  certifications: [],
  other_sections: [],
  section_order: [],
  rewrite_notes: [],
};

/* ------------------------------------------------------------------ long -- */

function role(
  index: number,
  company: string,
  title: string,
  start: string,
  end: string,
): ResumeDoc["experience"][number] {
  return {
    source_id: `E${index}`,
    company,
    title,
    location: "Ahmedabad, India",
    start_date: start,
    end_date: end,
    bullets: b(
      `Owned the ${company} platform services end to end, from schema design through on-call, across a team of six.`,
      "Led the migration off a monolith into eight services, with a strangler proxy and no planned downtime.",
      "Rewrote the batch layer as streaming jobs, taking the reporting delay from one day to four minutes.",
      "Set up contract testing between services, which caught seventeen breaking changes before release.",
      "Ran the quarterly capacity review and cut the compute bill by a third without touching headroom.",
    ),
  };
}

/**
 * Deliberately far too long for one page, so the fit ladder has something real
 * to fail against. Six roles of five bullets, four projects, and a long
 * summary. At rung 4 it still does not fit, which is the case the caller has
 * to surface rather than paper over.
 */
export const long: ResumeDoc = {
  contact: {
    name: "Devanshi Patel",
    email: "devanshi.patel@example.com",
    phone: "+91 90000 11111",
    location: "Ahmedabad, India",
    links: [
      { label: "github.com/devanshipatel", url: "https://github.com/devanshipatel" },
      { label: "linkedin.com/in/devanshipatel", url: "https://linkedin.com/in/devanshipatel" },
      { label: "devanshi.dev", url: "https://devanshi.dev" },
    ],
  },
  headline: "Principal Engineer | Platform | Reliability",
  summary: {
    text:
      "Principal engineer with twelve years across platform, data and reliability work at four companies. " +
      "Has taken three organisations from ad hoc deploys to continuous delivery, run incident review for a " +
      "two hundred engineer department, and spent the last four years on the infrastructure that everything " +
      "else in the business is built on top of. Comfortable being the person who says the migration will " +
      "take two quarters and then makes it take two quarters.",
    source_ids: ["SUMMARY"],
  },
  skills: [
    { category: "Languages", items: ["Go", "Rust", "Python", "TypeScript", "SQL", "Bash"], source_ids: ["S1"] },
    {
      category: "Platform",
      items: ["Kubernetes", "Terraform", "AWS", "GCP", "Envoy", "Kafka", "Temporal"],
      source_ids: ["S2"],
    },
    {
      category: "Data",
      items: ["PostgreSQL", "ClickHouse", "Snowflake", "dbt", "Airflow", "Spark"],
      source_ids: ["S3"],
    },
    {
      category: "Reliability",
      items: ["SLOs", "Incident command", "Chaos testing", "Distributed tracing", "Capacity planning"],
      source_ids: ["S4"],
    },
  ],
  experience: [
    role(1, "Northvale Systems", "Principal Engineer", "Apr 2022", "Present"),
    role(2, "Corveon Health", "Staff Engineer", "Sep 2019", "Mar 2022"),
    role(3, "Braysend Retail", "Senior Engineer", "Feb 2017", "Aug 2019"),
    role(4, "Onwick Media", "Engineer", "Jun 2015", "Jan 2017"),
    role(5, "Pelham Interactive", "Engineer", "Jul 2013", "May 2015"),
    role(6, "Ardley Labs", "Junior Engineer", "Aug 2012", "Jun 2013"),
  ],
  projects: [
    {
      source_id: "P1",
      name: "Driftmap",
      url: "https://github.com/devanshipatel/driftmap",
      bullets: b(
        "Terraform drift detector that opens a pull request with the diff instead of an alert nobody reads.",
        "Adopted by eleven teams internally before it was open sourced.",
      ),
    },
    {
      source_id: "P2",
      name: "Slowhand",
      url: "https://github.com/devanshipatel/slowhand",
      bullets: b("Latency injection proxy used for game days, with a recorded profile per dependency."),
    },
    {
      source_id: "P3",
      name: "Costcut",
      url: "",
      bullets: b("Weekly cloud spend attribution by team, which is how the compute bill argument got settled."),
    },
    {
      source_id: "P4",
      name: "Runbookd",
      url: "",
      bullets: b("Runbooks as executable checklists, wired into the incident channel from the first page."),
    },
  ],
  education: [
    {
      source_id: "ED1",
      institution: "Nirma University",
      degree: "B.Tech in Computer Engineering",
      dates: "2008 - 2012",
    },
    {
      source_id: "ED2",
      institution: "Indian Institute of Science",
      degree: "M.Tech in Computer Science",
      dates: "2012 - 2014",
    },
  ],
  certifications: [
    { source_id: "C1", text: "AWS Certified Solutions Architect, Professional, 2023" },
    { source_id: "C2", text: "Certified Kubernetes Administrator, 2021" },
    { source_id: "C3", text: "Google Cloud Professional Cloud Architect, 2020" },
  ],
  other_sections: [
    {
      source_id: "O1",
      heading: "Talks",
      bullets: b(
        "Two quarters is the honest estimate, SREcon Asia 2024.",
        "Strangling a monolith without a freeze, GopherCon India 2022.",
      ),
    },
    {
      source_id: "O2",
      heading: "Open Source",
      bullets: b(
        "Maintainer of two Terraform providers with combined downloads in the hundreds of thousands.",
        "Regular contributor to the Kubernetes autoscaling special interest group.",
      ),
    },
  ],
  section_order: ["summary", "experience", "skills", "projects", "education", "certifications"],
  rewrite_notes: [],
};

export const FIXTURES = { rich, sparse, long } as const;
export type FixtureName = keyof typeof FIXTURES;
