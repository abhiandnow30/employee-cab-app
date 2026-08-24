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
  - **Firebase Auth** — Microsoft/Entra for employees and coordinators, email/password for console-created admins, and a numeric cab+phone code for drivers (still email/password underneath — see the access model below).
- **Maps/geo:** Leaflet + OpenStreetMap on web; OSRM for routing/ETA; Nominatim for geocoding. Native maps are placeholders (see gaps below).

> IMPORTANT: The `backend/` (Node/Express) and `database/` (PostgreSQL) folders are **empty README stubs — "not built yet."** This is **not** an Angular / Spring Boot / SQL project. There are no Controllers, Repositories, JPA Entities, DTOs, or SQL tables. Do not invent them. Map any "backend" or "database" request onto Firestore collections, `firestore.rules`, and the `src/services/*` modules.
>
> The one exception is `mailer/` — a ~450-line worker on a free host (Cloudflare Workers by default) that holds the SendGrid API key and sends the cab-assigned email. It's the only server-side code in the project; everything else stays client → Firestore/RTDB directly.
>
> `functions/` holds a **parked, undeployed** Cloud Function that did the same job via a Firestore trigger. It needs the **Blaze** plan (a function calling an external API is blocked on Spark) and there is no budget approval, so it is not in use. Do not add to it or assume it runs — see `mailer/README.md`.

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
      directions.js          OFFICE constant, OSRM routing, ETA/distance formatting.
                             tripPickupPoint / tripDropPoint are a PAIR — which one
                             the driver needs flips the moment a rider gets in
      driverRun.js           PURE. Bookings → runs; the run's phase derived from
                             its riders' statuses; and which ids each cab-level
                             batch is allowed to touch. No Firebase, no React —
                             imported by both the driver screen and AppContext,
                             which have to agree on what "the current run" is
      maps.js                Google Maps key from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (reserved for the unbuilt native map)
      notifications.js       in-app notification docs + the wording of each message
      mail.js                queues a `mailQueue` job per rider and pokes the mailer
                             (../../mailer) to send it. Best-effort, never throws.
    screens/
      LoginScreen (email/password + Microsoft), DriverLoginScreen (one code field)
      employee/  EmployeeHome, SelfRoster (Weekly Schedule), BookCab (ad-hoc), MyRides,
                 RosterHistory (Ride History), TripCancel, TrackCab, Feedback, RateUs,
                 ContactUs, Profile
      admin/     Bookings (home), AssignCab, ManageDrivers ("Drivers" — driver accounts),
                 ManageCabs ("Fleet" — vehicles + the driver↔cab link),
                 ManageTimings, CancelledRides, NoShows, TrackCabs, FeedbackInbox,
                 EmployeeManagement, AddressChangeRequests, Messages
      driver/    DriverHome (My Trips), DriverShareLocation
    components/  AppDrawer, Dropdown, ScreenContainer, ErrorBoundary, leaflet.js (shared web-map loader),
                 DriverRunSection + DriverRiderCard (the driver's run/rider split),
                 FleetMap.{web,native}, TrackMap.{web,native}
    analytics/hotjar.js      Hotjar session recording, WEB ONLY. Off unless a Site ID
                             is configured, which is the default. Also exports
                             HJ_SUPPRESS — spread it onto anything that must never
                             reach a recording (every credential in the app is a
                             numeric field, not a password input, so Hotjar does
                             NOT mask them for you)
    config/runtimeConfig.js  Values read at page load from public/runtime-config.js
                             instead of being frozen into the bundle by Metro, so
                             the deploy can change them without a rebuild.
                             Runtime wins; EXPO_PUBLIC_* is the fallback
    data/mockData.js         Starter fleet + shared constants (STATUS, lead/cutoff hours, capacity, etc.)
    theme.js                 colors, statusColors, spacing, Paper MD3 theme
    branding.js              COMPANY_NAME + logo + SUPPORT_HELPLINE
    utils/datetime.js        Booking lead-time / cancel-cutoff / date-key helpers
    utils/useSyncedDraft.js  Edit form over live data (re-seeds while untouched — see its header)

  public/index.html          The web build's HTML template (Expo copies public/ into
                             dist/ verbatim). Loads runtime-config.js BEFORE the bundle
  public/runtime-config.js   Runtime-editable config, committed BLANK. The Hotjar Site
                             ID is written in here on the server by
                             deploy/remote_deploy.sh from the GitHub Actions repository
                             VARIABLE HOTJAR_SITE_ID (a variable, not a secret — it
                             ships in client-side JS either way). Unset = Hotjar off

