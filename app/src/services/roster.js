// ---------------------------------------------------------------------------
// MONTHLY SHIFT ROSTER SERVICE
//
// HR uploads one spreadsheet per month in the matrix layout every transport desk
// already uses:
//
//   Employee ID | Employee Name | 01-Jul | 02-Jul | ... | 31-Jul
//   ------------|---------------|--------|--------|-----|-------
//   1399        | Raghu         | E      | E      | ... | WO
//
// The pipeline is deliberately three separate steps so HR always sees what will
// happen before anything is written:
//
//   1. parseRosterFile()  — bytes → { month, days, rows }        (no network)
//   2. validateRoster()   — rows + employee list → a report      (no writes)
//   3. importRoster()     — writes rosters/<month>_<uid> docs    (only valid rows)
//
// STORAGE: one document per employee per month, at rosters/<YYYY-MM>_<uid>, with
// the month's codes held in a `days` map keyed by day-of-month ("01".."31").
// A 250-person month is 250 documents, an employee reads exactly ONE document to
// see their whole calendar, and correcting a single day is a one-field write.
//
// Rides are NOT written here. They're derived from these documents on demand —
// see services/rides.js. Materialising ~11,000 booking rows per upload would
// cost 22 batched writes and swamp every live query in the app.
// ---------------------------------------------------------------------------

import {
  collection, doc, getDocs, setDoc, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, addDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { firestore } from './firebase';
import { ALL_SHIFT_CODES, toShiftCode, isWeekdayRow } from '../data/shifts';

const ROSTERS = 'rosters';
const IMPORTS = 'rosterImports';

// Firestore commits at most 500 writes per batch.
const BATCH_LIMIT = 450;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The id for one employee's month. Deterministic, so re-uploading a corrected
// file OVERWRITES that month instead of creating a second copy.
export function rosterId(month, uid) {
  return `${month}_${uid}`;
}

// --- Step 1: parse -----------------------------------------------------------

// Excel stores dates as days since 1899-12-30. A header that came through as a
// bare number in that range is almost certainly a date cell, not a day-of-month.
function fromExcelSerial(n) {
  if (!Number.isFinite(n) || n < 20000 || n > 60000) return null; // ~1954..2064
  const ms = Math.round((n - 25569) * 86400 * 1000); // 25569 = 1970-01-01
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Recognise the header cells that hold a date. Accepts, in order of reliability:
//   • a real Date cell (what Excel produces once it has touched the file)
//   • an Excel date serial number
//   • "01-Jul", "1-Jul-2026", "01 Jul"
//   • "2026-07-01" (ISO)
//   • "01/07", "01-07-2026" (day first — matches the "01-Jul" convention)
//   • a bare day number, when other columns pin the month down
// Returns { day, monthIndex } or null.
function parseDateHeader(raw) {
  // A genuine date cell — unambiguous, so it wins.
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { day: raw.getDate(), monthIndex: raw.getMonth() };
  }
  if (typeof raw === 'number') {
    const d = fromExcelSerial(raw);
    if (d) return { day: d.getDate(), monthIndex: d.getMonth() };
  }

  const s = String(raw ?? '').trim();
  if (!s) return null;

  // ISO, which sorts and parses unambiguously.
  let iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const day = parseInt(iso[3], 10);
    const monthIndex = parseInt(iso[2], 10) - 1;
    if (day >= 1 && day <= 31 && monthIndex >= 0 && monthIndex <= 11) {
      return { day, monthIndex };
    }
    return null;
  }

  // 01-Jul / 1-Jul-2026 / 01 Jul
  let m = /^(\d{1,2})[-/\s]([A-Za-z]{3,})/.exec(s);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIndex = MONTHS.findIndex(
      (mo) => mo.toLowerCase() === m[2].slice(0, 3).toLowerCase()
    );
    if (day >= 1 && day <= 31 && monthIndex >= 0) return { day, monthIndex };
    return null;
  }
  // 01/07, 01-07, 01/07/2026, 01-07-2026 — day first, matching "01-Jul".
  m = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/.exec(s);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIndex = parseInt(m[2], 10) - 1;
    if (day >= 1 && day <= 31 && monthIndex >= 0 && monthIndex <= 11) return { day, monthIndex };
    return null;
  }
  // A bare day number — only usable when other columns pin the month down.
  m = /^(\d{1,2})$/.exec(s);
  if (m) {
    const day = parseInt(m[1], 10);
    if (day >= 1 && day <= 31) return { day, monthIndex: null };
  }
  return null;
}

