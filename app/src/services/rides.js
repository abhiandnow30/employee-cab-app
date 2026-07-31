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
// An Evening shift on the 5th runs 4:00 PM → 1:00 AM, so its two legs are:
//   • inbound  on the 5th, before the shift starts
//   • outbound on the 6th, when the shift ends
// They fall on different calendar days. "Rides on the 6th" therefore has to read
// TWO roster days: the 6th (for shifts starting that day) and the 5th (for
// overnight shifts ending that morning). Getting this wrong is how an overnight
// shift silently loses its ride home.
//
// Which of those legs a cab actually runs is policy — today the evening shift gets
// neither and the night shift only its inbound — but the two-day read is what
// makes the outbound land on the right day whenever one is provided.
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

// Build one derived ride.
function makeRide({ roster, shiftDate, travelDate, leg, code, time, policy }) {
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
    // The day the CAB runs. Differs from shiftDate for an overnight drop.
    date: travelDate,
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
export function ridesForDate(travelDate, rosters, policy, bookings = []) {
  if (!travelDate) return [];
  if (!rosters?.length) return [];

  const prevDate = shiftDateKey(travelDate, -1);
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
        makeRide({ roster, shiftDate, travelDate, leg: 'in', code, time: legs.pickup, policy })
      );
    }
    // Outbound runs the next day for an overnight shift, same day otherwise.
    const outDate = legs.dropNextDay ? shiftDateKey(shiftDate, 1) : shiftDate;
    if (outDate === travelDate && legs.provideDrop) {
      rides.push(
        makeRide({ roster, shiftDate, travelDate, leg: 'out', code, time: legs.drop, policy })
      );
    }
  };

  (rosters || []).forEach((roster) => {
    consider(roster, travelDate); // shifts starting today
    consider(roster, prevDate); // overnight shifts ending today
  });

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
  return rides
    .filter((r) => r.status !== STATUS.CANCELLED)
    .sort((a, b) => {
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
export function excuseResolvedRequests(rides, changeRequests) {
  if (!rides.length || !changeRequests?.length) return rides;

  const dayOff = new Set(); // `${employeeId}_${shiftDate}` — Leave / Absent
  const rideOff = new Set(); // rideKey — Cancel one ride
  changeRequests.forEach((r) => {
    if (r.status !== REQUEST_STATUS.RESOLVED) return;
    if (r.effect === EFFECT.CANCEL_DAY) dayOff.add(`${r.employeeId}_${r.date}`);
    else if (r.effect === EFFECT.CANCEL_RIDE && r.rideKey) rideOff.add(r.rideKey);
  });
  if (!dayOff.size && !rideOff.size) return rides;

  return rides.filter(
    (ride) => !rideOff.has(ride.key) && !dayOff.has(`${ride.employeeId}_${ride.shiftDate}`)
  );
}

// The payload for turning a derived ride into a real booking. Mirrors the shape
// the rest of the app already expects, plus the roster provenance.
export function bookingFromRide(ride, departAt) {
  return {
    rideKey: ride.key,
    employeeId: ride.employeeId,
    employeeName: ride.employeeName,
    // The company employee ID, carried onto the booking because the DRIVER'S trip
    // list identifies riders by ID rather than by name, and the rules (rightly) do
    // not let a driver read employee profiles to look one up.
    empId: ride.empId || '',
    employeeAddress: ride.employeeAddress || null,
    employeeHome: null,
    date: ride.date,
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
      unassigned: groups[route].filter((r) => !r.assignedCabId).length,
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
export function rideStats(rides) {
  return {
    total: rides.length,
    pending: rides.filter((r) => !r.assignedCabId).length,
    assigned: rides.filter((r) => r.assignedCabId).length,
    inbound: rides.filter((r) => r.leg === 'in').length,
    outbound: rides.filter((r) => r.leg === 'out').length,
  };
}
