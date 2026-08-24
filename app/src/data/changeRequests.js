// ---------------------------------------------------------------------------
// CHANGE REQUESTS — the three exceptions an employee can raise
//
// The roster says who travels. A change request is how reality differs from the
// roster on one particular day: someone isn't coming in, someone doesn't need one
// of their two cabs, someone is working a different shift from the one HR rostered.
//
// There were four. "Absent today" was retired because it did the same thing to the
// cabs as "Leave" and only differed in whether the roster day got recoded — two
// buttons, one outcome, and riders choosing between them at random. See the
// retired entry in REQUEST_CATALOGUE for the full reasoning.
//
// WHAT IS DELIBERATELY NOT HERE. Every ride the company runs is derived from a
// rostered shift code plus the shift policy — nothing else, ever. So there is no
// request for a later cab after a shift ran long, no emergency ride, and no
// "collect me at a different time": every one of those asks for a ride the
// roster does not produce, which is not a thing the desk can grant. Removing
// them is why nothing routes to HR any more (see ROUTE_TO) and why the
// coordinator's board is purely roster-driven. Anyone genuinely stranded phones
// the transport desk — the call button in the app header.
//
// The remedy for genuinely different hours is a SHIFT, not a request: HR adds or
// retimes one in Shift Timings and rosters the person onto it (that is what A2
// and E2 are — see data/shifts.js). That keeps the ride derivable from the
// roster, which is the whole property this file is protecting.
//
// Every request that remains only ever CANCELS or CORRECTS a ride the roster
// already produces, so `effect` has no "add a ride" case at all.
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
//
// `retired: true` means "still readable, no longer offered". A retired type keeps
// its label, effect and consequence text so requests already in Firestore — and
// any still sitting Pending — render and resolve exactly as they did; it is simply
// filtered out of the employee's picker (see ChangeRequestScreen). Deleting the
// entry outright would leave old rows labelled with a raw slug like "absent" and
// no effect to resolve them by.
export const REQUEST_CATALOGUE = [
  {
    type: REQUEST_TYPES.LEAVE,
    label: 'Leave',
    icon: 'calendar-remove',
    // Covers a planned day off AND "I can't come in today" — see the retired
    // ABSENT entry below for why this one blurb has to carry both.
    blurb: "I'm not coming in — cancel my cabs and mark the day as Leave.",
    routeTo: ROUTE_TO.COORDINATOR,
    effect: EFFECT.CANCEL_DAY,
    // Leave is a roster fact, so approving it rewrites the day's code to L.
    recodeTo: 'L',
    form: [],
  },
  {
    // RETIRED (Aug 2026) — it was indistinguishable from Leave in practice.
    //
    // Both were `effect: CANCEL_DAY`, so both cancelled every cab that day. The
    // only difference was that Leave also recoded the roster day to 'L' while this
    // one left the roster saying the person was still expected to travel — an
    // attendance distinction, invisible on the cab side. Two buttons that took the
    // same inputs and produced the same outcome for the rider, so people picked at
    // random. Worse, the label promised something the form didn't enforce: the date
    // picker offered today through +14 days for BOTH, so "Absent today" was
    // routinely raised for next week.
    //
    // Leave is the one kept because it is the durable half. Recoding the day to 'L'
    // stops it GENERATING rides at all, whereas this type only suppressed them via
    // excuseResolvedRequests() matching the resolved request document — delete or
    // alter that row and the ride comes back. The reason list (Medical, Family
    // emergency, Personal…) already carries why someone isn't travelling, which is
    // all the desk needed this type for.
    retired: true,
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

// What the employee may raise NOW. Everything else in the catalogue is history —
// use REQUEST_CATALOGUE (or requestMeta) to READ an existing request, and this to
// offer a new one.
export const OFFERED_REQUESTS = REQUEST_CATALOGUE.filter((r) => !r.retired);

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
