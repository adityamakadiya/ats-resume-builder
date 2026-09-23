/**
 * Port of `backend/src/atsresume/truth/vocabulary.py`.
 *
 * REGEX PARITY NOTES — the whole reason `test/regex-parity.test.ts` exists.
 *
 * * `_PUNCT = re.compile(r"[^a-z0-9+#./\- ]+")` is applied *after* `.lower()`,
 *   so it also strips every uppercase and non-ASCII character. `/[^a-z0-9+#./\- ]+/g`
 *   in JS is the same class: inside a character class `.` and `/` are literal
 *   in both engines, and `\-` is a literal hyphen in both.
 * * `_DASHES = re.compile(r"[‐-―]")` is the range U+2010..U+2015, written with
 *   literal codepoints in the Python source. Spelled out here as
 *   `[‐-―]` so nobody normalises the file and changes the meaning.
 * * `_IZE = re.compile(r"(is|iz)(e|ed|es|ing|ation|ations)\b")` relies on
 *   leftmost-first alternation plus backtracking on `\b`. Both Python and
 *   JavaScript are backtracking NFAs with first-alternative-wins, so
 *   "organization" -> "organis" and "organizations" -> "organis" identically:
 *   `ation` matches first, `\b` fails before the `s`, and `ations` wins on the
 *   retry. Do not "tidy" the alternation order.
 * * The word boundaries are `(?<![a-z0-9])` / `(?![a-z0-9])`, not `\b`. That is
 *   deliberate: the haystack is normalised text where `+`, `#`, `.`, `/` and
 *   `-` are legal inside a term, and `\b` would break "node.js" and "c++".
 *   Node 18+ supports lookbehind, so the construct ports directly.
 * * Python's `re.escape` escapes more than JavaScript needs (space, `#`, `&`,
 *   `~`). Escaping those in JS without the `u` flag is legal but pointless, and
 *   *with* the `u` flag it is a SyntaxError, so {@link escapeRegExp} escapes
 *   only the characters that are actually special outside a character class.
 *   The matched language is identical either way.
 */

/* ------------------------------------------------------------------ */
/* The vocabulary                                                      */
/* ------------------------------------------------------------------ */

