// ---------------------------------------------------------------------------
// REPORTS — what actually ran, over a period.
//
// The desk could see today, and it could see one ride at a time. It could not
// see a week. "How many rides did we run last month, and how many did nobody
// turn up for" had no answer anywhere in the app, which is a strange gap in a
// system whose whole job is running two rides a day for a few hundred people.
//
// NO NEW DATA. HR's session already holds ADMIN_HISTORY_DAYS (180) of bookings,
// live, because subscribeAllBookings fetches them for the All Bookings screen.
// Everything here is arithmetic over that array — no query, no index, no rules
// change, and nothing to keep in step with the server.
//
// PURE ON PURPOSE. No Firebase, no React. A report that quietly counts wrong is
// worse than no report — somebody bills on it — so the counting is kept where it
// can be tested on its own.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';
import { STATUS } from '../data/mockData';
import { DIRECTION } from './rides';
import { todayKey, shiftDateKey, prettyDateKey } from '../utils/datetime';

// ---------------------------------------------------------------------------
// PERIODS
//
// All backward-looking, which is the whole difference between this and the date
// filter on All Bookings — that one offers Tomorrow and Next 7 days because it
// was built for planning a day. A report is about what already happened.
//
// The week starts MONDAY. Not a detail worth burying: with a Sunday start, the
// Sunday night shift lands in a different week from the Monday morning it
// belongs to, and a weekly count splits a single working week in two.
// ---------------------------------------------------------------------------

export const PERIOD = {
  THIS_WEEK: 'this-week',
  LAST_WEEK: 'last-week',
  THIS_MONTH: 'this-month',
  LAST_MONTH: 'last-month',
  LAST_30: 'last-30',
  CUSTOM: 'custom',
};

export const PERIOD_LABEL = {
  [PERIOD.THIS_WEEK]: 'This week',
  [PERIOD.LAST_WEEK]: 'Last week',
  [PERIOD.THIS_MONTH]: 'This month',
  [PERIOD.LAST_MONTH]: 'Last month',
  [PERIOD.LAST_30]: 'Last 30 days',
  [PERIOD.CUSTOM]: 'Custom range',
};

// Date keys are 'YYYY-MM-DD' strings everywhere in this app, and comparing them
// as strings is exactly right — ISO dates sort lexicographically. Parsing to a
// Date and back is how timezone bugs get in.
const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

// Monday of the week containing `dateKey`. getDay() is 0=Sunday, so Sunday has
// to count as the SEVENTH day of the previous week, not the first of the next.
function mondayOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const back = (dt.getDay() + 6) % 7;
  return shiftDateKey(dateKey, -back);
}

// Start and end (both inclusive) for a named period, relative to `today`.
// `today` is a parameter rather than being read here so this stays pure and a
// test can pin the clock.
export function periodRange(period, today = todayKey(), custom = null) {
  const [y, m] = today.split('-').map(Number);

  if (period === PERIOD.CUSTOM) {
    if (!custom?.start || !custom?.end) return null;
    // Tolerate a range picked back-to-front rather than silently returning zero.
    return custom.start <= custom.end
      ? { start: custom.start, end: custom.end }
      : { start: custom.end, end: custom.start };
  }
  if (period === PERIOD.THIS_WEEK) {
    return { start: mondayOf(today), end: today };
  }
  if (period === PERIOD.LAST_WEEK) {
    const lastMonday = shiftDateKey(mondayOf(today), -7);
    return { start: lastMonday, end: shiftDateKey(lastMonday, 6) };
  }
  if (period === PERIOD.THIS_MONTH) {
    return { start: key(y, m - 1, 1), end: today };
  }
  if (period === PERIOD.LAST_MONTH) {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    // Day 0 of the next month is the last day of this one — the standard trick,
    // and the only one that gets February right without a table.
    const lastDay = new Date(py, pm, 0).getDate();
    return { start: key(py, pm - 1, 1), end: key(py, pm - 1, lastDay) };
  }
  if (period === PERIOD.LAST_30) {
    return { start: shiftDateKey(today, -29), end: today };
  }
  return null;
}

export function rangeLabel(range) {
  if (!range) return '';
  return range.start === range.end
    ? prettyDateKey(range.start)
    : `${prettyDateKey(range.start)} – ${prettyDateKey(range.end)}`;
}

// ---------------------------------------------------------------------------
// THE NUMBERS
// ---------------------------------------------------------------------------

