// ---------------------------------------------------------------------------
// RIDE DERIVATION
//
// Rides are NOT stored when a roster is imported — they're computed from it.
// A 250-person month would otherwise materialise ~11,000 booking documents per
// upload (22 batched writes, ~132k rows a year) and swamp every live query in
// the app. Instead:
//
//   • the roster is the source of truth (250 documents a month)
//   • this module turns it into "today's rides" on demand
//   • a booking document is written only when a ride acquires STATE worth
//     keeping — a cab assigned, a status, a cancellation
//
// So a ride is either DERIVED (no document yet, status "Pending") or BOOKED (a
// real bookings/<id> document, which then behaves exactly like every booking the
// app already handles — My Rides, Track Cab, the driver's trip list).
//
// ---------------------------------------------------------------------------
// THE OVERNIGHT PROBLEM
//
// An Evening 2 shift on the 5th runs 5:30 PM → 2:30 AM, so the cab home moves at
// 2:30 AM on the 6th — a different calendar day from the shift that earned it.
// Two dates therefore exist for one ride and must not be confused:
//
//   • `date`       — the OPERATIONAL day: the board the ride is worked from.
//                    Always the shift's own day, for both legs.
//   • `departDate` — the CLOCK day the cab moves. One later for an overnight
//                    drop. The only date an absolute instant may come from.
//
// CHANGED Aug 2026, at explicit request: the drop used to be listed on the day
// it departs, which meant adding a rider to the 26th put their ride on the 27th
// board and the desk could not find what they had just created. It is now listed
// with its shift. `departDate` is what keeps that from breaking every deadline in
// the app — see makeRide, where the whole trade is written out.
//
// The consequence to keep in mind: rides on a board are no longer all on the same
// clock day, so a board can hold a 10:00 PM drop and a 2:30 AM one that is
// technically tomorrow. That is why the sort at the end of ridesForDate orders by
// `departDate` BEFORE time-of-day — on minutes alone 2:30 AM would come first and
// the desk would be handed the night in reverse.
// ---------------------------------------------------------------------------

import { legsForShift, isWorkingCode } from '../data/shifts';
import { shiftDateKey, timeToMinutes } from '../utils/datetime';
import { STATUS } from '../data/mockData';
import { REQUEST_STATUS, EFFECT } from '../data/changeRequests';

export const DIRECTION = {
  IN: 'Home → Office',
  OUT: 'Office → Home',
};

// A derived ride's stable identity: the employee, the day their SHIFT started,
// and which leg. Stored on the booking when one is created, so a derived ride and
// its booking can always be matched back together.
export function rideKey(employeeId, shiftDate, leg) {
  return `${employeeId}_${shiftDate}_${leg}`;
}

// "2026-07-05" → "05"
const dayOf = (dateKey) => String(dateKey).slice(8, 10);
const monthOf = (dateKey) => String(dateKey).slice(0, 7);

// WHOSE CANCELLATION IS THIS? Three kinds exist and they are told apart by
// different fields, because the two write paths are kept separate by
// `firestore.rules` on purpose and cannot be merged:
//
//   • THE RIDER'S OWN      — `cancelledBy === employeeId` (cancelAssignedBooking).
//   • THE DESK, OFF-APP    — `cancellationSource === 'desk'` (deskCancelBooking /
//                            createDeskCancelledBooking).
//   • THE DESK RESOLVING A RIDER'S REQUEST — `cancelStatus === 'Approved'`
//                            (cancelFields in services/changeRequests.js).
//
// The third one carries NO `cancellationSource`, and it cannot be given one:
// validDeskCancellation() in the rules refuses any write that touches both the
// audit fields and `cancelStatus`/`cancelReason`/`cancelResolvedAt`, which is
// exactly what resolving a request writes. So "was this the desk?" has to be
// this two-part test rather than one field — checking only `cancellationSource`
// is what made a request-resolved cancellation vanish off the board entirely.
export function deskSideCancellation(booking) {
  if (!booking) return false;
  // The rider's own comes first: it must never be read as a desk decision.
  if (booking.cancelledBy && booking.cancelledBy === booking.employeeId) return false;
  return booking.cancellationSource === 'desk' || booking.cancelStatus === 'Approved';
}

