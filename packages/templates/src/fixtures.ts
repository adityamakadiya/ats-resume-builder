/**
 * Fixtures.
 *
 * Invented people, for the same reason the backend's sample.py invents one: a
 * real resume checked into a repository is someone's phone number checked into
 * a repository.
 *
 * Five of them, because the failure modes are at the edges. `rich` is the
 * happy path. `sparse` is where empty-field handling either holds or produces
 * a dangling separator and a heading over nothing. `long` is where the density
 * ladder either finds a rung or has to admit it cannot.
 *
 * `twopage` and `threepage` are newer and answer a different question: what
 * the page turn looks like. The first three are all either one page or
 * unfittable, so no template's page breaks had ever been measured, and
 * Standard was shipping a resume with SKILLS stranded at the foot of page two
 * carrying one of its four groups. These two are sized so that every template
 * prints the number of sheets the name promises and fills the last one, which
 * is what makes the break-quality assertions in
 * e2e/tier3/rendered-html.spec.ts and backend/tests/test_template_pdf.py
 * mean something. Retune them rather than the thresholds.
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

/* --------------------------------------------------------------- twopage -- */

/**
 * A senior candidate whose resume is genuinely two pages, and fills both.
 *
 * `rich`, `sparse` and `long` were chosen for what happens inside one page,
 * or for what happens when nothing fits. None of them says anything about the
 * one thing a reader notices first in a printed resume, which is where the
 * page turns. Until these two fixtures existed, no template had ever had a
 * page break looked at: e2e/tier3 asserted against the A4 box on single page
 * output, and backend/tests/test_template_pdf.py asserted that page two was
 * not blank. A section heading stranded at the foot of page two with one line
 * of its section under it passed both.
 *
 * Length is tuned, not arbitrary. Standard is the loosest of the three
 * templates, so the content is sized to fill roughly nine tenths of Standard's
 * second page; Compact and Modern fit about a third more per page, so the same
 * document lands on two pages there with a thinner but not embarrassing
 * second. The break-quality suite asserts that last page is not nearly empty,
 * and that assertion is only meaningful because this fixture was measured
 * rather than guessed. If a font or a metric changes and these drift, retune
 * the fixture; do not relax the threshold.
 */
