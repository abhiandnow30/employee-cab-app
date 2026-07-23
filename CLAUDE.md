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
      profile.js             employees/{uid} CRUD; ADMIN_SIGNUP_CODE; driver/employee subscriptions; roster writes
      bookings.js            bookings collection CRUD + live subscriptions + cancel/no-show/assign
      cabs.js                cabs collection CRUD + seedDefaultCabs()
      settings.js            config/timings (admin-editable pickup/drop times)
      tracking.js            Realtime DB read/write of live cab location
      directions.js          OFFICE constant, OSRM routing, ETA/distance formatting
      geocode.js             Nominatim address search / reverse geocode
      maps.js                Google Maps key from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
    screens/
      LoginScreen, SignUpScreen                     (logged-out)
      employee/  EmployeeHome, SelfRoster (Weekly Schedule), BookCab (ad-hoc), MyRides,
                 RosterHistory (Ride History), TripCancel, TrackCab, Feedback, RateUs,
                 ContactUs, Profile
      admin/     Bookings (home), AssignCab, ManageDrivers, ManageCabs, ShiftRoster,
                 ManageTimings, CancelledRides, TrackCabs
      driver/    DriverHome (My Trips), DriverShareLocation, DriverSim (demo)
    components/  AppDrawer, Dropdown, ScreenContainer, FleetMap.{web,native}, TrackMap.{web,native}, LocationPicker.{web,native}
    data/mockData.js         Seed data + shared constants (STATUS, SHIFT_OPTIONS, lead/cutoff hours, etc.)
    theme.js                 colors, statusColors, spacing, Paper MD3 theme
    branding.js              COMPANY_NAME + logo
    utils/datetime.js        Booking lead-time / cancel-cutoff / date-key helpers
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

## Conventions to follow

- **Theme, not hex.** Use `colors` / `statusColors` / `spacing` from `theme.js`. (Many files currently hardcode hex — do not copy that; prefer theme tokens in new/edited code.)
- **Constants live in `data/mockData.js`.** Reuse option lists / status / hour constants instead of re-declaring.
- **Date/time logic lives in `utils/datetime.js`.** Reuse it; don't roll new formatters.
- **Data access goes through `services/*`,** never Firebase calls inside screens/components.
- **Platform splits** use `*.native.js` / `*.web.js` (Metro picks per platform). Keep prop parity across both halves.
- **Expo SDK 57 changed APIs** — see `app/AGENTS.md`: check https://docs.expo.dev/versions/v57.0.0/ before using Expo APIs.
- Comments in this codebase are plain-English and teaching-oriented; match that tone.

## Known issues to be aware of (see full report for the list)

- **Self-promotion to admin:** any signed-in user can write their own `employees/{uid}` doc incl. `role`; the admin code is client-side only. Stricter rule is commented in `firestore.rules`.
- **DriverHome shows ALL non-cancelled bookings**, not just this driver's cab — missing `assignedCabId === currentUser.cabId` filter (`driver/DriverHomeScreen.js`).
- **Fire-and-forget writes:** several context mutations aren't awaited and swallow errors (AssignCab, Bookings, DriverHome, driver location screens).
- **Stale local drafts:** `ManageTimings` / `ShiftRoster` seed `useState` once and don't resync when live data arrives.
- **Duplication:** `loadLeaflet()` + fallback map center copied across 3 `.web` maps; `timeBucket`/time-group helpers copied between `BookCab` and `SelfRoster`.
- **Native map/picker parity gaps:** native `TrackMap`/`LocationPicker` ignore route/onChange props.

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