// Build one derived ride.
function makeRide({ roster, shiftDate, travelDate, departDate, leg, code, time, policy }) {
  const isIn = leg === 'in';
  return {
    key: rideKey(roster.employeeId, shiftDate, leg),
    employeeId: roster.employeeId,
    employeeName: roster.employeeName,
    empId: roster.empId,
    route: roster.route || null,
    employeeAddress: roster.address || '',
    shiftCode: code,
    shiftLabel: policy?.[code]?.label || code,
    // The day the shift itself belongs to — what HR sees in the roster.
    shiftDate,
    // THE OPERATIONAL DAY: the board this ride is worked from, which is now
    // always the shift's own day (see ridesForDate). For an overnight drop this
    // is NOT the calendar day the cab moves — that is `departDate` below.
    date: travelDate,
    // THE CALENDAR DAY THE CAB ACTUALLY MOVES, and the only date any absolute
    // time may be computed from. Equal to `date` for every same-day leg; one day
    // later for an overnight drop (E2's 2:30 AM belongs to tomorrow's clock even
    // though the desk works it tonight).
    //
    // This exists because `date` stopped being able to serve both jobs the
    // moment overnight drops moved onto the shift day. Every deadline in the app
    // — the rider's 4-hour cancel cutoff, the desk's 30-minute one, the 9-hour
    // lead time, `departAt` itself — is `date + shift` parsed into an instant,
    // and parsing "02:30 AM" against the shift day lands a full 24 hours early:
    // the ride reads as long past, cancellation closes before it opens, and the
    // row is flagged Overdue from the moment it appears. Anything reaching for a
    // real instant must use this field, falling back to `date`.
    departDate: departDate || travelDate,
    leg,
    direction: isIn ? DIRECTION.IN : DIRECTION.OUT,
    // `shift` is the pickup time, matching the field every existing screen reads.
    shift: time,
    pickup: isIn ? 'Home' : 'Office',
    // Filled in below when a booking already exists for this ride.
    booking: null,
    status: 'Pending',
    assignedCabId: null,
  };
}

