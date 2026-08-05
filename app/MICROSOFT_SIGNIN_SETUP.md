# Microsoft sign-in — setup

Employees can sign in with their company Microsoft (Entra ID) account, in
addition to email/password — never instead of it. Nobody can use this until
you complete the steps below in your own Azure and Firebase consoles; none of
this can be done from code or the `firebase` CLI.

## How it fits into this app

- An employee's account and `employees/{uid}` profile are still always
  created by the admin first, in **Employee Management**, exactly as before.
- Microsoft is an *additional credential* an employee links onto that SAME
  account from their **Profile** screen, after signing in once normally.
  Linking never changes their `uid`, so nothing about their profile, ride
  history, or the access-control rules changes.
- A Microsoft sign-in that was never linked to an existing account lands on
  the "Account not set up" screen with an explanation, rather than silently
  creating a new blank profile — same fail-closed behavior the app already
  guarantees for email/password (see `CLAUDE.md` → Access model).

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

1. Admin creates their account in Employee Management, as always
   (email + temporary password).
2. They sign in once with that email/password.
3. On their **Profile** screen, they tap **"Link Microsoft account"** and
   sign in with their company Microsoft account.
4. From then on, **"Sign in with Microsoft"** on the login screen works for
   them too — email/password still works as well, side by side.
