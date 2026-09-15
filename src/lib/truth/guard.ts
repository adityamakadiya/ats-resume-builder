import type {
  ResumeFacts,
  TailoredResume,
  TruthReport,
  TruthViolation,
} from "@/lib/schemas";

/**
 * The truth guard runs after the model rewrites the resume and before anything
 * is rendered. It is deliberately deterministic: the model is asked to be
 * truthful, but the guard is what actually enforces it.
 *
 * Three classes of fabrication are what matter in practice:
 *   1. A line with no traceable origin in the uploaded resume.
 *   2. A metric that did not exist before the rewrite ("reduced latency 40%").
 *   3. A technology the candidate never claimed ("added Kubernetes").
 * Employer facts (company, title, dates) are checked for tampering too, since
 * those are the fields a recruiter verifies first.
 */

/** Technologies common enough that seeing one appear from nowhere is a red flag. */
const TECH_VOCABULARY = [
  // languages
  "javascript","typescript","python","java","go","golang","rust","ruby","php","c#","c++","kotlin","swift","scala","elixir","perl","r","dart","solidity",
  // frontend
  "react","angular","vue","svelte","next.js","nextjs","nuxt","remix","redux","zustand","tailwind","bootstrap","jquery","webpack","vite","astro",
  // backend
  "node.js","nodejs","express","nestjs","fastify","django","flask","fastapi","spring","spring boot","rails","laravel","gin","fiber","asp.net",
  // data
  "postgresql","postgres","mysql","mariadb","sqlite","mongodb","redis","elasticsearch","opensearch","cassandra","dynamodb","neo4j","clickhouse","snowflake","bigquery","redshift","supabase","firebase","prisma","typeorm","sequelize","drizzle","sqlalchemy","hibernate",
  // cloud / devops
  "aws","azure","gcp","google cloud","kubernetes","docker","terraform","ansible","jenkins","github actions","gitlab ci","circleci","argocd","helm","ec2","s3","lambda","ecs","eks","fargate","cloudfront","rds","sqs","sns","vercel","netlify","heroku","cloudflare","nginx","apache",
  // messaging / streaming
  "kafka","rabbitmq","celery","bullmq","sidekiq","nats","pulsar","airflow","temporal",
  // observability
  "prometheus","grafana","datadog","sentry","opentelemetry","new relic","splunk","kibana","jaeger",
  // api / protocol
  "graphql","grpc","rest","restful","websocket","websockets","soap","openapi","swagger","trpc","protobuf",
  // auth / security
  "oauth","oauth2","oidc","jwt","saml","keycloak","auth0","clerk","rbac","abac",
  // ai / ml
  "tensorflow","pytorch","keras","scikit-learn","sklearn","pandas","numpy","huggingface","langchain","llamaindex","openai","anthropic","claude","gpt","llm","rag","pinecone","weaviate","chromadb","qdrant","pgvector","mlflow","opencv","yolo","bert","transformers",
  // testing
  "jest","vitest","pytest","junit","cypress","playwright","selenium","mocha","chai","testing library","k6","jmeter",
  // other
  "git","github","gitlab","bitbucket","jira","linux","bash","graphite","stripe","razorpay","twilio","sendgrid","elastic","kong","istio","rabbit","socket.io",
];

/** Terms that mean the same thing to a human but differ as strings. */
const ALIASES: Record<string, string> = {
  golang: "go",
  postgres: "postgresql",
  nextjs: "next.js",
  nodejs: "node.js",
  sklearn: "scikit-learn",
  restful: "rest",
  websockets: "websocket",
  oauth2: "oauth",
  "google cloud": "gcp",
  "spring boot": "spring",
};

const canonical = (term: string) => {
  const t = term.toLowerCase().trim();
  return ALIASES[t] ?? t;
};

