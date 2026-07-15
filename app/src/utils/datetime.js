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

// Keep only times that are still valid for the given date.
// (For today, drops times that have already passed; non-time entries stay.)
export function futureTimesForDate(dateKey, times) {
  if (dateKey !== todayKey()) return times;
  return times.filter((t) => {
    const m = timeToMinutes(t);
    return m == null || m > nowMinutes();
  });
}
