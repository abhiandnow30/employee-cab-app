---
description: employee-cab-app DEV deployment via GitHub Actions + Firebase — self-bootstrapping (asks setup questions on first run, deploys on subsequent runs). Dev only.
argument-hint: [--force] [--rollback] [--skip-tests] [--reconfigure]
allowed-tools: Bash, PowerShell, Read, Grep, Write, Edit
---

# /deploy — employee-cab-app (dev only)

You are the release engineer for employee-cab-app. This deploys ONLY to a dev
environment — no staging, no production, no approval gates exist in this command.
Deployment uses GitHub Actions triggered by pushing a git tag. On first run, ask
the user for dev infrastructure details and write the workflow. On subsequent
runs, skip setup.

Execution:
  PRE-CHECK:  Is .github/workflows/deploy.yml present and valid?
    NO  → FIRST-RUN mode (setup, then deploy)
    YES → NORMAL mode (deploy directly)

═════════════════════════════════════════════════
## STACK FACTS (do not re-derive, do not contradict)
═════════════════════════════════════════════════

This project has **no server, no container, and no image registry**. Deployment
targets Firebase. Anyone editing this command must keep that straight:

- **Client:** React Native / Expo SDK 57, web build via `react-native-web`, at `app/`.
  Build: `npm --prefix app run build:web` → `expo export --platform web` → `app/dist`.
- **Hosting:** Firebase Hosting serves `app/dist` (see `firebase.json` → `hosting.public`).
  `firebase.json` declares a **predeploy hook** that runs the web build for you, so
  `app/` dependencies MUST be installed in CI before any hosting deploy.
- **Server-side code:** `functions/` only — one Firestore-**triggered** Cloud Function
  (`onCabAssigned`). Node 20. It has **no HTTP URL** and cannot be curl'd.
- **Data:** Cloud Firestore + Realtime Database (managed). Rules live in
  `firestore.rules`, `firestore.indexes.json`, `database.rules.json`.
- **`backend/` and `database/` are empty README stubs.** No Express. No Postgres.
  Never generate steps that build, migrate, or connect to them.
- **No Dockerfile, and none is wanted.** If you ever feel the urge to `docker build`,
  `docker push`, or SSH into a host, you have misread the project — STOP.
- **No test suite exists** (no jest/RNTL installed). Report "no tests defined";
  never fake a pass. The web build is the real compile-time check.
- **`SENDGRID_API_KEY` is a Firebase secret**, set with
  `firebase functions:secrets:set` — it is NOT a GitHub secret and must never
  be added to GitHub.
- **`EXPO_PUBLIC_*` vars are inlined into the client bundle at build time**, so
  they are publicly readable by anyone who loads the site. Store the value in
  GitHub Secrets to keep it out of git, but treat it as public, and restrict the
  key by HTTP referrer in Google Cloud Console — not by hiding it.

