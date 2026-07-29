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
  - **Cloud Firestore** — `employees`, `bookings`, `cabs`, `config/timings`, `feedback`, `ratings`.
  - **Realtime Database** — live cab GPS at `cabs/{cabId}/location`.
  - **Firebase Auth** — email/password.
- **Maps/geo:** Leaflet + OpenStreetMap on web; OSRM for routing/ETA; Nominatim for geocoding. Native maps are placeholders (see gaps below).

> IMPORTANT: The `backend/` (Node/Express) and `database/` (PostgreSQL) folders are **empty README stubs — "not built yet."** This is **not** an Angular / Spring Boot / SQL project. There are no Controllers, Repositories, JPA Entities, DTOs, or SQL tables. Do not invent them. Map any "backend" or "database" request onto Firestore collections, `firestore.rules`, and the `src/services/*` modules.

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
      cabs.js                driver-owned cabs: createMyCab/updateMyCab/syncMyCabLink (driver),
                             removeCabSafely/unlinkCabDriver (admin oversight), capacity
      settings.js            config/timings (admin-editable pickup/drop times)
      tracking.js            Realtime DB live location, keyed by DRIVER uid
      directions.js          OFFICE constant, OSRM routing, ETA/distance formatting
      maps.js                Google Maps key from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (reserved for the unbuilt native map)
    screens/
      LoginScreen, SignUpScreen                     (logged-out)
      employee/  EmployeeHome, SelfRoster (Weekly Schedule), BookCab (ad-hoc), MyRides,
                 RosterHistory (Ride History), TripCancel, TrackCab, Feedback, RateUs,
                 ContactUs, Profile
      admin/     Bookings (home), AssignCab, ManageDrivers ("Coordinators" — read-only),
                 ManageCabs ("Fleet" — review/detach/remove only), EmployeeRoutes,
                 ManageTimings, CancelledRides, NoShows, TrackCabs, FeedbackInbox,
                 EmployeeManagement, AddressChangeRequests, Messages
      driver/    DriverHome (My Trips), MyCab (registers their own vehicle),
                 DriverShareLocation
    components/  AppDrawer, Dropdown, ScreenContainer, ErrorBoundary, leaflet.js (shared web-map loader),
                 FleetMap.{web,native}, TrackMap.{web,native}
    data/mockData.js         Starter fleet + shared constants (STATUS, lead/cutoff hours, capacity, etc.)
    theme.js                 colors, statusColors, spacing, Paper MD3 theme
    branding.js              COMPANY_NAME + logo + SUPPORT_HELPLINE
    utils/datetime.js        Booking lead-time / cancel-cutoff / date-key helpers
    utils/useSyncedDraft.js  Edit form over live data (re-seeds while untouched — see its header)
```

## Data flow

`Screen` → `useApp()` (AppContext) → `services/*` → Firebase SDK. Screens never call Firebase directly except through services. Lists are **live**: `onSnapshot` subscriptions in AppContext push updates automatically. Sorting/filtering is done client-side.

## Roles & access

Three roles on `employees/{uid}.role`: `employee`, `admin`, `driver`. App.js swaps the entire screen set by role. Server-side access is enforced in `firestore.rules` (role read via `get()` on the caller's own employee doc). `database.rules.json` guards live location.

## Domain rules (do NOT change without being asked)

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
- **Four places set it,** so nobody has to remember a separate screen: the create dialog in Employee Management, the per-employee card there, bulk assignment on **Employee Routes**, and the coordinator's own dashboard. A sheet with a `Route` column also writes it onto profiles at import — but only where there isn't one already, so it never overrides a choice made in the app.
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
- **Employees + drivers** are provisioned by the admin in Employee Management. Drivers may also self-register on the Sign Up screen.
- **An account with no `employees/<uid>` doc is locked out** (`UnprovisionedScreen` in App.js). `getOrCreateProfile` never invents a profile — that's what let a removed employee resurrect themselves by signing in again.
- **Cab records are driver-owned.** The coordinator (driver) enters their own vehicle's number, contact and seat count on the **My Cab** screen; the transport desk never types cab details. `cabs/<cabId>.driverUid` is pinned to the creator and can't be reassigned by them.
- **The driver↔cab link is two-sided and self-validating**: `cabs/<cabId>.driverUid` ←→ `employees/<uid>.cabId`. A driver may write their own `cabId` (and nothing else on their profile) *only* to a cab that already points back at them — otherwise they could claim another cab and read its riders' names and home addresses. `syncMyCabLink()` repairs drift on sign-in.
- **Live location is keyed by driver uid** at RTDB `driverLocations/<uid>`; the rules only let a driver write their own node. Never move this back to a per-cab path — any signed-in user could then spoof any cab. `updatedAt` must equal the server clock (`ServerValue.TIMESTAMP`), so a wrong device clock can't make a stale fix look live. Reads stay open to any signed-in user because RTDB rules cannot read Firestore roles; narrowing that needs a Cloud Function or moving the feed into Firestore.
- **`database.rules.json` must be strict JSON containing ONLY `rules`.** No comments (VS Code rejects them in a `.json` file) and no comment-shaped sibling keys like `"//"` — the Firebase console rejects those with *"Expected 'rules' property"*. Document the reasoning here or in `services/tracking.js`, not in the file.
- **No demo fleet fallback.** `cabs` comes straight from Firestore; an empty fleet is a real state ("no coordinator has registered a cab"). The old `initialCabs` fallback made screens show cab numbers that didn't exist.
- **Every policy the UI enforces is also enforced in `firestore.rules`** (no past bookings, 9h roster lead time, 4h cancel cutoff, no assigning an expired ride, who may change which field). Client-side-only checks fall to a wound-back device clock.

## Deploy steps after changing the rules

```
firebase deploy --only firestore:rules,database
```
One-time migration for existing data: each coordinator opens **My Cab** and
registers their vehicle. That writes `cabs/<cabId>.driverUid` (and links their
profile), which is what trip assignment and live tracking follow. Any cab rows
left over from the old admin-entered fleet show as "No coordinator" on the Fleet
screen and can be removed there.

## Known gaps that remain (deliberate — features, not bugs)

- **Native maps are placeholders.** `TrackMap.native` / `FleetMap.native` print coordinates; no map library is installed. Live tracking is web-only.
- **No notifications.** Nobody is told when a cab is assigned or a trip is cancelled; the app has to be reopened. Biggest remaining functional hole.
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
