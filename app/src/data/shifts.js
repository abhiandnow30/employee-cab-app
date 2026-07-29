// ---------------------------------------------------------------------------
// SHIFT CODES + TRANSPORT POLICY
//
// The monthly roster HR uploads is a grid of SHIFT CODES — one letter per
// employee per day. Everything downstream (who gets a cab, at what time, in
// which direction) is derived from these codes plus the policy below, so adding
// or retiming a shift is a CONFIG change, not a code change.
//
//   E  Evening    4:00 PM – 1:30 AM     → rides
//   A  Afternoon  1:00 PM – 10:00 PM    → rides
//   N  Night      9:00 PM – 6:00 AM     → rides
//   WO Week Off                         → no ride
//   H  Holiday                          → no ride
//   L  Leave                            → no ride
//
// OVERNIGHT SHIFTS ARE THE TRICKY PART. An Evening shift starting on the 5th
// ends at 1:30 AM on the 6th, so its two rides fall on DIFFERENT calendar days:
//   • inbound  (home → office) on the 5th, an hour before the shift starts
//   • outbound (office → home) on the 6th, when the shift ends
// `endsNextDay` below is what makes that explicit, and it's why the coordinator's
// "today" list is built from two roster days, not one (see services/rides.js).
// ---------------------------------------------------------------------------

// The codes that mean "this person travels today".
export const WORKING_CODES = ['E', 'A', 'N'];
// The codes that mean "no ride" — kept as data so the reason can be displayed.
export const NON_WORKING_CODES = ['WO', 'H', 'L'];

export const ALL_SHIFT_CODES = [...WORKING_CODES, ...NON_WORKING_CODES];

// Real rosters spell the shift out in the grid — "WEEK OFF" rather than "WO",
// "Evening" rather than "E" — even when the sheet's own legend lists the codes.
// Rejecting those would mean asking HR to find-and-replace a 31-column sheet
// every month, so the parser accepts the words and normalises them to codes.
//
// Keys are compared uppercased with runs of whitespace collapsed and a trailing
// "SHIFT" removed, so "evening shift" and "Evening  Shift" both land on E.
const SHIFT_SYNONYMS = {
  E: 'E', EVENING: 'E', EVE: 'E', EVN: 'E',
  A: 'A', AFTERNOON: 'A', AFT: 'A', NOON: 'A',
  N: 'N', NIGHT: 'N', NGT: 'N',
  WO: 'WO', 'WEEK OFF': 'WO', WEEKOFF: 'WO', 'W/O': 'WO', 'WEEKLY OFF': 'WO',
  OFF: 'WO', 'REST DAY': 'WO', RD: 'WO',
  H: 'H', HOLIDAY: 'H', HOL: 'H', 'PUBLIC HOLIDAY': 'H', PH: 'H',
  L: 'L', LEAVE: 'L', LV: 'L', 'ON LEAVE': 'L',
  // Common leave types all mean "not travelling".
  PL: 'L', CL: 'L', SL: 'L', EL: 'L', COMP: 'L', 'COMP OFF': 'L',
};

// The weekday names a lot of rosters put in a second header row under the dates.
// Such a row is part of the header, not an employee, and must not be read as one.
const WEEKDAY_WORDS = new Set([
  'MON', 'MONDAY', 'TUE', 'TUES', 'TUESDAY', 'WED', 'WEDNESDAY',
  'THU', 'THUR', 'THURS', 'THURSDAY', 'FRI', 'FRIDAY',
  'SAT', 'SATURDAY', 'SUN', 'SUNDAY',
]);

// "  week   off " → "WEEK OFF";  "Evening Shift" → "EVENING"
function normaliseCell(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*SHIFT$/, '');
}

// A grid cell → a canonical shift code, or null if it means nothing to us.
// Returns null for blanks too; the caller decides whether a blank is an error.
export function toShiftCode(raw) {
  const key = normaliseCell(raw);
  if (!key) return null;
  return SHIFT_SYNONYMS[key] || null;
}

// Is this row the weekday strip that sits under the date headers?
export function isWeekdayRow(cells) {
  const words = (cells || [])
    .map(normaliseCell)
    .filter(Boolean);
  if (words.length < 3) return false;
  const hits = words.filter((w) => WEEKDAY_WORDS.has(w)).length;
  // Most of what's filled in is a day name → it's a header row.
  return hits >= Math.max(3, Math.ceil(words.length * 0.6));
}

// The company's starting transport policy. The admin edits this in Shift Policy
// and it lives in Firestore at config/shifts, so a retimed shift takes effect
// for everyone without a redeploy.
//
//   start / end     — 24h "HH:MM". `end` before `start` means it runs past midnight.
//   pickupLeadMin   — how long before the shift starts the cab collects them.
//                     Derived, not a fixed list, so it adapts to every shift.
//   dropDelayMin    — how long after the shift ends the cab leaves the office.
//   providePickup / provideDrop
//                   — optional. Omitted, the SERVICE_WINDOW below decides whether
//                     a cab runs for that leg. Set explicitly to override it.
//
// dropDelayMin is 0 because the desk's stated policy is a drop AT the end of the
// shift — the 22:00 shift is dropped at 22:00, not 22:15.
export const DEFAULT_SHIFT_POLICY = {
  E: { label: 'Evening', start: '16:00', end: '01:30', pickupLeadMin: 60, dropDelayMin: 0, working: true },
  A: { label: 'Afternoon', start: '13:00', end: '22:00', pickupLeadMin: 60, dropDelayMin: 0, working: true },
  N: { label: 'Night', start: '21:00', end: '06:00', pickupLeadMin: 60, dropDelayMin: 0, working: true },
  WO: { label: 'Week Off', working: false },
  H: { label: 'Holiday', working: false },
  L: { label: 'Leave', working: false },
};

