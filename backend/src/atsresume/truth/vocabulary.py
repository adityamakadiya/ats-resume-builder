"""The vocabulary the truth guard watches for invented technologies.

The built-in list is a floor, not a ceiling — it cannot know about whatever
shipped last quarter. It is always seeded with the job description's own terms,
so the words a given application is judged on are the ones watched hardest,
which is exactly where inventing a claim is most tempting.
"""

from __future__ import annotations

import re
from functools import lru_cache

TECH_VOCABULARY: frozenset[str] = frozenset(
    {
        # languages
        "javascript", "typescript", "python", "java", "go", "golang", "rust", "ruby",
        "php", "c#", "c++", "kotlin", "swift", "scala", "elixir", "perl", "dart",
        "solidity", "bash", "powershell", "r",
        # frontend
        "react", "angular", "vue", "svelte", "next.js", "nextjs", "nuxt", "remix",
        "redux", "zustand", "tailwind", "bootstrap", "jquery", "webpack", "vite",
        "astro", "storybook", "radix ui", "shadcn",
        # backend
        "node.js", "nodejs", "express", "nestjs", "fastify", "django", "flask",
        "fastapi", "spring", "spring boot", "rails", "laravel", "gin", "asp.net",
        "celery", "sidekiq",
        # data
        "postgresql", "postgres", "mysql", "mariadb", "sqlite", "mongodb", "redis",
        "elasticsearch", "opensearch", "cassandra", "dynamodb", "neo4j", "clickhouse",
        "snowflake", "bigquery", "redshift", "supabase", "firebase", "prisma",
        "typeorm", "sequelize", "drizzle", "sqlalchemy", "hibernate", "duckdb",
        # cloud and devops
        "aws", "azure", "gcp", "google cloud", "kubernetes", "docker", "terraform",
        "ansible", "jenkins", "github actions", "gitlab ci", "circleci", "argocd",
        "helm", "ec2", "s3", "lambda", "ecs", "eks", "fargate", "cloudfront", "rds",
        "sqs", "sns", "vercel", "netlify", "heroku", "cloudflare", "nginx", "apache",
        "pulumi", "serverless",
        # messaging and scheduling
        "kafka", "rabbitmq", "bullmq", "nats", "pulsar", "airflow", "temporal",
        "cron", "pub/sub",
        # observability
        "prometheus", "grafana", "datadog", "sentry", "opentelemetry", "new relic",
        "splunk", "kibana", "jaeger", "posthog",
        # api and protocol
        "graphql", "grpc", "rest", "restful", "websocket", "websockets", "soap",
        "openapi", "swagger", "trpc", "protobuf", "webhooks",
        # auth and security
        "oauth", "oauth2", "oidc", "jwt", "saml", "keycloak", "auth0", "clerk",
        "rbac", "abac", "owasp",
        # ai and ml
        "tensorflow", "pytorch", "keras", "scikit-learn", "sklearn", "pandas",
        "numpy", "huggingface", "langchain", "llamaindex", "openai", "anthropic",
        "claude", "gpt", "llm", "rag", "pinecone", "weaviate", "chromadb", "qdrant",
        "pgvector", "mlflow", "opencv", "yolo", "bert", "transformers", "mcp",
        # testing
        "jest", "vitest", "pytest", "junit", "cypress", "playwright", "selenium",
        "mocha", "chai", "k6", "jmeter", "testing library",
        # tooling and payments
        "git", "github", "gitlab", "bitbucket", "jira", "linux", "stripe",
        "razorpay", "twilio", "sendgrid", "kong", "istio", "socket.io", "namecheap",
    }
)

# Terms that mean the same thing to a human but differ as strings.
ALIASES: dict[str, str] = {
    "golang": "go",
    "postgres": "postgresql",
    "nextjs": "next.js",
    "nodejs": "node.js",
    "sklearn": "scikit-learn",
    "restful": "rest",
    "websockets": "websocket",
    "oauth2": "oauth",
    "google cloud": "gcp",
    "spring boot": "spring",
    "k8s": "kubernetes",
    "gh actions": "github actions",
}


def canonical(term: str) -> str:
    key = term.strip().lower()
    return ALIASES.get(key, key)


_PUNCT = re.compile(r"[^a-z0-9+#./\- ]+")
_DASHES = re.compile(r"[‐-―]")
_SPACES = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Lowercase and flatten the punctuation that varies between writers."""
    lowered = _DASHES.sub("-", text.lower())
    return _SPACES.sub(" ", _PUNCT.sub(" ", lowered)).strip()


def build_vocabulary(jd_terms: list[str] | None = None) -> list[str]:
    terms = set(TECH_VOCABULARY)
    for raw in jd_terms or []:
        term = raw.strip()
        # Long phrases are responsibilities, not technologies, and matching them
        # verbatim produces noise rather than findings.
        if 2 <= len(term) <= 40 and re.search(r"[a-zA-Z]", term):
            terms.add(term.lower())
    return sorted(terms)


@lru_cache(maxsize=32)
def _matcher(vocabulary: tuple[str, ...]) -> tuple[re.Pattern[str], dict[str, str]]:
    """One compiled alternation for the whole vocabulary.

    Testing each term with its own regex is O(terms) passes over the text, and
    with a few hundred terms checked against every rewritten line that dominated
    the runtime of the whole pipeline. This is one pass, compiled once per
    distinct vocabulary.

    Alternation is first-match-wins at a given position, so terms are ordered
    longest first — otherwise "next" would shadow "next.js".
    """
    by_normalised: dict[str, str] = {}
    for term in vocabulary:
        needle = normalise(term)
        if len(needle) >= 2:
            by_normalised.setdefault(needle, term)

    ordered = sorted(by_normalised, key=len, reverse=True)
    alternation = "|".join(re.escape(n) for n in ordered)
    pattern = re.compile(rf"(?<![a-z0-9])({alternation})(?![a-z0-9])")
    return pattern, by_normalised


def terms_present(text: str, vocabulary: list[str]) -> set[str]:
    """Which vocabulary terms appear in ``text`` as whole words."""
    if not vocabulary:
        return set()
    pattern, by_normalised = _matcher(tuple(vocabulary))
    hay = normalise(text)
    return {canonical(by_normalised[m]) for m in pattern.findall(hay) if m in by_normalised}
