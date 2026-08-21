# Mailer — SendGrid email without Cloud Functions

Sends the rider's "your cab has been assigned" email using the company's existing
paid SendGrid account, **without Firebase Cloud Functions and without the Blaze
plan**.

## Why not Cloud Functions

A Cloud Function that calls an external API (SendGrid) needs Blaze — the free
Spark plan blocks outbound network calls, and Functions v2 can't be deployed on
Spark at all. `functions/index.js` is that version, written and left parked. It
is not deployed.

## Why not call SendGrid straight from the app

Two hard blockers, both fatal:

1. **The API key would ship to every user.** Anything in the Expo bundle
   (`EXPO_PUBLIC_*` or a plain constant) is readable by anyone who opens
   DevTools or unzips the APK. A leaked SendGrid key means anyone can send mail
   as the company — and the practical consequence is the sending domain's
   reputation, not just this app.
2. **`api.sendgrid.com` sends no CORS headers**, so the web build's request
   fails in the browser regardless.

## The shape of it

```
desk assigns a cab
      │
      ├─ Firestore: bookings/<id>.status = "Cab assigned"   (unchanged)
      ├─ Firestore: notifications/<id>                      (unchanged, in-app)
      ├─ Firestore: mailQueue/<id>  { type, bookingId, employeeId, pending }
      │
      └─ POST <worker>/send  { idToken, ids: [...] }
                │
                ▼
         this worker (Cloudflare, free tier)
                │  verifies the ID token (RS256 vs Google's JWKS)   ← gate 1
                │  reads mailQueue / bookings / employees / cabs
                │  via Firestore REST, AS THE CALLER                ← gate 2
                │  builds the email from its own template           ← gate 3
                ├─ POST api.sendgrid.com/v3/mail/send   (holds the key)
                └─ marks the job sent / failed
```

### The three gates that make a public endpoint safe

They are not interchangeable, and the worker holds no Firebase credentials in any
of them — there is no service-account key here.

**1. Authentication — is this a real user of our project?** `verifyIdToken()`
checks the caller's Firebase ID token the way any server would: RS256 signature
against Google's published JWKS (keyed by the token's `kid`, cached, refetched on
rotation), plus `iss`, `aud`, `exp`, `iat` and `sub` pinned to this project. The
algorithm is pinned to RS256, so `alg: none` and an HS256 key-confusion swap are
both rejected. A forged or expired token dies here, before any Firestore or
SendGrid call is made.

**2. Authorisation — may they send mail?** Every Firestore read and write uses
**the caller's own token**, so `firestore.rules` decides — the same rules the app
runs under. A rider's token is entirely valid at gate 1 and still sends nothing,
because `mailQueue` is desk-only.

Gate 2 is not made redundant by gate 1, which is why the token is still forwarded
rather than merely checked: signature verification **cannot see a revoked session
or a disabled account** — the signed token stays cryptographically valid until it
expires. Firestore checks revocation server-side on every call. Gate 1 is the
cheap early filter; gate 2 is the authority. Keep both.

**3. No caller-supplied content** — the body carries job ids and nothing else. The
worker looks the rider up from the booking and renders the message from the
template in `src/worker.js`. So the worst a signed-in desk user can do is email a
real rider about their own real booking. Never add a caller-supplied
`to`/`subject`/`html`; that is what turns this into an open relay.

A Google JWKS outage does **not** stop sending: a cached key set keeps verifying.
Only an unrecognised `kid` needs the endpoint, and if it's unreachable the request
fails closed with a retryable 503.

## Deploy (Cloudflare Workers — free, no card required)

```bash
cd mailer
npm install

# 1. Sign in (opens a browser once)
npx wrangler login

# 2. The SendGrid key — a Worker secret, not in wrangler.toml, not in git
npx wrangler secret put SENDGRID_API_KEY

# 3. Edit wrangler.toml: FROM_EMAIL must be a SendGrid-verified sender
#    (SendGrid → Settings → Sender Authentication). Check FIREBASE_PROJECT_ID
#    and ALLOWED_ORIGINS too.

# 4. Ship it
npm run deploy          # prints https://cab-mailer.<subdomain>.workers.dev
```

Then point the app at it and deploy the rules:

