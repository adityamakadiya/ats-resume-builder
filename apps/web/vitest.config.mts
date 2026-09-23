import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    // Node by default. A component test opts into jsdom with a docblock at
    // the top of its own file:  /** @vitest-environment jsdom */
    // environmentMatchGlobs was removed in Vitest 5.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
