# Employee Cab Facility — Application Documentation

A corporate cab-booking app for a company's own fleet. Employees book shift/on-demand
rides, the transport desk (admin) assigns cabs, and drivers run the trips with live GPS.

- **Owner/brand:** Neutara Technologies
- **Platforms:** Web (browser) and mobile (Expo Go / native), from one codebase
- **Backend:** Firebase (Authentication, Cloud Firestore, Realtime Database)

---

## 1. Tech stack

| Layer | Technology |
|---|---|
| UI framework | React Native **0.86** via **Expo SDK ~57** |
| Web build | `react-native-web` |
| Navigation | `@react-navigation/native` + native-stack (v7) |
| UI components | `react-native-paper` (Material Design 3) |
| Icons | `@expo/vector-icons` (Material Community Icons) |
| Auth | Firebase Authentication (email + password) |
| Database | Cloud Firestore (profiles, bookings, feedback, ratings, cabs) |
| Live location | Firebase Realtime Database (`cabs/<id>/location`) |
| Maps (web) | Leaflet + OpenStreetMap (no API key needed) |
| Geocoding | OSM Nominatim (free, no key) |
| Routing/ETA | OSRM (web), straight-line fallback |
| Device GPS | `expo-location` |

Run it:
```bash
cd app
npm install
npx expo start      # then press w (web) or scan the QR with Expo Go
```

---

## 2. The three roles

The app shows a completely different set of screens depending on who logs in.
Role is stored on the user's Firestore profile (`employees/<uid>.role`).

| Role | Who | What they do |
|---|---|---|
| **employee** | Staff who need rides | Book weekly (roster) or one-time (adhoc) rides, track their cab, request cancellations, give feedback |
| **admin** | Transport desk | See all bookings, assign cabs (carpool), manage cabs/drivers, set employee shift rosters |
| **driver** | Cab drivers | See assigned trips, advance trip status, flag no-shows, share live GPS |

Which screens each role sees is decided in [App.js](App.js) (`RootNavigator`).

---

## 3. High-level architecture

```
                    ┌──────────────────────────────┐
                    │        App.js (root)         │
                    │  PaperProvider + AppProvider │
                    │  + RootNavigator (by role)   │
                    └───────────────┬──────────────┘
                                    │
                 ┌──────────────────┴───────────────────┐
                 │        AppContext (global state)      │
                 │  currentUser, bookings, cabs, +actions│
                 └──────────────────┬────────────────────┘
                                    │ calls
        ┌───────────────┬───────────┼───────────┬───────────────┐
        ▼               ▼           ▼           ▼               ▼
   auth.js         profile.js   bookings.js  cabs.js      tracking.js
   (Firebase Auth) (Firestore)  (Firestore)  (Firestore)  (Realtime DB)
```

- **`src/context/AppContext.js`** is the single source of truth. Every screen calls
  `useApp()` to read state (e.g. `currentUser`, `bookings`, `cabs`) and to run actions
  (e.g. `addBooking`, `assignCab`, `markNoShow`).
- All data is **live**: screens subscribe to Firestore/Realtime DB, so a change on one
  device (e.g. admin assigns a cab) appears on another (the employee) instantly.
- **`src/data/mockData.js`** holds config constants (shift times, routes, statuses,
  time-limit rules). It no longer holds any real employee data.

---

## 4. Data model (Firestore)

### `employees/<uid>` — user profiles
```js
{
  name, email, role,          // 'employee' | 'admin' | 'driver'
  empId, phone,
  cabId,                      // drivers only — which cab they drive
  home,                       // employee's saved pickup map location { latitude, longitude, ... }
  roster: {                   // set by admin in the Shift Roster screen
    route,                    // e.g. 'JNTU Cab'  (one of CAB_ROUTES)
    shift,                    // e.g. '1:00 PM – 10:00 PM' (one of SHIFT_TIMINGS)
    workingDays,              // e.g. ['Mon','Tue','Wed','Thu','Fri'] — may include Sat/Sun
  },
}
```

### `bookings/<id>` — every ride request
```js
{
  employeeId, employeeName,
  date,                       // 'YYYY-MM-DD'
  shift,                      // e.g. '11:00 PM'
  direction,                  // 'Home → Office' | 'Office → Home'
  pickup,                     // pickup label
  source,                     // 'roster' (Weekly Schedule) | 'adhoc' (one-time)
  status,                     // see status flow below
  assignedCabId,              // set when admin assigns a cab
  createdAt,                  // serverTimestamp
  // Cancellation request (employee asks, admin approves):
  cancelStatus,               // 'Requested' | 'Approved' | 'Rejected'
  cancelReason, cancelRequestedAt, cancelResolvedAt,
  // No-show (driver flags):
  noShowAt,                   // serverTimestamp when driver marked no-show
}
```

