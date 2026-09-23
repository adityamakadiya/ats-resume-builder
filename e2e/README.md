# End to end

Playwright. Three tiers, split by what they need in order to run.

The split exists because of one awkward fact: a real session on this app
needs a Supabase account, and email signup on this project is rate limited.
A suite that only works for whoever has the credentials is a suite nobody
runs. So almost everything here is written to work without an account, and
the part that genuinely cannot is opt in and says so when it skips.

```
e2e/
  tier1/               no account, normal dev server           23 tests
  tier1-unconfigured/  no account, Supabase vars blanked        4 tests
  tier2/               needs E2E_EMAIL / E2E_PASSWORD           8 tests
  tier3/               no server at all, file:// fixtures      37 tests
  support/             the console watchdog and the axe pass
  harness/             boots the second, unconfigured server
  unconfigured-app/    the scratch Next project that server runs out of
```

Everything is driven from `apps/web`, because that is where the Playwright
install, the Next config and `node_modules` are.

```sh
cd apps/web
npm run e2e:install     # once: fetch the Chromium build
```

## Running

| What | Command |
| --- | --- |
| Everything that belongs in CI | `npm run e2e:ci` |
| Both no-account tiers | `npm run e2e:tier1` |
| The rendered document checks | `npm run e2e:tier3` |
| The signed in suite | `npm run e2e:tier2` |
| All five projects | `npm run e2e` |
| Last report | `npm run e2e:report` |

`npm run e2e:ci` is `--project=tier1 --project=tier1-unconfigured
--project=tier3`, 64 tests, about thirty seconds cold. That is the command
for a CI job. Tier 2 is left out on purpose; see below.

A dev server is started automatically, and reused if one is already up
(`reuseExistingServer`, off under `CI`). Ports: 3100 for the app, 3101 for
the unconfigured one. Override with `E2E_PORT`, `E2E_BASE_URL` and
`E2E_UNCONFIGURED_PORT`.

Only the projects you select get a server. `--project=tier3` opens nine local
files and boots nothing.

## Tier 1, no account

Runs anywhere, and is the tier that must stay green.

- `/login` renders: the Google button, the email field, the strapline. And
  the word "verified" appears nowhere on the page. The product's claim is
  that a rewrite is *traced* to a line the candidate wrote; it does not
  verify that anything is true. "Verified" is one word away and would be a
  lie, so there is a test holding it off the page.
- Every protected prefix, signed out, is a 307 to `/login?next=<path>`, with
  the query string preserved. Asserted at the HTTP level with redirects off,
  because a browser follows the redirect and the evidence disappears.
- `/login` at 375px: no horizontal scroll, nothing individually overflowing,
  the primary button in the viewport, at least 40px tall and hittable.
- Keyboard: one full tab cycle is skip link, Google, email, submit, and each
  of the three controls draws a visible focus ring.
- axe on `/login`, clean and in its error state. The threshold is serious and
  critical, and `support/a11y.ts` will not be lowered to make a run green:
  the first run of this suite found seven serious contrast violations on the
  setup panel, they were recorded as an expected failure with the numbers
  written down, and a redesign pass fixed them within the hour. The
  annotation then reported "expected to fail but passed" and came off. That
  loop is the point.
- A console watchdog runs on every one of these. Any `console.error`, any
  uncaught exception, any failed request fails the test. See
  `support/fixtures.ts`; the ignore list is empty and should stay that way.

## Tier 1, unconfigured

The same app with the two `NEXT_PUBLIC_SUPABASE_*` variables blank. That is
not a broken state, it is the state of a fresh clone: nothing throws, nothing
redirects, and every screen renders a panel naming the two variables and
saying which file they go in. It is the first thing a new contributor sees.

Getting a server into that state took some doing, and the shape is worth
knowing before you touch it:

- Blanking the variables through the environment works. Next's dotenv loader
  only fills keys absent from `process.env`, and an empty string counts as
  present, so `apps/web/.env.local` does not win.
- But Next 16 refuses to start a second `next dev` in a directory that
  already has one, and `distDir` cannot be set from the CLI, so the two
  servers cannot both live in `apps/web`. Somebody almost always has the
  normal dev server running.