/** Lowercase, collapse punctuation that varies between writers, keep word shape. */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9+#./\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Metric tokens: percentages, multipliers, durations, byte/req counts, money,
 * and bare numbers of two digits or more. Single digits are skipped because
 * "3 microservices" is usually a restatement, not an invented claim, and
 * flagging them buries the real findings in noise.
 */
const METRIC_PATTERN =
  /(\d[\d,.]*\s?(?:%|percent|x\b|ms\b|s\b|sec\b|seconds\b|min\b|minutes\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|k\b|m\b|b\b|mb\b|gb\b|tb\b|rps\b|qps\b|tps\b|req\/s|users?\b|customers?\b|clients?\b))|([$₹€£]\s?\d[\d,.]*)|(\b\d{2,}\b)/gi;

function extractMetrics(text: string): string[] {
  return (text.match(METRIC_PATTERN) ?? []).map((m) => m.trim().toLowerCase());
}

/** A metric matches its source if the same digits appear there in any form. */
function digitsOf(s: string) {
  return s.replace(/[^0-9]/g, "");
}

function buildFactIndex(facts: ResumeFacts) {
  const index = new Map<string, string>();
  const add = (id: string, text: string) => index.set(id, text);

  if (facts.summary) add("SUMMARY", facts.summary);
  if (facts.headline) add("HEADLINE", facts.headline);

  for (const e of facts.experience) {
    add(e.id, [e.company, e.title, e.location, e.startDate, e.endDate, ...e.tech].join(" "));
    for (const b of e.bullets) add(b.id, b.text);
  }
  for (const p of facts.projects) {
    add(p.id, [p.name, p.description, ...p.tech].join(" "));
    for (const b of p.bullets) add(b.id, b.text);
  }
  for (const ed of facts.education) {
    add(ed.id, [ed.institution, ed.degree, ed.dates, ed.details].join(" "));
  }
  for (const s of facts.skills) add(s.id, [s.category, ...s.items].join(" "));
  for (const c of facts.certifications) add(c.id, c.text);
  for (const o of facts.otherSections) {
    add(o.id, o.heading);
    for (const b of o.bullets) add(b.id, b.text);
  }
  return index;
}

/** Everything the candidate ever claimed, as one normalized haystack. */
function buildCorpus(facts: ResumeFacts, rawResumeText: string) {
  const index = buildFactIndex(facts);
  return normalize([...index.values()].join(" \n ") + " \n " + rawResumeText);
}

function techTermsIn(text: string, vocabulary: string[]): string[] {
  const hay = normalize(text);
  const found = new Set<string>();
  for (const term of vocabulary) {
    const t = normalize(term);
    if (t.length < 2) continue;
    // Word-ish boundary: the term must not be glued to surrounding letters.
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(hay)) found.add(canonical(term));
  }
  return [...found];
}

/**
 * The built-in list is a floor, not a ceiling — it cannot know about whatever
 * shipped last quarter. Seeding it with the job description's own vocabulary
 * means the terms this particular application will be judged on are always
 * covered, which is exactly where an invented claim would be most tempting.
 */
function buildVocabulary(jdTerms: string[]): string[] {
  const extra = jdTerms
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 40 && /[a-z]/i.test(t));
  return [...new Set([...TECH_VOCABULARY, ...extra])];
}

