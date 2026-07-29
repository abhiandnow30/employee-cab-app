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
// An Evening shift on the 5th runs 4:00 PM → 1:30 AM, so it produces:
//   • an inbound  ride on the 5th (pickup 3:00 PM)
//   • an outbound ride on the 6th (drop 1:45 AM)
// The two legs are on different calendar days. "Rides on the 6th" therefore has
// to read TWO roster days: the 6th (for shifts starting that day) and the 5th
// (for overnight shifts ending that morning). Getting this wrong is how a night
// shift silently loses its ride home.
// ---------------------------------------------------------------------------

import { legsForShift, isWorkingCode } from '../data/shifts';
import { shiftDateKey, timeToMinutes } from '../utils/datetime';
import { STATUS } from '../data/mockData';

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
//   rosters       — roster docs covering travelDate AND the day before (see above)
//   policy        — the shift policy (config/shifts)
//   bookings      — existing booking docs, used to attach live state
//   extraRequests — APPROVED change requests that call for an additional ride
//                   (a shift extension, or an emergency ride the desk agreed to)
//
// The roster is the source of most rides, but not all of them: an approved shift
// extension or emergency ride is a ride that the roster knows nothing about. Those
// used to go nowhere — HR approved them and no cab could ever be assigned, because
// nothing put them in front of the coordinator. They're folded in here so they
// appear in the day's list and can be assigned exactly like a rostered ride.
//
// Returns rides sorted by pickup time, each carrying its booking when it has one.
export function ridesForDate(travelDate, rosters, policy, bookings = [], extraRequests = []) {
  if (!travelDate) return [];
  if (!rosters?.length && !extraRequests?.length) return [];

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

  // Approved extra rides for this day. The request carries the employee and the
  // time; the address comes from any roster row we hold for them, since a request
  // doesn't duplicate it.
  (extraRequests || [])
    .filter((r) => r.date === travelDate && !r.fulfilledBookingId)
    .forEach((r) => {
      const known = (rosters || []).find((x) => x.employeeId === r.employeeId);
      const leg = r.direction === DIRECTION.IN ? 'in' : 'out';
      rides.push({
        // Keyed by the request, not by a shift — there is no shift behind it.
        key: `req_${r.id}`,
        employeeId: r.employeeId,
        employeeName: r.employeeName || known?.employeeName || 'Employee',
        empId: r.empId || known?.empId || '',
        route: r.route || known?.route || null,
        employeeAddress: known?.address || '',
        shiftCode: r.type === 'shift_extended' ? 'EXT' : 'SOS',
        shiftLabel: r.typeLabel || 'Extra ride',
        shiftDate: travelDate,
        date: travelDate,
        leg,
        direction: r.direction || DIRECTION.OUT,
        shift: r.requestedTime || '',
        pickup: leg === 'in' ? 'Home' : 'Office',
        // Marks it out in the UI, and lets the assign action close the request.
        isExtra: true,
        requestId: r.id,
        requestType: r.type,
        booking: null,
        status: 'Pending',
        assignedCabId: null,
      });
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

// The payload for turning a derived ride into a real booking. Mirrors the shape
// the rest of the app already expects, plus the roster provenance.
export function bookingFromRide(ride, departAt) {
  return {
    rideKey: ride.key,
    // Set for a ride that came from an approved request rather than the roster.
    ...(ride.requestId ? { changeRequestId: ride.requestId } : {}),
    employeeId: ride.employeeId,
    employeeName: ride.employeeName,
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