export const twopage: ResumeDoc = {
  contact: {
    name: "Nikhil Desai",
    email: "nikhil.desai@example.com",
    phone: "+91 98200 44556",
    location: "Bengaluru, India",
    links: [
      { label: "github.com/nikhildesai", url: "https://github.com/nikhildesai" },
      { label: "linkedin.com/in/nikhildesai", url: "https://linkedin.com/in/nikhildesai" },
    ],
  },
  headline: "Staff Platform Engineer | Developer Experience | Observability",
  summary: {
    text:
      "Staff engineer with nine years on the systems other engineers build against. Owns the build, " +
      "deploy and observability path at a five hundred person company, and has taken the median time " +
      "from merge to production from two days to nineteen minutes. Prefers to fix the thing that keeps " +
      "producing incidents rather than the incident.",
    source_ids: ["SUMMARY"],
  },
  skills: [
    { category: "Languages", items: ["Go", "Python", "TypeScript", "Bash", "SQL"], source_ids: ["S1"] },
    {
      category: "Platform",
      items: ["Kubernetes", "Argo CD", "Terraform", "AWS", "Bazel", "GitHub Actions"],
      source_ids: ["S2"],
    },
    {
      category: "Observability",
      items: ["OpenTelemetry", "Prometheus", "Grafana", "Loki", "Honeycomb"],
      source_ids: ["S3"],
    },
    {
      category: "Practices",
      items: ["SLOs", "Progressive delivery", "Incident review", "Capacity planning"],
      source_ids: ["S4"],
    },
  ],
  experience: [
    {
      source_id: "E1",
      company: "Pallavi Retail Group",
      title: "Staff Platform Engineer",
      location: "Bengaluru, India",
      start_date: "Jan 2022",
      end_date: "Present",
      bullets: b(
        "Replaced a hand-maintained Jenkins estate with Argo CD and per-service pipelines, taking median merge to production from two days to nineteen minutes.",
        "Instrumented forty services with OpenTelemetry and retired three overlapping metrics stacks, cutting the observability bill by 44 percent.",
        "Wrote the SLO framework the whole engineering organisation now reviews monthly, including the error budget policy that stops feature work.",
        "Ran incident review for eighteen months and closed out the top five repeat causes, which halved Sev-1 count year on year.",
        "Built the developer portal that answers who owns this service, a question that previously took a Slack thread and an afternoon.",
      ),
    },
    {
      source_id: "E2",
      company: "Trailhead Mobility",
      title: "Senior Infrastructure Engineer",
      location: "Bengaluru, India",
      start_date: "Mar 2019",
      end_date: "Dec 2021",
      bullets: b(
        "Migrated the fleet telemetry platform from self-managed Kafka to a managed cluster with no loss of ordering guarantees and no downtime window.",
        "Cut the cost of the staging environment by 62 percent by making it ephemeral, spun up per pull request and destroyed on merge.",
        "Introduced Terraform modules with policy checks, which ended the practice of clicking production changes into the console.",
        "Led the response to a twelve hour regional outage and wrote the postmortem that changed the multi-region strategy.",
      ),
    },
    {
      source_id: "E3",
      company: "Sarovar Analytics",
      title: "Backend Engineer",
      location: "Pune, India",
      start_date: "Jun 2016",
      end_date: "Feb 2019",
      bullets: b(
        "Built the query scheduling service behind a customer-facing reporting product used by three hundred accounts.",
        "Reduced p95 report generation from 41 seconds to 6 by caching intermediate aggregates and reworking the join order.",
        "Took the service through its first SOC 2 audit, including audit logging and key rotation.",
        "Owned the on-call rotation for the reporting stack and wrote the first runbooks the team had.",
      ),
    },
    {
      source_id: "E4",
      company: "Kalpataru Web Services",
      title: "Software Engineer",
      location: "Pune, India",
      start_date: "Jul 2014",
      end_date: "May 2016",
      bullets: b(
        "Built and maintained the billing integration against three payment providers, including the retry and reconciliation logic.",
        "Moved the deployment from hand-copied artefacts to a versioned pipeline, which ended the practice of patching servers individually.",
        "Added integration tests around the checkout flow after an outage that a unit test could not have caught.",
      ),
    },
  ],
  projects: [
    {
      source_id: "P1",
      name: "Traceroute-otel",
      url: "https://github.com/nikhildesai/traceroute-otel",
      bullets: b(
        "OpenTelemetry collector processor that attaches network path data to spans, which is how we found a noisy availability zone.",
      ),
    },
    {
      source_id: "P2",
      name: "Budgetd",
      url: "",
      bullets: b(
        "Error budget calculator that posts to the team channel on Monday rather than waiting for someone to open a dashboard.",
      ),
    },
  ],
  education: [
    {
      source_id: "ED1",
      institution: "Veermata Jijabai Technological Institute",
      degree: "B.Tech in Computer Engineering",
      dates: "2012 - 2016",
    },
  ],
  certifications: [
    { source_id: "C1", text: "Certified Kubernetes Administrator, 2023" },
    { source_id: "C2", text: "AWS Certified DevOps Engineer, Professional, 2022" },
  ],
  other_sections: [
    {
      source_id: "O1",
      heading: "Talks",
      bullets: b(
        "Error budgets that people actually honour, IndiaSRE 2024.",
        "Ephemeral staging, and what it costs you elsewhere, KubeCon India 2023.",
      ),
    },
  ],
  section_order: ["summary", "experience", "skills", "projects", "education", "certifications"],
  rewrite_notes: [],
};

/* ------------------------------------------------------------- threepage -- */

/**
 * The same idea one page further on, and the case the page-break rules were
 * written against.
 *
 * The defect that started all of this was found on `long` in Standard: SKILLS
 * at the foot of page two with "Languages" under it and the other three
 * groups overleaf. `long` is not a good regression test for it, because `long`
 * exists to be unfittable and its content is six copies of one generated role.
 * This one is a real career with a real shape, so a break lands somewhere
 * different in each template and the rules get exercised at three different
 * places rather than one.
 *
 * Three pages in all three templates, and two page turns each, which is what
 * makes it the fixture most of the break-quality assertions actually bite on.
 * Tuned the same way and for the same reason as `twopage`.
 */