### Other collections
- **`cabs/<id>`** — fleet: `{ cabNumber, driverName, driverPhone }`
- **`feedback/<id>`** — `{ employeeId, employeeName, category, message, createdAt }`
- **`ratings/<id>`** — `{ employeeId, employeeName, stars, comment, createdAt }`
- **Realtime DB `cabs/<id>/location`** — `{ latitude, longitude, ts }` (live cab GPS)

### Booking status flow
```
Booked ──(admin assigns cab)──► Cab assigned ──(driver)──► On the way ──► Arrived ──► Completed
   │                                                                          │
   └──(employee requests cancel → admin approves)──► Cancelled                └──(driver)──► No show
```
Status colors are defined in [src/theme.js](src/theme.js) (`statusColors`).

---

## 5. Screens by role

### Auth (logged out)
| Screen | File | Purpose |
|---|---|---|
| Login | [LoginScreen.js](src/screens/LoginScreen.js) | Email + password sign-in; shows a demo-credentials hint |
| Sign Up | [SignUpScreen.js](src/screens/SignUpScreen.js) | Create account; role toggle (employee/driver/admin). Admin needs an admin code; drivers get a cab assigned later |

### Employee
| Screen | File | Purpose |
|---|---|---|
| Home | [EmployeeHomeScreen.js](src/screens/employee/EmployeeHomeScreen.js) | Tiles (Weekly Schedule / Book a Ride / Feedback) + lists of scheduled & one-time rides |
| Weekly Schedule | [SelfRosterScreen.js](src/screens/employee/SelfRosterScreen.js) | Book cabs for a whole week (Mon–Sun). **Only rostered working days are bookable**; non-working days show "Not a working day" |
| Book a Ride (Adhoc) | [BookCabScreen.js](src/screens/employee/BookCabScreen.js) | One-time request; enforces the booking lead-time rule |
| My Rides | [MyRidesScreen.js](src/screens/employee/MyRidesScreen.js) | The employee's bookings with status + assigned cab |
| Ride History | [RosterHistoryScreen.js](src/screens/employee/RosterHistoryScreen.js) | Read-only list of all bookings (incl. cancelled) |
| Trip Cancel | [TripCancelScreen.js](src/screens/employee/TripCancelScreen.js) | Request a cancellation (subject to the cancel cutoff); admin approves |
| Track Cab | [TrackCabScreen.js](src/screens/employee/TrackCabScreen.js) | Live map of the assigned cab, ETA + distance |
| Profile | [ProfileScreen.js](src/screens/employee/ProfileScreen.js) | Edit name/ID/phone; set pickup location on a map |
| Feedback | [FeedbackScreen.js](src/screens/employee/FeedbackScreen.js) | Category + message |
| Rate Us | [RateUsScreen.js](src/screens/employee/RateUsScreen.js) | 1–5 stars + comment |
| Contact Us | [ContactUsScreen.js](src/screens/employee/ContactUsScreen.js) | Transport-desk phone; tap to call |

Employees navigate via the **side drawer** ([AppDrawer.js](src/components/AppDrawer.js)) — a slide-in
menu on phones, a permanent sidebar on wide screens.

### Admin (transport desk)
| Screen | File | Purpose |
|---|---|---|
| All Bookings | [BookingsScreen.js](src/screens/admin/BookingsScreen.js) | Home. Bookings **grouped by route**, each card shows pickup location. Tick employees (or "Select all" per route) → assign a shared cab. Shows no-show + cancellation banners |
| Assign Cab | [AssignCabScreen.js](src/screens/admin/AssignCabScreen.js) | Pick one cab for a single booking |
| Shift Roster | [ShiftRosterScreen.js](src/screens/admin/ShiftRosterScreen.js) | Per employee: set **route, shift, working days** (tick Sat/Sun for weekend workers) |
| Manage Cabs | [ManageCabsScreen.js](src/screens/admin/ManageCabsScreen.js) | Add/edit/remove fleet cabs (cab number + driver name + phone, all required) |
| Manage Drivers | [ManageDriversScreen.js](src/screens/admin/ManageDriversScreen.js) | Link each driver account to a cab |