export function runTruthGuard(
  tailored: TailoredResume,
  facts: ResumeFacts,
  rawResumeText: string,
  jdTerms: string[] = [],
): TruthReport {
  const violations: TruthViolation[] = [];
  const factIndex = buildFactIndex(facts);
  const corpus = buildCorpus(facts, rawResumeText);
  const vocabulary = buildVocabulary(jdTerms);
  const corpusTech = new Set(techTermsIn(corpus, vocabulary));
  const corpusDigits = new Set(extractMetrics(corpus).map(digitsOf).filter(Boolean));

  const checkLine = (location: string, text: string, sourceIds: string[]) => {
    if (sourceIds.length === 0) {
      violations.push({
        code: "UNSOURCED_LINE",
        severity: "error",
        location,
        detail: "Rewritten line cites no source in the uploaded resume.",
        offending: text,
      });
    }

    const unknown = sourceIds.filter((id) => !factIndex.has(id));
    for (const id of unknown) {
      violations.push({
        code: "UNKNOWN_SOURCE_ID",
        severity: "error",
        location,
        detail: `Cites '${id}', which does not exist in the extracted resume facts.`,
        offending: text,
      });
    }

    const sourceText = sourceIds
      .filter((id) => factIndex.has(id))
      .map((id) => factIndex.get(id)!)
      .join(" ");
    const sourceDigits = new Set(extractMetrics(sourceText).map(digitsOf).filter(Boolean));

    for (const metric of extractMetrics(text)) {
      const d = digitsOf(metric);
      if (!d) continue;
      if (!sourceDigits.has(d) && !corpusDigits.has(d)) {
        violations.push({
          code: "UNSOURCED_METRIC",
          severity: "error",
          location,
          detail: `The figure '${metric}' does not appear anywhere in the uploaded resume.`,
          offending: text,
        });
      }
    }

    for (const tech of techTermsIn(text, vocabulary)) {
      if (!corpusTech.has(tech)) {
        violations.push({
          code: "UNSOURCED_TECH",
          severity: "error",
          location,
          detail: `'${tech}' is presented as the candidate's experience but is absent from the uploaded resume.`,
          offending: text,
        });
      }
    }
  };

  checkLine("Summary", tailored.summary.text, tailored.summary.sourceIds);

  // A headline speaks for the candidate's current level and claimed stack, so
  // it may draw on the most recent role and the skills section — not, as it
  // once did, on every role ever held, which let it borrow a technology from a
  // job three years ago and call it a specialisation.
  const headlineSources = [
    "HEADLINE",
    facts.experience[0]?.id,
    ...facts.skills.map((s) => s.id),
  ].filter((id): id is string => Boolean(id));
  checkLine("Headline", tailored.headline, headlineSources);

  for (const group of tailored.skills) {
    checkLine(`Skills / ${group.category}`, group.items.join(", "), group.sourceIds);
  }

  for (const exp of tailored.experience) {
    const fact = facts.experience.find((e) => e.id === exp.sourceId);
    if (!fact) {
      violations.push({
        code: "UNKNOWN_SOURCE_ID",
        severity: "error",
        location: `Experience / ${exp.company}`,
        detail: `Experience block cites '${exp.sourceId}', which is not an extracted role.`,
        offending: `${exp.title} at ${exp.company}`,
      });
      continue;
    }
    const drift: string[] = [];
    if (normalize(exp.company) !== normalize(fact.company)) drift.push(`company '${fact.company}' -> '${exp.company}'`);
    if (normalize(exp.title) !== normalize(fact.title)) drift.push(`title '${fact.title}' -> '${exp.title}'`);
    if (normalize(exp.startDate) !== normalize(fact.startDate)) drift.push(`start '${fact.startDate}' -> '${exp.startDate}'`);
    if (normalize(exp.endDate) !== normalize(fact.endDate)) drift.push(`end '${fact.endDate}' -> '${exp.endDate}'`);
    if (drift.length) {
      violations.push({
        code: "ALTERED_EMPLOYER_FACT",
        severity: "error",
        location: `Experience / ${fact.company}`,
        detail: `Verifiable employment details were changed: ${drift.join("; ")}.`,
        offending: drift.join("; "),
      });
    }
    exp.bullets.forEach((b, i) =>
      checkLine(`Experience / ${fact.company} / bullet ${i + 1}`, b.text, b.sourceIds),
    );
  }

  for (const proj of tailored.projects) {
    proj.bullets.forEach((b, i) =>
      checkLine(`Project / ${proj.name} / bullet ${i + 1}`, b.text, b.sourceIds),
    );
  }

  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warningCount = violations.length - errorCount;

  return { passed: errorCount === 0, errorCount, warningCount, violations };
}
