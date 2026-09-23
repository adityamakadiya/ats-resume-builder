/**
 * The throwaway project that e2e/harness/serve-unconfigured.mjs boots.
 *
 * It mirrors apps/web/next.config.ts. The turbopack root has to be the
 * repository root for the same reason it does there: `src` imports
 * `@ats/templates`, which resolves through the symlinked node_modules to
 * ../../packages/templates, and anything outside the root fails to resolve.
 *
 * There is deliberately no .env.local beside this file. That absence is the
 * thing under test.
 */

import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: join(__dirname, "..", "..") },
  serverExternalPackages: ["@react-pdf/renderer", "unpdf", "mammoth"],
  // Next writes an AGENTS.md and a CLAUDE.md into the project directory on
  // boot. This directory is scratch, so there is nothing for them to say.
  agentRules: false,
};

export default nextConfig;