// 0 → "A", 25 → "Z", 26 → "AA". HR reads column letters, not indexes, so every
// message about a column speaks Excel's language.
function columnLetter(index) {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

// Which column holds the employee id / name / email / … Tolerant of the wording
// desks use.
//
// Two things here are deliberate and were both learned the hard way:
//
// 1. Patterns are tried in ORDER OF SPECIFICITY, not left-to-right across the
//    sheet. The loose fallbacks at the end of each list ("employee ", "location")
//    exist to catch odd headings, but if they were allowed to win on an earlier
//    column they'd steal it from the precise pattern. A sheet headed
//    "Employee ID | Employee Name" is the case that matters: scanning columns
//    first made /^employee\s/ match "employee id", so the NAME column resolved to
//    the ID column and every row showed a number where the person's name goes.
//
// 2. `taken` stops one column doing two jobs. "Cab Location" is a route to the
//    route matcher and an address to the address matcher; whoever asks first
//    keeps it, and the other field correctly reports "not present".
function findColumn(header, patterns, taken) {
  const cells = header.map((h) => String(h ?? '').trim().toLowerCase());
  for (const pattern of patterns) {
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i] || taken?.has(i)) continue;
      if (pattern.test(cells[i])) {
        taken?.add(i);
        return i;
      }
    }
  }
  return -1;
}