```bash
# app/.env  (git-ignored)
EXPO_PUBLIC_MAILER_URL=https://cab-mailer.<subdomain>.workers.dev

cd ..
firebase deploy --only firestore:rules      # adds the mailQueue block
npm --prefix app run build:web && firebase deploy --only hosting
```

`EXPO_PUBLIC_MAILER_URL` is inlined into the shipped bundle and is public. That's
fine and intended — see the safety properties above. Rebuild the web bundle after
changing it; the value is baked in at build time.

Logs: `npm run tail`.

## Local testing

```bash
# mailer/.dev.vars  (git-ignored — copy from .dev.vars.example)
SENDGRID_API_KEY=SG.xxxx

npm run dev     # http://localhost:8787
```

Point `app/.env` at `http://localhost:8787`, run `npm --prefix app start`, sign in
as the desk and assign a cab to a rider whose profile has your own address in
`email`. Then check:

- Firestore → `mailQueue` → the job flipped `pending` → `sent`, with `sentTo`;
- SendGrid → Activity Feed → the message;
- a job stuck at `failed` carries the reason in `lastError` — an unverified
  `FROM_EMAIL` shows up here as a SendGrid 403;
- a job stuck at `sending` means the sender died mid-flight (worker killed,
  SendGrid accepted but the outcome write didn't land). Nothing retries that
  state on purpose: whether the mail went out is genuinely unknown, and silently
  re-sending is the worse guess. Set `status` back to `pending` in the console to
  retry it deliberately.

Send nothing to real riders while testing: a queued job is only ever built from
a real booking, so use a test booking.

## What this does NOT do (and what to do about it)

**No trigger means the desk's client starts the send.** A Firestore trigger fired
server-side no matter what the browser did; this doesn't. The `mailQueue`
collection is the mitigation: the intent is recorded durably before any HTTP call,
so a job never silently vanishes — it sits `pending` and the next assignment's
flush retries it (`stalePendingIds()` in `app/src/services/mail.js`).

The gap that remains: if nobody assigns another cab, nothing re-triggers the
flush. Jobs stay `pending` and visible in Firestore, but unsent. In practice the
desk assigns in batches all evening, so a straggler is picked up minutes later. If
that isn't good enough, the cheapest closure is a scheduled sweep — a GitHub
Actions cron (this repo already uses Actions for `/deploy`) that signs in as a
service account and POSTs any pending ids to this same worker. That needs a
service-account key as a GitHub secret, which is a deliberate security decision,
so it is documented rather than built.

**Only cab-assigned emails.** `MAIL_TYPES` in `src/worker.js` and the `type` pin
in the `mailQueue` rules are both one-element lists. Adding "ride cancelled"
means: a builder function in the worker, the new type in both lists, and a
`queue…Emails()` call at the right place in `AppContext`.

**Duplicate emails are possible on reassignment.** Assigning a cab twice queues
twice, exactly as the Cloud Function re-sent when `assignedCabId` changed. Two
desk browsers flushing the same backlog do *not* duplicate: each job is claimed
with an `updateTime` precondition, so only one sender wins.

**Revocation is gate 2's job, not gate 1's.** Local verification can't know a
session was revoked or an account disabled — a stolen token stays verifiable until
`exp` (Firebase ID tokens last an hour). Firestore rejects it server-side on every
call, so the real exposure is nil *as long as the worker keeps acting as the
caller*. If anyone ever replaces that with a service-account key, this protection
leaves with it, and `accounts:lookup` (or Admin-SDK `checkRevoked`) would be
needed to replace it. Same for `verifyIdToken()`: don't reduce it to decoding the
payload — a JWT's claims are attacker-controlled until the signature is checked.

## Other free hosts

`src/worker.js` is a standard `fetch(request, env)` module with no Cloudflare-only
APIs, so porting is a shim plus wherever that host keeps secrets:

| Host | Entry point | Config |
| --- | --- | --- |
| Cloudflare Workers | `export default { fetch }` (as-is) | `wrangler secret put` |
| Deno Deploy | `Deno.serve((r) => handle(r, Deno.env.toObject()))` | dashboard env vars |
| Vercel | `api/send.js` → `export const config = { runtime: 'edge' }`, `export default (r) => handle(r, process.env)` | project env vars |
| Netlify Edge | `export default (r, ctx) => handle(r, Netlify.env.toObject())` | site env vars |

The path is ignored — any POST to the worker is treated as a send request — so
`/send`, `/api/send` and `/` all work.