Detected env templates: `app/.env.example` (1 key: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`).
Detected default branch: `main`.
Detected health endpoint: **MISSING** — there is no HTTP service. The closest
equivalent is an HTTP GET against the deployed Hosting URL.

═════════════════════════════════════════════════
## PHASE 0 — Locate the repo root
═════════════════════════════════════════════════

The git repository root is the `employee-cab-app` directory, which may NOT be the
directory this command was invoked from. Before anything else:

  git rev-parse --show-toplevel

If that fails ("not a git repository"), look for `employee-cab-app/.git` in a
subdirectory of the cwd and `cd` there. If you still cannot find a repo root,
STOP and tell the user where you looked.

Every path in this command is relative to that repo root. Run every git,
`gh`, and npm command from there.

═════════════════════════════════════════════════
## PRE-CHECK — Detect first run vs subsequent runs
═════════════════════════════════════════════════

Run:
  test -f .github/workflows/deploy.yml && echo EXISTS || echo MISSING

Also honour the `--reconfigure` flag: force FIRST-RUN mode even if the file exists.

If EXISTS and no `--reconfigure`: go to NORMAL mode.
If MISSING or `--reconfigure`: go to FIRST-RUN mode.

If a DIFFERENT deploy workflow exists (e.g. `.github/workflows/release.yml`) but
`deploy.yml` does not, WARN the user first:

  "Found an existing workflow at <path>. I'm about to create a separate
   deploy.yml. Continue, or should I stop so you can point me at the existing
   one? (continue / stop)"

Handle `--rollback` before anything else — see the ROLLBACK section at the end.

═════════════════════════════════════════════════
## FIRST-RUN MODE — Setup + deploy
═════════════════════════════════════════════════

Tell the user:

  📋 First-run DEV setup for employee-cab-app deploy.

  I'll ask you a few dev infrastructure questions (Firebase dev target, what to
  deploy, verification URL, CI auth, runner). Then I'll:
    1. Write .github/workflows/deploy.yml with your answers
    2. Print an exact checklist of what to add in GitHub (Secrets)
    3. Wait for you to add them, then continue with the deploy

  This is dev only — no staging, no production, no approval gates.
  Every future /deploy in this repo skips setup and goes straight to deploying.

Ask ONE question at a time. Wait for each answer. Do NOT suggest specific real
values — describe the shape of the answer only. If the user says "unknown" for any
required question, tell them to ask their team lead and STOP.

─────────────────────────────────────────────────
### Q1 — Dev target style (USER CHOICE)
─────────────────────────────────────────────────

This repo currently defines a single Firebase project in `.firebaserc`. Dev needs
its own target. Present the two options:

  A) **Separate Firebase dev project** — a second Firebase project used only for
     dev. Fully isolated: its own Firestore data, its own Auth users, its own
     Functions, its own Hosting site. Rules and Functions changes can be tested
     for real without touching anyone's live data. Costs a second project's
     quota; requires the Azure/Entra app registration and any API keys to be
     configured for it too.

  B) **Hosting preview channel on the existing project** — a temporary,
     separately-URL'd deploy of the web bundle only. Zero extra setup, but it
     **shares the live Firestore, RTDB, Auth, Functions and rules**. Only the
     static client differs. Deploying rules or functions to a preview channel is
     not possible — those are project-wide.

  Which? (A or B)

  ⚠ Say this plainly before they answer: with **B**, any Firestore/RTDB write the
  dev build makes hits real data, and you cannot dev-test `firestore.rules`,
  `database.rules.json`, or `functions/` in isolation. Choose B only if dev means
  "preview the UI".

Store as `DEV_TARGET_STYLE` (A or B).

─────────────────────────────────────────────────
### Q2 — Target identifier
─────────────────────────────────────────────────

  IF Q1 = A: the **Firebase project ID** of the dev project.
             (Shape: lowercase letters, digits and hyphens, as shown in Firebase
             Console → Project settings → Project ID.)
             Do NOT suggest a value. Do NOT reuse the project ID already in
             `.firebaserc` — that is the existing project, not a dev one.

  IF Q1 = B: the **preview channel ID** to deploy to.
             (Shape: a short lowercase slug; it becomes part of the preview URL.)

Store as `DEV_TARGET_ID`.

─────────────────────────────────────────────────
### Q3 — What should a dev deploy push? (USER CHOICE, multi-select)
─────────────────────────────────────────────────

  1) hosting          (the Expo web bundle — always includes the build)
  2) functions        (the onCabAssigned Cloud Function)
  3) firestore:rules + firestore:indexes
  4) database         (Realtime Database rules)

  Which of these? (e.g. "1", or "1,3", or "all")

  IF Q1 = B (preview channel): only option 1 is possible. Tell the user that
  options 2–4 are project-wide and cannot target a preview channel, and confirm
  they still want hosting-only. If they want 2–4, they need option A — offer to
  go back to Q1.

  IF functions (2) is selected: warn that Cloud Functions calling SendGrid
  require the **Blaze** plan on the target project, and that
  `SENDGRID_API_KEY` must be set on that project via
  `firebase functions:secrets:set SENDGRID_API_KEY` — it is not a GitHub secret.

Store as `DEPLOY_TARGETS` (the `--only` list, e.g. `hosting,functions,firestore,database`).

─────────────────────────────────────────────────
### Q4 — Verification URL
─────────────────────────────────────────────────

The URL the verify job will GET to prove the deploy is live.

  IF Q1 = A: the dev Hosting site URL (shape: `https://<something>.web.app` or a
             custom domain you've attached). Do NOT guess it from the project ID
             — ask.
  IF Q1 = B: leave blank — the preview channel URL is generated per-deploy and
             the workflow will read it from the deploy output.

Store as `VERIFY_BASE_URL` (may be empty when Q1 = B).

─────────────────────────────────────────────────
### Q5 — Smoke check path
─────────────────────────────────────────────────

Format: PATH → EXPECTED_STATUS
Parse SMOKE_PATH (before " → ") and SMOKE_STATUS (after).

Remember what this app is: a single-page app whose Hosting config rewrites
`**` → `/index.html`. So **almost any path returns 200 with the SPA shell** —
which makes a deep path a weak signal, not a strong one. The honest checks are:

  - `/` → 200                 (site is serving)
  - `/index.html` → 200       (same, explicit)

There is no API endpoint to hit: the client talks to Firestore over the SDK, and
`onCabAssigned` is Firestore-triggered with no URL. Tell the user this rather
than inventing an `/api/...` route. If they name a path, accept it, but do not
claim it verifies backend behaviour — it does not.

Also ask whether the verify job should assert that the served `index.html`
references a freshly-built bundle (a cheap way to catch "deploy succeeded but
served a stale build"). Store as `VERIFY_BUNDLE_CHECK` (yes/no).

─────────────────────────────────────────────────
### Q6 — CI authentication to Firebase (USER CHOICE)
─────────────────────────────────────────────────

  A) **Service account JSON** → one secret: `FIREBASE_SERVICE_ACCOUNT_DEV`
     Current recommended practice. Generate in Google Cloud Console → IAM →
     Service Accounts on the **target** project, create a JSON key, paste the
     whole JSON into the secret. The workflow writes it to a temp file and points
     `GOOGLE_APPLICATION_CREDENTIALS` at it.

  B) **`FIREBASE_TOKEN` CI token** (`firebase login:ci`) → one secret: `FIREBASE_TOKEN`
     Simpler, but it is a long-lived credential tied to a human user with that
     user's full access, and Google has been deprecating this path. Only pick it
     if your team already uses it.

  Which style? (A or B)

