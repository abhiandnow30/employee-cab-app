// ---------------------------------------------------------------------------
// CHANGE REQUESTS — the seven exceptions, and who resolves each
//
// The roster says who travels. A change request is how reality differs from the
// roster on one particular day: someone takes leave, a shift runs long, a cab is
// needed at short notice.
//
// The ROUTING TABLE below is the whole of the approval policy, held as data so it
// can be read in one place and changed without hunting through screens:
//
//   • Most requests go to the COORDINATOR, who resolves them as part of running
//     the day. No admin sign-off — that was the point of the redesign.
//   • Only two things reach HR/Admin: a shift EXTENSION (it commits an extra cab
//     outside the rostered shift) and an emergency ride the coordinator has no
//     vehicle for (it needs someone who can authorise an exception).
//
// `effect` describes what resolving the request actually does to the day's rides,
// and services/changeRequests.js is what carries it out.
// ---------------------------------------------------------------------------

export const REQUEST_TYPES = {
  LEAVE: 'leave',
  ABSENT: 'absent',
  SHIFT_EXTENDED: 'shift_extended',
  SHIFT_CHANGED: 'shift_changed',
  CANCEL_RIDE: 'cancel_ride',
  EMERGENCY_RIDE: 'emergency_ride',
  PICKUP_TIME_CHANGE: 'pickup_time_change',
};

export const REQUEST_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RESOLVED: 'Resolved',
};

// Who a request lands with.
export const ROUTE_TO = {
  COORDINATOR: 'coordinator',
  ADMIN: 'admin',
};

// What resolving a request does to the roster / rides.
export const EFFECT = {
  CANCEL_DAY: 'cancel_day',       // drop every ride that day
  CANCEL_RIDE: 'cancel_ride',     // drop one leg
  RETIME: 'retime',               // move a pickup time
  RECODE: 'recode',               // change the roster's shift code for that day
  EXTRA_RIDE: 'extra_ride',       // create an additional ride
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
    type: REQUEST_TYPES.PICKUP_TIME_CHANGE,
    label: 'Change pickup time',
    icon: 'clock-edit-outline',
    blurb: 'I need collecting at a different time.',
    routeTo: ROUTE_TO.COORDINATOR,
    effect: EFFECT.RETIME,
    form: ['ride', 'time'],
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
  {
    type: REQUEST_TYPES.SHIFT_EXTENDED,
    label: 'Shift extended',
    icon: 'clock-plus-outline',
    // Goes to HR because it commits a cab outside the rostered shift.
    blurb: "I'm working past my shift and need a later cab home.",
    routeTo: ROUTE_TO.ADMIN,
    effect: EFFECT.EXTRA_RIDE,
    form: ['time'],
  },
  {
    type: REQUEST_TYPES.EMERGENCY_RIDE,
    label: 'Emergency ride',
    icon: 'car-emergency',
    blurb: 'I need a cab at short notice.',
    // The coordinator tries first; if no vehicle is free they escalate.
    routeTo: ROUTE_TO.COORDINATOR,
    effect: EFFECT.EXTRA_RIDE,
    escalatable: true,
    form: ['time', 'direction'],
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
