# End to end

Playwright. Three tiers, split by what they need in order to run.

The split used to exist because of one awkward fact: a real session needed a
Supabase account and email signup on this project is rate limited, so tier 2
was opt in and skipped itself for anyone without credentials. **There is no
authentication in this app any more.** There is no sign in, no session and
no account, so every tier runs for everyone. Tier 2 stays separate because
it is slow, it spends model tokens and it writes rows, not because it needs
a secret.

What that costs is written down once, at the top of
`apps/web/src/lib/supabase/client.ts`. Read it before pointing any of this
at a database you care about.

```
e2e/
  tier1/               normal dev server                       42 tests
  tier1-unconfigured/  Supabase vars blanked                    4 tests
  tier2/               the full funnel, real DB and model       7 tests
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
| The full funnel | `npm run e2e:tier2` |
| All four projects | `npm run e2e` |
| Last report | `npm run e2e:report` |

`npm run e2e:ci` is `--project=tier1 --project=tier1-unconfigured
--project=tier3`, 83 tests, about a minute cold. That is the command
for a CI job. Tier 2 is left out on purpose; see below.

A dev server is started automatically, and reused if one is already up
(`reuseExistingServer`, off under `CI`). Ports: 3100 for the app, 3101 for
the unconfigured one. Override with `E2E_PORT`, `E2E_BASE_URL` and
`E2E_UNCONFIGURED_PORT`.

Only the projects you select get a server. `--project=tier3` opens nine local
files and boots nothing.

## Tier 1

Runs anywhere, and is the tier that must stay green.

`/login` is gone, so the four specs that lived on it moved to `/start` and
`/resumes`, which are the two screens a visit now begins on.

- `/start/job`, the third step, renders: the counter reading 3 of 3, both
  ways of giving a posting, the login-wall warning on the link input, and a
  skip that names what skipping costs. Switching inputs keeps what was
  typed. `?document=` survives the Back link. No em dash, no en dash.
- Skipping the posting writes a real resume row through `POST /api/resumes`
  and opens the editor on it. That editor shows the invitation and **no
  number**: a score with no posting behind it is computed against a fixture
  posting for a job the candidate never applied to, it looks completely
  correct, and it is the fiction this step exists to prevent. The prompt's
  button opens the tailor panel over a document that is still on screen.
- `/start` renders: the step counter, the dropzone, the blank template
  button. And the word "verified" appears nowhere on it, or on `/resumes`.
  The product's claim is that a rewrite is *traced* to a line the candidate
  wrote; it does not verify that anything is true. "Verified" is one word
  away and would be a lie, so there is a test holding it off the page.
- Every prefix that used to be gated answers 200 with no `Location` header,
  `/` is a 307 to `/resumes` and nowhere else, and `/login` is a 404 rather
  than a redirect. Asserted at the HTTP level with redirects off, because a
  browser follows a redirect and the evidence disappears. This is the exact
  inverse of what `auth-gate.spec.ts` asserted before, and it is the same
  file: the property was not deleted, it was turned over.
- `/resumes` offers nothing to sign out of. A dead "Sign out" control is
  worse than no control, because it looks like there is a session behind it.
- `/start`, `/start/job` and `/resumes` at 375px: no horizontal scroll, nothing
  individually overflowing, both primary actions in the viewport, at least
  40px tall and hittable, and the mobile navigation drawer opens.
- Keyboard: one full tab cycle is skip link, dropzone, blank template, each
  control draws a visible focus ring, and the skip link reaches `#main`.
- axe on `/start`, `/start/job` (both inputs) and `/resumes`, clean and in
  the dropzone's error state.
  The threshold is serious and
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
not a broken state, it is the state of a fresh clone: nothing throws, and
every screen renders a panel naming the two variables and saying which file
they go in. It is the first thing a new contributor sees.

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
- The harness resolves the `next` binary rather than assuming it is under
  `apps/web/node_modules`. npm hoists to the workspace root, that directory
  can hold nothing but a vite cache, and the run then died with
  MODULE_NOT_FOUND before collecting a single spec. The `node_modules`
  symlink still points there on purpose: resolution walks up and finds the
  hoisted copy anyway, and pointing the link at the root instead makes
  Tailwind scan every dependency and emit utilities generated from the bytes
  of a binary, which fails the CSS parse.

Nothing there needs maintaining by hand. `src` is recopied each boot, so it
cannot go stale.

`/start` is scanned by axe here and in tier 1, and the two are not
redundant: here it renders the setup panel, there it renders the real upload
card. Same scan, same threshold.

If that server ever fails to start with "Parsing CSS source code failed",
delete `unconfigured-app/.next`. Tailwind can cache a garbled stylesheet if
it happens to read `apps/web/src` while something else is writing to it, and
the scratch project keeps its own Turbopack cache.

## Tier 2, the full funnel

```sh
npm run e2e:tier2
```

No credentials. There used to be two environment variables, a `setup`
project and an `auth.setup.ts` that exchanged them with GoTrue for a session
cookie; authentication has been removed from the app, so all three are gone
and the suite runs for anyone with the dev server up. `.auth/` is gone with
them.

**Why it is still out of CI.** It uploads a real PDF, runs the real document
service and the real model, and writes rows to whatever database
`apps/web/.env.local` points at. That is slow and it costs money, and it is
destructive in the sense that it leaves data behind. It also needs migration
`0009_single_user.sql` applied, or every insert is refused for want of a
`user_id`.

What it covers: upload a PDF and land on `/start/template?document=<uuid>`,
pick a template and land on `/start/job?document=<uuid>&template=<id>`, skip
the posting and land on a working editor at `/resume/<uuid>`, that editor
showing the no-posting invitation rather than a number while still taking an
edit, undo restoring the previous text, the two column card carrying its
parser warning, and a download whose first bytes are `%PDF-`.

It takes the skip rather than running the real tailor, on purpose: the
tailor is four model calls and up to five minutes, and the plumbing this
suite exists to check is the same on either branch. The cost is that the
"score moves within 500ms" assertion is gone from this tier; the score
itself is covered by `src/lib/store/editor.test.ts`, which measures the
recomputation directly and holds it under one frame.

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
  `apps/web/node_modules`, so a bare import from this directory resolves
  somewhere. Playwright honours tsconfig `paths` when it transforms a spec.
  Be aware that npm hoists: those packages may actually sit at the
  repository root with `apps/web/node_modules` holding nothing but a vite
  cache. Playwright still resolves them, but anything that builds a path
  into `apps/web/node_modules` by hand will not, which is the harness note
  above.
- There is no `.auth/` any more. It held a live session token for the
  `setup` project, and neither exists.
