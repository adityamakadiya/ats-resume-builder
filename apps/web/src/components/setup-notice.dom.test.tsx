// @vitest-environment jsdom
//
// The environment is declared in the file rather than left to a config glob:
// vitest 5 dropped `environmentMatchGlobs`, and a docblock cannot silently
// stop applying when the config is refactored.

/**
 * The unconfigured state.
 *
 * The important assertion is the negative one at the bottom: reading the
 * config on a machine with no environment variables must not throw. That is
 * how this repository will be run the first time, and a module-scope throw
 * would replace the instructions below with a stack trace.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "./setup-notice";
import { SUPABASE_ENV_KEYS, isSupabaseConfigured, supabaseConfig } from "@/lib/supabase/config";

afterEach(cleanup);

describe("supabaseConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...saved };
  });

  it("reports both keys missing instead of throwing when nothing is set", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const config = supabaseConfig();
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.missing).toEqual([...SUPABASE_ENV_KEYS]);
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("treats a blank string as missing, because an empty var is a typo", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "   ";

    const config = supabaseConfig();
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.missing).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  });

  it("is ok once both are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(supabaseConfig().ok).toBe(true);
  });
});

describe("SetupNotice", () => {
  it("renders the checklist instead of throwing, and names both variables", () => {
    expect(() => render(<SetupNotice />)).not.toThrow();

    expect(screen.getByRole("heading", { name: /supabase is not configured/i })).toBeTruthy();
    for (const key of SUPABASE_ENV_KEYS) {
      expect(screen.getByText(key)).toBeTruthy();
    }
  });

  it("says where the variables go and what to run", () => {
    render(<SetupNotice />);
    expect(screen.getByText(".env.local")).toBeTruthy();
    expect(screen.getByText("supabase db reset")).toBeTruthy();
  });

  it("only lists the keys that are actually missing", () => {
    render(<SetupNotice missing={["NEXT_PUBLIC_SUPABASE_ANON_KEY"]} />);
    expect(screen.getByText("NEXT_PUBLIC_SUPABASE_ANON_KEY")).toBeTruthy();
    expect(screen.queryByText("NEXT_PUBLIC_SUPABASE_URL")).toBeNull();
  });

  it("names the thing the user was trying to do", () => {
    render(<SetupNotice context="Signing in" />);
    expect(screen.getByText(/Signing in reads and writes through Supabase/)).toBeTruthy();
  });
});