// Parse an .xlsx / .xls / .csv file into rows of { empId, name, days }.
//
// `data` is an ArrayBuffer (browser File.arrayBuffer()). `year` pins the year,
// which spreadsheets in this format never carry.
// Throws on anything that isn't a readable roster — that's "Invalid file format".
export function parseRosterFile(data, { year, fileName = '' } = {}) {
  let book;
  try {
    // cellDates matters more than it looks: the moment HR opens the template in
    // Excel and saves it, Excel converts the text "01-Jul" into a real DATE cell.
    // Without this we'd get back whatever Excel's regional format renders —
    // "7/1/2026", "01-07-2026", or a bare serial number — and the header would
    // stop being recognisable.
    book = XLSX.read(data, { type: 'array', cellDates: true });
  } catch (e) {
    throw new Error('Invalid file format — could not read that as a spreadsheet or CSV.');
  }
  const sheetName = book.SheetNames?.[0];
  if (!sheetName) throw new Error('Invalid file format — the file has no sheets.');

  // header:1 gives raw rows; blank cells become '' so column positions hold.
  // raw:true keeps Date objects as Dates (raw:false would format them back into
  // locale-dependent strings). Shift codes are read with String() below, so text
  // cells are unaffected.
  const grid = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
  if (!grid.length) throw new Error('Invalid file format — the sheet is empty.');

  // The header is the first row that yields at least 3 date columns; desks often
  // put a title or the month name above it.
  let headerIndex = -1;
  let dateCols = [];
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const cols = [];
    grid[r].forEach((cell, c) => {
      const d = parseDateHeader(cell);
      if (d) cols.push({ col: c, ...d });
    });
    if (cols.length >= 3) {
      headerIndex = r;
      dateCols = cols;
      break;
    }
  }
  if (headerIndex === -1) {
    // Show what we actually saw — "it needs 01-Jul" is useless without telling
    // them what they've got.
    const firstRow = (grid[0] || [])
      .slice(0, 8)
      .map((c) => (c instanceof Date ? c.toDateString() : String(c ?? '')))
      .filter((c) => c !== '')
      .join(' | ');
    throw new Error(
      'Could not find the date columns. The header row needs at least three cells ' +
        'like "01-Jul", "02-Jul" — or real date cells.' +
        (firstRow ? ` The first row of your file reads: ${firstRow}` : '')
    );
  }

  // Work out the month from the date headers (majority wins, so one odd cell
  // can't derail it). Bare day numbers inherit it.
  const monthVotes = {};
  dateCols.forEach((d) => {
    if (d.monthIndex != null) monthVotes[d.monthIndex] = (monthVotes[d.monthIndex] || 0) + 1;
  });
  const votes = Object.entries(monthVotes).sort((a, b) => b[1] - a[1]);
  if (!votes.length) {
    throw new Error(
      'The date columns don\'t say which month this is. Use headers like "01-Jul".'
    );
  }
  const monthIndex = parseInt(votes[0][0], 10);
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

  // Days that don't belong to the detected month are "Incorrect dates".
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const badDateHeaders = dateCols
    .filter((d) => (d.monthIndex != null && d.monthIndex !== monthIndex) || d.day > daysInMonth)
    .map((d) => String(grid[headerIndex][d.col]));
  const usableCols = dateCols.filter(
    (d) => (d.monthIndex == null || d.monthIndex === monthIndex) && d.day <= daysInMonth
  );

  const header = grid[headerIndex];

  // The row carrying the DATES is very often NOT the row carrying the LABELS, and it
  // can be on either side of it. Both of these are real layouts:
  //
  //     A            B          C             D           E
  //   1 Employee ID  Emp Name                                          <- labels
  //   2                                       01-Jul      02-Jul       <- dates
  //
  //     A     B          C             D           E
  //   1       Date                     01-07-2026  02-07-2026          <- dates
  //   2 S.No  Day        Employee ID   Wednesday   Thursday            <- labels
  //   3 1     Vineetha   1415          N           Week off            <- data
  //
  // Only looking upward meant the second layout's "Employee ID" in C2 was never
  // seen, the column was guessed from content instead, and it picked the S.No
  // column — so serial numbers were imported as employee IDs.
  //
  // So gather labels from a small window around the date row. Rows BELOW it only
  // count while they aren't employee data: a weekday row or a row with empty date
  // cells is a label row, and the first genuine data row stops the search.
  const labelRowIndexes = [headerIndex];
  for (let r = headerIndex - 1; r >= Math.max(0, headerIndex - 3); r--) {
    labelRowIndexes.push(r);
  }
  for (let r = headerIndex + 1; r < Math.min(grid.length, headerIndex + 3); r++) {
    const dateCells = usableCols.map((d) => grid[r]?.[d.col]);
    const blank = dateCells.every((v) => String(v ?? '').trim() === '');
    if (!isWeekdayRow(dateCells) && !blank) break; // real data — stop here
    labelRowIndexes.push(r);
  }

  const labelRow = header.map((_, c) => {
    for (const r of labelRowIndexes) {
      const cell = grid[r]?.[c];
      // A date is a date, never a label.
      if (cell instanceof Date || parseDateHeader(cell)) continue;
      const text = String(cell ?? '').trim();
      if (text) return text;
    }
    return '';
  });

  // Claim columns one field at a time. The date columns are claimed up front so a
  // heading like "01-Jul" can never be mistaken for a detail column, and each
  // field is asked for in order of how much the import depends on it.
  const taken = new Set(usableCols.map((d) => d.col));

  // NOTE: "S.No" / "Sl.No" are deliberately NOT here. They are row counters, not
  // employee identifiers, and treating one as an ID matches every row against the
  // wrong person — or nobody. The serial column is excluded from the guess below too.
  let idCol = findColumn(labelRow, [
    /emp.*id/, /^id$/, /employee\s*(no|code|number)/, /staff\s*(id|no|code)/,
    /^e\s*id$/, /associate\s*id/, /token\s*no/, /^emp\b/,
  ], taken);
  let nameCol = findColumn(labelRow, [
    /emp.*name/, /^name$/, /employee$/, /staff\s*name/, /associate\s*name/,
    /full\s*name/, /^employee\s/, /candidate/, /person/,
  ], taken);

  // Optional employee details. When present, the roster carries everything needed
  // to CREATE the people it names — which is what turns "12 unknown employees"
  // from a dead end into a one-click action.
  const emailCol = findColumn(labelRow, [/e-?mail/, /mail\s*id/, /official\s*mail/], taken);
  const phoneCol = findColumn(labelRow, [/phone/, /mobile/, /contact\s*(no|number)/], taken);
  const routeCol = findColumn(
    labelRow,
    [/route/, /cab\s*location/, /pickup\s*(point|area|route)/],
    taken
  );
  const addressCol = findColumn(
    labelRow,
    [/home\s*address/, /address/, /residence/, /location/],
    taken
  );

  // No recognisable name heading. Rather than fail every row with "Unknown
  // employee" — which tells HR nothing about the real problem — fall back to the
  // first unclaimed column that actually holds text in the body rows, and report
  // which column was used.
  let nameColGuessed = false;
  if (nameCol === -1) {
    const candidates = [];
    for (let c = 0; c < header.length; c++) {
      // `taken` already covers the date columns and every detail column that was
      // matched, so an email or address column can't be guessed as the name.
      if (taken.has(c)) continue;
      // Does this column hold text (not shift codes) in the rows below?
      let texty = 0;
      for (let r = headerIndex + 1; r < Math.min(grid.length, headerIndex + 8); r++) {
        const v = String(grid[r]?.[c] ?? '').trim();
        if (v && !toShiftCode(v) && /[A-Za-z]/.test(v)) texty++;
      }
      if (texty >= 1) candidates.push({ col: c, texty });
    }
    candidates.sort((a, b) => b.texty - a.texty || a.col - b.col);
    if (candidates.length) {
      nameCol = candidates[0].col;
      nameColGuessed = true;
    }
  }

  // Same courtesy for the ID column, which had none — so an unlabelled ID column
  // was silently ignored and produced "Employee ID missing" on every single row
  // while the IDs sat there in plain sight. An ID column is one whose body cells
  // are short codes: mostly digits, no spaces, never a shift code.
  let idColGuessed = false;
  if (idCol === -1) {
    const looksLikeId = (v) =>
      !!v && v.length <= 12 && !/\s/.test(v) && /[0-9]/.test(v) && !toShiftCode(v);
    const candidates = [];
    for (let c = 0; c < header.length; c++) {
      if (taken.has(c) || c === nameCol) continue;
      let hits = 0;
      let seen = 0;
      const values = [];
      for (let r = headerIndex + 1; r < Math.min(grid.length, headerIndex + 10); r++) {
        const v = String(grid[r]?.[c] ?? '').trim();
        if (!v) continue;
        seen++;
        values.push(v);
        if (looksLikeId(v)) hits++;
      }
      // 1, 2, 3, … is a row counter, not an employee ID. Excluding it matters most
      // on exactly the sheets that need guessing, because an unlabelled "S.No"
      // column sits to the left of the names and looks like a perfect ID otherwise.
      const isRowCounter =
        values.length >= 3 && values.every((v, i) => Number(v) === i + 1);
      // Needs to be the dominant shape of the column, not an occasional stray.
      if (seen >= 2 && hits / seen >= 0.8 && !isRowCounter) {
        candidates.push({ col: c, hits });
      }
    }
    // Prefer the column nearest the name, which is where an ID almost always sits.
    candidates.sort((a, b) => b.hits - a.hits || a.col - b.col);
    if (candidates.length) {
      idCol = candidates[0].col;
      idColGuessed = true;
      taken.add(idCol);
    }
  }

  const rows = [];
  let skippedWeekdayRows = 0;
  for (let r = headerIndex + 1; r < grid.length; r++) {
    const line = grid[r];
    if (!line || !line.length) continue;

    // Many rosters put a weekday strip (MON TUE WED…) directly under the dates.
    // It is part of the header, not a person.
    if (isWeekdayRow(usableCols.map((d) => line[d.col]))) {
      skippedWeekdayRows++;
      continue;
    }

    const empId = idCol >= 0 ? String(line[idCol] ?? '').trim() : '';
    const name = nameCol >= 0 ? String(line[nameCol] ?? '').trim() : '';
    const cell = (c) => (c >= 0 ? String(line[c] ?? '').trim() : '');
    const email = cell(emailCol).toLowerCase();
    const phone = cell(phoneCol).replace(/[^0-9]/g, '').slice(-10);
    const sheetRoute = cell(routeCol);
    const sheetAddress = cell(addressCol);

    // Codes for this row, keyed by zero-padded day. `toShiftCode` accepts the
    // spelled-out forms real rosters use ("WEEK OFF" → WO) and returns null for
    // anything unrecognised; `rawDays` keeps the original text so the validation
    // summary can quote what was actually in the cell.
    const days = {};
    const rawDays = {};
    let filled = 0;
    usableCols.forEach((d) => {
      const key = String(d.day).padStart(2, '0');
      const raw = String(line[d.col] ?? '').trim();
      rawDays[key] = raw;
      days[key] = raw ? toShiftCode(raw) || raw.toUpperCase() : '';
      if (raw) filled++;
    });

    // A row with no id, no name and no codes is spreadsheet padding, not a record.
    if (!empId && !name && filled === 0) continue;
    rows.push({
      rowNumber: r + 1, empId, name, days, rawDays,
      email, phone, sheetRoute, sheetAddress,
    });
  }

  return {
    month,
    monthLabel: `${MONTHS[monthIndex]} ${year}`,
    daysInMonth,
    dayKeys: usableCols.map((d) => String(d.day).padStart(2, '0')).sort(),
    rows,
    fileName,
    hasIdColumn: idCol >= 0,
    hasNameColumn: nameCol >= 0,
    hasEmailColumn: emailCol >= 0,
    hasRouteColumn: routeCol >= 0,
    hasAddressColumn: addressCol >= 0,
    nameColumnGuessed: nameColGuessed,
    idColumnGuessed: idColGuessed,
    nameColumnHeading: nameCol >= 0 ? String(labelRow[nameCol] ?? '').trim() : '',
    skippedWeekdayRows,
    badDateHeaders,
    // What the header row looked like, for the "we couldn't find X" messages.
    headerCells: header
      .slice(0, 12)
      .map((c) => (c instanceof Date ? c.toDateString() : String(c ?? '')))
      .filter(Boolean),
    // Exactly which column each field came from, so "Employee ID missing" can be
    // answered by looking instead of by guessing. `column` is a spreadsheet letter
    // so it maps straight onto what HR sees in Excel.
    columnMap: [
      { field: 'Employee ID', col: idCol, guessed: idColGuessed },
      { field: 'Employee Name', col: nameCol, guessed: nameColGuessed },
      { field: 'Email', col: emailCol, guessed: false },
      { field: 'Phone', col: phoneCol, guessed: false },
      { field: 'Route', col: routeCol, guessed: false },
      { field: 'Home Address', col: addressCol, guessed: false },
    ].map((e) => ({
      ...e,
      column: e.col >= 0 ? columnLetter(e.col) : '',
      // A guessed column has no heading worth quoting — reporting whatever text
      // happened to sit above it (here, "Date" over the names) reads as though the
      // app matched on it, which is the opposite of what happened.
      heading: e.col >= 0 && !e.guessed ? String(labelRow[e.col] ?? '').trim() : '',
    })),
    headerRowNumber: headerIndex + 1,
  };
}