Store as `FIREBASE_AUTH_STYLE` (A or B).

IF A, tell the user which roles the service account needs, scaled to Q3:
  - hosting        → Firebase Hosting Admin
  - firestore/db   → Firebase Rules Admin (+ Cloud Datastore Index Admin for indexes)
  - functions      → Cloud Functions Admin, Service Account User, and
                     Secret Manager Secret Accessor (for SENDGRID_API_KEY)
  - always         → Firebase Viewer / Viewer on the project

─────────────────────────────────────────────────
### Q7 — Build-time public env vars
─────────────────────────────────────────────────

The web build inlines `EXPO_PUBLIC_*` variables. `app/.env.example` declares:

    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY

Ask: should the workflow supply this at build time from a GitHub secret named
`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`? (yes / no — no means the build runs without
it and any feature depending on it is degraded in dev.)

Ask whether any OTHER `EXPO_PUBLIC_*` var has been added since; if so collect the
names only. **Never ask for, and never accept, the values in chat.**

Repeat the warning: these end up readable in the shipped bundle. The GitHub
secret keeps the value out of git, not out of the browser. Restrict the Maps key
by HTTP referrer.

Store as `BUILD_ENV_VARS` (list of names).

─────────────────────────────────────────────────
### Q8 — Runner type (USER CHOICE)
─────────────────────────────────────────────────

  A) GitHub-hosted (`ubuntu-latest`)
     Correct for this project in almost every case — the deploy talks to
     Google's APIs over the public internet, so there's nothing private to reach.

  B) Self-hosted runner (you provide the runner label)
     Only if your org requires builds on its own infrastructure. If B, ask for
     the runner label (the value after `runs-on:`) and note the runner needs
     Node 20 and `npm` available.

  Which? (A or B)

Store as `RUNNER` (either `ubuntu-latest` or the label the user gives).

─────────────────────────────────────────────────
### Confirm and write files
─────────────────────────────────────────────────

Summarize back:

  Confirming DEV setup:
  ─────────────────────
  Dev target style:  <Q1: A separate project / B preview channel>
  Target ID:         <Q2>
  Deploying:         <Q3 list>
  Verify URL:        <Q4 or "generated per-deploy (preview channel)">
  Smoke check:       <Q5>
  Firebase CI auth:  <Q6: A service account / B CI token>
  Build env vars:    <Q7 names, or "none">
  Runner:            <Q8>

  Write .github/workflows/deploy.yml with these values? (yes / no / edit)

If yes → write the file (details below).
If edit → ask which field, then re-confirm.
If no → STOP.

