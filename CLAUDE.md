# Employee Cab Facility App — AI Assistant Guide (GStack)

This file configures the AI development assistant for this repo. Read it before making changes.

## What this project actually is

A corporate cab-booking app for employees (company-owned cabs; shift-based + on-demand rides).

**Real stack (verified from code):**
- **Client:** React Native (Expo SDK 57), one codebase for **iOS, Android, and web** via `react-native-web`.
- **UI kit:** React Native Paper (Material Design 3) + `@expo/vector-icons` (MaterialCommunityIcons).
- **Navigation:** `@react-navigation/native-stack` with deep-linking (each screen has a web URL).
- **State:** a single React Context — `src/context/AppContext.js` (the app's "store").
- **Backend:** **Firebase, called directly from the client. There is NO custom server.**
  - **Cloud Firestore** — `employees`, `employeeInvites` (passwordless provisioning, keyed by email), `cabServiceRequests` (non-rostered riders asking to be set up), `bookings`, `cabs`, `config/timings`, `feedback`, `ratings`.
  - **Realtime Database** — live cab GPS at `cabs/{cabId}/location`.
  - **Firebase Auth** — email/password.
- **Maps/geo:** Leaflet + OpenStreetMap on web; OSRM for routing/ETA; Nominatim for geocoding. Native maps are placeholders (see gaps below).

> IMPORTANT: The `backend/` (Node/Express) and `database/` (PostgreSQL) folders are **empty README stubs — "not built yet."** This is **not** an Angular / Spring Boot / SQL project. There are no Controllers, Repositories, JPA Entities, DTOs, or SQL tables. Do not invent them. Map any "backend" or "database" request onto Firestore collections, `firestore.rules`, and the `src/services/*` modules.
>
> The one exception is `functions/` — a single Firestore-triggered Cloud Function (`onCabAssigned`) that emails a rider when their cab is assigned/reassigned. It's the only server-side code in the project; everything else stays client → Firestore/RTDB directly.

## Directory map (`app/` is the only real code)

```
app/
  App.js                     Root: PaperProvider + AppProvider + NavigationContainer; role-based stack; deep-link config; responsive sidebar/drawer
  src/
    context/AppContext.js    Single global store: auth, live bookings/cabs/timings, ~35 action fns via useApp()
    services/                Firebase + external-API access layer ("the backend calls")
      firebase.js            Firebase init; config is committed (web config is not secret); exposes auth/firestore/db
      auth.js                Firebase Auth wrappers + friendlyAuthError()
      profile.js             employees/{uid} CRUD; admin provisioning; driver↔cab linking (both sides, atomic)
      bookings.js            bookings CRUD + live subscriptions + cancel/no-show/assign + capacity & conflict helpers + address sync
      cabs.js                fleet CRUD (vehicle fields only), linkCabDriver (both sides,
                             atomic), unlinkCabDriver, removeCabSafely (cascades), capacity
      settings.js            config/timings (admin-editable pickup/drop times)
      tracking.js            Realtime DB live location, keyed by DRIVER uid
      directions.js          OFFICE constant, OSRM routing, ETA/distance formatting
      maps.js                Google Maps key from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (reserved for the unbuilt native map)
    screens/
      LoginScreen, SignUpScreen                     (logged-out)
      employee/  EmployeeHome, SelfRoster (Weekly Schedule), BookCab (ad-hoc), MyRides,
                 RosterHistory (Ride History), TripCancel, TrackCab, Feedback, RateUs,
                 ContactUs, Profile
      admin/     Bookings (home), AssignCab, ManageDrivers ("Drivers" — driver accounts),
                 ManageCabs ("Fleet" — vehicles + the driver↔cab link),
                 ManageTimings, CancelledRides, NoShows, TrackCabs, FeedbackInbox,
                 EmployeeManagement, AddressChangeRequests, Messages
      driver/    DriverHome (My Trips), DriverShareLocation
    components/  AppDrawer, Dropdown, ScreenContainer, ErrorBoundary, leaflet.js (shared web-map loader),
                 FleetMap.{web,native}, TrackMap.{web,native}
    data/mockData.js         Starter fleet + shared constants (STATUS, lead/cutoff hours, capacity, etc.)
    theme.js                 colors, statusColors, spacing, Paper MD3 theme
    branding.js              COMPANY_NAME + logo + SUPPORT_HELPLINE
    utils/datetime.js        Booking lead-time / cancel-cutoff / date-key helpers
    utils/useSyncedDraft.js  Edit form over live data (re-seeds while untouched — see its header)

functions/                   Cloud Functions (Admin SDK — the one place server code runs)
  index.js                   onCabAssigned: bookings/{id} onUpdate → status becomes
                              "Cab assigned" (or the assigned cab changes) → email the
                              rider via SendGrid with cab number, driver, pickup time.
```

## Data flow

`Screen` → `useApp()` (AppContext) → `services/*` → Firebase SDK. Screens never call Firebase directly except through services. Lists are **live**: `onSnapshot` subscriptions in AppContext push updates automatically. Sorting/filtering is done client-side.

## Roles & access

Three roles on `employees/{uid}.role`: `employee`, `admin`, `driver`. App.js swaps the entire screen set by role. Server-side access is enforced in `firestore.rules` (role read via `get()` on the caller's own employee doc). `database.rules.json` guards live location.

## Domain rules (do NOT change without being asked)

- **The company runs exactly TWO rides and nothing else, ever:** the Night shift's **8:00 PM pickup** from home (shift starts 21:00, 60-min lead) and the Afternoon shift's **10:00 PM drop** home. No third ride exists in the system — there is no shift-extension cab, no emergency ride, no "collect me at another time", and nothing an employee can raise adds a ride. Consequences to preserve: `ridesForDate()` takes no extra-request argument, `EFFECT` has no `EXTRA_RIDE`/`RETIME`, nothing routes to HR (`ROUTE_TO` has only `COORDINATOR`), and there is no Exception Approvals screen. Anyone genuinely stranded phones the desk.
- **The four change requests** are Leave, Absent today, Cancel one ride, and Shift changed — all of which only CANCEL or RE-CODE one of the two rides, and all of which land with the coordinator.
- **Cab service requests are a fifth, different thing — and are NOT a third ride.** A `cabServiceRequests` doc says "the desk has no address or route for me, please set me up"; approving writes name/empId/phone/address/`roster.route` onto `employees/<uid>` and creates no booking. It exists because self-provisioning (below) lets someone in without HR having entered them, so they arrive with nothing a cab could be sent to. See `services/cabServiceRequests.js`, `CabServiceRequestScreen` (employee), `CabRequestsScreen` (desk).
  - **`needsCabServiceSetup()` is keyed on the FIELDS, not on `selfProvisioned`** — an employee HR created years ago with a blank address is just as unpickupable as this morning's walk-up. An employee in that state is held at the request form by `holdForCabSetup` in App.js until they submit; submitting unlocks the whole app.
  - **Both desk roles see the queue, but only HR approves.** The coordinator writes `proposedRoute` and nothing else, because `firestore.rules` only lets them touch `roster.route` on a profile — the screen mirrors that split rather than offering a button that would fail. Approval also clears `selfProvisioned`, which is what marks them as vetted.
- **Booking sources:** `SOURCE.ROSTER` (weekly Self Roster) vs `SOURCE.ADHOC` (Book a Ride).
- **Status lifecycle:** `Booked → Cab assigned → On the way → Arrived → Completed`, plus `No show` and `Cancelled`.
- **Booking lead time:** `BOOKING_LEAD_HOURS = 9` (can't book too close to departure).
- **Cancel cutoff:** `CANCEL_CUTOFF_HOURS = 4`; cancellation is a *request* the admin approves/rejects.
- **Carpooling:** admin assigns one cab to many bookings via `assignCabToGroup` (atomic batch).
- **Office is fixed:** `OFFICE` in `directions.js` (Kondapur, Hyderabad).

### Pickup routes (the unit the coordinator assigns in)

- **Every employee belongs to a route** — the pickup area their cab collects from. Stored at `employees/<uid>.roster.route`; the route *names* are HR-editable in **Routes & Timings** (`config/timings.routes`, falling back to `CAB_ROUTES` in `data/mockData.js`).
- **Route is why grouping works.** One route ≈ one cabful of neighbours, so the coordinator's board turns ~200 rides into ~15 decisions. Anyone unrouted lands under "No route set" and is grouped by hand *every day of the month* — treat an unrouted employee as a real defect, not a cosmetic gap.
- **The profile is the source of truth, not the roster document.** `importRoster()` denormalises the route onto `rosters/<month>_<uid>` for the driver, but that copy is frozen at import time. `AppContext.ridesOn()` overlays the live profile route and only falls back to the snapshot — do NOT "simplify" that away, or re-routing someone mid-month silently does nothing until the next upload.
- **Route spellings are normalised on write, never compared case-insensitively.** `canonicalRoute()` in `services/roster.js` snaps a sheet value onto the configured list (`Jntu Cab` → `JNTU Cab`), so only one spelling ever reaches Firestore and the coordinator's grouping stays a plain exact match. A value matching nothing is *reported in the validation summary and not written* — inventing a route from a spreadsheet is how one pickup area ends up with three spellings and a carpool splits in two. Do not "fix" this by making consumers case-insensitive; that just moves the bug to whichever consumer is added next.
- **The roster sheet is now authoritative for name/phone/address/route on EVERY upload, not just at first provisioning.** (Reversed Jul 2026 → **changed back Jul 2026, at explicit admin request** — see `importRoster()` in `services/roster.js`.) For every row that matches an existing employee, `importRoster()` unconditionally overwrites their `employees/<uid>` name, phone, address, and `roster.route` with whatever the sheet says, whenever the sheet cell is non-blank. A blank cell never erases existing data, but a filled one always wins — including over a value HR set by hand or approved through the Address Requests flow. **This intentionally reintroduces the exact failure the previous rule existed to prevent**: re-uploading a stale or copy-pasted monthly sheet will silently revert any profile change made since. If that surprises someone, the fix is discipline on the sheet (always reflect current values before uploading), not code — this is the requested behavior, not a bug.
- **There is deliberately NO dedicated routing screen.** A route is one field of an employee's record, so it is set wherever that record is already open: the create dialog in **Employee Management**, the per-employee card there, and the coordinator's own dashboard for a rider who turns up unrouted mid-shift. A sheet with a `Route` column also writes it onto profiles at import — now unconditionally (see above), same as name/phone/address. (A bulk "Employee Routes" screen existed briefly and was removed: at this headcount it duplicated the card field. Reconsider it if routing ever means moving groups — a re-drawn pickup area, a moved office — since one-at-a-time is what stops that happening.)
- **The coordinator may write `roster.route` and nothing else** on an employee profile (`coordinatorSettingRoute()` in `firestore.rules` checks the nested map diff). They're the one who finds an unrouted rider at 9 PM; everything else on the profile stays HR-owned.

## Conventions to follow

- **Theme, not hex.** Use `colors` / `statusColors` / `spacing` from `theme.js`. (Many files currently hardcode hex — do not copy that; prefer theme tokens in new/edited code.)
- **Constants live in `data/mockData.js`.** Reuse option lists / status / hour constants instead of re-declaring.
- **Date/time logic lives in `utils/datetime.js`.** Reuse it; don't roll new formatters.
- **Data access goes through `services/*`,** never Firebase calls inside screens/components.
- **Platform splits** use `*.native.js` / `*.web.js` (Metro picks per platform). Keep prop parity across both halves.
- **Expo SDK 57 changed APIs** — see `app/AGENTS.md`: check https://docs.expo.dev/versions/v57.0.0/ before using Expo APIs.
- Comments in this codebase are plain-English and teaching-oriented; match that tone.

## Access model (do NOT weaken)

- **Admins are created in the Firebase console only** — console → Auth → add user, then a Firestore `employees/<uid>` doc with `role: 'admin'`. The rules refuse any self-created role except `driver`, so there is no in-app admin code any more (the old one shipped in the bundle).
- **Employees are provisioned as INVITES, with no account and no password** (`adminCreateInvite` / `adminInviteEmployees` in `services/profile.js`). HR files their details at `employeeInvites/<their email>`; the first time they click "Sign in with Microsoft", `getOrCreateProfile` claims that invite into `employees/<their own uid>` and deletes it. One click, first time, nothing to explain.
  - **Why it works this way:** Firebase Auth will not attach a new sign-in provider to an existing account without proof of ownership of it. So while HR pre-created an email/password login, a Microsoft sign-in arrived as a *different* uid and the only honest bridge was asking for the password once. Not pre-creating the login removes the second account entirely — there is nothing left to bridge. Do NOT "simplify" this back into `adminCreateAccount` for employees; that reintroduces the password step for every new hire.
  - **The email is the security boundary.** `createsFromInvite()` in `firestore.rules` requires an invite to already exist for the caller's *own* verified email, copies `role` from the invite, and refuses role `admin`. `emailIsTrusted()` requires `email_verified`, or that the caller signed in through `microsoft.com` (our single-tenant Entra directory). Without that gate, anyone could self-register a password account using a colleague's address — the Sign Up screen allows self-registration — and claim their invite. Never relax it.
  - **A shift document is keyed by uid, so an invited employee's shifts can only import once they have signed in at least once.** Roster upload invites everyone the sheet names who has no profile; the validation report re-derives live off the `employees` subscription, so their shifts import as they arrive with no re-upload. A brand-new hire who has never opened the app has no rides on the coordinator's board yet.
- **Drivers still get email/password accounts** (`adminCreateAccount`), because they are not in the company Microsoft directory — there is no Microsoft account for them to sign in with. They may also self-register on the Sign Up screen.
- **The one-time password-confirm screen (`MicrosoftConfirmScreen`) is now only a fallback** for accounts provisioned the old way, or whose Microsoft email collides with an existing password login (`auth/account-exists-with-different-credential`). New hires never see it.
- **Any company Microsoft account can sign in, invited or not** (`selfProvisionFromDirectory` in `services/profile.js`, `selfProvisionsFromDirectory()` in `firestore.rules`). Signing in through Entra creates an `employee` profile on the spot. **Why:** an employee who isn't on this month's roster still needs to ask the desk for a cab, and they can't ask if they can't sign in.
  - **The gate is the PROVIDER, not the email.** Only `sign_in_provider == 'microsoft.com'` self-provisions, because the Azure app registration is **single-tenant** — Microsoft won't issue a token for anyone outside the company directory. `email_verified` is deliberately *not* sufficient: anyone can verify a personal address and walk in. **If that Azure registration is ever switched to multi-tenant/`common`, this becomes open registration for the entire internet.**
  - **Role is pinned to `employee`** and the document is pinned by `hasOnly()` to token-supplied identity fields. A self-provisioned rider gets **no route, no address, no empId, no phone** — a rider must not pick the route that decides which cab collects them, and the address stays HR-owned (it changes via `addressChangeRequests`). They're flagged `selfProvisioned: true` so the desk can tell a walk-up from someone HR entered. They can sign in and request a cab; they can't be routed into one until the desk fills those in.
  - **Offboarding moved to IT.** Deleting an `employees/<uid>` doc no longer locks anyone out — they recreate it on the next sign-in. Access ends when IT disables the Microsoft account. This reverses the old rule (`getOrCreateProfile` never invents a profile, which existed because a removed employee could otherwise resurrect themselves) and was **changed at explicit request** — the directory is the company's real record of who works here. Do not "fix" this by deleting profiles; it does nothing.
  - **Keep "one account per email address" enabled** in Firebase Console → Authentication → Settings. It's the default. With it off, an employee who already has a password login would get a *second* account on Microsoft sign-in and a fresh blank profile, orphaning their roster and ride history instead of hitting the confirm-and-link path.
- **An account that is neither invited, self-provisioned, nor HR-created is still locked out** (`UnprovisionedScreen` in App.js) — e.g. an email/password sign-in for someone with no profile. Self-provisioning is the Microsoft path only.
- **Three separate things, three places — do not merge them.** A **cab** is a vehicle (Fleet: number + seats only). A **driver** is an account (Drivers: the coordinator may create one, role pinned to `driver` by the rules). The **link** between them is the Driver dropdown on each Fleet card, and nowhere else. `driverName`/`driverPhone` on a cab are copied off the linked account by `linkCabDriver()` — never typed. They were form fields once, which meant a name could be saved and shown to riders while granting its owner no access and showing them no trip; a typed name is not a link, and `cabAssignmentProblem()` refuses a cab with no `driverUid`.
- **The driver↔cab link is two-sided and written atomically**: `cabs/<cabId>.driverUid` ←→ `employees/<uid>.cabId`, both in one batch, releasing whatever each side held before. A driver can write neither side — `cabId` is what grants read access to that cab's riders' names and home addresses, so only the desk sets it (`coordinatorLinkingCab()` in the rules allows `cabId` and nothing else). Never `set(..., {merge:true})` a cab inside that batch: on a cab that has since been deleted that is a *create*, which `validCab()` rejects, and the whole link fails as "permission denied".
- **Live location is keyed by driver uid** at RTDB `driverLocations/<uid>`; the rules only let a driver write their own node. Never move this back to a per-cab path — any signed-in user could then spoof any cab. `updatedAt` must equal the server clock (`ServerValue.TIMESTAMP`), so a wrong device clock can't make a stale fix look live. Reads stay open to any signed-in user because RTDB rules cannot read Firestore roles; narrowing that needs a Cloud Function or moving the feed into Firestore.
- **`database.rules.json` must be strict JSON containing ONLY `rules`.** No comments (VS Code rejects them in a `.json` file) and no comment-shaped sibling keys like `"//"` — the Firebase console rejects those with *"Expected 'rules' property"*. Document the reasoning here or in `services/tracking.js`, not in the file.
- **No demo fleet fallback.** `cabs` comes straight from Firestore; an empty fleet is a real state ("no coordinator has registered a cab"). The old `initialCabs` fallback made screens show cab numbers that didn't exist.
- **Every policy the UI enforces is also enforced in `firestore.rules`** (no past bookings, 9h roster lead time, 4h cancel cutoff, no assigning an expired ride, who may change which field). Client-side-only checks fall to a wound-back device clock.

## Deploy steps after changing the rules

```
firebase deploy --only firestore:rules,database
```
One-time migration for existing data: on the **Fleet** screen, pick each cab's
driver once from the Driver dropdown. That writes `cabs/<cabId>.driverUid` (and
the driver's `cabId`), which is what trip assignment and live tracking follow.
Until then a cab shows "No driver" and assignment refuses it.

## Deploy steps for `functions/` (cab-assigned email)

Cloud Functions calling an external API (SendGrid) require the **Blaze**
(pay-as-you-go) plan — the free Spark plan blocks outbound network calls from
functions. Enable it in the Firebase console (Project Settings → Usage and
billing) before deploying.

```
firebase functions:secrets:set SENDGRID_API_KEY   # paste the SendGrid API key when prompted
firebase deploy --only functions
```

Before the first deploy, open `functions/index.js` and replace `FROM_EMAIL`
with a sender address verified in SendGrid (Settings → Sender
Authentication) — SendGrid rejects sends from an unverified sender.

## Known gaps that remain (deliberate — features, not bugs)

- **Native maps are placeholders.** `TrackMap.native` / `FleetMap.native` print coordinates; no map library is installed. Live tracking is web-only.
- **No notifications for anything except cab assignment.** A cab-assigned email is sent by `functions/onCabAssigned`; every other event (trip cancelled, no-show, etc.) still only surfaces as an in-app notification — the app has to be reopened to see it.
- **No reporting/export** (monthly trip or billing report, no-show history per employee).
- **No test suite.** No jest/RNTL installed; nothing is covered.
- **RTDB reads are open to any signed-in user.** A driver's live position can be read by any authenticated account. Narrowing it to "today's riders on that cab" needs a Cloud Function or moving the feed into Firestore.
- **No email-domain restriction** on accounts — worth adding once you settle on the domain.

## How to help on this repo (GStack capabilities)

Code generation, explanation, bug detection, debugging, refactoring, UI improvements, test generation (Jest + React Native Testing Library — none exist yet), documentation, security review, and performance work — all targeted at **React Native + Firebase**, not Angular/Spring Boot. "API generation" here means new `services/*` functions + Firestore reads/writes and rule updates. "SQL optimization" maps to Firestore query shape, indexes, and rules.

## Rules of engagement

- Do NOT modify business logic unless explicitly asked.
- Preserve existing service function signatures and the `useApp()` context surface (screens depend on them).
- Make incremental, explained changes; keep iOS/Android/web all working.
- Ask before breaking changes; maintain backward compatibility with existing Firestore documents.
- No custom backend exists — if server-side logic is needed, propose Firebase (rules / Cloud Functions) rather than assuming a Java server.

## Skill routing (GStack)

When a request matches a GStack skill, invoke it via the Skill tool:
- Bug / "why is this broken" → `/investigate`
- QA / "does this work" → `/qa`
- Review my changes / pre-commit → `/review`
- Visual/design polish → `/design-review`
- Ship / PR / deploy → `/ship`
- Architecture / plan a change → `/plan-eng-review`
- Security check → `/cso`
- Save / restore progress → `/context-save` · `/context-restore`