export const threepage: ResumeDoc = {
  contact: {
    name: "Anjali Ramanathan",
    email: "anjali.ramanathan@example.com",
    phone: "+91 99400 87654",
    location: "Chennai, India",
    links: [
      { label: "github.com/anjalir", url: "https://github.com/anjalir" },
      { label: "linkedin.com/in/anjalir", url: "https://linkedin.com/in/anjalir" },
      { label: "anjali.engineering", url: "https://anjali.engineering" },
    ],
  },
  headline: "Principal Engineer | Data Platform | Streaming",
  summary: {
    text:
      "Principal engineer with fourteen years on data platforms, the last six of them owning the " +
      "streaming and warehouse layer that every analytical product in the business reads from. Has " +
      "run two platform migrations to completion without a freeze, sat on the architecture review " +
      "board for four years, and spends about a third of her time making other teams' designs " +
      "smaller. Writes the document before the code, and keeps the document current afterwards.",
    source_ids: ["SUMMARY"],
  },
  skills: [
    { category: "Languages", items: ["Scala", "Java", "Python", "Go", "SQL"], source_ids: ["S1"] },
    {
      category: "Streaming",
      items: ["Kafka", "Flink", "Debezium", "Pulsar", "Schema Registry"],
      source_ids: ["S2"],
    },
    {
      category: "Warehouse",
      items: ["Snowflake", "BigQuery", "ClickHouse", "dbt", "Iceberg", "Trino"],
      source_ids: ["S3"],
    },
    {
      category: "Platform",
      items: ["Kubernetes", "Terraform", "AWS", "GCP", "Airflow", "Dagster"],
      source_ids: ["S4"],
    },
    {
      category: "Governance",
      items: ["Data contracts", "Lineage", "PII classification", "Retention policy"],
      source_ids: ["S5"],
    },
  ],
  experience: [
    {
      source_id: "E1",
      company: "Kaveri Financial",
      title: "Principal Engineer, Data Platform",
      location: "Chennai, India",
      start_date: "Aug 2020",
      end_date: "Present",
      bullets: b(
        "Owns the streaming platform that carries every transaction event in the business, about nine billion a month, with a published availability objective the platform has met for eleven consecutive quarters.",
        "Moved the warehouse from nightly batch to change data capture on Debezium and Flink, taking the freshness of the regulatory reporting tables from eighteen hours to under four minutes.",
        "Introduced data contracts between producing services and the platform, which turned a class of silent downstream breakage into a failing build in the producing team's repository.",
        "Led the Iceberg migration across two hundred tables and forty thousand daily queries, with a dual-write period and a rollback plan that was never needed.",
        "Chairs the architecture review board, where the main contribution has been persuading teams to build less.",
        "Runs the platform's quarterly capacity review, which has kept the streaming cluster inside budget through three years of growth.",
      ),
    },
    {
      source_id: "E2",
      company: "Ellora Health Systems",
      title: "Staff Data Engineer",
      location: "Hyderabad, India",
      start_date: "Feb 2017",
      end_date: "Jul 2020",
      bullets: b(
        "Built the clinical events pipeline that fed the readmission risk model, including the PII classification and retention policy that let it pass its first regulatory audit.",
        "Replaced a nightly Sqoop job with incremental CDC, cutting the ingestion window from six hours to eleven minutes and removing the source database lock that came with it.",
        "Rewrote the aggregation layer in Flink, dropping the cost of the pipeline by a third while doubling the events it handled.",
        "Wrote the on-call guide for the pipeline, which cut the median time to first useful action on a page from twenty minutes to five.",
        "Set up the lineage graph that answers which report breaks if this column changes, which is the question every schema change used to start with.",
        "Mentored four engineers onto the platform team, two of whom now own pipelines end to end.",
      ),
    },
    {
      source_id: "E3",
      company: "Meghdoot Commerce",
      title: "Senior Data Engineer",
      location: "Bengaluru, India",
      start_date: "Apr 2014",
      end_date: "Jan 2017",
      bullets: b(
        "Designed the clickstream warehouse taking three terabytes a day, partitioned so that the common queries never touched more than one day of it.",
        "Built the experimentation pipeline that made A/B results available the same day rather than the following week.",
        "Migrated reporting from a shared MySQL replica to Redshift, retiring eleven years of accumulated views in the process.",
        "Wrote the cost model that made the warehouse spend legible to finance, and then made it go down.",
      ),
    },
    {
      source_id: "E4",
      company: "Chandan Media Networks",
      title: "Data Engineer",
      location: "Mumbai, India",
      start_date: "Jul 2011",
      end_date: "Mar 2014",
      bullets: b(
        "Built the ad delivery reporting pipeline on Hadoop, then rebuilt it on Spark when the batch window stopped fitting in the night.",
        "Automated the monthly reconciliation that two analysts had been doing by hand for three days each month.",
        "Wrote the data quality checks that stopped bad campaign data reaching the client-facing dashboard.",
        "Took the reporting pipeline through two acquisitions, absorbing both companies' schemas without a reporting gap.",
      ),
    },
    {
      source_id: "E5",
      company: "Dhruva Interactive Labs",
      title: "Software Engineer",
      location: "Pune, India",
      start_date: "Sep 2009",
      end_date: "Jun 2011",
      bullets: b(
        "Built the telemetry ingestion service for a mobile games portfolio, sized for launch spikes of forty times normal traffic.",
        "Replaced a nightly CSV export to the publisher with an API they could poll, which removed a standing source of disputes.",
        "Added indexing and query rewrites that took the daily player retention report from ninety minutes to four.",
        "Wrote the schema migration tooling that the whole backend team then used for the next three years.",
        "Sat with the live operations team every launch week, which is where most of what I know about capacity came from.",
      ),
    },
    {
      source_id: "E6",
      company: "Sahyadri Software Services",
      title: "Junior Engineer",
      location: "Pune, India",
      start_date: "Aug 2008",
      end_date: "Aug 2009",
      bullets: b(
        "Maintained the ETL jobs behind a logistics client's operational reporting, on a codebase older than the team.",
        "Documented the undocumented half of that pipeline, which is how the handover to the client's own team became possible.",
        "Built the regression test harness that caught the first defect it was pointed at.",
        "Rewrote the overnight reconciliation report after the client changed billing systems mid-contract.",
      ),
    },
  ],
  projects: [
    {
      source_id: "P1",
      name: "Contractd",
      url: "https://github.com/anjalir/contractd",
      bullets: b(
        "Data contract linter that runs in the producing service's pipeline and fails the build on an incompatible schema change.",
        "Used by nineteen teams internally and open sourced after the second external request for it.",
      ),
    },
    {
      source_id: "P2",
      name: "Lagwatch",
      url: "https://github.com/anjalir/lagwatch",
      bullets: b(
        "Consumer lag alerting that understands the difference between a slow consumer and a stopped one.",
      ),
    },
    {
      source_id: "P3",
      name: "Freshness",
      url: "",
      bullets: b(
        "Table freshness dashboard that publishes the number the data consumers actually care about, rather than job success.",
        "Wired into the incident channel, so a stale table pages the owning team rather than surprising an analyst.",
      ),
    },
  ],
  education: [
    {
      source_id: "ED1",
      institution: "Anna University",
      degree: "B.E. in Computer Science and Engineering",
      dates: "2007 - 2011",
    },
    {
      source_id: "ED2",
      institution: "Indian Institute of Technology Madras",
      degree: "M.Tech in Data Science",
      dates: "2015 - 2017",
    },
  ],
  certifications: [
    { source_id: "C1", text: "Google Cloud Professional Data Engineer, 2023" },
    { source_id: "C2", text: "Confluent Certified Developer for Apache Kafka, 2021" },
    { source_id: "C3", text: "AWS Certified Solutions Architect, Associate, 2019" },
    { source_id: "C4", text: "Databricks Certified Data Engineer, Professional, 2022" },
  ],
  other_sections: [
    {
      source_id: "O1",
      heading: "Talks",
      bullets: b(
        "Data contracts, and why the producer has to feel the pain, Kafka Summit India 2024.",
        "Four minutes instead of eighteen hours, and what it cost, Flink Forward 2023.",
      ),
    },
  ],
  section_order: ["summary", "experience", "skills", "projects", "education", "certifications"],
  rewrite_notes: [],
};

export const FIXTURES = { rich, sparse, long, twopage, threepage } as const;
export type FixtureName = keyof typeof FIXTURES;
