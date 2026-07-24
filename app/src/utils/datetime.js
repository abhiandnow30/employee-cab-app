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
// time). The single source of truth for "assignment is closed".
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
