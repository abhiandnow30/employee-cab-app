# Microsoft sign-in — setup

Employees can sign in with their company Microsoft (Entra ID) account, in
addition to email/password — never instead of it. Nobody can use this until
you complete the steps below in your own Azure and Firebase consoles; none of
this can be done from code or the `firebase` CLI.

## How it fits into this app

- **Every employee with a company Microsoft account can sign in — invited or
  not.** Someone HR has entered (Employee Management, or the monthly roster
  upload) arrives with their employee id, phone, address and pickup route
  already filled in. Someone who hasn't been entered still gets in, with those
  fields blank and flagged `selfProvisioned`, so they can reach the app and ask
  the desk for a cab. This is why **step 1.3 below — single tenant — is not
  optional**: it is the only thing that makes "every employee" mean your
  company's employees rather than every Microsoft account in the world.
- **This project stays on the free Spark plan — deliberately, no Cloud
  Functions.** Cloud Functions (any version) require the paid Blaze plan just
  to deploy at all, regardless of what the function does or how little it's
  used — Artifact Registry/Cloud Build are billed services Google gates
  behind it. Microsoft sign-in itself needs none of that: it is a built-in
  Firebase Auth provider, and everything below runs client-side.

### The normal path: one click, no password, ever

HR does **not** create a login for anyone. An employee clicks **"Sign in with
Microsoft"**, Firebase creates their account under a fresh uid, and the app
builds their profile at `employees/{that uid}` from whichever of these applies:

1. **HR entered them** (Employee Management, or the monthly roster upload). HR
   files an **invite** at `employeeInvites/<their email>` holding name,
   employee id, phone, address and route. The app claims it into their profile
   and deletes the invite in the same batch (single-use). They arrive complete.
2. **HR hasn't entered them.** They still get in — `selfProvisionsFromDirectory()`
   creates an `employee` profile from the token, flagged `selfProvisioned`, with
   **no** employee id, phone, address or route. Enough to open the app and ask
   the desk for a cab; not enough to be routed into one until the desk fills
   those in. This is what lets someone who isn't on this month's roster ask for
   a ride at all.

Either way: no password entry, no confirmation screen, nothing to explain. The
uid is theirs from the start, so nothing ever needs re-keying.

**What stops this being open sign-up:** `signedInWithDirectory()` in
`firestore.rules` requires `sign_in_provider == 'microsoft.com'`, and the Azure
app registration is single-tenant — so Microsoft itself refuses a token for
anyone outside the company directory. `role` is pinned to `employee`, and
`hasOnly()` pins the document to token-supplied fields, so no desk role and no
self-chosen pickup route can come in this way. A *verified email* is
deliberately not sufficient anywhere near this path: anyone can verify their
own personal address.

**Two consequences worth knowing:**

- **Offboarding is IT's job now.** Deleting an `employees/<uid>` document no
  longer locks anyone out — they recreate it on their next sign-in. Access ends
  when their Microsoft account is disabled in Entra.
- **Shifts import after first sign-in, not at upload.** A shift document is
  keyed by uid, and a uid exists only once the person has signed in. The roster
  screen's report re-derives live, so people are picked up as they arrive — no
  re-upload needed.

### Keep "one account per email address" enabled

Firebase Console → **Authentication → Settings**. It's the default; leave it on.
With it off, an employee who already has a password login would get a *second*
account on Microsoft sign-in plus a fresh blank profile, orphaning their roster
and ride history — instead of being sent down the confirm-and-link path below.

### Fallbacks (existing accounts only)

- If an employee **already has** an HR-created email/password account, their
  profile sits under that older uid, and Firebase will not attach Microsoft to
  it without proof of ownership. Those people get the **"Confirm your
  Microsoft sign-in"** screen once: one password entry links Microsoft onto
  their real account (same uid, no data moves), and every sign-in after that
  is direct. New hires never see this.
- This also covers `auth/account-exists-with-different-credential`, which
  Firebase raises when "one account per email address" (the default) blocks a
  Microsoft sign-in whose email matches an existing password login.
- Someone with **neither** an account nor an invite falls through to
  "Account not set up" — the same fail-closed behavior the app guarantees for
  email/password (see `CLAUDE.md` → Access model). It never guesses.