─────────────────────────────────────────────────
### Writing .github/workflows/deploy.yml
─────────────────────────────────────────────────

Write `.github/workflows/deploy.yml`. Structure (DEV ONLY — one deploy job):

  name: Deploy (dev)

  on:
    push:
      tags:
        - 'v[0-9][0-9][0-9][0-9].*-dev'

  concurrency:
    group: deploy-dev
    cancel-in-progress: false

  jobs:
    build:
      runs-on: <RUNNER from Q8>
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'

        # There is no test suite in this repo. Say so; do not fake a pass.
        - name: Tests
          run: echo "::warning::No test suite defined in employee-cab-app — skipping tests. The web build below is the compile-time check."

        - name: Install app deps
          run: npm --prefix app ci

        # Only if functions is in DEPLOY_TARGETS:
        - name: Install functions deps
          run: npm --prefix functions ci

        # Only if Q7 selected any build env vars — pass them as env, not as a
        # committed file. Never echo the values.
        - name: Build web bundle
          env:
            EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: ${{ secrets.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY }}
          run: npm --prefix app run build:web

        - name: Fail if bundle is empty
          run: test -f app/dist/index.html || { echo "❌ app/dist/index.html missing — web build produced nothing"; exit 1; }

        - uses: actions/upload-artifact@v4
          with:
            name: web-dist
            path: app/dist
            retention-days: 7

    deploy-dev:
      needs: build
      runs-on: <RUNNER from Q8>
      environment: dev
      outputs:
        preview_url: ${{ steps.deploy.outputs.preview_url }}   # only when Q1 = B
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'

        - name: Install app deps
          run: npm --prefix app ci        # firebase.json predeploy rebuilds the bundle

        - name: Install functions deps    # only if functions in DEPLOY_TARGETS
          run: npm --prefix functions ci

        - name: Install Firebase CLI
          run: npm i -g firebase-tools

        # Auth — form depends on FIREBASE_AUTH_STYLE.
        # IF Q6 = A (service account):
        - name: Authenticate to Firebase
          run: |
            echo '${{ secrets.FIREBASE_SERVICE_ACCOUNT_DEV }}' > "$RUNNER_TEMP/sa.json"
            echo "GOOGLE_APPLICATION_CREDENTIALS=$RUNNER_TEMP/sa.json" >> "$GITHUB_ENV"
        # IF Q6 = B (CI token): no step; pass --token ${{ secrets.FIREBASE_TOKEN }}
        # on every firebase command instead.

        # Snapshot the current live site so --rollback has something to restore.
        # Hosting only, and only when Q1 = A (a preview channel never touches live).
        - name: Snapshot current live hosting → dev-previous
          continue-on-error: true
          run: |
            firebase hosting:clone <Q2>:live <Q2>:dev-previous --project <Q2>

        - name: Deploy
          id: deploy
          env:
            EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: ${{ secrets.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY }}
          run: |
            # IF Q1 = A (separate project):
            firebase deploy --only <DEPLOY_TARGETS from Q3> \
              --project <Q2> \
              --message "${{ github.ref_name }}"

            # IF Q1 = B (preview channel) — hosting only:
            firebase hosting:channel:deploy <Q2> \
              --project <project id from .firebaserc> \
              --expires 7d --json > channel.json
            # then parse the channel's live URL out of channel.json and write it to
            # $GITHUB_OUTPUT as preview_url

    verify:
      needs: [deploy-dev]
      if: always() && !cancelled()
      runs-on: <RUNNER from Q8>
      steps:
        - name: Smoke check
          run: |
            BASE="<Q4 VERIFY_BASE_URL>"            # or needs.deploy-dev.outputs.preview_url when Q1 = B
            CODE=$(curl -sS -o /dev/null -w '%{http_code}' --retry 5 --retry-delay 5 \
                     --retry-all-errors "$BASE<SMOKE_PATH>")
            [ "$CODE" = "<SMOKE_STATUS>" ] || { echo "❌ expected <SMOKE_STATUS>, got $CODE"; exit 1; }

        # Only if VERIFY_BUNDLE_CHECK = yes
        - name: Assert served bundle is not stale
          run: |
            curl -sS "$BASE/index.html" | grep -q '<script' || { echo "❌ index.html has no script tag"; exit 1; }

        - name: Roll back hosting on failure
          if: failure()
          run: |
            # Q1 = A only. Restores the snapshot taken before the deploy.
            firebase hosting:clone <Q2>:dev-previous <Q2>:live --project <Q2>

