#!/usr/bin/env node
/**
 * Run the whole product with one command.
 *
 * This exists because of a failure that looked like three different bugs.
 * The app needs two processes: the Next server, and the Python document
 * service that reads PDFs, fetches job postings and runs the truth guard.
 * `npm run dev` started only the first, so the second was something you had
 * to remember, and forgetting it did not produce an error anyone could act
 * on. It produced:
 *
 *   - an upload that stored the file and showed a sample resume, because
 *     nothing could parse it
 *   - a job description URL that would not load, on any site
 *   - a tailoring run that could not verify anything
 *
 * Three unrelated-looking symptoms, one dead process, and no message saying
 * so. A second process that must be running is part of the product, not a
 * thing to document in a README and hope for.
 *
 *   npm run dev          both, with prefixed output
 *   npm run dev -- --web only the web app, if the service runs elsewhere
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");
const BACKEND = join(ROOT, "backend");
const VENV = join(BACKEND, ".venv", "bin", "python");

const WEB_PORT = process.env.PORT ?? "3100";
const DOC_PORT = process.env.DOCSVC_PORT ?? "8000";

const webOnly = process.argv.includes("--web");

/* Colours are pleasant, but not at the cost of a log nobody can grep. */
const paint = process.stdout.isTTY
  ? { web: "\u001b[36m", doc: "\u001b[35m", warn: "\u001b[33m", dim: "\u001b[2m", off: "\u001b[0m" }
  : { web: "", doc: "", warn: "", dim: "", off: "" };

const children = [];

function prefix(name, colour, stream) {
  let carry = "";
  return (chunk) => {
    const lines = (carry + chunk.toString()).split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      stream.write(`${colour}${name}${paint.off} ${line}\n`);
    }
  };
}

function start(name, colour, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", prefix(name, colour, process.stdout));
  child.stderr.on("data", prefix(name, colour, process.stderr));

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `\n${paint.warn}${name} exited${paint.off} (${signal ?? `code ${code}`}). ` +
        `Stopping the rest so you are not left with half a product running.\n`
    );
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  // Give them a moment to close ports before the shell hands them back.
  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/* ------------------------------------------------------------------ run */

if (!webOnly) {
  if (!existsSync(VENV)) {
    console.error(
      `${paint.warn}The document service has no virtualenv.${paint.off}\n\n` +
        `  cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"\n` +
        `  .venv/bin/playwright install chromium\n\n` +
        `Or run the web app alone with: npm run dev -- --web\n` +
        `Without the service: uploads are not parsed, job description URLs do\n` +
        `not load, and nothing can be verified.\n`
    );
    process.exit(1);
  }

  start(
    "docsvc",
    paint.doc,
    VENV,
    ["-m", "uvicorn", "atsresume.api:app", "--host", "127.0.0.1", "--port", DOC_PORT, "--app-dir", "src"],
    BACKEND
  );
}

start("web   ", paint.web, "npx", ["next", "dev", "--port", WEB_PORT], WEB, {
  DOCSVC_URL: process.env.DOCSVC_URL ?? `http://127.0.0.1:${DOC_PORT}`,
});

console.log(
  `\n  ${paint.web}web   ${paint.off} http://localhost:${WEB_PORT}\n` +
    (webOnly
      ? `  ${paint.warn}docsvc${paint.off} not started. Uploads will not be parsed.\n`
      : `  ${paint.doc}docsvc${paint.off} http://localhost:${DOC_PORT}\n`) +
    `  ${paint.dim}ctrl-c stops both${paint.off}\n`
);
