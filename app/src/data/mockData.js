// ---------------------------------------------------------------------------
// SHARED CONSTANTS + STARTER FLEET
// The option lists, status names and policy numbers the whole app reads from.
// (The real data lives in Firestore; this file holds the fixed choices and the
// starter fleet the admin can seed from.)
// ---------------------------------------------------------------------------

// How many riders a cab seats when nothing else is set. Each driver enters their
// own vehicle's seat count when they register it; this is only the fallback for
// cabs saved before capacity existed.
export const DEFAULT_CAB_CAPACITY = 6;

// (There is no starter fleet any more. Cabs are registered by the drivers who
// drive them, so an empty fleet is a real, meaningful state — "no coordinator has
// added a cab yet" — rather than something to paper over with demo vehicles.)

// Times shown in the Weekly Schedule table (night-shift service: 9 PM → 6 AM).
// "Pickup" = cab picks you up from home to office → start of the night shift
//            (late evening: 9-11 PM).
// "Drop"   = cab drops you home from office → end of the night shift
//            (early morning of the next day: 4-6 AM).
// "NA" is the default (no ride that leg).
export const NONE = 'NA';
export const PICKUP_TIMES = [NONE, '09:00 PM', '10:00 PM', '11:00 PM'];
export const DROP_TIMES = [NONE, '04:00 AM', '05:00 AM', '06:00 AM'];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// --- Shift roster (admin-assigned) -----------------------------------------
// The cab routes / pickup locations employees are grouped under.
export const CAB_ROUTES = [
  'Madhapur',
  'JNTU Cab',
  'LB Nagar Cab',
  'Kapra Cab',
  'Shaikpet Cab',
  'ECIL Cab',
  'Berumguda Cab',
];

// The shift timings an employee can be rostered on.
export const SHIFT_TIMINGS = [
  '1:00 PM – 10:00 PM', // day shift
  '9:00 PM – 6:00 AM',  // night shift
];

// A new employee's default working days until the admin rosters them.
export const DEFAULT_WORKING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// --- Ad-hoc request form options ---
export const OFFICE_LOCATIONS = ['Vamsiram building'];

export const REASONS = [
  'Extended Shift Hours',
  'Personal Emergency',
  'Roaster not updated',
  'Other',
];

// Pick = cab picks you up from home (Home → Office).
// Drop = cab drops you home from office (Office → Home).
export const REQUEST_TYPES = ['Pick', 'Drop'];

// All times a one-time ride can choose from — the full 9 PM → 6 AM window.
export const SHIFT_TIMES = [
  '09:00 PM',
  '10:00 PM',
  '11:00 PM',
  '12:00 AM',
  '01:00 AM',
  '02:00 AM',
  '03:00 AM',
  '04:00 AM',
  '05:00 AM',
  '06:00 AM',
];

// Where a booking came from — used by the home "My ORS" / "My Adhoc" lists.
export const SOURCE = { ROSTER: 'roster', ADHOC: 'adhoc' };

// The stages a booking moves through. Used for coloring status chips.
export const STATUS = {
  BOOKED: 'Booked',
  ASSIGNED: 'Cab assigned',
  ON_THE_WAY: 'On the way',
  ARRIVED: 'Arrived',
  COMPLETED: 'Completed',
  NO_SHOW: 'No show', // driver reached the pickup but the employee wasn't there
  CANCELLED: 'Cancelled',
};

// Employees must book a ride at least this many hours before it starts.
export const BOOKING_LEAD_HOURS = 9;

// Employees must raise a cancellation request at least this many hours before
// the ride; the admin then approves or rejects it.
export const CANCEL_CUTOFF_HOURS = 4;

// The state of a cancellation request on a booking (separate from `status`, so
// the ride stays active until the admin approves).
//   Requested → employee asked to cancel, waiting on the transport desk
//   Approved  → admin accepted; the booking's status becomes "Cancelled"
//   Rejected  → admin declined; the ride stays on
export const CANCEL_STATUS = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