// --- Step 2: validate --------------------------------------------------------

export const ERROR_KINDS = {
  MISSING_ID: 'Employee ID missing',
  UNKNOWN_EMPLOYEE: 'Unknown employee',
  DUPLICATE: 'Duplicate employee',
  INVALID_CODE: 'Invalid shift code',
  MISSING_SHIFT: 'Missing shift value',
  BAD_DATE: 'Incorrect dates',
  NO_ACCOUNT: 'No account yet',
  ID_MISMATCH: 'Employee ID does not match',
  // A warning, never an error: the month still imports, but every ride it
  // produces for this person lands under "No route set" on the coordinator's
  // board until somebody routes them. Silent, this is the gap that made the
  // coordinator group people by hand — so HR gets told before they import.
  NO_ROUTE: 'No pickup route',
  // The sheet named a route that isn't in Routes & Timings. Also a warning: the
  // shifts are fine, but the route isn't written, because inventing one from a
  // spreadsheet is how an area ends up with three spellings.
  UNKNOWN_ROUTE: 'Route not in your list',
};

// --- Pickup routes: one spelling, whatever the sheet says --------------------
//
// A route is stored as plain text on the employee and the coordinator's board
// groups rides by that exact string, so "JNTU Cab" and "Jntu Cab" are two groups
// to the code and one pickup area to a human — the JNTU carpool silently splits in
// two and asks for a cab that shouldn't exist.
//
// The in-app dropdown can't produce a variant (you pick from the list), so the
// spreadsheet is the only source of drift. Fixed HERE, at the point of writing,
// rather than by comparing case-insensitively everywhere: normalise once and every
// consumer downstream — grouping, the dropdown, search — keeps working on an exact
// match, because only one spelling ever reaches the database.
function routeKey(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// "jntu  cab" → "JNTU Cab" (the configured spelling), or null if it matches none.
export function canonicalRoute(value, routeOptions) {
  const key = routeKey(value);
  if (!key) return null;
  const match = (routeOptions || []).find((r) => routeKey(r) === key);
  return match || null;
}

// Check the parsed rows against the real employee list and the shift policy.
// Nothing is written. Returns a report HR can act on:
//
//   { month, monthLabel, total, valid, errorCount, warningCount, rows[],
//     byKind{}, canImport }
//
// ERRORS block a row from importing. WARNINGS don't — they're things HR should
// know but that don't make the row unusable. That distinction matters for one
// case in particular: a sheet with a name column but NO employee-id column is a
// perfectly normal export from a lot of HR systems, and if "Employee ID missing"
// were fatal such a file would import nobody at all. So a row whose NAME resolves
// to exactly one employee imports, with a warning; only an unresolvable row fails.
export function validateRoster(parsed, employees, policy, routeOptions = []) {
  const validCodes = new Set(
    Object.keys(policy || {}).length ? Object.keys(policy) : ALL_SHIFT_CODES
  );
  // Distinct route names the sheet used that aren't configured — reported once for
  // the whole file rather than as the same warning on twenty rows.
  const unknownRoutes = new Set();

  // Match on employee id first (stable), then on name as a fallback for desks
  // whose sheet has no id column.
  const byEmpId = new Map();
  const byName = new Map();
  (employees || []).forEach((e) => {
    if (e.empId) byEmpId.set(String(e.empId).trim().toLowerCase(), e);
    if (e.name) {
      const key = String(e.name).trim().toLowerCase();
      // A duplicated NAME in the directory makes name-matching ambiguous; mark it.
      byName.set(key, byName.has(key) ? 'ambiguous' : e);
    }
  });

  const seen = new Map(); // uid → first row number that claimed it
  const rows = parsed.rows.map((row) => {
    const errors = [];
    const warnings = [];
    let creatable = false;

    // -- identity --
    // Employee id first (stable across name changes), then the name. A name that
    // matches two people in the directory is 'ambiguous' and can't be used.
    let employee = null;
    let matchedBy = null;
    if (row.empId) {
      employee = byEmpId.get(row.empId.toLowerCase()) || null;
      if (employee) matchedBy = 'id';
    }
    let ambiguousName = false;
    if (!employee && row.name) {
      const hit = byName.get(row.name.toLowerCase());
      if (hit === 'ambiguous') ambiguousName = true;
      else if (hit) {
        employee = hit;
        matchedBy = 'name';
      }
    }

    if (!employee) {
      // Couldn't resolve the row to anybody. Whether that's fatal depends on
      // whether the sheet gave us enough to create them.
      const emailLooksReal = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email || '');
      if (emailLooksReal && row.name) {
        // Everything needed to provision this person is in the file, so this is a
        // job to do rather than an error to fix. The upload screen offers to create
        // them; only then do their shifts import.
        // Flagged as creatable so a future bulk-provision step can pick these up.
        // The message deliberately does NOT promise a button that doesn't exist
        // yet — it just states what's true: no account, and here's the address on
        // file for them.
        creatable = true;
        errors.push(`${ERROR_KINDS.NO_ACCOUNT} (${row.email})`);
      } else {
        if (!row.empId) errors.push(ERROR_KINDS.MISSING_ID);
        errors.push(
          ambiguousName
            ? `${ERROR_KINDS.UNKNOWN_EMPLOYEE} (more than one employee is called "${row.name}" — add an Employee ID column)`
            : row.name
            ? `${ERROR_KINDS.UNKNOWN_EMPLOYEE} (no account, and no email in the file to create one)`
            : ERROR_KINDS.UNKNOWN_EMPLOYEE
        );
      }
    } else {
      // Resolved. A missing id is worth saying, but not worth rejecting them for.
      if (!row.empId) warnings.push(`${ERROR_KINDS.MISSING_ID} (matched on name)`);
      // A row that carries an id AND matched on name means the two disagree, and
      // that was passing in complete silence. It is how a serial-number column read
      // as the ID went unnoticed — "1" matched Vineetha by name and looked fine.
      // Worse, on a sheet with two people of the same name it could quietly attach a
      // month of shifts to the wrong person. Not fatal (the name is good evidence),
      // but never invisible.
      else if (
        matchedBy === 'name' &&
        employee.empId &&
        String(employee.empId).trim().toLowerCase() !== row.empId.toLowerCase()
      ) {
        warnings.push(
          `${ERROR_KINDS.ID_MISMATCH} (sheet says "${row.empId}", ${employee.name} is "${employee.empId}" — matched on name)`
        );
      }
      const firstRow = seen.get(employee.uid);
      if (firstRow) errors.push(`${ERROR_KINDS.DUPLICATE} (also row ${firstRow})`);
      else seen.set(employee.uid, row.rowNumber);
    }

    // -- shift codes --
    const badCodes = [];
    const blankDays = [];
    Object.keys(row.days).forEach((day) => {
      const code = row.days[day];
      if (!code) blankDays.push(day);
      else if (!validCodes.has(code)) {
        // Show what the cell actually said — "WEEK OFF" is far more useful to
        // whoever has to fix the sheet than a normalised code would be.
        badCodes.push(`${day}: "${row.rawDays?.[day] ?? code}"`);
      }
    });
    if (badCodes.length) {
      errors.push(`${ERROR_KINDS.INVALID_CODE} (${badCodes.slice(0, 4).join(', ')}${badCodes.length > 4 ? '…' : ''})`);
    }
    if (blankDays.length) {
      errors.push(`${ERROR_KINDS.MISSING_SHIFT} (${blankDays.length} day${blankDays.length > 1 ? 's' : ''})`);
    }

    // -- pickup route --
    // Whatever the sheet spelled it, store the CONFIGURED spelling, so a stray
    // capital can't split a carpool. A value matching nothing in Routes & Timings
    // is reported and then ignored — better an unrouted rider HR can see than a
    // second spelling of an area nobody notices.
    const sheetRoute = canonicalRoute(row.sheetRoute, routeOptions);
    if (row.sheetRoute && !sheetRoute) {
      unknownRoutes.add(String(row.sheetRoute).trim());
      warnings.push(`${ERROR_KINDS.UNKNOWN_ROUTE} ("${String(row.sheetRoute).trim()}")`);
    }
    // Prefer what the app already holds; fall back to the sheet, which is all we
    // have for someone who doesn't exist yet.
    const profileRoute = employee?.roster?.route || null;
    const route = profileRoute || sheetRoute || null;
    // Never fatal — the shifts are still worth importing — but say it, because a
    // rider with no route can't be grouped into a cab with their neighbours.
    if (!route) warnings.push(ERROR_KINDS.NO_ROUTE);

    return {
      ...row,
      // The canonical spelling (or '' when it matched nothing), so nothing
      // downstream can write the raw text from the sheet.
      sheetRoute: sheetRoute || '',
      rawSheetRoute: row.sheetRoute || '',
      employeeId: employee?.uid || null,
      matchedName: employee?.name || null,
      matchedEmpId: employee?.empId || null,
      matchedBy,
      route,
      // What the PROFILE says, kept separately from `route` so the import can tell
      // "the sheet is filling a gap" from "the profile already knows".
      profileRoute,
      address: employee?.address || row.sheetAddress || '',
      errors,
      warnings,
      creatable,
      valid: errors.length === 0,
    };
  });

  // File-level problems apply to the whole upload and are worth saying ONCE,
  // loudly, instead of as the same error repeated on every row.
  const fileErrors = [];
  if (parsed.badDateHeaders?.length) {
    fileErrors.push(`${ERROR_KINDS.BAD_DATE}: ${parsed.badDateHeaders.slice(0, 5).join(', ')}`);
  }
  if (!parsed.hasNameColumn) {  // eslint-disable-line no-constant-condition
    fileErrors.push(
      'No employee name column found. Add a column headed "Employee Name"' +
        (parsed.headerCells?.length
          ? ` — the header row reads: ${parsed.headerCells.join(' | ')}`
          : '.')
    );
  }

  // Group the counts the way the summary screen shows them.
  const byKind = {};
  const byWarning = {};
  rows.forEach((r) => {
    r.errors.forEach((e) => {
      const kind = e.split(' (')[0];
      byKind[kind] = (byKind[kind] || 0) + 1;
    });
    // Only tally warnings on rows that will actually import — a warning on a
    // row we're rejecting anyway would make the counts contradict each other.
    if (r.valid) {
      r.warnings.forEach((w) => {
        const kind = w.split(' (')[0];
        byWarning[kind] = (byWarning[kind] || 0) + 1;
      });
    }
  });
  fileErrors.forEach((e) => {
    const kind = e.split(':')[0];
    byKind[kind] = (byKind[kind] || 0) + 1;
  });

  const valid = rows.filter((r) => r.valid).length;
  const warned = rows.filter((r) => r.valid && r.warnings.length).length;
  // People the sheet names who have no account but could be created from it, and
  // people who can't be because the file gives no email.
  const creatable = rows.filter((r) => r.creatable);
  const uncreatable = rows.filter(
    (r) => !r.valid && !r.creatable && !r.employeeId && r.name
  );
  return {
    month: parsed.month,
    monthLabel: parsed.monthLabel,
    fileName: parsed.fileName,
    dayKeys: parsed.dayKeys,
    hasIdColumn: parsed.hasIdColumn,
    // Passed straight through so the screen can show which spreadsheet column each
    // field was read from — the fastest answer to "but I DID add an ID column".
    columnMap: parsed.columnMap || [],
    headerRowNumber: parsed.headerRowNumber,
    idColumnGuessed: parsed.idColumnGuessed,
    nameColumnGuessed: parsed.nameColumnGuessed,
    total: rows.length,
    valid,
    errorCount: rows.length - valid,
    warningCount: warned,
    rows,
    fileErrors,
    byKind,
    byWarning,
    // Route names the sheet used that aren't in Routes & Timings, so the summary can
    // name them — "fix the sheet, or add the route" is only actionable if HR can see
    // which spelling was rejected.
    unknownRoutes: [...unknownRoutes],
    creatable,
    creatableCount: creatable.length,
    uncreatable,
    uncreatableCount: uncreatable.length,
    // Importing a partial roster is allowed and useful — HR fixes the rejects and
    // re-uploads. Zero valid rows is the only hard stop.
    canImport: valid > 0,
  };
}