**Rollback honesty — state these limits in the generated file as comments, and to
the user:**

- Hosting rollback uses `firebase hosting:clone <site>:dev-previous <site>:live`,
  restoring the snapshot taken immediately before the deploy. If the snapshot step
  failed (e.g. first-ever deploy, no prior live release), there is nothing to
  restore and rollback is a no-op — the job must say so, not claim success.
- **Functions, Firestore rules, indexes and RTDB rules have NO automatic
  rollback.** Firebase does not version them the way Hosting versions releases.
  Recovery is to re-deploy from a known-good commit or tag. The verify job must
  report this explicitly instead of implying everything was reverted.
- A **preview channel deploy (Q1 = B) never touches live**, so it needs no
  rollback — a bad preview is simply a bad URL. Say that rather than emitting a
  dead rollback step.

─────────────────────────────────────────────────
### Print the manual GitHub setup checklist
─────────────────────────────────────────────────

After writing the workflow, print exactly this (fill placeholders from answers):

  ✅ .github/workflows/deploy.yml written (dev only).

  ═══════════════════════════════════════════════════════════════
  NOW DO THIS IN GITHUB (before your first deploy)
  ═══════════════════════════════════════════════════════════════

  STEP 1 — Add repository Secrets
  Go to: https://github.com/<your-org>/<your-repo>/settings/secrets/actions
  Click "New repository secret" for each below.

  ── Firebase CI auth (based on your Q6 choice: <A service account / B token>) ──
    IF you picked A:
      FIREBASE_SERVICE_ACCOUNT_DEV   (the ENTIRE service-account JSON, one paste)
    IF you picked B:
      FIREBASE_TOKEN                 (output of `firebase login:ci`)

  ── Build-time public vars (from Q7) ──
      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
      <any other EXPO_PUBLIC_* names collected>
    ⚠ These are inlined into the shipped bundle and are readable by anyone who
      loads the site. The secret keeps them out of git, not out of the browser.
      Restrict the Maps key by HTTP referrer in Google Cloud Console.

  ── NOT a GitHub secret ──
      SENDGRID_API_KEY is a FIREBASE secret. Set it on the target project with:
        firebase functions:secrets:set SENDGRID_API_KEY --project <Q2>
      Do not add it here.

  STEP 2 — If Firebase auth is service-account (A), create the key
    Google Cloud Console → IAM & Admin → Service Accounts (on project <Q2>)
    → Create service account → Keys → Add key → JSON.
    Grant the roles listed during Q6, matched to what you're deploying.
    Paste the whole JSON file contents into FIREBASE_SERVICE_ACCOUNT_DEV.

  STEP 3 — Prepare the dev Firebase target
    IF Q1 = A (separate project):
      • Create the dev Firebase project if it doesn't exist.
      • Enable Authentication and register the Microsoft/Entra provider — note the
        Azure app registration is SINGLE-TENANT; the dev project needs its own
        redirect URI added there or Microsoft sign-in will fail in dev.
      • Enable Firestore and Realtime Database.
      • If deploying functions: upgrade that project to the Blaze plan and set
        SENDGRID_API_KEY (Step 1).
      • Add the dev project to .firebaserc as a named alias if you want to run
        deploys by hand too.
    IF Q1 = B (preview channel):
      • Nothing to create. Remember the preview shares LIVE Firestore/Auth/rules.

  STEP 4 — Local env file (unchanged by this workflow)
    app/.env holds EXPO_PUBLIC_GOOGLE_MAPS_API_KEY for local runs. It is
    git-ignored. CI does not read it — CI uses the GitHub secret from Step 1.
    Never paste its contents in this chat.

  STEP 5 — Commit and push the workflow
    git add .github/workflows/deploy.yml
    git commit -m "add dev deploy workflow"
    git push

  ── IMPORTANT ──
  Enter every secret ONLY in the GitHub Secrets UI. Never type a secret value
  in this chat.

  Have you added the secrets and committed the workflow? (yes / not yet)

If user says "not yet" → STOP. Tell them to re-run /deploy when ready.
If user says "yes" → continue with the deploy (NORMAL MODE, Phase 2–11 below).

═════════════════════════════════════════════════
## NORMAL MODE — Run the deploy (Phase 2–11)
═════════════════════════════════════════════════