export const TECH_VOCABULARY: ReadonlySet<string> = new Set([
  // languages
  'javascript', 'typescript', 'python', 'java', 'go', 'golang', 'rust', 'ruby',
  'php', 'c#', 'c++', 'kotlin', 'swift', 'scala', 'elixir', 'perl', 'dart',
  'solidity', 'bash', 'powershell', 'r',
  // frontend
  'react', 'angular', 'vue', 'svelte', 'next.js', 'nextjs', 'nuxt', 'remix',
  'redux', 'zustand', 'tailwind', 'bootstrap', 'jquery', 'webpack', 'vite',
  'astro', 'storybook', 'radix ui', 'shadcn',
  // backend
  'node.js', 'nodejs', 'express', 'nestjs', 'fastify', 'django', 'flask',
  'fastapi', 'spring', 'spring boot', 'rails', 'laravel', 'gin', 'asp.net',
  'celery', 'sidekiq',
  // data
  'postgresql', 'postgres', 'mysql', 'mariadb', 'sqlite', 'mongodb', 'redis',
  'elasticsearch', 'opensearch', 'cassandra', 'dynamodb', 'neo4j', 'clickhouse',
  'snowflake', 'bigquery', 'redshift', 'supabase', 'firebase', 'prisma',
  'typeorm', 'sequelize', 'drizzle', 'sqlalchemy', 'hibernate', 'duckdb',
  // cloud and devops
  'aws', 'azure', 'gcp', 'google cloud', 'kubernetes', 'docker', 'terraform',
  'ansible', 'jenkins', 'github actions', 'gitlab ci', 'circleci', 'argocd',
  'helm', 'ec2', 's3', 'lambda', 'ecs', 'eks', 'fargate', 'cloudfront', 'rds',
  'sqs', 'sns', 'vercel', 'netlify', 'heroku', 'cloudflare', 'nginx', 'apache',
  'pulumi', 'serverless',
  // messaging and scheduling
  'kafka', 'rabbitmq', 'bullmq', 'nats', 'pulsar', 'airflow', 'temporal',
  'cron', 'pub/sub',
  // observability
  'prometheus', 'grafana', 'datadog', 'sentry', 'opentelemetry', 'new relic',
  'splunk', 'kibana', 'jaeger', 'posthog',
  // api and protocol
  'graphql', 'grpc', 'rest', 'restful', 'websocket', 'websockets', 'soap',
  'openapi', 'swagger', 'trpc', 'protobuf', 'webhooks',
  // auth and security
  'oauth', 'oauth2', 'oidc', 'jwt', 'saml', 'keycloak', 'auth0', 'clerk',
  'rbac', 'abac', 'owasp',
  // ai and ml
  'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'sklearn', 'pandas',
  'numpy', 'huggingface', 'langchain', 'llamaindex', 'openai', 'anthropic',
  'claude', 'gpt', 'llm', 'rag', 'pinecone', 'weaviate', 'chromadb', 'qdrant',
  'pgvector', 'mlflow', 'opencv', 'yolo', 'bert', 'transformers', 'mcp',
  // testing
  'jest', 'vitest', 'pytest', 'junit', 'cypress', 'playwright', 'selenium',
  'mocha', 'chai', 'k6', 'jmeter', 'testing library',
  // tooling and payments
  'git', 'github', 'gitlab', 'bitbucket', 'jira', 'linux', 'stripe',
  'razorpay', 'twilio', 'sendgrid', 'kong', 'istio', 'socket.io', 'namecheap',
]);

/** Terms that mean the same thing to a human but differ as strings. */
export const ALIASES: ReadonlyMap<string, string> = new Map([
  ['golang', 'go'],
  ['postgres', 'postgresql'],
  ['nextjs', 'next.js'],
  ['nodejs', 'node.js'],
  ['sklearn', 'scikit-learn'],
  ['restful', 'rest'],
  ['websockets', 'websocket'],
  ['oauth2', 'oauth'],
  ['google cloud', 'gcp'],
  ['spring boot', 'spring'],
  ['k8s', 'kubernetes'],
  ['gh actions', 'github actions'],
  ['role-based access', 'rbac'],
  ['role based access', 'rbac'],
  ['access control', 'rbac'],
  ['github actions', 'ci/cd'],
  ['gitlab ci', 'ci/cd'],
  ['continuous integration', 'ci/cd'],
  ['ci cd', 'ci/cd'],
  ['json web token', 'jwt'],
  ['json web tokens', 'jwt'],
  ['rest api', 'rest'],
  ['rest apis', 'rest'],
  ['restful apis', 'rest'],
  ['message queue', 'queue'],
  ['background jobs', 'queue'],
  ['job queue', 'queue'],
]);

/**
 * Naming a tool is claiming the capability it provides. Weaker than an alias:
 * the implication runs one way only, so it is applied to the corpus, never to
 * the rewrite.
 */
export const IMPLIES: ReadonlyMap<string, readonly string[]> = new Map([
  ['bullmq', ['queue']],
  ['celery', ['queue']],
  ['sidekiq', ['queue']],
  ['rabbitmq', ['queue', 'message broker']],
  ['kafka', ['queue', 'message broker', 'streaming']],
  ['sqs', ['queue']],
  ['pulsar', ['queue', 'message broker']],
  ['nats', ['queue', 'message broker']],
  ['redis', ['caching']],
  ['memcached', ['caching']],
  ['docker', ['containers', 'containerisation']],
  ['kubernetes', ['containers', 'orchestration']],
  ['github actions', ['ci/cd']],
  ['gitlab ci', ['ci/cd']],
  ['jenkins', ['ci/cd']],
  ['circleci', ['ci/cd']],
  ['prometheus', ['observability', 'monitoring']],
  ['grafana', ['observability', 'monitoring']],
  ['datadog', ['observability', 'monitoring']],
  ['opentelemetry', ['observability', 'tracing']],
  ['jwt', ['authentication']],
  ['oauth', ['authentication']],
  ['postgresql', ['sql', 'relational database']],
  ['mysql', ['sql', 'relational database']],
]);