// --- Step 3: import ---------------------------------------------------------

// Write the valid rows. Existing documents for the same employee+month are
// REPLACED, so a corrected re-upload converges instead of duplicating.
// Also records the run in rosterImports for the history screen.
// Returns { imported, skipped, importId }.
export async function importRoster(report, { uploadedBy, uploadedByName } = {}) {
  if (!firestore) throw new Error('Backend not configured.');
  const good = report.rows.filter((r) => r.valid);
  if (!good.length) throw new Error('Nothing to import — every row has an error.');

  // Log the attempt first, so a failure halfway through is still visible to HR.
  const importRef = await addDoc(collection(firestore, IMPORTS), {
    month: report.month,
    monthLabel: report.monthLabel,
    fileName: report.fileName || '',
    uploadedBy: uploadedBy || null,
    uploadedByName: uploadedByName || '',
    uploadedAt: serverTimestamp(),
    total: report.total,
    valid: report.valid,
    errorCount: report.errorCount,
    errorSummary: report.byKind || {},
    status: 'importing',
  });

  // Chunked batches — 250 employees is one batch, but a multi-site roster isn't.
  //
  // A row is USUALLY one write, but two when it also routes the employee (below),
  // so the chunking counts WRITES rather than rows. Slicing by row count was safe
  // only while the ratio was 1:1; at two writes a row, a 450-row slice would be
  // 900 writes and Firestore rejects the batch at 500.
  let imported = 0;
  let routed = 0;
  let batch = writeBatch(firestore);
  let writes = 0;
  let pendingRows = 0;

  // `imported` counts rows that are actually COMMITTED, so a batch that fails
  // halfway doesn't get reported to HR as imported.
  const flush = async () => {
    if (!writes) return;
    await batch.commit();
    imported += pendingRows;
    batch = writeBatch(firestore);
    writes = 0;
    pendingRows = 0;
  };

  for (const row of good) {
    // THE SHEET'S ROUTE COLUMN STICKS TO THE PROFILE.
    // A route in the sheet used to reach the roster document and stop there, so
    // HR filling in a Route column changed nothing for anyone next month — and the
    // coordinator still had unrouted riders. Writing it onto the profile (only
    // where there isn't one already, so it never overrides a deliberate choice
    // made in the app) makes one upload route the whole company.
    const alsoRoute = !row.profileRoute && !!row.sheetRoute;
    if (writes + (alsoRoute ? 2 : 1) > BATCH_LIMIT) await flush();

    if (alsoRoute) {
      batch.update(doc(firestore, 'employees', row.employeeId), {
        'roster.route': String(row.sheetRoute).trim(),
      });
      writes += 1;
      routed += 1;
    }
    batch.set(doc(firestore, ROSTERS, rosterId(report.month, row.employeeId)), {
      employeeId: row.employeeId,
      employeeName: row.matchedName || row.name,
      empId: row.matchedEmpId || row.empId,
      month: report.month,
      days: row.days,
      // Denormalised so the driver can navigate without reading profiles. The
      // coordinator's board resolves the route from the PROFILE and only falls
      // back to this copy — see AppContext.ridesOn — because this one is frozen
      // at import time and goes stale the moment anybody is re-routed.
      route: row.route || null,
      address: row.address || '',
      importId: importRef.id,
      importedAt: serverTimestamp(),
    });
    writes += 1;
    pendingRows += 1;
  }
  await flush();

  await setDoc(
    doc(firestore, IMPORTS, importRef.id),
    { status: 'imported', importedCount: imported, routedCount: routed },
    { merge: true }
  );

  return { imported, skipped: report.errorCount, routed, importId: importRef.id };
}