Runs on every /deploy after first-run setup is complete. Dev only — no
environment question needed.

═════════════════════════════════════════════════
## Phase 2 — Commit pending changes locally (NO push yet)
═════════════════════════════════════════════════

Detect uncommitted work (staged, unstaged, untracked).

If any non-empty: show `git status --short` and ASK:
  Type: commit / stash / abort

On commit: ask for message (default: `pre-deploy(dev): changes before <timestamp>`),
then `git add -A && git commit -m "<msg>"`. Push deferred to Phase 6.5.

On stash: `git stash push -u -m "pre-deploy-dev stash <timestamp>"`.

On abort: STOP.

═════════════════════════════════════════════════
## Phase 3 — Git pre-flight (relaxed for dev)
═════════════════════════════════════════════════

1. Git repo exists (resolved in Phase 0).
2. Not detached HEAD.
3. No rebase/merge/cherry-pick in progress.
4. Branch check — RELAXED: any branch allowed for dev.
   Print: "✅ Deploying branch: <branch> (any branch OK for dev)"
   Note the repo's default branch is `main`; the working branch is often
   something else (e.g. a feature branch) — that is fine for dev.
5. Tree clean (should be true after Phase 2).
6. Local not behind remote (`git fetch` then compare).
7. **.env files NOT in git history — SECURITY hard-fail.** Check:
     git log --all --full-history --name-only -- '*.env' '*.env.local' '*.env.dev'
   `app/.env.example` is expected and fine. Any real `.env` in history is a
   hard-fail: STOP and tell the user the key must be rotated, because rewriting
   history does not un-leak a value that was pushed.
8. `.gitignore` covers env file patterns. The repo root `.gitignore` already has
   `.env`, `.env.*`, `!.env.example` — those are path-less patterns, so they
   match at every depth including `app/`. Confirm, don't duplicate.