// Colours for the monthly calendar, roster legend and every shift chip, so a
// month reads at a glance.
//
// These follow the colour convention the transport desk already uses in its own
// spreadsheet — people who have been reading that sheet for years shouldn't have
// to relearn what green means:
//   E  Evening    → green
//   A  Afternoon  → peach
//   H  Holiday    → cyan
//   WO Week Off   → unfilled in the sheet, so a neutral grey here
//
// Night and Leave are not colour-coded in that sheet. They still need to be
// distinguishable in a calendar grid, so: N gets a slate tint (it is a WORKING
// shift and must not read as an empty cell) and L gets red (it is an absence).
// Change these two freely — nothing depends on the specific hues.
export const SHIFT_COLORS = {
  E: { bg: '#D8EFD3', fg: '#1B5E20' },
  A: { bg: '#FCE4D6', fg: '#A64B06' },
  N: { bg: '#E4E9EF', fg: '#33475B' },
  WO: { bg: '#F2F2F2', fg: '#5F6368' },
  H: { bg: '#C9EEF8', fg: '#0A5A6E' },
  L: { bg: '#FDE0E0', fg: '#B3261E' },
};

// "16:00" → 960 (minutes since midnight). null if unparseable.
export function hhmmToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// 960 → "04:00 PM". The rest of the app displays times in this format, so shift
// policy times get converted before they ever reach a booking.
export function minutesToDisplay(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440; // keep negatives / >24h in range
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ap}`;
}

// Does this shift finish on the following calendar day?
export function endsNextDay(shift) {
  const s = hhmmToMinutes(shift?.start);
  const e = hhmmToMinutes(shift?.end);
  if (s == null || e == null) return false;
  return e <= s;
}

// Is this a code that generates rides? Unknown codes are treated as non-working,
// so a typo in the roster can never silently book a cab.
export function isWorkingCode(policy, code) {
  const s = policy?.[code];
  return !!s && s.working === true;
}

// --- Which legs the company actually provides -------------------------------
//
// A working shift does NOT automatically mean two cab rides. Cabs run only during
// the hours when getting yourself home is the problem — late night and early
// morning. Outside that window people travel under their own steam.
//
// For this company: cabs run 20:00 → 06:00. Which means:
//
//   A  Afternoon 13:00–22:00   pickup 12:00  ✗ outside the window — no cab
//                              drop   22:00  ✓ provided
//   N  Night     21:00–06:00   pickup 20:00  ✓ provided
//                              drop   06:00  ✓ provided
//   E  Evening   16:00–01:30   pickup 15:00  ✗ outside the window — no cab
//                              drop   01:30  ✓ provided
//
// Before this existed, every working shift produced both legs, so ten afternoon
// employees generated ten midday pickups that no cab was ever going to make.
//
// A shift can override the window explicitly with `providePickup` /
// `provideDrop` booleans — set those on the Shift Policy screen when a shift
// doesn't follow the general rule.
export const SERVICE_WINDOW = { from: '20:00', to: '06:00' };

// Is this time inside the service window? The window wraps midnight, so
// 20:00→06:00 means "at or after 20:00, OR at or before 06:00". Both ends are
// inclusive: a 06:00 drop for a shift ending at 06:00 is provided.
export function withinServiceWindow(minutes, window = SERVICE_WINDOW) {
  if (minutes == null) return false;
  const from = hhmmToMinutes(window?.from);
  const to = hhmmToMinutes(window?.to);
  if (from == null || to == null) return true; // no window configured — provide everything
  const t = ((minutes % 1440) + 1440) % 1440;
  return from <= to ? t >= from && t <= to : t >= from || t <= to;
}

// The two ride legs a working shift produces, as display times.
// Returns { pickup, drop, dropNextDay, providePickup, provideDrop } — or null for
// a non-working code. The times are always computed; the flags say whether a cab
// is actually sent, so a screen can show "no cab at 12:00 PM" rather than nothing.
export function legsForShift(policy, code) {
  const s = policy?.[code];
  if (!s || s.working !== true) return null;
  const start = hhmmToMinutes(s.start);
  const end = hhmmToMinutes(s.end);
  if (start == null || end == null) return null;
  // Home → Office: collected `pickupLeadMin` before the shift starts.
  const pickupMins = start - (Number(s.pickupLeadMin) || 0);
  // Office → Home: leaves `dropDelayMin` after it ends.
  const dropMins = end + (Number(s.dropDelayMin) || 0);
  return {
    pickup: minutesToDisplay(pickupMins),
    drop: minutesToDisplay(dropMins),
    dropNextDay: endsNextDay(s),
    // An explicit setting always wins; otherwise the service window decides.
    providePickup:
      typeof s.providePickup === 'boolean'
        ? s.providePickup
        : withinServiceWindow(pickupMins),
    provideDrop:
      typeof s.provideDrop === 'boolean' ? s.provideDrop : withinServiceWindow(dropMins),
  };
}

// A human summary of a shift, for chips and dropdowns: "Evening · 4:00 PM–1:30 AM".
export function shiftSummary(policy, code) {
  const s = policy?.[code];
  if (!s) return code;
  if (s.working !== true) return s.label;
  const start = hhmmToMinutes(s.start);
  const end = hhmmToMinutes(s.end);
  if (start == null || end == null) return s.label;
  return `${s.label} · ${minutesToDisplay(start)}–${minutesToDisplay(end)}`;
}