// Every ride that runs on `travelDate`.
//
//   rosters  — roster docs covering travelDate AND the day before (see above)
//   policy   — the shift policy (config/shifts)
//   bookings — existing booking docs, used to attach live state
//
// THE ROSTER IS THE ONLY SOURCE OF RIDES. The company runs the two scheduled rides
// and nothing else, so there is no path that adds one: no shift-extension cab, no
// emergency ride. A change request can only cancel a ride or re-code the day, both
// of which are already reflected here (cancelled rides drop out below; a re-coded
// day derives different rides).
//
// Returns rides sorted by pickup time, each carrying its booking when it has one.
// `options.keepDeskCancelled` — keep a ride the DESK cancelled in the list, with
// its Cancelled status, instead of dropping it. Off by default so the function's
// contract is unchanged for anything that just wants "what has to be driven".
//
// The coordinator's board turns it on because a desk cancellation is a decision
// the desk itself made and may need to reverse: the ride stays as a card in
// place, with a Put back button (see CoordinatorDashboardScreen). A RIDER's
// cancellation is deliberately still dropped — `restoreDeskCancelledRide()`
// refuses to reverse one, so a card for it could offer nothing to do, and the
// rider-cancellation panel already reports it with the reason they gave.
export function ridesForDate(travelDate, rosters, policy, bookings = [], options = {}) {
  if (!travelDate) return [];
  if (!rosters?.length) return [];

  const byKey = new Map();
  bookings.forEach((b) => {
    if (b.rideKey) byKey.set(b.rideKey, b);
  });

  const rides = [];

  const consider = (roster, shiftDate) => {
    const month = monthOf(shiftDate);
    if (roster.month !== month) return; // this roster doc doesn't cover that day
    const code = roster.days?.[dayOf(shiftDate)];
    if (!code || !isWorkingCode(policy, code)) return; // WO / H / L / blank / typo

    const legs = legsForShift(policy, code);
    if (!legs) return;

    // Inbound runs on the day the shift starts — but only if a cab is provided for
    // it. An afternoon shift starting at 13:00 is outside the service window, so
    // those employees make their own way in; generating a ride for it would put a
    // midday pickup on the coordinator's board that no cab was ever going to make.
    if (shiftDate === travelDate && legs.providePickup) {
      rides.push(
        makeRide({
          roster, shiftDate, travelDate, departDate: shiftDate,
          leg: 'in', code, time: legs.pickup, policy,
        })
      );
    }
    // BOTH LEGS BELONG TO THE SHIFT'S OWN DAY (changed Aug 2026, at explicit
    // request). An overnight drop used to be listed on the following calendar
    // day — `outDate = shiftDate + 1` — because that is when the cab physically
    // moves. It is now listed with the shift that produced it, so an E2 worked on
    // the 26th shows its 2:30 AM drop on the 26th board.
    //
    // WHY: the desk adds a rider to a day and expects that day's board to show
    // what they just created; the previous behaviour put it on a board they were
    // not looking at, which read as the ride having silently failed. It also
    // matches how the shift is worked — one coordinator runs the night of the
    // 26th, and that 2:30 AM cab is their job, not the next shift's.
    //
    // WHAT IT COSTS, so nobody is surprised: at 1 AM on the 27th, a coordinator
    // opening "today" does NOT see the cab that is running right then — it is on
    // yesterday's board. The driver is unaffected (DriverHomeScreen already reads
    // today plus yesterday's unfinished runs), and `departDate` keeps every
    // deadline computed against the true instant.
    if (shiftDate === travelDate && legs.provideDrop) {
      rides.push(
        makeRide({
          roster, shiftDate, travelDate,
          // The clock day, one later when the shift runs past midnight.
          departDate: legs.dropNextDay ? shiftDateKey(shiftDate, 1) : shiftDate,
          leg: 'out', code, time: legs.drop, policy,
        })
      );
    }
  };

  // ONE ROSTER DAY, not two. Every ride now belongs to the day its own shift is
  // rostered on, so the second pass over yesterday — which existed solely to
  // catch an overnight shift's drop landing on this morning — would match
  // nothing: both branches above require `shiftDate === travelDate`. Removed
  // rather than left in as a no-op, and it takes the month-boundary special case
  // with it (a shift on the 31st keeps its drop on the 31st, so no date on a
  // board ever needs the previous month's roster documents).
  (rosters || []).forEach((roster) => {
    consider(roster, travelDate);
  });

  // A CANCELLED RIDE THE ROSTER NO LONGER DERIVES.
  //
  // The board is built from roster codes, so a ride only has a row while its
  // code still produces one. Resolving a LEAVE request recodes that day to `L` —
  // a non-working code — so from that moment the loop above derives nothing for
  // this person and the cancelled booking has no row to attach to. The ride did
  // not become cancelled on the board; it disappeared off it, and the day's
  // count silently dropped by one with nothing anywhere to say why.
  //
  // So cancelled bookings for this date are added back as rows in their own
  // right, keyed the same way, and only when the caller asked to keep cancelled
  // rides at all. `seen` guards against doubling up a booking that the roster
  // still does derive.
  if (options.keepDeskCancelled === true) {
    const seen = new Set(rides.map((r) => r.key));
    bookings.forEach((b) => {
      if (b.date !== travelDate) return;
      if (b.status !== STATUS.CANCELLED) return;
      if (!deskSideCancellation(b)) return;
      const key = b.rideKey || `${b.employeeId}_${b.shiftDate || b.date}_${b.direction === DIRECTION.IN ? 'in' : 'out'}`;
      if (seen.has(key)) return;
      seen.add(key);
      const isIn = b.direction === DIRECTION.IN;
      rides.push({
        key,
        employeeId: b.employeeId,
        employeeName: b.employeeName,
        empId: b.empId || '',
        // Neither of these is on a booking; AppContext.ridesOn overlays both
        // from the live profile for every ride, which is what fills them in.
        route: null,
        employeeAddress: b.employeeAddress || '',
        shiftCode: b.shiftCode || '',
        shiftLabel: policy?.[b.shiftCode]?.label || b.shiftCode || '',
        shiftDate: b.shiftDate || b.date,
        date: b.date,
        departDate: b.departDate || b.date,
        leg: isIn ? 'in' : 'out',
        direction: b.direction || (isIn ? DIRECTION.IN : DIRECTION.OUT),
        shift: b.shift,
        pickup: b.pickup || (isIn ? 'Home' : 'Office'),
        booking: b,
        bookingId: b.id,
        status: STATUS.CANCELLED,
        assignedCabId: b.assignedCabId || null,
      });
    });
  }

  // Attach live state from any booking that already exists for the ride.
  rides.forEach((ride) => {
    const booking = byKey.get(ride.key);
    if (booking) {
      ride.booking = booking;
      ride.bookingId = booking.id;
      ride.status = booking.status || STATUS.BOOKED;
      ride.assignedCabId = booking.assignedCabId || null;
      // A coordinator may have moved the pickup time on the booking.
      if (booking.shift) ride.shift = booking.shift;
      if (booking.cancelStatus) ride.cancelStatus = booking.cancelStatus;
    }
  });

  // Cancelled rides drop out of the operational list entirely.
  //
  // Sort CHRONOLOGICALLY, which means parsing the time — comparing "hh:mm AM/PM"
  // as text puts 10:15 PM before 12:00 PM and 03:00 PM before 06:15 AM, so the
  // desk would work the day out of order.
  //
  // BY DEPART DATE FIRST, then time-of-day. Time alone was right only while every
  // ride on a board shared one clock day; now that an overnight drop is listed
  // with its own shift, a single board can hold a 10:00 PM drop and a 2:30 AM one
  // belonging to the next morning. On minutes alone the 2:30 AM (150) and the
  // 12:00 AM (0) sort BEFORE the 10:00 PM (1320) — the desk would be handed the
  // night backwards, ending with the cab that actually leaves first. Comparing
  // `departDate` first restores real order: 10:00 PM tonight, then midnight, then
  // 2:30 AM. Plain string compare is correct for YYYY-MM-DD.
  return rides
    .filter(
      (r) =>
        r.status !== STATUS.CANCELLED ||
        (options.keepDeskCancelled === true && deskSideCancellation(r.booking))
    )
    .sort((a, b) => {
      const da = String(a.departDate || a.date || '');
      const db = String(b.departDate || b.date || '');
      if (da !== db) return da < db ? -1 : 1;
      const ta = timeToMinutes(a.shift);
      const tb = timeToMinutes(b.shift);
      if (ta != null && tb != null && ta !== tb) return ta - tb;
      // Same minute (a carpool): keep it stable and readable by name.
      return String(a.employeeName || '').localeCompare(String(b.employeeName || ''));
    });
}