9. CI status → WARNING ONLY (dev is a sandbox, red CI doesn't block).

═════════════════════════════════════════════════
## Phase 4 — Local env check
═════════════════════════════════════════════════

Env files: `app/.env` (template `app/.env.example`, 1 key).

For each path:
1. `app/.env.example` exists → verify the real `app/.env` has no placeholder
   values (e.g. a value still reading `your-google-maps-api-key-here`).
2. Report any key present in `.env.example` but missing from `.env`.

Report ONLY KEY NAMES on issues. **NEVER print env values.**

A missing/placeholder Maps key is a WARNING, not a blocker — it degrades
map/ETA features, it does not break the build. Say which it is.

═════════════════════════════════════════════════
## Phase 5 — Local tests + build
═════════════════════════════════════════════════

Tests: **no test suite defined in this repo.** Print exactly:
  "backend: no tests defined · frontend: no tests defined"
Do NOT fake a pass, and do NOT invent a test command.

Build (this IS the real check):
  npm --prefix app ci        (or `npm --prefix app install` if no lockfile change desired)
  npm --prefix app run build:web

Then assert `app/dist/index.html` exists. A build that exits 0 but produces no
`index.html` is a failure.

If `functions` is in the deploy targets, also run `npm --prefix functions ci` and
`node --check functions/index.js` as a minimum syntax gate.

`--skip-tests`: there are no tests to skip. If passed, print:
  "⚠️  --skip-tests passed, but this repo has no test suite. Skipping the local
   web build instead is NOT done — the build is the only real check."
and still run the build.

═════════════════════════════════════════════════
## Phase 6 — Optional gstack quality gates
═════════════════════════════════════════════════

If `~/.claude/skills/gstack` exists (this repo's CLAUDE.md documents gstack routing):
  Ask "Run /review before dev deploy? (yes/skip)"
If gstack not installed → skip silently.

If the diff touches `firestore.rules`, `database.rules.json`, or `functions/`,
recommend `/cso` (security check) before continuing — those are the files where a
dev mistake can expose live data, especially under a preview-channel setup.

═════════════════════════════════════════════════
## Phase 6.5 — Push tested code to origin
═════════════════════════════════════════════════

Only pushes AFTER the build and any review pass.
  git push origin <branch>

═════════════════════════════════════════════════
## Phase 7 — Deploy plan (HARD GATE)
═════════════════════════════════════════════════

Print:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEV DEPLOY PLAN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Environment:  dev
    Firebase:     <target style> → <target id>
    Deploying:    <DEPLOY_TARGETS>
    Commit:       <SHA> — "<message>"
    Branch:       <branch>
    Deployer:     <git config user.name>
    Tag will be:  v<YYYY.MM.DD-HHMM>-dev

    This tag triggers .github/workflows/deploy.yml.
    Pipeline: build web bundle → firebase deploy → smoke check → hosting rollback on failure.

    <IF preview channel:>
    ⚠ This preview shares LIVE Firestore, Auth and rules. Writes hit real data.

    <IF deploying functions/rules:>
    ⚠ Functions and rules have NO automatic rollback. Recovery = redeploy a
      known-good tag.

    Type DEPLOY to proceed.

Only continue on EXACT match of "DEPLOY". Skip only with `--force` (warn loudly).

═════════════════════════════════════════════════
## Phase 8 — Push git tag → GitHub Actions wakes up
═════════════════════════════════════════════════

  SHA=$(git rev-parse --short HEAD)
  TAG="v$(date +%Y.%m.%d-%H%M)-dev"

  git tag -a "$TAG" -m "deploy(dev): $(git log -1 --pretty=%s)"
  git push origin "$TAG"

═════════════════════════════════════════════════
## Phase 9 — Watch the GitHub Actions pipeline
═════════════════════════════════════════════════

  gh run watch --exit-status

If `gh` is not installed or not authenticated, say so and give the Actions URL
for the repo instead of pretending to watch.

═════════════════════════════════════════════════
## Phase 10 — Post-deploy verification
═════════════════════════════════════════════════

The workflow's verify job runs the smoke check and handles hosting rollback if it
fails. Report the pipeline result as it actually was.

If the deploy included functions or rules, state plainly that those were NOT
covered by rollback, and whether they landed.

If the target was a preview channel, report the generated preview URL from the
job output.

═════════════════════════════════════════════════
## Phase 11 — Report + audit log
═════════════════════════════════════════════════

Print success or failure summary based on the `gh run watch` exit code.

Append to `deploys.md`:
  ## <ISO timestamp> — dev-<SHA>
  - Environment: dev
  - Firebase target: <style> / <id>
  - Deployed: <DEPLOY_TARGETS>
  - Deployer: <git config user.name>
  - Result: success / failed / rolled back
  - Commit: <sha> — "<message>"
  - Pipeline: <URL from gh run view>

═════════════════════════════════════════════════
## ROLLBACK — `/deploy --rollback`
═════════════════════════════════════════════════

Read the last entry in `deploys.md` and confirm with the user what they are
rolling back.

- **Hosting (separate project):**
    firebase hosting:clone <target>:dev-previous <target>:live --project <target>
  If `dev-previous` does not exist, say so — there is nothing to restore.
- **Hosting (preview channel):** nothing to roll back; live was never touched.
  Optionally delete the channel: `firebase hosting:channel:delete <channel>`.
- **Functions / Firestore rules / indexes / RTDB rules:** no automatic rollback
  exists. Offer to check out the previous known-good tag and re-run the deploy
  from it. Never claim these were reverted when they were not.

═════════════════════════════════════════════════
## Hard rules (never violate)
═════════════════════════════════════════════════

- This command is DEV ONLY. Never add staging or production paths here.
- **Never generate Docker, container-registry, or SSH steps.** This project has
  no server and no image. If a step needs a host, a port, or a registry, it is wrong.
- NEVER print env VALUES anywhere — only KEY NAMES.
- NEVER ask the user to type secret values in chat — always via the GitHub UI
  (or `firebase functions:secrets:set` for SENDGRID_API_KEY).
- NEVER put SENDGRID_API_KEY in GitHub Secrets — it belongs to Firebase.
- NEVER hardcode a service-account JSON, CI token, or API key in the workflow.
- NEVER skip Phase 2 — uncommitted work never deploys.
- NEVER push in Phase 2 — push only after the Phase 5 build passes (Phase 6.5).
- NEVER claim success without Phase 10 (verify job) passing.
- NEVER proceed past Phase 7 without EXACT "DEPLOY" string match.
- NEVER report "tests passed" — this repo has no tests. Report "no tests defined".
- NEVER claim functions or rules were rolled back. Only Hosting can be, and only
  when the pre-deploy snapshot succeeded.
- NEVER let a preview-channel deploy be described as isolated — it shares live data.

$ARGUMENTS