export function inRange(booking, range) {
  if (!range) return false;
  const d = String(booking?.date || '');
  return !!d && d >= range.start && d <= range.end;
}

export const bookingsInRange = (bookings, range) =>
  (bookings || []).filter((b) => inRange(b, range));

// One pass, so a long month does not walk the array eight times.
//
// `ran` is the number worth leading with and the one most easily got wrong: a
// cancelled ride is a row in the collection but not a journey anybody made, and
// counting it would inflate every figure a report is used for. A no-show DID
// run — the cab drove there — so it counts as run and is called out separately.
export function summarise(bookings) {
  const s = {
    total: 0, ran: 0, completed: 0, noShow: 0, cancelled: 0,
    inbound: 0, outbound: 0, unassigned: 0,
  };
  (bookings || []).forEach((b) => {
    s.total += 1;
    if (b.status === STATUS.CANCELLED) s.cancelled += 1;
    else {
      s.ran += 1;
      if (b.status === STATUS.COMPLETED) s.completed += 1;
      if (b.status === STATUS.NO_SHOW) s.noShow += 1;
      if (!b.assignedCabId) s.unassigned += 1;
      if (b.direction === DIRECTION.OUT) s.outbound += 1;
      else s.inbound += 1;
    }
  });
  return s;
}

// Group by anything and count the same way, so every table on the screen reads
// identically whether it is split by route, by cab or by person.
export function breakdown(bookings, keyOf, labelOf = (k) => k) {
  const groups = new Map();
  (bookings || []).forEach((b) => {
    const k = keyOf(b) ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  });
  return [...groups.entries()]
    .map(([k, rows]) => ({ key: k, label: labelOf(k), ...summarise(rows) }))
    // Busiest first — a report is read from the top, and the top should be the
    // route or the cab carrying the most people.
    .sort((a, b) => b.ran - a.ran || String(a.label).localeCompare(String(b.label)));
}

// ---------------------------------------------------------------------------
// THE SPREADSHEET
//
// One row per ride, not per summary line: a total can be re-derived from rows,
// but rows cannot be recovered from a total, and whoever opens this in Excel
// will want to pivot it their own way.
// ---------------------------------------------------------------------------

export const EXPORT_HEADER = [
  'Date', 'Shift', 'Direction', 'Employee', 'Employee ID', 'Route',
  'Cab', 'Driver', 'Status', 'Pickup address',
];

export function exportRows(bookings, { cabOf = () => null, routeOf = () => '' } = {}) {
  return [...(bookings || [])]
    .sort(
      (a, b) =>
        String(a.date || '').localeCompare(String(b.date || '')) ||
        String(a.shift || '').localeCompare(String(b.shift || '')) ||
        String(a.employeeName || '').localeCompare(String(b.employeeName || ''))
    )
    .map((b) => {
      const cab = cabOf(b.assignedCabId);
      return [
        b.date || '',
        b.shift || '',
        b.direction || '',
        b.employeeName || '',
        b.empId || '',
        routeOf(b) || '',
        cab?.cabNumber || '',
        cab?.driverName || '',
        b.status || '',
        b.employeeAddress || '',
      ];
    });
}

export function exportFileName(range) {
  return `cab-rides-${range?.start || 'all'}-to-${range?.end || 'all'}.xlsx`;
}

// Build the workbook. Kept separate from the download so the sheet can be
// inspected without a browser — which is what makes the column order testable.
export function buildRideReport(bookings, range, opts) {
  const rows = exportRows(bookings, opts);
  const sheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADER, ...rows]);
  // Widths, because a column of addresses at the default width is unreadable and
  // the first thing anyone does otherwise is drag ten borders.
  sheet['!cols'] = [12, 9, 15, 22, 12, 16, 14, 18, 14, 46].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Rides');
  return { book, fileName: exportFileName(range), rowCount: rows.length };
}

// WEB ONLY, exactly as downloadTemplate in services/roster.js is: XLSX.writeFile
// works by handing the browser a file to save, and a phone has nowhere to put
// it. The desk works from a computer; the screen says so rather than offering a
// button that would throw.
export function downloadRideReport(bookings, range, opts) {
  if (typeof window === 'undefined' || !window.document) {
    throw new Error('The spreadsheet can only be downloaded from a computer.');
  }
  const { book, fileName } = buildRideReport(bookings, range, opts);
  XLSX.writeFile(book, fileName);
  return fileName;
}
