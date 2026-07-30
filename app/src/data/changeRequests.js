// ---------------------------------------------------------------------------
// CHANGE REQUESTS — the four exceptions an employee can raise
//
// The roster says who travels. A change request is how reality differs from the
// roster on one particular day: someone takes leave, someone can't come in,
// someone doesn't need one of their two cabs, someone is working a different
// shift from the one HR rostered.
//
// WHAT IS DELIBERATELY NOT HERE. The company runs exactly two rides — the 8:00 PM
// pickup for the Night shift and the 10:00 PM drop for the Afternoon shift — and
// nothing else, ever. So there is no request for a later cab after a shift ran
// long, no emergency ride, and no "collect me at a different time": every one of
// those asks for a ride outside the two, which is not a thing the desk can grant.
// Removing them is why nothing routes to HR any more (see ROUTE_TO) and why the
// coordinator's board is purely roster-driven. Anyone genuinely stranded phones
// the transport desk — the call button in the app header.
//
// Every request that remains only ever CANCELS or CORRECTS one of the two rides,
// so `effect` has no "add a ride" case at all.
// ---------------------------------------------------------------------------

export const REQUEST_TYPES = {
  LEAVE: 'leave',
  ABSENT: 'absent',
  SHIFT_CHANGED: 'shift_changed',
  CANCEL_RIDE: 'cancel_ride',
};

export const REQUEST_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RESOLVED: 'Resolved',
};

// Who a request lands with. Everything goes to the coordinator, who resolves it as
// part of running the day — there is no HR sign-off, because nothing an employee
// can ask for commits a cab outside the two scheduled rides.
export const ROUTE_TO = {
  COORDINATOR: 'coordinator',
};

// What resolving a request does to the roster / rides. All three either stop a
// ride or move the day to a different shift code; none of them create one.
export const EFFECT = {
  CANCEL_DAY: 'cancel_day',       // drop every ride that day
  CANCEL_RIDE: 'cancel_ride',     // drop one leg
  RECODE: 'recode',               // change the roster's shift code for that day
  NONE: 'none',
};

// The catalogue. `form` lists the extra fields the employee is asked for beyond
// date / reason / comments.
export const REQUEST_CATALOGUE = [
  {
    type: REQUEST_TYPES.LEAVE,
    label: 'Leave',
    icon: 'calendar-remove',
    blurb: "I'm on leave — cancel my cabs and mark the day as Leave.",
    routeTo: ROUTE_TO.COORDINATOR,
    effect: EFFECT.CANCEL_DAY,
    // Leave is a roster fact, so approving it rewrites the day's code to L.
    recodeTo: 'L',
    form: [],
  },
  {
    type: REQUEST_TYPES.ABSENT,
    label: 'Absent today',
    icon: 'account-off',
    blurb: "I can't come in today — cancel my cabs, but leave my roster as is.",
    routeTo: ROUTE_TO.COORDINATOR,
    effect: EFFECT.CANCEL_DAY,
    form: [],
  },
  {
    type: REQUEST_TYPES.CANCEL_RIDE,
    label: 'Cancel one ride',
    icon: 'car-off',
    blurb: "I'm working, but I don't need one of my cabs.",
    routeTo: ROUTE_TO.COORDINATOR,
    effect: EFFECT.CANCEL_RIDE,
    form: ['ride'],
  },
  {
    type: REQUEST_TYPES.SHIFT_CHANGED,
    label: 'Shift changed',
    icon: 'swap-horizontal',
    blurb: "I'm working a different shift from the one on the roster.",
    routeTo: ROUTE_TO.COORDINATOR,
    effect: EFFECT.RECODE,
    form: ['shiftCode'],
  },
];

export function requestMeta(type) {
  return REQUEST_CATALOGUE.find((r) => r.type === type) || null;
}

export function requestLabel(type) {
  return requestMeta(type)?.label || type;
}

// Reasons offered on the form. Free text goes in `comments`.
export const REASONS = [
  'Personal',
  'Medical',
  'Work from home',
  'Family emergency',
  'Work commitment',
  'Travel',
  'Other',
];

// Chip colours by status.
export const STATUS_STYLE = {
  [REQUEST_STATUS.PENDING]: { bg: '#FFF4E0', fg: '#B26A00', icon: 'progress-clock' },
  [REQUEST_STATUS.APPROVED]: { bg: '#E7F4E8', fg: '#2E7D32', icon: 'check-circle-outline' },
  [REQUEST_STATUS.RESOLVED]: { bg: '#E7F4E8', fg: '#2E7D32', icon: 'check-circle-outline' },
  [REQUEST_STATUS.REJECTED]: { bg: '#FDECEC', fg: '#C62828', icon: 'close-circle-outline' },
};