// Drop rides that a RESOLVED change request already excused, even though no
// booking document exists to carry a Cancelled status.
//
// A ride only becomes a document once it acquires state — a cab assigned, or a
// cancellation (see the header above). Leave/Absent/Cancel-one-ride are almost
// always raised BEFORE the coordinator has assigned anything, so resolving one
// often has nothing to cancel: ridesForDate() would otherwise keep deriving
// that ride as Pending forever, as if the request had never been resolved.
//
// This runs AFTER ridesForDate() rather than folding into it, so the deriver
// itself still takes no request-shaped argument (see CLAUDE.md) — it only ever
// REMOVES a ride here, never adds one, so the "no extra-request path" rule
// stays true of the actual derivation.
// ---------------------------------------------------------------------------
// SEARCH
//
// EVERY WORD MUST MATCH, so typing more narrows rather than widens — "meghana
// gachibowli" finds one rider, not everyone called Meghana plus everyone in
// Gachibowli. Same rule the Employees screen already uses, so the two search
// boxes in this app behave identically.
//
// The address is in the haystack on purpose. The coordinator is often working
// from what somebody said on the phone — "the girls' PG in Ameerpet" — which is
// a landmark, not a name they can spell.
//
// Lives here, not on the dashboard, because ONE function has to answer this.
// What the board hides is also what decides which ticks survive a keystroke
// (see changeSearch there) — and a tick left on a hidden row is a cab assigned
// to somebody the coordinator cannot see. Two copies could drift; one cannot.
// ---------------------------------------------------------------------------
export function searchWordsOf(term) {
  return String(term || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function rideMatches(ride, words, cab) {
  if (!words?.length) return true;
  const hay = [
    ride?.employeeName, ride?.empId, ride?.route, ride?.employeeAddress,
    ride?.shift, ride?.direction,
    // THE SHIFT, BY CODE AND BY NAME. The code is the chip on every card and
    // the label is what Shift Timings calls it, so both are things the desk can
    // see on screen and reasonably type — "night" or "A2" used to match nothing
    // at all while the row it belonged to was in plain sight. No new false
    // positives: matching is substring over the whole haystack, so a one-letter
    // code was already matching everything through the names and addresses.
    ride?.shiftCode, ride?.shiftLabel,
    cab?.cabNumber, cab?.driverName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function excuseResolvedRequests(rides, changeRequests) {
  if (!rides.length || !changeRequests?.length) return rides;

  // Keyed on the EFFECT, not the type, which is why retiring "Absent today" needed
  // no change here: any request whose effect is CANCEL_DAY excuses the whole day.
  const dayOff = new Set(); // `${employeeId}_${shiftDate}` — Leave (or old Absent)
  const rideOff = new Set(); // rideKey — Cancel one ride
  changeRequests.forEach((r) => {
    if (r.status !== REQUEST_STATUS.RESOLVED) return;
    if (r.effect === EFFECT.CANCEL_DAY) dayOff.add(`${r.employeeId}_${r.date}`);
    else if (r.effect === EFFECT.CANCEL_RIDE && r.rideKey) rideOff.add(r.rideKey);
  });
  if (!dayOff.size && !rideOff.size) return rides;

  return rides.filter((ride) => {
    // A RIDE WITH A CANCELLED BOOKING IS NOT EXCUSED — it is EVIDENCE.
    //
    // This function exists for the ride that has no document at all: resolving a
    // request usually has nothing to cancel, so without this the deriver would
    // keep producing that ride as Pending for ever. But once a cancelled booking
    // exists, dropping the row here is the second reason a cancelled ride went
    // missing from the board — the status filter had already been taught to show
    // it, and then this removed the row before anything could.
    if (ride.status === STATUS.CANCELLED) return true;
    return !rideOff.has(ride.key) && !dayOff.has(`${ride.employeeId}_${ride.shiftDate}`);
  });
}

// The payload for turning a derived ride into a real booking. Mirrors the shape
// the rest of the app already expects, plus the roster provenance.
export function bookingFromRide(ride, departAt) {
  return {
    rideKey: ride.key,
    employeeId: ride.employeeId,
    employeeName: ride.employeeName,
    // Both the name above and this ID are carried onto the booking for the DRIVER'S
    // trip list: the rules (rightly) don't let a driver read employee profiles, so
    // whatever their screen shows has to already be here. The name is what they see;
    // the ID is the fallback for bookings written before it was copied across.
    empId: ride.empId || '',
    employeeAddress: ride.employeeAddress || null,
    employeeHome: null,
    date: ride.date,
    // Persisted alongside `date` because the two differ for an overnight drop and
    // every deadline is computed from this one (see makeRide). Written even when
    // it equals `date`, so a consumer can read it unconditionally rather than
    // having to know which legs are overnight. Bookings created before this field
    // existed have no value for it — callers fall back to `date`, which was the
    // depart date under the old rule, so legacy documents stay correct.
    departDate: ride.departDate || ride.date,
    shift: ride.shift,
    direction: ride.direction,
    pickup: ride.pickup,
    shiftCode: ride.shiftCode,
    shiftDate: ride.shiftDate,
    source: 'roster',
    generated: true,
    status: STATUS.BOOKED,
    assignedCabId: null,
    departAt: departAt || null,
  };
}

// --- Grouping for the coordinator dashboard ---------------------------------

const NO_ROUTE = 'No route set';

// Group rides by route, then note the shifts present in each — the coordinator
// assigns a cab to people on the same route travelling at the same time.
export function groupByRoute(rides) {
  const groups = {};
  rides.forEach((r) => {
    const key = r.route || NO_ROUTE;
    (groups[key] = groups[key] || []).push(r);
  });
  return Object.keys(groups)
    .map((route) => ({
      title: route,
      data: groups[route],
      // Drives the "Select N" button, so a cancelled ride must not be in it —
      // it needs no cab, and ticking it would put it in an assignment.
      unassigned: groups[route].filter(
        (r) => !r.assignedCabId && r.status !== STATUS.CANCELLED
      ).length,
    }))
    .sort((a, b) => {
      // Routes with people still waiting first; "no route" last.
      if (!!a.unassigned !== !!b.unassigned) return a.unassigned ? -1 : 1;
      if (a.title === NO_ROUTE) return 1;
      if (b.title === NO_ROUTE) return -1;
      return a.title.localeCompare(b.title);
    });
}

// Group by shift + direction — the other way a desk works: "everyone on Evening
// going home at 1:45 AM".
export function groupByShift(rides) {
  const groups = {};
  rides.forEach((r) => {
    const key = `${r.shiftCode} · ${r.direction} · ${r.shift}`;
    (groups[key] = groups[key] || []).push(r);
  });
  return Object.keys(groups)
    .map((title) => ({
      title,
      data: groups[title],
      unassigned: groups[title].filter((r) => !r.assignedCabId).length,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Headline counts for the dashboard.
//
// CANCELLED RIDES ARE COUNTED SEPARATELY AND IN NOTHING ELSE. They can now be in
// the list (keepDeskCancelled above), and every other figure here means "work to
// do or work covered" — a cancelled ride is neither. Left in `pending` it would
// have read as a cab still to find, which is the one number the desk works from.
export function rideStats(rides) {
  const live = rides.filter((r) => r.status !== STATUS.CANCELLED);
  return {
    total: live.length,
    pending: live.filter((r) => !r.assignedCabId).length,
    assigned: live.filter((r) => r.assignedCabId).length,
    inbound: live.filter((r) => r.leg === 'in').length,
    outbound: live.filter((r) => r.leg === 'out').length,
    cancelled: rides.length - live.length,
  };
}
