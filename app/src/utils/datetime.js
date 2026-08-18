// ---------------------------------------------------------------------------
// Date/time helpers used to block bookings in the past.
// (These run on the device, so using `new Date()` here is fine.)
// ---------------------------------------------------------------------------

// Today as an ISO key "YYYY-MM-DD".
export function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

// ISO date strings compare correctly as plain text, so "<" means earlier.
export function isPastDateKey(dateKey) {
  return dateKey < todayKey();
}

// Move an ISO key by whole days: shiftDateKey('2026-07-28', -7) → '2026-07-21'.
// (Used to bound how far back the admin's live booking list reaches.)
export function shiftDateKey(dateKey, days) {
  const [y, m, d] = String(dateKey).split('-').map((n) => parseInt(n, 10));
  const date = new Date(y || 1970, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// "2026-08-19" → "Wed 19 Aug". THE one date format shown to a person: an ISO key
// is how dates are stored, compared and keyed, and it should never reach a screen
// — nobody reads "2026-08-19" and thinks "tomorrow". An unparseable key comes back
// unchanged rather than as "NaN", so a bad document shows something honest.
export function prettyDateKey(dateKey) {
  const [y, m, d] = String(dateKey || '').split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return String(dateKey || '');
  const date = new Date(y, m - 1, d);
  return `${DAY_NAMES[date.getDay()]} ${String(d).padStart(2, '0')} ${MONTH_NAMES[m - 1]}`;
}

// "Today" / "Tomorrow" / "Yesterday", or null for any other day. These three are
// how a rider actually thinks about their cab, and they answer "is this the one
// I'm waiting for?" without the reader having to work out what today's date is.
// Null rather than a fallback string, so the caller can decide whether to prefix
// it or show the plain date on its own.
export function relativeDayLabel(dateKey) {
  const key = String(dateKey || '');
  if (!key) return null;
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === shiftDateKey(today, 1)) return 'Tomorrow';
  if (key === shiftDateKey(today, -1)) return 'Yesterday';
  return null;
}

// "07:00 AM" / "05:00 PM" → minutes since midnight (null if not a time).
export function timeToMinutes(str) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(str).trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// Current time as minutes since midnight.
export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// True if the given date (and time, if it's today) is in the past.
export function isPastDateTime(dateKey, timeStr) {
  if (isPastDateKey(dateKey)) return true;
  if (dateKey === todayKey()) {
    const t = timeToMinutes(timeStr);
    if (t == null) return false; // non-time values (e.g. "NA") aren't "past"
    return t <= nowMinutes();
  }
  return false;
}

// Build a JS Date from an ISO date key ("YYYY-MM-DD") + "hh:mm AM/PM" time,
// in the device's local timezone. Returns null if either can't be parsed.
export function toDateTime(dateKey, timeStr) {
  const mins = timeToMinutes(timeStr);
  if (mins == null) return null;
  const [y, m, d] = String(dateKey).split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60, 0, 0);
}

// Hours from now until the ride at `dateKey` + `timeStr` (a float; negative if
// the ride is already in the past). Returns null if the time can't be parsed.
export function hoursUntil(dateKey, timeStr) {
  const rideAt = toDateTime(dateKey, timeStr);
  if (!rideAt) return null;
  return (rideAt.getTime() - Date.now()) / (1000 * 60 * 60);
}

// True if a booking's full scheduled date+time is in the past (device-local
// time). This marks a ride as OVERDUE — it does NOT close assignment. The desk
// may give a cab to a ride whose slot has passed (that is the case they are most
// often racing), so callers use this to flag and sort, never to disable.
export function isBookingPast(booking) {
  if (!booking) return false;
  return isPastDateTime(booking.date, booking.shift);
}

// True if a ride is far enough away to still be cancellable (default: at least
// 4 hours before it starts). Rides inside the window — or already past — can't.
export function canRequestCancel(dateKey, timeStr, cutoffHours = 4) {
  const h = hoursUntil(dateKey, timeStr);
  if (h == null) return true; // no parseable time → don't block on the cutoff
  return h >= cutoffHours;
}

// The exact INSTANT that cancellation closes: `cutoffHours` before the ride.
// Returns a Date, or null when the ride's time can't be parsed.
//
// This is the same moment canRequestCancel() compares against, only named rather
// than folded into a boolean — a screen that tells someone "you have until 5:00
// PM" must be quoting the deadline the check actually uses, or the two disagree
// at the edge and the button greys out at a time the page never mentioned.
// Derived from toDateTime() for exactly that reason: one parse of date + shift,
// used by both.
//
// Subtracting on the millisecond value is also what makes overnight shifts come
// out right — a 12:30 AM ride's deadline is 8:30 PM the PREVIOUS evening, and
// the Date arithmetic rolls the day (and month, and year) back on its own. Doing
// it on the clock reading instead would land on 8:30 PM of the same morning.
export function cancelDeadline(dateKey, timeStr, cutoffHours = 4) {
  const rideAt = toDateTime(dateKey, timeStr);
  if (!rideAt) return null;
  return new Date(rideAt.getTime() - cutoffHours * 60 * 60 * 1000);
}

// "5:00 PM on Tue 12 Aug" — the deadline, written the way someone reads it back.
export function formatDeadline(date) {
  if (!date) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  let h = date.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mins = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${mins} ${ap} on ${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

// True if a ride at `dateKey` + `timeStr` is far enough in the future to be
// booked (default: at least 9 hours of lead time). Non-time values (e.g. "NA")
// aren't gated. Rides too soon — or in the past — return false.
export function canBook(dateKey, timeStr, leadHours = 9) {
  const h = hoursUntil(dateKey, timeStr);
  if (h == null) return true; // non-time values (e.g. "NA") aren't gated
  return h >= leadHours;
}

// Keep only times that are still valid for the given date.
// (For today, drops times that have already passed; non-time entries stay.)
export function futureTimesForDate(dateKey, times) {
  if (dateKey !== todayKey()) return times;
  return times.filter((t) => {
    const m = timeToMinutes(t);
    return m == null || m > nowMinutes();
  });
}

// Keep only times that satisfy the booking lead time (default 9 hours) for the
// given date — so a time inside the lead window can't even be picked. Non-time
// entries (e.g. "NA") always stay.
export function bookableTimesForDate(dateKey, times, leadHours = 9) {
  return times.filter((t) => canBook(dateKey, t, leadHours));
}