- The **manual link-from-Profile** flow (`ProfileScreen.js`) still exists for
  anyone who'd rather link proactively.
- **Drivers keep email/password logins** — they aren't in the company
  directory, so there's no Microsoft account for them to use.

## 1. Register an app in Microsoft Entra ID

1. Go to the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID**
   → **App registrations** → **New registration**.
2. Name it something like "Cab Service".
3. Under **Supported account types**, choose **Accounts in this
   organizational directory only (Single tenant)** — this is what restricts
   sign-in to your company's own accounts.
4. Register the app, then note down from the **Overview** page:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## 2. Add redirect URIs

Still on this app registration, go to **Authentication** → **Add a platform**:

- **Web** platform: add
  `https://<your-firebase-project-id>.firebaseapp.com/__/auth/handler`
  (Firebase shows you this exact URL again in step 4 below — you can come
  back and confirm it matches).
- **Mobile and desktop applications** platform: add the custom redirect
  `cabservice://microsoft-auth` (matches the `scheme` already set in
  `app.json` plus the path the app requests it on).

Under **Implicit grant and hybrid flows** (same Authentication page), check
**ID tokens (used for implicit and hybrid flows)** and save. Without this,
Microsoft will refuse to hand back an `id_token` at all, and every sign-in
attempt will fail.

## 3. Create a client secret

**Certificates & secrets** → **New client secret** → give it a description and
expiry → copy the **Value** immediately (Azure only shows it once).

## 4. Enable Microsoft in the Firebase Console

**Authentication** → **Sign-in method** → **Add new provider** → **Microsoft**:

- **Application ID**: the Client ID from step 1.
- **Application secret**: the client secret from step 3.
- Save, then copy the callback URL Firebase shows you and double check it
  matches what you entered as the Web redirect URI in step 2.

**If the web app is served from a custom domain** (e.g. a domain connected via
Firebase Hosting's own "Add custom domain" flow), that domain also needs to be
on **Authentication → Settings → Authorized domains**, or `signInWithPopup`
will fail there with `auth/unauthorized-domain` even though it works fine on
`localhost` or the default `<project-id>.firebaseapp.com` domain. Adding a
custom domain through Firebase Hosting's own wizard usually adds it here
automatically — worth double-checking rather than assuming. This is separate
from, and doesn't change, the Azure redirect URI above: that always stays on
your project's `authDomain` (`cab-app-eec4c.firebaseapp.com`) regardless of
which domain the app is actually served from.

## 5. Fill in `.env`

In `app/.env` (already git-ignored):

```
EXPO_PUBLIC_MICROSOFT_CLIENT_ID=<Application (client) ID from step 1>
EXPO_PUBLIC_MICROSOFT_TENANT_ID=<Directory (tenant) ID from step 1>
```

Neither value is a secret (same reasoning as the Firebase web config in
`services/firebase.js`) — the actual secret only ever lives in the Firebase
Console from step 4.

**Restart the Expo dev server** after editing `.env` — environment variables
are baked in at bundle time, so a running server won't pick up the change.

## 6. Test

- **Web**: `npm run web` (or your usual web dev command), then try "Sign in
  with Microsoft" on the login screen — this uses a plain popup and needs no
  further setup once steps 1–5 are done.
- **Phone**: test with a real development build (`expo run:ios` /
  `expo run:android`, or an EAS development client) rather than Expo Go —
  custom-scheme OAuth redirects are more reliable there. First-time native
  testing of any new OAuth integration commonly needs a couple of rounds of
  live debugging (wrong redirect URI registered, tenant mismatch, etc.) even
  when the code itself is correct — that's normal for this kind of
  integration, not a sign something's broken.

## What employees actually do

1. They open the app and click **"Sign in with Microsoft"**.
2. They're in. That's the whole flow, first time and every time.

Nothing to brief them on, and no temporary password in circulation.

HR's job is no longer to grant access — the directory does that — it's to make
sure riders arrive **complete**. Someone HR entered has their address and
pickup route already set and can be grouped into a cab immediately. Someone who
self-provisioned shows up with neither, and the desk has to fill those in
before they can be picked up.

Email/password still works side by side for anyone who has a password (drivers,
admins, and employees provisioned before this change), and **Profile → "Link
Microsoft account"** still exists for linking proactively.