- So `harness/serve-unconfigured.mjs` boots a scratch project,
  `unconfigured-app/`, which gets a fresh copy of `apps/web/src` and symlinks
  to everything else on every boot. `src` has to be a real copy: Next's route
  discovery follows a symlink to its real path and then finds no routes, and
  the failure looks like the layout rendering with every page 404ing.

Nothing there needs maintaining by hand. `src` is recopied each boot, so it
cannot go stale.

The axe pass on `/start` lives here rather than in tier 1, because a signed
out visitor to a configured server is redirected away from `/start` and
never sees it. Same scan, same threshold.

If that server ever fails to start with "Parsing CSS source code failed",
delete `unconfigured-app/.next`. Tailwind can cache a garbled stylesheet if
it happens to read `apps/web/src` while something else is writing to it, and
the scratch project keeps its own Turbopack cache.

## Tier 2, signed in, opt in

```sh
E2E_EMAIL=you@example.com E2E_PASSWORD=... npm run e2e:tier2
```

Without those two variables all eight tests skip, and the terminal says what
to set. They do not fail, and they do not silently pass.

**Why it is opt in rather than part of CI.** The account has to be real.
Email signup on this Supabase project is rate limited, so a test cannot make
one on the fly, and a shared account cannot be committed. There is also no
password on the login screen at all: the product signs people in with a magic
link or with Google, and neither can be driven from a test without an inbox
or a Google session.

So `auth.setup.ts` exchanges the credentials with GoTrue directly and writes
the cookie `@supabase/ssr` would have written, once, into `.auth/user.json`.
Every tier 2 test starts from that storage state. The cookie encoding is
copied from `@supabase/ssr` and the source files are named in the comments;
if a Supabase upgrade changes it, that file is what breaks.

**Making an account that works.** In the Supabase dashboard, Authentication,
Users, add a user with a password (or set one on an existing user). That is
all tier 2 needs. Use a throwaway account: the suite uploads a resume and
creates rows under it.

What it covers: upload a PDF and land on `/start/template?document=<uuid>`,
pick a template and land on a working editor at `/resume/<uuid>`, the score
moving within 500ms of a keystroke, undo restoring the previous text, the two
column card carrying its parser warning, and a download whose first bytes are
`%PDF-`.

The one that matters most is "the editor shows the uploaded candidate, not
the fixture". This screen used to fall back to the sample document whenever a
version was missing, which is every resume for the first seconds of its life,
and the result looked completely correct: a well laid out resume for somebody
who does not exist. Both paths render perfectly, so nothing short of an end
to end check can tell them apart. The uploaded candidate is invented in
`tier2/support.ts` with a name no fixture in this repository uses, which is
what makes the assertion possible.

The PDF is built in code rather than committed, for the same reason
`packages/templates/src/fixtures.ts` invents its candidate: a real resume in
a repository is somebody's phone number in a repository.

## Tier 3, no server

The nine files in `packages/templates/test/fixtures/html/` are the emitted
output of every template crossed with every document shape, and they are what
headless Chromium turns into a PDF. The package's own vitest suite reads them
as strings. This lays each one out in a browser at A4 and checks four things:

- no horizontal overflow, and nothing outside the page's own margins
- exactly one `h1`, non-empty, which is the candidate's name
- no leaf element whose text starts or ends with a separator, which is how a
  join with an empty side shows up
- nothing but ASCII in `document.body.textContent`

The last one is the point of the tier. A middle dot in generated content
reached a PDF once; some parsers mangle it and some fonts have no glyph for
it. `ALLOWED_NON_ASCII` in the spec is empty, and adding to it should be a
decision somebody writes down.

The overflow check runs under print media, because that is the contract these
files exist under. Measured on screen instead, all nine are 802px wide at an
A4 viewport: the default 8px body margin is only cancelled inside
`@media print`. Harmless in the PDF, visible as a scrollbar in the on-screen
preview. There is a comment at the assertion saying so.

## Failure output

Traces and screenshots are kept for failures only, under `test-results/`; a
green run leaves nothing behind. `npm run e2e:report` opens the last HTML
report, and `npx playwright show-trace <path>` opens a single trace.

## Notes

- `tsconfig.json` here maps `@playwright/test` and `@axe-core/playwright` to
  `apps/web/node_modules`. There is no `node_modules` at the repository root,
  so a bare import from this directory resolves against nothing. Playwright
  honours tsconfig `paths` when it transforms a spec.
- `.auth/` holds a live session token and is gitignored.