### Driver
| Screen | File | Purpose |
|---|---|---|
| My Trips | [DriverHomeScreen.js](src/screens/driver/DriverHomeScreen.js) | Assigned trips; advance status; **flag a no-show** when the employee isn't at pickup |
| Share Location | [DriverShareLocationScreen.js](src/screens/driver/DriverShareLocationScreen.js) | Stream phone GPS to the cab's live location |
| Simulate (demo) | [DriverSimScreen.js](src/screens/driver/DriverSimScreen.js) | Fake a moving cab for testing, no phone needed |

---

## 6. Key features (how the important rules work)

### Shift Roster + weekend rule
- The **admin** sets each employee's `roster` (route, shift, working days) in the Shift Roster screen.
- Working days drive the **Weekly Schedule**: an employee can only book cabs on days they're
  rostered for. Weekend workers (Sat/Sun ticked) can book weekends; everyone else sees those days
  locked. This is the "some employees work Saturday/Sunday too" requirement.
- An employee with **no roster yet** defaults to all 7 days bookable until the admin rosters them.

### Route-based carpool grouping (admin)
- The admin Bookings screen subscribes to employee profiles and **joins each booking to its
  employee's route + pickup address**, then groups the cards under route headers
  (e.g. "JNTU Cab (3)"). "Select all" ticks a whole route so the desk can assign one shared cab.
- Grouping is by **route name** (from the roster), not by GPS proximity.

### Booking lead-time limit
- Defined by `BOOKING_LEAD_HOURS = 9` in [mockData.js](src/data/mockData.js).
- Employees must book at least 9 hours before the ride. Enforced in **BookCab** and
  **Weekly Schedule** via `canBook` / `bookableTimesForDate` in [datetime.js](src/utils/datetime.js) —
  too-soon times are hidden from the dropdowns and blocked on save.

### Cancellation (request → approve)
- Defined by `CANCEL_CUTOFF_HOURS = 4` in [mockData.js](src/data/mockData.js).
- Cancelling is **not instant**: the employee raises a request (only allowed ≥4 hours before the
  ride, via `canRequestCancel`); the ride stays active until the **admin approves or rejects** it
  on the Bookings screen. Backed by `requestCancelBooking` / `resolveCancelRequest` in
  [bookings.js](src/services/bookings.js).

### No-show
- When a driver reaches the pickup (status "Arrived") and the employee isn't there, they tap
  **"Employee not here (No-show)"**. This sets status `No show` + `noShowAt`.
- On the admin Bookings screen, no-shows get a **red banner, red chip, red left-bar**, and float to
  the top so the transport desk notices immediately.

### Live cab tracking
- Driver's phone streams GPS (`expo-location` → `updateCabLocation`) into Realtime DB.
- Employee's Track Cab screen subscribes (`subscribeCabLocation`) and draws the cab, destination,
  route polyline, ETA, and distance (route via OSRM on web, straight-line fallback otherwise).

---

## 7. State & services reference

### AppContext (`useApp()`) — main values & actions
- **State:** `currentUser`, `authReady`, `bookings`, `cabs`
- **Auth:** `login`, `signup`, `logout`, `changePassword`
- **Bookings:** `addBooking`, `addBookings`, `assignCab`, `assignCabToGroup`, `cancelBooking`,
  `requestCancel`, `approveCancel`, `rejectCancel`, `pendingCancelRequests`,
  `updateBookingStatus`, `markNoShow`, `myBookings`, `myActiveBookings`
- **Cabs:** `createCab`, `editCab`, `deleteCab`, `loadDefaultCabs`, `getCabById`
- **Profile:** `saveHomeLocation`, `saveProfileDetails`
- **Feedback:** `addFeedback`, `addRating`

### Services
| File | Responsibility |
|---|---|
| [auth.js](src/services/auth.js) | Firebase Auth: sign in/up/out, change password, watch auth, friendly errors |
| [profile.js](src/services/profile.js) | Firestore profiles: get/create, live profile, subscribe drivers/employees, assign cab to driver, **update employee roster** |
| [bookings.js](src/services/bookings.js) | Firestore bookings: create, subscribe (mine/all/by-cab), assign cab(s), set status, **mark no-show**, cancel request/resolve |
| [cabs.js](src/services/cabs.js) | Firestore cabs CRUD + seed starter fleet |
| [feedback.js](src/services/feedback.js) | Write feedback & ratings docs |
| [tracking.js](src/services/tracking.js) | Realtime DB: push/subscribe cab location |
| [directions.js](src/services/directions.js) | Distance, route, ETA (OSRM + fallback) |
| [geocode.js](src/services/geocode.js) | Address search + reverse geocode (Nominatim) |
| [maps.js](src/services/maps.js) | Google Maps key config (web uses OSM, needs no key) |