mailer/                      THE ONLY SERVER CODE. A worker on a free host (not Firebase),
                             because SendGrid from a Cloud Function needs the Blaze plan.
  src/worker.js              POST { idToken, ids } → verifies the ID token (RS256 vs
                              Google's JWKS), reads mailQueue/bookings/employees/cabs via
                              Firestore REST AS THE CALLER (so firestore.rules is the
                              authorisation), renders the email, sends via SendGrid, marks
                              the job. Holds no Firebase credentials; the request body
                              carries no recipient or body text.
  wrangler.toml              config; SENDGRID_API_KEY is a Worker secret, never in here
  README.md                  deploy, local testing, the trade-offs vs a trigger

functions/                   PARKED, NOT DEPLOYED — needs Blaze. The Firestore-trigger
  index.js                   version of the same email. Kept for if billing is approved.
```

## Data flow

`Screen` → `useApp()` (AppContext) → `services/*` → Firebase SDK. Screens never call Firebase directly except through services. Lists are **live**: `onSnapshot` subscriptions in AppContext push updates automatically. Sorting/filtering is done client-side.

## Roles & access

Three roles on `employees/{uid}.role`: `employee`, `admin`, `driver`. App.js swaps the entire screen set by role. Server-side access is enforced in `firestore.rules` (role read via `get()` on the caller's own employee doc). `database.rules.json` guards live location.

## Domain rules (do NOT change without being asked)

- **Rides come from the SHIFT POLICY and nothing else.** Every ride in the system is derived from a rostered shift code plus `config/shifts` — there is no shift-extension cab, no emergency ride, no "collect me at another time", and nothing an employee can raise adds a ride. Consequences to preserve: `ridesForDate()` takes no extra-request argument, `EFFECT` has no `EXTRA_RIDE`/`RETIME`, nothing routes to HR (`ROUTE_TO` has only `COORDINATOR`), and there is no Exception Approvals screen. Anyone genuinely stranded phones the desk.
  - **As configured today that is four rides — one pickup, three drops:** the Night shift's **8:00 PM pickup** from home (shift starts 21:00, 60-min lead), the Afternoon shift's **10:00 PM drop**, Afternoon 2's **12:00 AM drop**, and Evening 2's **2:30 AM drop**. The count is a *policy* fact, not an invariant in code — nothing branches on it.
  - **A2 (3:00 PM–12:00 AM) and E2 (5:30 PM–2:30 AM) were added Aug 2026** for employees on hours no existing code covered. Both start outside cab hours so nobody is collected; both finish inside them so both get a drop. Because they end after midnight, `endsNextDay` is true and **their drops appear on the coordinator's board the FOLLOWING day** — a Tuesday board shows Monday's A2/E2 drops at 12:00 AM and 2:30 AM alongside Tuesday's own 10:00 PM drop, sorted chronologically within the calendar day.
  - **E and E2 deliberately differ.** `E` is a working shift the company runs no cab for (`provideDrop: false`); `E2` gets a drop. They look like a pair and are not one — do not "tidy" them into matching flags.
  - **Adding or retiming a shift is mostly config.** Times, labels and which legs run are edited on **Shift Timings** and stored in `config/shifts`, no redeploy. A brand-new *code* additionally needs an entry in `WORKING_CODES`, `SHIFT_SYNONYMS`, `SHIFT_COLORS` and `DEFAULT_SHIFT_POLICY` in `data/shifts.js` — the synonym so the roster grid parses it, the colour because `RosterUploadScreen` treats a code with no colour as unrecognised.
- **The three change requests** are Leave, Cancel one ride, and Shift changed — all of which only CANCEL or RE-CODE one of the two rides, and all of which land with the coordinator.
  - **"Absent today" was retired (Aug 2026) because it duplicated Leave.** Both were `effect: CANCEL_DAY` and cancelled every cab that day; the only difference was that Leave also recoded the roster day to `L` while Absent left the roster saying the rider was still expected — an attendance nuance, invisible on the cab side. Two buttons, one outcome, chosen at random, and the label lied anyway (the date picker offered today→+14 days for both). Leave is the half kept because recoding to `L` stops the day *generating* rides, whereas Absent only suppressed them via `excuseResolvedRequests()` matching the resolved request row.
  - **Retirement is `retired: true` in `REQUEST_CATALOGUE`, NOT deletion.** The entry stays so existing (and still-Pending) `absent` documents keep their label, effect and the desk's consequence text; `OFFERED_REQUESTS` is what the employee's picker renders, and `createChangeRequest()` refuses a retired type so a stale open tab can't keep filing them. The `REQUEST_TYPES.ABSENT` branches in `ChangeRequestQueueScreen` are load-bearing for history — don't tidy them away. Retire the same way if another type ever goes.
- **Cab service requests are a separate thing from those three — and are NOT a third ride.** A `cabServiceRequests` doc says "the desk has no address or route for me, please set me up"; approving writes name/empId/phone/address/`roster.route` onto `employees/<uid>` and creates no booking. It exists because self-provisioning (below) lets someone in without HR having entered them, so they arrive with nothing a cab could be sent to. See `services/cabServiceRequests.js`, `CabServiceRequestScreen` (employee), `CabRequestsScreen` (desk).
  - **`needsCabServiceSetup()` is keyed on the FIELDS, not on `selfProvisioned`** — an employee HR created years ago with a blank address is just as unpickupable as this morning's walk-up. An employee in that state is held at the request form by `holdForCabSetup` in App.js until they submit; submitting unlocks the whole app.
  - **Both desk roles see the queue, but only HR approves.** The coordinator writes `proposedRoute` and nothing else, because `firestore.rules` only lets them touch `roster.route` on a profile — the screen mirrors that split rather than offering a button that would fail. Approval also clears `selfProvisioned`, which is what marks them as vetted.
- **Booking sources:** `SOURCE.ROSTER` (weekly Self Roster) vs `SOURCE.ADHOC` (Book a Ride).
- **Status lifecycle:** `Booked → Cab assigned → On the way → Arrived → On board → Completed`, plus `No show` and `Cancelled`.
- **A ride starts with the RIDER'S OTP, not the driver's tap.** Six digits are issued in the same atomic write that assigns the cab, shown only to the rider (and the desk), and typed in by the driver at the kerb; that is the only way into `On board`, and `Completed` is only reachable *from* `On board`. See the OTP section under the access model below and `services/rideOtp.js`.
- **THE DRIVER'S SCREEN IS BUILT AROUND A RUN, NOT A RIDER** (Aug 2026). A *run* is one cab, one departure — everyone travelling together, keyed `date|shift|direction`. Decisions are split by who they belong to: **per rider**, the one thing only that person settles (are they in the cab, which needs their code, or are they not coming); **per cab**, the ones that belong to the vehicle (we are at the office, we are leaving, we are done). It replaced a four-tap ladder repeated on every card, which made a carpool of four sixteen taps, each a question about which button belonged to whom.
  - **Exactly one half of any journey is spread across stops, and that half gets the per-rider cards**; the other half happens in one place and gets a single button. Pickup boards at each kerb and drops everyone at the office; the drop leg is the mirror. `services/driverRun.js` derives all of it — **the phase is computed from the riders' statuses on every render and nothing about a run is persisted**, which is what makes the screen recoverable after a restart. Do not add a run document; it would be a second source of truth for what the statuses already say.
  - **Every cab-level batch filters its ids by current status first** (`idsToMarkOnTheWay` / `idsToMarkArrived` / `idsToComplete`). This is not tidiness. `driverAdvancingTrip()` constrains the FROM status for `Completed` **only**, so a blind batch would demote a rider who is already `On board`; and a batch is all-or-nothing, so one no-show in the "trip complete" list would refuse the whole cab. `idsToMarkArrived` is defined by *exclusion* on purpose — a whitelist skips a `Booked` rider, and boarding is legal only from `Arrived`, so they would be stranded with no button that works.
  - **Turning location sharing on is what sets `On the way`** — no driver tap does. The effect lives in `AppContext` (not inside `startSharingLocation`, which runs on resume before `bookings` has loaded) and is **scoped to today's active run**: marking the whole cab would tell the evening drop's riders their cab was coming and close their cancel window hours early.
  - **"Start trip" writes nothing** — a driver may only write a booking's status, and there is no status for "the cab left" that isn't a claim about a rider. It is screen state; losing it to a restart costs one harmless tap.
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
- **The day board (`CoordinatorHome`) is registered for BOTH desk roles** (Aug 2026), and in HR's menu it **replaced "All Bookings"** — the admin drawer has Today's Rides where `Bookings` used to sit. `BookingsScreen` is still registered for both roles and still in the coordinator's menu, so nothing was deleted; two capabilities simply left HR's navigation with it — **approving/rejecting a rider's cancellation request**, and the by-cab view of the last 180 days. Restore the drawer line if HR needs either back. It is still the coordinator's home and where the day is run, but HR reaches it from their own drawer as "Today's Rides" — because **"Add a rider" lives there** and HR is usually who hears that the monthly sheet missed someone (a mid-month joiner, someone who turns out to need a cab). `addRiderForDay()` writes `rosters/<month>_<uid>.days[DD]`, which the coordinator's board derives from, so the rider appears on their screen with no re-upload and no second step. Nothing on the screen is role-gated: `rosters` create/update is already the admin's outright in `firestore.rules`, every subscription the screen needs is gated on `isDeskRole`, and an admin could already assign cabs from All Bookings — so this hands out no new capability. HR still isn't expected to assign the cab; the added rider simply shows as Waiting.

## Conventions to follow

- **Theme, not hex.** Use `colors` / `statusColors` / `spacing` from `theme.js`. (Many files currently hardcode hex — do not copy that; prefer theme tokens in new/edited code.)
- **Constants live in `data/mockData.js`.** Reuse option lists / status / hour constants instead of re-declaring.
- **Date/time logic lives in `utils/datetime.js`.** Reuse it; don't roll new formatters.
- **Data access goes through `services/*`,** never Firebase calls inside screens/components.
- **Platform splits** use `*.native.js` / `*.web.js` (Metro picks per platform). Keep prop parity across both halves.
- **Expo SDK 57 changed APIs** — see `app/AGENTS.md`: check https://docs.expo.dev/versions/v57.0.0/ before using Expo APIs.
- Comments in this codebase are plain-English and teaching-oriented; match that tone.

## Access model (do NOT weaken)

- **Admins are created in the Firebase console only** — console → Auth → add user, then a Firestore `employees/<uid>` doc with `role: 'admin'`. They are the reason the login screen still has email/password fields at all. The rules refuse **every** self-created profile, so there is no in-app admin code any more (the old one shipped in the bundle).
- **Nothing self-registers.** The `employees` create rule used to begin with `(request.auth.uid == uid && role == 'driver')` — the Sign Up screen's mechanism, and exactly the hole `emailIsTrusted()` describes (self-register on a colleague's address, become a driver, claim their invite). That screen is deleted and the clause with it; `useApp()` has no `signup` any more.
- **Employees are provisioned as INVITES, with no account and no password** (`adminCreateInvite` / `adminInviteEmployees` in `services/profile.js`). HR files their details at `employeeInvites/<their email>`; the first time they click "Sign in with Microsoft", `getOrCreateProfile` claims that invite into `employees/<their own uid>` and deletes it. One click, first time, nothing to explain.
  - **Why it works this way:** Firebase Auth will not attach a new sign-in provider to an existing account without proof of ownership of it. So while HR pre-created an email/password login, a Microsoft sign-in arrived as a *different* uid and the only honest bridge was asking for the password once. Not pre-creating the login removes the second account entirely — there is nothing left to bridge. Do NOT "simplify" this back into `adminCreateAccount` for employees; that reintroduces the password step for every new hire.
  - **The email is the security boundary.** `createsFromInvite()` in `firestore.rules` requires an invite to already exist for the caller's *own* verified email, copies `role` from the invite, and refuses role `admin`. `emailIsTrusted()` requires `email_verified`, or that the caller signed in through `microsoft.com` (our single-tenant Entra directory). Without that gate, anyone holding a password account on a colleague's address could claim their invite. Nothing in the app self-registers any more, which shuts the front door — but accounts can still arrive from the Firebase console, so this stays the lock. Never relax it.
  - **A shift document is keyed by uid, so an invited employee's shifts can only import once they have signed in at least once.** Roster upload invites everyone the sheet names who has no profile; the validation report re-derives live off the `employees` subscription, so their shifts import as they arrive with no re-upload. A brand-new hire who has never opened the app has no rides on the coordinator's board yet.
- **Drivers sign in with their CAB + their PHONE and cannot create an account.** No email, no password, no sign-up screen. `DriverLoginScreen` asks for the two halves as **two fields** — last 4 digits of the cab, then the phone — because that is how a driver holds the information: they read the first off the vehicle they're sitting in and know the second by heart. Joined, they form the code `<last4><phone>`: cab `TS 08 TR 3456` + phone `9263565755` → `34569263565755`. See `app/src/utils/driverLogin.js`, the single home for the format and the reasoning.
  - **It is still Firebase Auth underneath, because it has to be.** `firestore.rules` identifies a driver by `request.auth.uid` (`isDriverForCab()`) and live location is written to `driverLocations/<uid>`, so the code does not replace Auth — it *becomes* the credentials, derived the same way every time: **email = `d<phone>@driver.cab.invalid`** (the phone only, so it never changes) and **password = the whole code**. Deriving the email from the phone alone is what makes one field enough — the last 10 digits of what they typed give the email, the whole string is the password, and *nothing is read from Firestore before signing in*, so no rule had to be opened for a pre-auth lookup. `.invalid` is RFC 2606 reserved, so a stray Firebase email can never reach a real inbox.
  - **The code is a consequence of the cab link, not a field anyone maintains.** `linkCabDriver()` in `services/cabs.js` issues it; unlinking, deleting the cab, or renaming it re-issues it (the last 4 digits are half the code). A driver holding no cab holds `unassignedLoginCode()` — their phone alone — and **cannot sign in**, because the app refuses anything that isn't a full 14 digits (`isDriverLoginCode`, enforced on the login screen *and* in `loginDriver`).
  - **EVERY password this system issues is recomputable, and that is load-bearing.** The unassigned value was random at first, which made `employees/<uid>.loginCode` the sole record of it — so one refused write (undeployed rules, say) left the account impossible to sign into *or* repair, and the driver had to be deleted and re-created. Now `loginCodeCandidates()` can enumerate what the password might be (`stored`, `next`, `phone`), and `rotateDriverLoginCode()` walks that list — which is what makes a half-finished rotation recoverable with the Drivers tab's **Fix code** button. The residual: someone hand-crafting a Firebase call with a bare phone number authenticates as a driver with no cab, and `isDriverForCab()` refuses a null `cabId`, so they can read no bookings, riders or addresses.
  - **The repair is offered only when the desk screens detect drift** — they compare the stored code against what the cab link implies (`driverLoginCode(cab, phone)`, or `unassignedLoginCode(phone)` with no cab). Do not turn "Fix code" back into an always-visible button: it exposes an internal mirror as a routine action, and a code the desk has no reason to doubt is one they should simply read out. It repairs both directions — issuing a code on a cab, and *withdrawing* one that outlived its assignment.
  - **Rotation works without the Admin SDK** via `rotateDriverLoginCode()` in `services/profile.js`: the desk signs in *as the driver* on the throwaway secondary Firebase app using one of those candidates, then calls `updatePassword`. Only possible because the email is fixed. Password first, Firestore second — that ordering plus the candidate walk is what makes retrying safe.
  - **A driver must never be offered "Change password", anywhere.** Their Firebase password *is* the issued code, so changing it succeeds and then locks them out for good: the login screen accepts 14 digits and nothing else, and no recovery candidate would match. `AppDrawer` hides the row and doesn't mount the dialog for `role === 'driver'`, and `changePassword()` in AppContext refuses outright as a backstop. Their synthesized email is hidden in the same places (their phone is shown instead) — it is on an unroutable domain, so displaying it only invites someone to write to it.
  - **Never write `loginCode` outside `rotateDriverLoginCode()`.** It mirrors a real Firebase password, and only that function keeps the two in step.
  - **The desk's screens do NOT display the code at all** (changed Aug 2026 at explicit request). The Fleet and Drivers cards used to print the stored value; they now print nothing, and the desk tells the driver the *rule* instead — "your cab's last 4 digits, then your mobile" — which the driver assembles from the vehicle they're sitting in. The display bought nothing: both halves were already on the same card (last 4 in the cab-number heading, phone on the line beneath), so it added only a live password on a screen the whole desk can see. The driver's OWN Profile still shows it, guarded by `isShareableCode()` — that's their credential, and `unassignedLoginCode()` must stay off it. **`ManageCoordinatorsScreen` still shows the coordinator passcode and must keep doing so** — that one is random, not derivable, so the stored mirror is the only record of it anywhere.
  - **Removing the display makes the drift check MORE load-bearing, not less.** The spoken rule *is* the derived value (`driverLoginCode(cab, phone)`), so whenever the stored code disagrees, that instruction locks the driver out. Both desk screens still compute the comparison and still surface the warning + **Fix code**; the wording now says the rule itself won't work until it's fixed. Never remove the comparison, and never re-add an always-visible "Fix code".
  - **Security trade, stated plainly:** the password is 14 digits of which 10 are a phone number and 4 are painted on the vehicle. Weaker than a chosen password, requested deliberately, scoped to driver-level access (one cab's riders), and revoked whenever the cab changes. Do not extend the trick to any other role.
  - **A cab number needs at least 4 digits** (`cabDetailsProblem()`), or no code can be formed for whoever drives it.
- **The one-time password-confirm screen (`MicrosoftConfirmScreen`) is now only a fallback** for accounts provisioned the old way, or whose Microsoft email collides with an existing password login (`auth/account-exists-with-different-credential`). New hires never see it.
- **Any company Microsoft account can sign in, invited or not** (`selfProvisionFromDirectory` in `services/profile.js`, `selfProvisionsFromDirectory()` in `firestore.rules`). Signing in through Entra creates an `employee` profile on the spot. **Why:** an employee who isn't on this month's roster still needs to ask the desk for a cab, and they can't ask if they can't sign in.
  - **The gate is the PROVIDER, not the email.** Only `sign_in_provider == 'microsoft.com'` self-provisions, because the Azure app registration is **single-tenant** — Microsoft won't issue a token for anyone outside the company directory. `email_verified` is deliberately *not* sufficient: anyone can verify a personal address and walk in. **If that Azure registration is ever switched to multi-tenant/`common`, this becomes open registration for the entire internet.**
  - **Role is pinned to `employee`** and the document is pinned by `hasOnly()` to token-supplied identity fields. A self-provisioned rider gets **no route, no address, no empId, no phone** — a rider must not pick the route that decides which cab collects them, and the address stays HR-owned (it changes via `addressChangeRequests`). They're flagged `selfProvisioned: true` so the desk can tell a walk-up from someone HR entered. They can sign in and request a cab; they can't be routed into one until the desk fills those in.
  - **Offboarding moved to IT.** Deleting an `employees/<uid>` doc no longer locks anyone out — they recreate it on the next sign-in. Access ends when IT disables the Microsoft account. This reverses the old rule (`getOrCreateProfile` never invents a profile, which existed because a removed employee could otherwise resurrect themselves) and was **changed at explicit request** — the directory is the company's real record of who works here. Do not "fix" this by deleting profiles; it does nothing.
  - **Keep "one account per email address" enabled** in Firebase Console → Authentication → Settings. It's the default. With it off, an employee who already has a password login would get a *second* account on Microsoft sign-in and a fresh blank profile, orphaning their roster and ride history instead of hitting the confirm-and-link path.
- **An account that is neither invited, self-provisioned, nor HR-created is still locked out** (`UnprovisionedScreen` in App.js) — e.g. an email/password sign-in for someone with no profile. Self-provisioning is the Microsoft path only.
- **Three separate things, three places — do not merge them.** A **cab** is a vehicle (Cabs tab: number + seats only). A **driver** is an account (Drivers tab: name + phone, role pinned to `driver` by the rules). The **link** between them is the Driver dropdown on each Cabs card, and nowhere else — and it is also what issues the driver's login code, so it is now the only place a driver becomes able to sign in at all. `driverName`/`driverPhone` on a cab are copied off the linked account by `linkCabDriver()` — never typed. They were form fields once, which meant a name could be saved and shown to riders while granting its owner no access and showing them no trip; a typed name is not a link, and `cabAssignmentProblem()` refuses a cab with no `driverUid`.
- **The driver↔cab link is two-sided and written atomically**: `cabs/<cabId>.driverUid` ←→ `employees/<uid>.cabId`, both in one batch, releasing whatever each side held before. A driver can write neither side — `cabId` is what grants read access to that cab's riders' names and home addresses, so only the desk sets it (`coordinatorLinkingCab()` in the rules allows `cabId`, `loginCode` and `updatedAt`, and nothing else). Never `set(..., {merge:true})` a cab inside that batch: on a cab that has since been deleted that is a *create*, which `validCab()` rejects, and the whole link fails as "permission denied".
  - **The login-code re-issue is deliberately OUTSIDE that batch** and runs after it commits — it changes a Firebase Auth password, which is a sequence of network calls, not a document write. So `linkCabDriver`, `updateCab` and `removeCabSafely` return `codeWarning`: the link committed but the code didn't follow, meaning the driver's *previous* code still works. Surface it; never swallow it, or the desk reads out a code that signs nobody in.
- **The ride-start OTP is the only thing on a trip the driver cannot assert alone — keep it that way.** Every other signal about a trip (on the way, arrived, completed, no-show) is the driver's own tap, so before this there was nothing separating "I collected them" from "I said I did". Six digits are issued by the desk in the *same commit* that assigns the cab (`issueRideOtp` inside `assignCabToBooking`, `assignCabToBookings` and `createAssignedBookings`), re-issued whenever the ride moves to another cab, and one per RIDER — a carpool of four is four boardings, each verified as that person gets in.
  - **The code is NOT a field on the booking, and that is not a style choice.** The assigned cab's driver may read the whole booking document (the `bookings` read rule) and Firestore has no field-level read security, so a `startOtp` field would be plainly visible to the one person it exists to test. It lives at `bookings/<id>/private/otp`, which the rules give to the rider and the desk and to nobody else. **Never denormalise it upward onto the booking** "so the screen doesn't need a second read" — that hands the code straight to the driver and the whole feature becomes decoration.
  - **`get()` in `firestore.rules` runs with full privileges, independent of what the CALLER may read.** That is the entire trick that makes this enforceable with no server: `driverStartingRide()` compares the driver's typed attempt against a document the driver cannot open. No Cloud Function, no Blaze. The attempt has to be written onto the booking (`startOtpAttempt`) because a rule can only inspect `request.resource.data` — a rejected write stores nothing, and an accepted one stores a code that has just been spent.
  - **`Completed` is reachable only from `On board`** (`completingOnlyAfterBoarding()`). Without that the OTP is sidestepped in one tap: the driver ignores the prompt at the kerb and marks the trip finished straight from `Arrived`, and the record reads exactly as if someone had got in. `No show` stays reachable from anywhere — it is the honest way out of a pickup nobody came to, and with the OTP in place it is the *only* other way out.
  - **The desk can read the code and can set the status by hand, deliberately.** A rider with a dead phone still has to get to work; the coordinator reads the code down the line (tap "Show start code" on their board) or moves the ride on themselves via `deskEditing()`. This is the documented escape hatch, not a hole — stranding a real employee is a worse failure than the one being prevented.
  - **Known residual: no rate limiting.** Rules cannot count failed attempts, so a scripted client could grind through codes. Six digits (`RIDE_OTP_LENGTH`) is a million combinations at one network round-trip each — hours of traffic against a single document, and loud in usage metrics. **Do not shorten it to four** to make it easier to read out; that trade was considered and refused.
- **Live location is keyed by driver uid** at RTDB `driverLocations/<uid>`; the rules only let a driver write their own node. Never move this back to a per-cab path — any signed-in user could then spoof any cab. `updatedAt` must equal the server clock (`ServerValue.TIMESTAMP`), so a wrong device clock can't make a stale fix look live. Reads stay open to any signed-in user because RTDB rules cannot read Firestore roles; narrowing that needs a Cloud Function or moving the feed into Firestore.
- **`database.rules.json` must be strict JSON containing ONLY `rules`.** No comments (VS Code rejects them in a `.json` file) and no comment-shaped sibling keys like `"//"` — the Firebase console rejects those with *"Expected 'rules' property"*. Document the reasoning here or in `services/tracking.js`, not in the file.
- **No demo fleet fallback.** `cabs` comes straight from Firestore; an empty fleet is a real state ("no coordinator has registered a cab"). The old `initialCabs` fallback made screens show cab numbers that didn't exist.
- **Every policy the UI enforces is also enforced in `firestore.rules`** (no past *employee* bookings, 9h roster lead time, 4h cancel cutoff, who may change which field). Client-side-only checks fall to a wound-back device clock.
- **The desk's cab assignment has NO time limit, deliberately** (changed Aug 2026 at explicit request). It used to: `validDeskBooking()` required `departAt > request.time` and `assignNotExpired()` refused the move into "Cab assigned" once the slot had passed, mirrored by `isBookingPast()` guards in `assignCab`/`assignCabToGroup` and a filter on the admin Bookings screen. All of that is gone, because the ride whose time has just passed is exactly the one the coordinator is scrambling to cover — a cab found at 8:20 PM for an 8:00 PM pickup is a rider who got to work, and the rules were turning it into "Could not assign the cab". `isBookingPast()` now only *flags* a ride as **Overdue** (amber chip, amber left edge) and never disables anything. Do not reintroduce a clock check on the assign path. The employee-facing gates are untouched: `validSelfBooking()` still refuses a past or inside-lead-time self-booking, and the 4-hour cancel cutoff still holds.

## Deployment (dev)

This project uses `/deploy` for DEV deployment via GitHub Actions → Firebase.

On first run, `/deploy` asks for the dev infrastructure details (dev target style,
what to deploy, verification URL, CI auth, runner), writes
`.github/workflows/deploy.yml`, and prints a checklist of GitHub Secrets to add.
On subsequent runs it skips setup and deploys directly. A tag matching
`v<YYYY.MM.DD-HHMM>-dev` is what triggers the pipeline.

**Scope: dev only.** Staging and production are NOT set up in this repo.

What "deploy" means here — there is **no server, no container, and no image
registry**. A deploy is: build the Expo web bundle (`npm --prefix app run
build:web` → `app/dist`) and hand it, plus optionally `functions/` and the rules
files, to Firebase. Any deploy advice involving Docker or SSH is wrong for this
repo.

Two dev target styles, chosen at first run:
- **Separate Firebase dev project** — real isolation; rules and Functions can be
  tested without touching live data.
- **Hosting preview channel** on the existing project — zero setup, but it
  **shares live Firestore, RTDB, Auth and rules**. Only the static client differs,
  and rules/Functions cannot be targeted at a channel at all.

Rollback is partial and the command says so rather than overstating it: Hosting
rolls back from a `dev-previous` snapshot taken before each deploy, via
`firebase hosting:clone`. **Cloud Functions, Firestore rules/indexes and RTDB
rules have no automatic rollback** — recovery is redeploying a known-good tag.

`SENDGRID_API_KEY` is a **Cloudflare Worker** secret (`wrangler secret put`, in
`mailer/`), never a GitHub secret and no longer a Firebase one — `functions/` is
parked. `EXPO_PUBLIC_*` vars are inlined into the shipped bundle
and are publicly readable — keep them out of git, but restrict the Maps key by
HTTP referrer rather than treating it as hidden.

See `.claude/commands/deploy.md` for details, and `deploys.md` for the audit log.
For rollback: `/deploy --rollback`. To change infrastructure config:
`/deploy --reconfigure`.

The two manual sections below still apply — they are what `/deploy` automates,
and what you run when deploying by hand.

## Deploy steps after changing the rules

```
firebase deploy --only firestore:rules,database
```
One-time migration for existing data: on the **Fleet** screen, pick each cab's
driver once from the Driver dropdown. That writes `cabs/<cabId>.driverUid` (and
the driver's `cabId`), which is what trip assignment and live tracking follow.
Until then a cab shows "No driver" and assignment refuses it.

## Deploy steps for the cab-assigned email (`mailer/`)

**Do NOT deploy `functions/`** — it needs Blaze, which we don't have. The email
path is the worker in `mailer/`, deployed separately from Firebase:

```
cd mailer && npm install
npx wrangler login
npx wrangler secret put SENDGRID_API_KEY    # the SendGrid key lives ONLY here
# edit wrangler.toml: FROM_EMAIL must be a SendGrid-verified sender
npm run deploy                              # prints the worker URL
```

Then wire the app to it and ship the rules:

```
# app/.env  →  EXPO_PUBLIC_MAILER_URL=https://cab-mailer.<subdomain>.workers.dev
firebase deploy --only firestore:rules      # the mailQueue block
npm --prefix app run build:web && firebase deploy --only hosting
```

Full detail, local testing and the trade-offs are in `mailer/README.md`. Two
things worth knowing before changing any of it:

- **Three gates, all required.** (1) The mailer verifies the caller's Firebase ID
  token itself — RS256 against Google's JWKS, with `iss`/`aud`/`exp` pinned to this
  project and the algorithm pinned so `alg: none` and HS256 confusion are refused.
  (2) It then forwards that same token to the Firestore REST API, so
  `firestore.rules` decides what they may do — a rider's token is valid at (1) and
  still can't read `mailQueue`. It holds no service-account key. (3) The request
  body carries no recipient or text. Gate 2 is not redundant: verification can't
  see a revoked session, and Firestore can.
- **The request body never carries a recipient or any email text**, only job ids.
  Adding a caller-supplied `to`/`subject`/`html` would make the company's SendGrid
  account an open relay for anyone who can sign in. Don't.

Without a Firestore trigger the send is started by the desk's own client, so
`mailQueue/<id>` is written durably *before* the HTTP call; anything left
`pending` is retried by the next assignment's flush. If no further assignment
happens, a straggler stays queued and unsent — visible in Firestore, not lost.

## Known gaps that remain (deliberate — features, not bugs)

- **Native maps are placeholders.** `TrackMap.native` / `FleetMap.native` print coordinates; no map library is installed. Live tracking is web-only.
- **No notifications for anything except cab assignment.** A cab-assigned email is sent by the `mailer/` worker; every other event (trip cancelled, no-show, etc.) still only surfaces as an in-app notification — the app has to be reopened to see it. Adding a second email type = a builder in `mailer/src/worker.js`, the type in `MAIL_TYPES` **and** in the `mailQueue` rules pin, and a `queue…Emails()` call in `AppContext`.
- **Email sends are started by the desk's client, not by a trigger** (no Blaze → no Cloud Functions). `mailQueue` makes the intent durable and self-healing on the next assignment, but a job queued when no further assignment follows can sit `pending`. Closing that needs a scheduled sweep — see the end of `mailer/README.md`.
- **Reporting is on-device and bounded by the 180-day window.** HR's Reports
  screen (`screens/admin/ReportsScreen.js`, arithmetic in `services/reports.js`)
  counts rides over a period and exports to .xlsx, but every figure comes from
  the `bookings` array already in the session — `subscribeAllBookings` fetches
  `ADMIN_HISTORY_DAYS` (180). **Ask for anything older and the totals are
  silently short**, so the screen says so rather than hiding it. A real
  longer-range report needs an aggregate written server-side, which needs
  Blaze. Also note `ran` excludes `Cancelled` (nobody travelled) but includes
  `No show` (the cab drove there) — that distinction is what the numbers mean.
- **Export is web-only**, same as the roster template: `XLSX.writeFile` hands the
  browser a file to save and a phone has nowhere to put it.
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