/** Capabilities the candidate can honestly claim because of what they own. */
export function impliedBy(terms: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const term of terms) {
    for (const implied of IMPLIES.get(term) ?? []) out.add(implied);
  }
  return out;
}

export function canonical(term: string): string {
  const key = term.trim().toLowerCase();
  return ALIASES.get(key) ?? key;
}

/* ------------------------------------------------------------------ */
/* normalise                                                           */
/* ------------------------------------------------------------------ */

const PUNCT = /[^a-z0-9+#./\- ]+/g;
const DASHES = /[‐-―]/g;
const SPACES = /\s+/g;
const IZE = /(is|iz)(e|ed|es|ing|ation|ations)\b/g;

/**
 * Lowercase, flatten punctuation, and settle the -ise/-ize argument.
 *
 * Python applies `_IZE.sub` and `_PUNCT.sub` with no count limit, i.e. global,
 * which is what the `g` flags above reproduce. Order is load bearing: dashes,
 * then -ize folding, then punctuation, then whitespace collapse, then strip.
 */
export function normalise(text: string): string {
  let lowered = text.toLowerCase().replace(DASHES, '-');
  lowered = lowered.replace(IZE, 'is');
  return lowered.replace(PUNCT, ' ').replace(SPACES, ' ').trim();
}

/**
 * Escape for literal use in a RegExp, outside a character class.
 *
 * Deliberately narrower than Python's `re.escape`, which also escapes space,
 * `#`, `&`, `~` and `-`. Those are not special in JavaScript outside a class,
 * and escaping them would be a SyntaxError under the `u` flag.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/* Shape filters for seeding                                           */
/* ------------------------------------------------------------------ */

/**
 * `_TECH_SHAPED`. The Python source is in VERBOSE mode; whitespace and the
 * trailing comments are not part of the pattern, so it reduces to this.
 */
export const TECH_SHAPED =
  /^([A-Z][A-Za-z0-9+#.\-]*|[A-Za-z0-9]*[0-9+#./][A-Za-z0-9+#./\-]*)$/;

export const GENERIC: ReadonlySet<string> = new Set([
  'data', 'isolation', 'design', 'designing', 'scaling', 'scalable', 'api', 'apis',
  'service', 'services', 'system', 'systems', 'server', 'client', 'based', 'driven',
  'management', 'managing', 'development', 'developing', 'engineering', 'experience',
  'knowledge', 'strong', 'solid', 'good', 'excellent', 'production', 'performance',
  'optimization', 'optimisation', 'testing', 'tests', 'code', 'review', 'reviews',
  'team', 'teams', 'product', 'products', 'end', 'stack', 'full', 'backend',
  'frontend', 'web', 'mobile', 'cloud', 'software', 'application', 'applications',
  'architecture', 'patterns', 'practices', 'tooling', 'tools', 'modern', 'using',
  'multi', 'tenant', 'distributed', 'real', 'time', 'high', 'low', 'level',
  'workflow', 'automation', 'monitoring', 'logging', 'deployment', 'pipeline',
  'integration', 'delivery', 'quality', 'ownership', 'mentoring', 'communication',
  'queue', 'queues', 'settlement', 'settlements', 'reconciliation', 'payments',
  'payouts', 'billing', 'onboarding', 'compliance', 'reporting', 'analytics',
]);

/**
 * The built-in list, seeded with the technology names this posting uses.
 *
 * `sorted()` in Python orders by code point; `Array.prototype.sort()` with no
 * comparator orders by UTF-16 code unit. Identical for the ASCII terms here.
 */
export function buildVocabulary(jdTerms: readonly string[] = []): string[] {
  const terms = new Set<string>([...TECH_VOCABULARY, ...ALIASES.keys()]);
  for (const raw of jdTerms) {
    const term = raw.trim();
    if (!(term.length >= 2 && term.length <= 30)) continue;
    const words = term.split(/[\s/]+/).filter((w) => w.length > 0);
    if (words.length === 0 || words.length > 2) continue;
    if (words.some((w) => GENERIC.has(w.toLowerCase()))) continue;
    if (!words.every((w) => TECH_SHAPED.test(w))) continue;
    terms.add(term.toLowerCase());
  }
  return [...terms].sort();
}

/* ------------------------------------------------------------------ */
/* terms_present                                                       */
/* ------------------------------------------------------------------ */

interface Matcher {
  pattern: RegExp;
  byNormalised: Map<string, string>;
}

// `functools.lru_cache(maxsize=32)` on the Python side. A Map keyed by the
// joined vocabulary is the same idea; the cache is bounded the same way.
const MATCHER_CACHE = new Map<string, Matcher>();
const MATCHER_CACHE_MAX = 32;

function buildMatcher(vocabulary: readonly string[]): Matcher {
  const byNormalised = new Map<string, string>();
  for (const term of vocabulary) {
    const needle = normalise(term);
    if (needle.length < 2) continue;
    if (!byNormalised.has(needle)) byNormalised.set(needle, term);
    // Register the singular too, so a plural vocabulary term still matches a
    // resume that wrote it singular.
    for (const suffix of ['es', 's']) {
      if (needle.endsWith(suffix) && needle.length - suffix.length >= 3) {
        const base = needle.slice(0, -suffix.length);
        if (!byNormalised.has(base)) byNormalised.set(base, term);
        break;
      }
    }
  }

  // Longest first, otherwise "next" shadows "next.js". Python's `sorted` and
  // JS's `sort` are both stable, so equal-length terms keep insertion order.
  const ordered = [...byNormalised.keys()].sort((a, b) => b.length - a.length);
  const alternation = ordered.map((n) => `${escapeRegExp(n)}(?:e?s)?`).join('|');
  const pattern = new RegExp(`(?<![a-z0-9])(${alternation})(?![a-z0-9])`, 'g');
  return { pattern, byNormalised };
}

function matcherFor(vocabulary: readonly string[]): Matcher {
  const key = vocabulary.join('\u0000');
  const hit = MATCHER_CACHE.get(key);
  if (hit) return hit;
  const built = buildMatcher(vocabulary);
  if (MATCHER_CACHE.size >= MATCHER_CACHE_MAX) {
    const oldest = MATCHER_CACHE.keys().next();
    if (!oldest.done) MATCHER_CACHE.delete(oldest.value);
  }
  MATCHER_CACHE.set(key, built);
  return built;
}

/** Which vocabulary terms appear in `text` as whole words. */
export function termsPresent(text: string, vocabulary: readonly string[]): Set<string> {
  const found = new Set<string>();
  if (vocabulary.length === 0) return found;
  const { pattern, byNormalised } = matcherFor(vocabulary);
  const hay = normalise(text);
  // Cached RegExp objects carry `lastIndex`; reset before every scan so the
  // result never depends on the previous call. (Python has no such state.)
  pattern.lastIndex = 0;
  for (const match of hay.matchAll(pattern)) {
    let base = match[1] ?? '';
    if (!byNormalised.has(base)) {
      for (const suffix of ['es', 's']) {
        if (base.endsWith(suffix) && byNormalised.has(base.slice(0, -suffix.length))) {
          base = base.slice(0, -suffix.length);
          break;
        }
      }
    }
    const term = byNormalised.get(base);
    if (term !== undefined) found.add(canonical(term));
  }
  return found;
}