// --- Reads ------------------------------------------------------------------

// Every roster row for a month (coordinator + admin). One query, ~250 docs.
export async function fetchMonthRosters(month) {
  if (!firestore || !month) return [];
  const snap = await getDocs(
    query(collection(firestore, ROSTERS), where('month', '==', month))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Live version of the above, for the coordinator's dashboard.
export function subscribeMonthRosters(month, cb, onError) {
  if (!firestore || !month) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(firestore, ROSTERS), where('month', '==', month)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// One employee's own months (their calendar). Employees may only read their own —
// enforced by the security rules.
export function subscribeMyRosters(employeeId, cb, onError) {
  if (!firestore || !employeeId) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(firestore, ROSTERS), where('employeeId', '==', employeeId)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// Import history, newest first (admin).
export function subscribeImportHistory(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(firestore, IMPORTS), orderBy('uploadedAt', 'desc'), limit(50)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// Change one employee's code for one day — how an approved leave / shift change
// gets written back onto the roster. `day` is "01".."31".
export async function setRosterDay(month, employeeId, day, code) {
  if (!firestore) throw new Error('Backend not configured.');
  return setDoc(
    doc(firestore, ROSTERS, rosterId(month, employeeId)),
    { days: { [day]: code }, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// --- Sample template -------------------------------------------------------

// Build the downloadable template HR starts from: the exact layout the parser
// expects, pre-filled with the right number of day columns for the month.
export function buildTemplate(year, monthIndex, sampleNames = ['Raghu', 'Sriram', 'Vineetha']) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  // Email, Phone, Route and Home Address are optional for matching an employee who
  // already has an account — but they're the difference between "this person has no
  // account, sort it out yourself" and being able to create them from the file. The
  // template asks for them so HR fills them in once rather than being asked later.
  const header = ['Employee ID', 'Employee Name', 'Email', 'Phone', 'Route', 'Home Address'];
  for (let d = 1; d <= daysInMonth; d++) {
    header.push(`${String(d).padStart(2, '0')}-${MONTHS[monthIndex]}`);
  }
  const cycle = ['E', 'E', 'E', 'E', 'E', 'WO', 'WO'];
  const samples = [
    ['9876543210', 'Kondapur', 'Flat 101, Kondapur, Hyderabad'],
    ['9876543211', 'ECIL', 'H.No 7-2, ECIL X Roads, Hyderabad'],
    ['9876543212', 'Miyapur', 'Plot 44, Miyapur, Hyderabad'],
  ];
  const rows = sampleNames.map((name, i) => {
    const [phone, route, address] = samples[i % samples.length];
    const line = [
      `100${i + 1}`, name, `${name.toLowerCase()}@example.com`, phone, route, address,
    ];
    for (let d = 1; d <= daysInMonth; d++) line.push(cycle[(d + i * 2) % 7]);
    return line;
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, `${MONTHS[monthIndex]} ${year}`);
  return { book, fileName: `shift-roster-${MONTHS[monthIndex]}-${year}.xlsx` };
}

// Trigger the browser download of the template (web only — HR uploads from a desk).
export function downloadTemplate(year, monthIndex) {
  const { book, fileName } = buildTemplate(year, monthIndex);
  XLSX.writeFile(book, fileName);
  return fileName;
}