---

## 8. Security rules (Firebase)

- **[firestore.rules](../firestore.rules)** — role-scoped:
  - Employees: only their own profile + bookings.
  - Drivers: bookings for their assigned cab.
  - Admin: everything. Cabs readable by any signed-in user, writable only by admin.
  - Feedback/ratings: create-only by the owner, readable only by admin. Bookings are never hard-deleted.
- **[database.rules.json](../database.rules.json)** — only signed-in users may read/write cab live location.
- **Known limitation:** a user can currently write their own `role`, so the in-app admin code isn't
  enforced server-side. For production, create admins in the Firebase console and tighten the
  employees write rule (noted in the rules file).

---

## 9. Config constants ([mockData.js](src/data/mockData.js))

| Constant | Value | Used for |
|---|---|---|
| `CAB_ROUTES` | Madhapur, JNTU Cab, LB Nagar Cab, Kapra Cab, Shaikpet Cab, ECIL Cab, Berumguda Cab | Route dropdown in Shift Roster |
| `SHIFT_TIMINGS` | `1:00 PM – 10:00 PM`, `9:00 PM – 6:00 AM` | Shift dropdown in Shift Roster |
| `WEEKDAYS` | Mon…Sun | Weekly schedule + working-day pills |
| `PICKUP_TIMES` / `DROP_TIMES` | night-shift windows | Weekly schedule time dropdowns |
| `SHIFT_TIMES` | 9 PM–6 AM window | Adhoc booking times |
| `BOOKING_LEAD_HOURS` | `9` | Minimum hours before a booking |
| `CANCEL_CUTOFF_HOURS` | `4` | Minimum hours before requesting a cancel |
| `STATUS`, `SOURCE`, `CANCEL_STATUS` | enums | Status/source labels |

---

## 10. Project structure

```
employee-cab-app/
├── app/                        ← the Expo app (this project)
│   ├── App.js                  ← root: providers + role-based navigation
│   ├── DOCUMENTATION.md        ← this file
│   └── src/
│       ├── context/AppContext.js   ← global state + all actions
│       ├── data/mockData.js        ← config constants (no real user data)
│       ├── services/               ← Firebase + maps/geocode wrappers
│       ├── screens/                ← employee / admin / driver / auth screens
│       ├── components/             ← AppDrawer, Dropdown, LocationPicker, TrackMap, ScreenContainer
│       ├── utils/datetime.js       ← date/time + lead-time/cutoff helpers
│       ├── theme.js                ← colors + status colors
│       └── branding.js             ← company name + logo
├── firestore.rules             ← Firestore security rules
├── database.rules.json         ← Realtime DB security rules
├── backend/                    ← (not built yet)
└── database/                   ← (not built yet)
```

---

## 11. Current status & limitations

- **No custom backend yet** — everything runs directly against Firebase from the client.
  There's no server-side way to bulk-create employee accounts; each employee **signs up themselves**,
  after which the admin can roster them.
- **Employee data is fully dynamic** — no employees are hardcoded. New staff sign up, sign in, then
  book within the time-limit rules.
- **Maps are web-first** — the interactive map + live tracking map are implemented for web (Leaflet/OSM).
  The native versions are placeholders awaiting an `expo-maps` dev build.
- **Admin code is client-side only** (see security note above).

---

## 12. Common "how do I…?" answers

- **Add an employee?** They sign up (Sign Up screen). No admin "add employee" button exists — adding
  a person means creating a login. After signup, configure them in Shift Roster.
- **Make someone a weekend worker?** Admin → Shift Roster → tick Sat and/or Sun → Save.
- **Assign a shared cab by area?** Admin → All Bookings → a route group → "Select all" → Assign cab.
- **Know an employee didn't show up?** The driver flags it (My Trips → "No-show"); it appears in red on
  the admin's Bookings screen.
- **Change the booking lead time or cancel cutoff?** Edit `BOOKING_LEAD_HOURS` / `CANCEL_CUTOFF_HOURS`
  in [mockData.js](src/data/mockData.js).
```
