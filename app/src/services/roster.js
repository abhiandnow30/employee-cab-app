// ---------------------------------------------------------------------------
// MONTHLY SHIFT ROSTER SERVICE
//
// HR uploads one spreadsheet per month in the matrix layout every transport desk
// already uses:
//
//   Employee ID | Employee Name | 01-Jul-2026 | 02-Jul-2026 | ... | 31-Jul-2026
//   ------------|---------------|-------------|-------------|-----|------------
//   1399        | Raghu         | E           | E           | ... | WO
//
// The date headers are the ONLY statement of which month and year the sheet is
// for — nobody picks a period in the UI — so they have to carry a year. Real
// Excel date cells, ISO, "01-Jul-2026" and "01-07-2026" all do; a bare "01-Jul"
// does not, and is refused rather than guessed at. See parseRosterFile().
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
  collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where,
  orderBy, limit, writeBatch, serverTimestamp, addDoc, deleteDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { firestore } from './firebase';
import { ALL_SHIFT_CODES, toShiftCode, isWeekdayRow } from '../data/shifts';
import { directoryEmail, isGuestDirectoryEmail } from '../utils/directoryEmail';

const ROSTERS = 'rosters';
const IMPORTS = 'rosterImports';

// The uploaded spreadsheet itself, one document per import, keyed by the SAME id
// as its rosterImports row. Kept out of that collection on purpose — the history
// list subscribes to every row of it, and bytes riding along would be re-read on
// every page open. See the file-keeping block in importRoster.
const IMPORT_FILES = 'rosterImportFiles';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A Firestore document is capped at 1 MiB TOTAL, and base64 costs about a third
// on top of the raw bytes — so this is the raw size that still leaves room for
// the encoding and the handful of other fields. A 250-person .xlsx is around
// 60 KB, so this is far above any real roster; it exists so a wrong file (a
// workbook full of images, say) fails with a sentence rather than a Firestore
// error nobody can act on.
export const MAX_STORED_FILE_BYTES = 600 * 1024;

// Raw byte count of a base64 string, without decoding it — 4 characters encode
// 3 bytes, minus whatever the trailing '=' padding stands in for.
function base64ByteLength(b64) {
  const s = String(b64 || '');
  if (!s) return 0;
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - padding;
}

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

// "26" → 2026. Two-digit years only ever turn up in hand-typed headers; the
// pivot matches the window fromExcelSerial already accepts (~1954..2064), so the
// two agree about what counts as a plausible roster year.
function expandYear(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1000) return n;
  if (n >= 100) return null; // "126" is a typo, not a year
  return n <= 64 ? 2000 + n : 1900 + n;
}

// Recognise the header cells that hold a date. Accepts, in order of reliability:
//   • a real Date cell (what Excel produces once it has touched the file)
//   • an Excel date serial number
//   • "01-Jul", "1-Jul-2026", "01 Jul"
//   • "2026-07-01" (ISO)
//   • "01/07", "01-07-2026" (day first — matches the "01-Jul" convention)
//   • a bare day number, when other columns pin the month down
//
// Returns { day, monthIndex, year } or null. `monthIndex` and `year` are null
// when the cell genuinely doesn't carry them — a bare "12" says neither, and the
// template's own "01-Jul" convention says no year. Everything else here does
// carry a year, and it used to be parsed and thrown away; the caller now votes on
// it so the roster period comes from the file instead of from a dropdown.
function parseDateHeader(raw) {
  // A genuine date cell — unambiguous, so it wins. This is the common case in
  // practice: the moment HR opens the template in Excel and saves it, "01-Jul"
  // becomes a real date cell carrying the year Excel resolved it to.
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { day: raw.getDate(), monthIndex: raw.getMonth(), year: raw.getFullYear() };
  }
  if (typeof raw === 'number') {
    const d = fromExcelSerial(raw);
    if (d) return { day: d.getDate(), monthIndex: d.getMonth(), year: d.getFullYear() };
  }

  const s = String(raw ?? '').trim();
  if (!s) return null;

  // ISO, which sorts and parses unambiguously.
  let iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const day = parseInt(iso[3], 10);
    const monthIndex = parseInt(iso[2], 10) - 1;
    if (day >= 1 && day <= 31 && monthIndex >= 0 && monthIndex <= 11) {
      return { day, monthIndex, year: parseInt(iso[1], 10) };
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
    if (day >= 1 && day <= 31 && monthIndex >= 0) {
      // The year is optional and usually absent — "01-Jul" is what the template
      // ships. Read only a trailing year, so a heading like "01-Jul (Wed)" still
      // parses as a date with no year rather than failing outright: the pattern
      // above is deliberately unanchored and that tolerance is worth keeping.
      const trailing = /^[-/\s,]+(\d{2,4})\s*$/.exec(s.slice(m[0].length));
      return { day, monthIndex, year: trailing ? expandYear(parseInt(trailing[1], 10)) : null };
    }
    return null;
  }
  // 01/07, 01-07, 01/07/2026, 01-07-2026 — day first, matching "01-Jul".
  m = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/.exec(s);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIndex = parseInt(m[2], 10) - 1;
    if (day >= 1 && day <= 31 && monthIndex >= 0 && monthIndex <= 11) {
      return { day, monthIndex, year: m[3] ? expandYear(parseInt(m[3], 10)) : null };
    }
    return null;
  }
  // A bare day number — only usable when other columns pin the month down.
  m = /^(\d{1,2})$/.exec(s);
  if (m) {
    const day = parseInt(m[1], 10);
    if (day >= 1 && day <= 31) return { day, monthIndex: null, year: null };
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
// `data` is an ArrayBuffer (browser File.arrayBuffer()).
//
// THE ROSTER PERIOD COMES FROM THE FILE. Both the month and the year are voted
// on from the date headers, so HR uploads a sheet and the app works out what
// month it is — there is nothing to pick and nothing to get wrong. The year used
// to be supplied by a dropdown on the screen, on the belief that these headers
// never carry one. They usually do: a real date cell, an Excel serial, an ISO
// header and "01-07-2026" all carry a year, and it was being parsed and
// discarded. Only the bare "01-Jul" convention genuinely lacks one.
//
// `year` is now a FALLBACK for that last case, for callers outside the upload
// screen. The screen passes nothing, so a sheet whose headers carry no year is
// refused with an error naming what's missing rather than being silently
// imported into whatever year the app happened to guess — writing a month key is
// destructive (rosters/<month>_<uid> is overwritten) and must never rest on an
// assumption.
//
// Throws on anything that isn't a readable roster — that's "Invalid file format".
export function parseRosterFile(data, { year: fallbackYear, fileName = '' } = {}) {
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

  // Now the year, the same way — majority of the columns that agreed on the
  // month, so a stray "01-Jul-2025" in a July 2026 sheet can't decide it.
  // Columns carrying no year at all (the "01-Jul" convention) simply don't vote.
  const yearVotes = {};
  dateCols.forEach((d) => {
    if (d.monthIndex !== monthIndex) return;
    if (d.year != null) yearVotes[d.year] = (yearVotes[d.year] || 0) + 1;
  });
  const yearWinner = Object.entries(yearVotes).sort((a, b) => b[1] - a[1])[0];
  const detectedYear = yearWinner ? parseInt(yearWinner[0], 10) : null;
  const year = detectedYear ?? fallbackYear ?? null;
  if (year == null) {
    // Say what was actually seen and how to fix it. "Add a year" is useless
    // without telling them which cells the app is looking at.
    const sample = dateCols
      .slice(0, 4)
      .map((d) => String(grid[headerIndex][d.col] ?? '').trim())
      .filter(Boolean)
      .join(', ');
    throw new Error(
      "Could not tell which YEAR this roster is for. The date headers say which " +
        'month, but carry no year' +
        (sample ? ` — they read: ${sample}.` : '.') +
        ' Use headers that include the year ("01-Jul-2026", "01-07-2026" or ' +
        '"2026-07-01"), or open the sheet in Excel and format that row as real ' +
        'dates, then upload it again.'
    );
  }

  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

  // Days that don't belong to the detected month are "Incorrect dates" — and now
  // that headers can carry a year, a column dated to a DIFFERENT year is out of
  // range for exactly the same reason a wrong month is. Without this a stray
  // "15-Jul-2025" column would import as 15 July 2026.
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const inPeriod = (d) =>
    (d.monthIndex == null || d.monthIndex === monthIndex) &&
    (d.year == null || d.year === year) &&
    d.day <= daysInMonth;
  const badDateHeaders = dateCols
    .filter((d) => !inPeriod(d))
    .map((d) => String(grid[headerIndex][d.col]));
  const usableCols = dateCols.filter(inPeriod);

  // A day between 1 and daysInMonth with no usableCols entry at all means its
  // header cell never parsed as a date — the most common cause is a merged
  // header cell in the spreadsheet: SheetJS only puts a value in the top-left
  // cell of a merge, so the other physical column reads as '' and vanishes here
  // rather than landing in badDateHeaders (which is only for headers that DID
  // parse, just to the wrong month/day). Every employee's shift code in that
  // column would otherwise be dropped with nothing telling HR it happened.
  const foundDays = new Set(usableCols.map((d) => d.day));
  const missingDayColumns = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (!foundDays.has(day)) missingDayColumns.push(day);
  }

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
    // The detected period, broken out so the screen can show it back to HR
    // ("Detected roster period: August 2026") rather than making them trust an
    // unexplained month key. `yearDetected` is false only when the fallback was
    // used, which the upload screen never does.
    year,
    monthIndex,
    yearDetected: detectedYear != null,
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
    missingDayColumns,
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
  // A day whose header cell never parsed as a date at all — usually a merged
  // header cell in the spreadsheet. Distinct from BAD_DATE, which is a header
  // that DID parse, just to the wrong month/an out-of-range day.
  MISSING_DAY_COLUMN: 'Missing day column',
  // A warning, never an error. The person is invited automatically on import;
  // what this reports is that their SHIFTS wait, because rosters/<month>_<uid>
  // needs a uid and that only exists after their first Microsoft sign-in.
  NO_ACCOUNT: 'Invited — shifts import after their first sign-in',
  ID_MISMATCH: 'Employee ID does not match',
  // Two employee records share one email address. Never a warning: whichever
  // one this sheet attached a month of shifts to would be a coin toss, and the
  // other copy of the person would keep generating rides nobody is expecting.
  DUPLICATE_ACCOUNT: 'Two accounts share this email',
  // The sheet has no Email column, or a row's cell is empty. Fatal either way:
  // email is the only identity this importer trusts.
  MISSING_EMAIL: 'Email missing',
  // Matched on email, but the sheet calls them something else. The sheet wins;
  // this only makes the rename visible.
  NAME_CHANGED: 'Name differs from the profile',
  NO_EMAIL_COLUMN: 'No Email column',
  // A warning, never an error: the month still imports, but every ride it
  // produces for this person lands under "No route set" on the coordinator's
  // board until somebody routes them. Silent, this is the gap that made the
  // coordinator group people by hand — so HR gets told before they import.
  NO_ROUTE: 'No pickup route',
  // The sheet named a pickup area nobody is on yet. A warning, never an error:
  // the route IS written now — the sheet is how new areas arrive — but a brand
  // new name is also exactly what a typo looks like, so HR is told before they
  // import rather than discovering a one-person carpool later.
  UNKNOWN_ROUTE: 'New pickup route',
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
export function routeKey(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// "jntu  cab" → "JNTU Cab" (the spelling already in use), or the value as typed
// when it matches nothing.
//
// This used to return null for an unrecognised route, and the caller dropped it —
// back when the route list was hand-maintained on a Routes & Timings screen and
// anything off that list had to be a mistake. That screen is gone: routes now
// arrive with the roster, and `routeOptions` is derived from what is actually in
// use (see AppContext). So a name nobody is on yet is a NEW AREA, not an error,
// and refusing it would mean a new pickup area could never be created at all.
//
// The anti-drift guarantee is unchanged and is the whole point of this function:
// matching is on routeKey(), so "jntu  cab", "JNTU CAB" and "Jntu Cab" all snap
// onto the one existing spelling. Only a genuinely new key creates a new route.
export function canonicalRoute(value, routeOptions) {
  const key = routeKey(value);
  if (!key) return null;
  const match = (routeOptions || []).find((r) => routeKey(r) === key);
  return match || String(value).trim();
}

// Is this a pickup area nobody is on yet? Used to report a new route rather than
// silently accept it — a new name and a typo are indistinguishable to the code,
// so the person reading the validation summary gets to tell them apart.
export function isNewRoute(value, routeOptions) {
  const key = routeKey(value);
  if (!key) return false;
  return !(routeOptions || []).some((r) => routeKey(r) === key);
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
  // Distinct pickup areas this sheet INTRODUCES — nobody is on them yet.
  // Reported once for the whole file rather than as the same warning on twenty
  // rows. They are written; this is a "did you mean that?", not a rejection.
  const unknownRoutes = new Set();

  // EMAIL IS THE IDENTITY. EMPLOYEE ID IS THE ONLY FALLBACK. NAME IS NOT A KEY.
  //
  // One person is known to this system three different ways — a Firebase uid, an
  // email address, and a name plus employee id typed into a spreadsheet — and
  // every import bug worth the name has been two of those disagreeing:
  //
  //   • the sheet said "Naga Lakshmi", her Microsoft account said "NagaLakshmi
  //     Mangina", and her self-provisioned profile carried no employee id at all
  //     (the rules pin those documents to token fields). Neither name nor id hit,
  //     so the import decided she did not exist and filed an invite for an
  //     address that already had an account — unclaimable, because
  //     getOrCreateProfile returns on the existing document before it ever looks
  //     for an invite. Her shifts never imported and she was held at the
  //     cab-service form as though she were a walk-up.
  //   • two people shared an employee id, and a month of shifts went to the wrong
  //     one, silently.
  //
  // Email is the only one of the three that cannot drift: it is what Microsoft
  // authenticates, what an invite is keyed on, and what firestore.rules treats as
  // the security boundary. So it is now REQUIRED and it is what rows are matched
  // on. Employee id remains as a fallback for a row whose address is new to the
  // directory but whose id is already on file.
  //
  // NAME IS NO LONGER USED TO FIND ANYBODY — deliberately, at explicit request.
  // It is still written to the profile (the sheet is authoritative for it, same
  // as phone and address), it just cannot identify a person any more. A name is
  // whatever the sheet's author typed; matching on it produced both a false
  // negative (Naga Lakshmi above) and, on two people with the same name, a false
  // positive that attached a month of shifts to a stranger.
  // Indexed on directoryEmail(), so a sheet row carrying somebody's real
  // address still finds them when Entra signs them in as a B2B guest and their
  // profile therefore stores the mangled #EXT# name. Without it a guest is
  // unmatchable by the one key that "cannot drift", falls through to an invite
  // nobody can claim, and their shifts never import — see utils/directoryEmail.js.
  const byEmail = new Map();
  const byEmpId = new Map();
  (employees || []).forEach((e) => {
    const mail = directoryEmail(e.email);
    // Two profiles on one email is the duplicate-account bug itself. Flagged,
    // never guessed at — see DUPLICATE_ACCOUNT.
    if (mail) byEmail.set(mail, byEmail.has(mail) ? 'ambiguous' : e);
    if (e.empId) byEmpId.set(String(e.empId).trim().toLowerCase(), e);
  });

  const seen = new Map(); // uid → first row number that claimed it
  const rows = parsed.rows.map((row) => {
    const errors = [];
    const warnings = [];
    let creatable = false;

    // -- identity --
    // Email, then employee id. Nothing else — see the maps above.
    let employee = null;
    let matchedBy = null;
    let duplicateEmail = false;
    // A row with no email cannot be matched and cannot be invited, so it is
    // rejected before anything else is looked at. Reported per row rather than
    // only at file level, because the fix is a cell, not the file.
    const hasEmail = !!row.email;
    if (hasEmail) {
      const hit = byEmail.get(directoryEmail(row.email));
      if (hit === 'ambiguous') duplicateEmail = true;
      else if (hit) {
        employee = hit;
        matchedBy = 'email';
      }
    }
    if (!employee && !duplicateEmail && hasEmail && row.empId) {
      employee = byEmpId.get(row.empId.toLowerCase()) || null;
      if (employee) matchedBy = 'id';
    }

    if (!employee) {
      // Couldn't resolve the row to anybody. Whether that's fatal depends on
      // whether the sheet gave us enough to create them.
      const emailLooksReal = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email || '');
      if (!hasEmail) {
        // NO EMAIL, NO IMPORT. There is nothing to match this row to and nothing
        // to invite, and guessing from the name is exactly what was removed.
        errors.push(
          `${ERROR_KINDS.MISSING_EMAIL}${row.name ? ` for "${row.name}"` : ''} — ` +
            'add their company email to this row'
        );
      } else if (duplicateEmail) {
        // Deliberately fatal, and deliberately NOT creatable: inviting an
        // address that already has one account — let alone two — writes an
        // invite nobody can ever claim, which is the state this whole block
        // exists to stop being created.
        errors.push(
          `${ERROR_KINDS.DUPLICATE_ACCOUNT} (${row.email} — two employee records ` +
            'use it; delete the one that should not exist, then re-upload)'
        );
      } else if (emailLooksReal && row.name) {
        // A WARNING, NOT AN ERROR. Everything needed to provision this person is
        // in the file, and Import now files their invite automatically, so there
        // is nothing for HR to go and fix — which is what an error means on this
        // screen. It stays visible because one thing IS still true and matters:
        // their shifts cannot be written yet.
        //
        // Not a fixable problem, a physical one. A roster row lives at
        // rosters/<month>_<uid> and a uid only exists once that person has signed
        // in with Microsoft at least once, so until they do there is no key to
        // write under. Their invite is filed, they appear in Employees as
        // pending, and their shifts land the first time they sign in — the
        // validation report re-derives off the live employee list, so it happens
        // with no re-upload.
        creatable = true;
        warnings.push(`${ERROR_KINDS.NO_ACCOUNT} (${row.email})`);
      } else if (!emailLooksReal) {
        errors.push(`${ERROR_KINDS.MISSING_EMAIL} ("${row.email}" is not an email address)`);
      } else {
        // A real email, nobody on file, and no name to create them with.
        errors.push(`${ERROR_KINDS.UNKNOWN_EMPLOYEE} (${row.email} — add their name so they can be invited)`);
      }
    } else {
      // Resolved. A missing id is worth saying, but not worth rejecting them for.
      if (!row.empId) warnings.push(`${ERROR_KINDS.MISSING_ID} (matched on ${matchedBy})`);
      // Matched by EMAIL while the sheet's name differs from the profile's. Not a
      // problem — the sheet wins and the profile is renamed — but worth seeing,
      // because it is also what a row pasted against the wrong email looks like.
      else if (
        matchedBy === 'email' &&
        row.name &&
        employee.name &&
        String(employee.name).trim().toLowerCase() !== row.name.toLowerCase()
      ) {
        warnings.push(
          `${ERROR_KINDS.NAME_CHANGED} ("${employee.name}" → "${row.name}" for ${row.email})`
        );
      }
      // Matched on EMAIL while the sheet also carries an employee id, and the two
      // disagree. Never fatal — email decided it, and email is the identity — but
      // never silent either: it is what a row pasted against the wrong person
      // looks like, and it is how a serial-number column read as the ID went
      // unnoticed. A profile with no empId at all is a gap the sheet is filling,
      // not a disagreement, so that case stays quiet.
      else if (
        matchedBy !== 'id' &&
        employee.empId &&
        String(employee.empId).trim().toLowerCase() !== row.empId.toLowerCase()
      ) {
        warnings.push(
          `${ERROR_KINDS.ID_MISMATCH} (sheet says "${row.empId}", ${employee.name} is "${employee.empId}" — matched on ${matchedBy})`
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
    // Whatever the sheet spelled it, store the spelling already in use, so a
    // stray capital can't split a carpool. A name nobody is on yet is accepted
    // as a new pickup area — the sheet is how routes arrive now — but reported,
    // because a new area and a typo look identical from here.
    const sheetRoute = canonicalRoute(row.sheetRoute, routeOptions);
    if (sheetRoute && isNewRoute(row.sheetRoute, routeOptions)) {
      unknownRoutes.add(sheetRoute);
      warnings.push(`${ERROR_KINDS.UNKNOWN_ROUTE} ("${sheetRoute}")`);
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
      // What the PROFILE stores as their address, which is not always a real
      // one — a B2B guest's profile carries the mangled #EXT# name Entra signs
      // them in as. Carried through so the import can tell that apart from the
      // address in the sheet and correct it. See importRoster.
      matchedEmail: employee?.email || null,
      matchedBy,
      route,
      // What the PROFILE says, kept separately from `route` so the import can tell
      // "the sheet is filling a gap" from "the profile already knows".
      profileRoute,
      // Sheet first, matching the "the sheet is authoritative on every upload"
      // rule below in importRoster — this value is written onto the roster
      // document in the same batch that overwrites the profile from the sheet,
      // so reading the pre-import profile here left the snapshot one upload
      // behind whenever a sheet introduced or corrected an address. A blank
      // cell still falls back to the profile and erases nothing.
      address: row.sheetAddress || employee?.address || '',
      errors,
      warnings,
      creatable,
      valid: errors.length === 0,
    };
  });

  // File-level problems apply to the whole upload and are worth saying ONCE,
  // loudly, instead of as the same error repeated on every row.
  const fileErrors = [];
  // WITHOUT AN EMAIL COLUMN NOTHING IN THE FILE CAN BE IMPORTED, so say it once,
  // at the top, instead of repeating the same row error two hundred times.
  if (!parsed.hasEmailColumn) {
    fileErrors.push(
      `${ERROR_KINDS.NO_EMAIL_COLUMN}: this sheet has no Email column. Email is how ` +
        'rows are matched to people — add one (a column headed "Email") and upload again.'
    );
  }
  if (parsed.badDateHeaders?.length) {
    fileErrors.push(`${ERROR_KINDS.BAD_DATE}: ${parsed.badDateHeaders.slice(0, 5).join(', ')}`);
  }
  if (parsed.missingDayColumns?.length) {
    const plural = parsed.missingDayColumns.length > 1;
    const days = parsed.missingDayColumns.join(', ');
    fileErrors.push(
      `${ERROR_KINDS.MISSING_DAY_COLUMN}: day ${days} of ${parsed.monthLabel} ` +
        `${plural ? 'have' : 'has'} no column in your sheet (check for a merged header ` +
        `cell) — nobody's shift code for ${plural ? 'those days' : 'that day'} will be imported.`
    );
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
    // The period the FILE said it was for, carried through so the screen never
    // has to re-derive it from the month key.
    year: parsed.year,
    monthIndex: parsed.monthIndex,
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
    // New pickup areas this sheet introduces, so the summary can name them —
    // the only defence against a typo quietly becoming a route with one rider on
    // it. Capitalisation variants never land here; those are snapped.
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
// `onProgress(done, total)` fires after each committed batch, in rows — a
// 250-row roster is one batch (one call), a 1000+ row one reports as it goes.
// Returns { imported, skipped, importId }.
export async function importRoster(
  report,
  { uploadedBy, uploadedByName, onProgress, fileBytes, fileName, contentType } = {}
) {
  if (!firestore) throw new Error('Backend not configured.');
  // A valid row with no employeeId is somebody who was just invited and has not
  // signed in yet — "No account yet" is a warning now, not an error, so these
  // reach here. They cannot be written: the document id is <month>_<uid> and
  // there is no uid until their first Microsoft sign-in. Held back rather than
  // written under a null key, and counted separately so the caller can say so.
  const valid = report.rows.filter((r) => r.valid);
  const good = valid.filter((r) => r.employeeId);
  const waiting = valid.length - good.length;
  if (!good.length && !waiting) throw new Error('Nothing to import — every row has an error.');

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
    onProgress?.(imported, good.length);
  };

  for (const row of good) {
    // THE SHEET IS AUTHORITATIVE FOR THE PROFILE, ON EVERY UPLOAD.
    // HR's explicit choice: every upload re-syncs name/phone/address/route from
    // whatever the sheet says for a matched employee, overwriting the profile —
    // not just filling a gap. A blank cell never erases existing data (there's
    // nothing to sync from), but a filled one always wins, even over a value an
    // admin set by hand or approved through Address Requests. Re-uploading last
    // month's sheet unchanged will re-write the same values, so keep the sheet
    // itself current — this screen no longer protects against a stale one.
    const profileUpdates = {};
    if (row.name) profileUpdates.name = String(row.name).trim();
    if (row.phone) profileUpdates.phone = String(row.phone).trim();
    if (row.sheetAddress) profileUpdates.address = String(row.sheetAddress).trim();
    if (row.sheetRoute) profileUpdates['roster.route'] = row.sheetRoute;
    // EMAIL IS THE ONE FIELD THE SHEET DOES NOT OWN — WITH ONE EXCEPTION.
    //
    // It is deliberately absent from the block above. `employees/<uid>.email`
    // mirrors the account the person actually authenticates as; letting a
    // spreadsheet cell overwrite it means one typo detaches a profile from its
    // own login, and every match after that — this import included — starts
    // looking for the wrong person.
    //
    // The exception is the case where the two are PROVABLY the same person and
    // the stored one is provably wrong: a B2B guest whose profile carries the
    // mangled #EXT# sign-in name Entra minted from this very address. That is
    // not the sheet asserting an identity — the row only matched at all because
    // un-mangling the stored value produced the sheet's address, so correcting
    // it can't point the profile at anybody new. It is worth doing because
    // nothing delivers mail to an #EXT# address, so the cab-assigned email for
    // every external employee fails until this is fixed.
    if (
      row.email
      && isGuestDirectoryEmail(row.matchedEmail)
      && directoryEmail(row.matchedEmail) === directoryEmail(row.email)
    ) {
      profileUpdates.email = directoryEmail(row.email);
    }
    const hasProfileUpdate = Object.keys(profileUpdates).length > 0;

    if (writes + (hasProfileUpdate ? 2 : 1) > BATCH_LIMIT) await flush();

    if (hasProfileUpdate) {
      batch.update(doc(firestore, 'employees', row.employeeId), profileUpdates);
      writes += 1;
      if (row.sheetRoute) routed += 1;
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

  // KEEP THE FILE HR ACTUALLY UPLOADED.
  //
  // Everything above turns the sheet into roster documents; none of it keeps the
  // sheet. Before this, the only copy of the uploaded bytes lived in a browser
  // localStorage draft that clearDraft() wipes the moment an import succeeds, so
  // the file ceased to exist anywhere the second it was imported — and the
  // download button on a history row could only ever rebuild a NEW sheet out of
  // Firestore and hand that back under a different name.
  //
  // A SEPARATE COLLECTION, NOT A FIELD ON THE IMPORT LOG. subscribeImportHistory
  // subscribes to every rosterImports document; a few hundred KB of base64 on
  // each one would re-download every file ever imported each time the Upload
  // Roster screen opens. Kept apart, the history list stays as light as it was
  // and the bytes are read only when somebody actually clicks Download.
  //
  // BEST EFFORT, NEVER FATAL. The roster rows are already committed at this
  // point and they are the thing that matters — a file that could not be stored
  // must not report the import as failed. The caller is told either way.
  let fileStored = false;
  let fileSkipped = '';
  if (fileBytes) {
    const rawBytes = base64ByteLength(fileBytes);
    if (rawBytes > MAX_STORED_FILE_BYTES) {
      fileSkipped =
        `the file is ${Math.round(rawBytes / 1024)} KB, over the ` +
        `${Math.round(MAX_STORED_FILE_BYTES / 1024)} KB a Firestore document can hold`;
    } else {
      try {
        await setDoc(doc(firestore, IMPORT_FILES, importRef.id), {
          importId: importRef.id,
          month: report.month,
          fileName: fileName || report.fileName || 'roster.xlsx',
          contentType: contentType || XLSX_MIME,
          // The raw size, not the base64 length — this is what to show a human.
          size: rawBytes,
          data: fileBytes,
          uploadedBy: uploadedBy || null,
          uploadedAt: serverTimestamp(),
        });
        fileStored = true;
      } catch (e) {
        fileSkipped = e?.message || 'the file could not be saved';
      }
    }
  } else {
    fileSkipped = 'the original bytes were no longer in hand';
  }

  await setDoc(
    doc(firestore, IMPORTS, importRef.id),
    {
      status: 'imported',
      importedCount: imported,
      routedCount: routed,
      // Written only once the file document is actually there, so the history row
      // can offer Download without reading the file collection to find out — and
      // can never offer it for a file that isn't stored.
      hasOriginalFile: fileStored,
      originalFileName: fileStored ? fileName || report.fileName || '' : '',
    },
    { merge: true }
  );

  return {
    imported,
    skipped: report.errorCount,
    routed,
    // Invited but not signed in yet, so their shifts are still to come.
    waiting,
    importId: importRef.id,
    fileStored,
    fileSkipped,
  };
}

// Read one import's original spreadsheet back. Returns null when nothing was
// stored — every import made before this existed, and any file that was too big.
export async function fetchImportFile(importId) {
  if (!firestore || !importId) return null;
  const snap = await getDoc(doc(firestore, IMPORT_FILES, importId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// --- Who the sheet no longer mentions ---------------------------------------
//
// AN IMPORT ONLY EVER WRITES. It walks the rows the sheet HAS and writes a
// document for each; a person who has been taken OUT of the sheet is simply
// never visited, so their rosters/<month>_<uid> document from a previous upload
// survives untouched and keeps deriving a ride every single day.
//
// Which means removing somebody from the spreadsheet does not remove them from
// the board, and re-uploading cannot fix it — there is no "this person is gone"
// signal in a file that just doesn't mention them. Until this existed the only
// remedy was deleting documents by hand in the Firestore console.
//
// SO THIS IS A DIFFERENCE, NOT A DELETE. It reports what is stored for the month
// that the sheet does not claim, and the screen asks before removing any of it.
// Doing it automatically would be dangerous in a way that is easy to miss: a
// partial sheet — one route, a correction for three people, the wrong file —
// would silently wipe everybody else's month in a single click.
//
// HAND-ADDED RIDERS ARE HELD BACK, and that is the subtle part. addRiderForDay()
// writes to this same collection for someone the monthly sheet MISSED, stamping
// `addedBy` and no `importId`. They are absent from the sheet by definition —
// that is why the desk added them — so offering them for removal because a sheet
// doesn't list them would delete the fix along with the problem.
export function rosterOrphans(report, stored, namesByUid) {
  if (!report || !stored?.length) return { removable: [], handAdded: [] };

  // Anyone the sheet resolved to a real account, INCLUDING rows that failed
  // validation: a row with a bad shift code is still the sheet saying "this
  // person is on the roster", and must never count as an absence.
  const claimed = new Set(
    (report.rows || []).map((r) => r.employeeId).filter(Boolean)
  );

  const missing = (stored || []).filter(
    (r) => r.employeeId && !claimed.has(r.employeeId)
  );

  const describe = (r) => ({
    id: r.id,
    employeeId: r.employeeId,
    name: rosterRowName(r, namesByUid) || '(no name on roster row)',
    empId: r.empId || '',
    route: r.route || '',
    days: Object.values(r.days || {}).filter(Boolean).length,
    importedAt: r.importedAt || null,
    addedByName: r.addedByName || '',
  });

  return {
    removable: missing.filter((r) => r.importId).map(describe),
    handAdded: missing.filter((r) => !r.importId && r.addedBy).map(describe),
  };
}

// Delete roster documents by id. Admin only — `allow delete: if isAdmin()` on
// the rosters collection. Chunked under Firestore's 500-write batch limit.
//
// This removes a month of SHIFTS, never a person: their employee record, their
// profile and every booking they have ever had are untouched. A booking is what
// actually happened and the rules refuse to delete one at all; a roster is a
// standing instruction to keep producing rides, and that is what stops here.
export async function removeRosterEntries(ids) {
  if (!firestore || !ids?.length) return 0;
  const CHUNK = 400;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = writeBatch(firestore);
    ids.slice(i, i + CHUNK).forEach((id) => batch.delete(doc(firestore, ROSTERS, id)));
    await batch.commit();
    removed += Math.min(CHUNK, ids.length - i);
  }
  return removed;
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

// Remove one entry from Import history. This only deletes the log record of
// the upload — the roster rows it wrote (rosters/<month>_<uid>) are untouched,
// so nobody's shifts or already-generated rides disappear. It's a cleanup of
// the audit trail, not an undo of the import itself.
export async function deleteImportHistoryEntry(importId) {
  if (!firestore) throw new Error('Backend not configured.');
  // The stored spreadsheet goes with its row. Leaving it behind would orphan a
  // document nothing links to and nothing can reach — the only handle on it is
  // the import id that is about to be deleted. Deleted FIRST so a failure here
  // surfaces while the row is still visible to try again; deleteDoc on a
  // document that was never stored is a no-op, so pre-file imports are fine.
  await deleteDoc(doc(firestore, IMPORT_FILES, importId));
  return deleteDoc(doc(firestore, IMPORTS, importId));
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

// --- Coordinator: put one rider on ONE day's board --------------------------

// The 9 PM problem. Somebody needs a cab tonight and isn't on the board, because
// the roster the month was built from doesn't have them working today. Until this
// existed the only fix was phoning HR to add a roster row, so the person running
// the day could see the problem and not solve it.
//
// This is deliberately NOT addSingleEmployeeRoster() with a one-day range:
//   • that one is admin-only and lives on the Roster Upload screen;
//   • it logs a rosterImports row, which the rules only let an admin write;
//   • and its day range invites rostering someone for the rest of the month.
// This writes exactly one day, from the screen where the problem is visible.
//
// TWO SHAPES, because the rules draw the line in a different place for each:
//   • the employee already HAS a roster document for this month → update only
//     `days`, which is precisely what a coordinator is allowed to touch
//     (onlyDaysTouched() in firestore.rules);
//   • they DON'T → this write creates it, so it must carry the same identity
//     fields importRoster() writes. Without `employeeId` the rider cannot read
//     their own schedule (the read rule matches on it) and ridesForDate() can't
//     attribute the ride; without `month` the derivation skips the document
//     entirely.
// Returns { created } so the caller can word the confirmation honestly.
export async function addRiderForDay(
  { month, employee, day, code },
  { addedBy, addedByName } = {}
) {
  if (!firestore) throw new Error('Backend not configured.');
  if (!employee?.uid) throw new Error('Pick an employee first.');
  if (!code) throw new Error('Pick a shift first.');
  if (!/^\d{2}$/.test(String(day))) throw new Error('Bad day.');
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Bad month.');

  const ref = doc(firestore, ROSTERS, rosterId(month, employee.uid));
  const existing = await getDoc(ref);

  if (existing.exists()) {
    // A dotted path so only this one day moves — a whole-map write would wipe
    // the rest of their month, and the merge that avoids that reports the same
    // affected key to the rules anyway.
    await updateDoc(ref, { [`days.${day}`]: code, updatedAt: serverTimestamp() });
    return { created: false };
  }

  await setDoc(ref, {
    employeeId: employee.uid,
    employeeName: employee.name || '',
    empId: employee.empId || '',
    month,
    days: { [day]: code },
    // Route and address are copied off the profile exactly as an import would.
    // AppContext.ridesOn() overlays the live profile route on top of this, so a
    // rider who gets routed later still groups correctly without a rewrite.
    route: employee.roster?.route || null,
    address: employee.address || '',
    // Provenance, because a roster row that nobody can account for is worse than
    // no roster row. The import path logs to rosterImports for this reason; a
    // coordinator may not write that collection, so it is stamped here instead.
    addedBy: addedBy || null,
    addedByName: addedByName || '',
    addedAt: serverTimestamp(),
  });
  return { created: true };
}

// --- Manual single-employee add (no spreadsheet) ----------------------------

// Writes ONE employee's roster for a range of days, without a spreadsheet —
// for the walk-in case: someone needs a cab arranged for the rest of the
// month and re-uploading the whole sheet (or asking HR to add a row and
// re-import) is overkill for one person.
//
// Writes the SAME document shape importRoster() writes per row (month,
// employeeId, employeeName, empId, route, address), so this employee's rides
// generate identically whether their row came from a sheet or was added by
// hand here — nothing downstream needs to know which. `{merge: true}` means
// an existing partial roster for this employee/month gets these days merged
// in rather than wiped.
//
// Also logs a rosterImports entry (status 'imported', fileName says "Manual
// entry") so this write shows up in Import history exactly like a real
// upload — otherwise it would be an invisible way to change someone's roster.
// Returns { importId, daysWritten }.
export async function addSingleEmployeeRoster(
  { month, monthLabel, employee, startDay, endDay, code },
  { uploadedBy, uploadedByName } = {}
) {
  if (!firestore) throw new Error('Backend not configured.');
  if (!employee?.uid) throw new Error('Pick an employee first.');
  if (!code) throw new Error('Pick a shift code first.');
  if (!(startDay >= 1) || !(endDay >= startDay)) {
    throw new Error('Pick a valid day range.');
  }

  const days = {};
  for (let d = startDay; d <= endDay; d += 1) {
    days[String(d).padStart(2, '0')] = code;
  }

  const importRef = doc(collection(firestore, IMPORTS));
  const batch = writeBatch(firestore);
  batch.set(importRef, {
    month,
    monthLabel,
    fileName: `Manual entry — ${employee.name || 'employee'}`,
    uploadedBy: uploadedBy || null,
    uploadedByName: uploadedByName || '',
    uploadedAt: serverTimestamp(),
    total: 1,
    valid: 1,
    errorCount: 0,
    errorSummary: {},
    status: 'imported',
    importedCount: 1,
    routedCount: 0,
  });
  batch.set(
    doc(firestore, ROSTERS, rosterId(month, employee.uid)),
    {
      employeeId: employee.uid,
      employeeName: employee.name || '',
      empId: employee.empId || '',
      month,
      days,
      route: employee.roster?.route || null,
      address: employee.address || '',
      importId: importRef.id,
      importedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();

  return { importId: importRef.id, daysWritten: Object.keys(days).length };
}

// --- Sample template -------------------------------------------------------

// Build the downloadable template HR starts from: the exact layout the parser
// expects, pre-filled with the right number of day columns for the month.
export function buildTemplate(year, monthIndex, sampleNames = ['Raghu', 'Sriram', 'Vineetha']) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  // EMAIL IS REQUIRED — it is how a row is matched to a person, so a blank cell
  // means that row cannot import at all (see validateRoster). Phone, Route and
  // Home Address are optional to MATCH on, but the sheet is authoritative for
  // them, so a blank cell simply leaves the profile as it was — which is how
  // somebody ends up rostered with no address and stuck at the cab-service form.
  // Employee ID is the one fallback when an email is new to the directory.
  const header = ['Employee ID', 'Employee Name', 'Email', 'Phone', 'Route', 'Home Address'];
  for (let d = 1; d <= daysInMonth; d++) {
    // "01-Aug-2026", not "01-Aug". The upload screen no longer asks for a year —
    // it reads the roster period out of these headers — so a template that
    // omitted it would produce a file the app then refuses as undateable. Still
    // plain readable text, and Excel converting it to a real date cell on save
    // is the most reliable form parseDateHeader() accepts.
    header.push(`${String(d).padStart(2, '0')}-${MONTHS[monthIndex]}-${year}`);
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

// --- Verifying an import ----------------------------------------------------
//
// "Status: Success" says the write returned without error. It does NOT show what
// landed, and the uploaded file itself is never kept — the bytes live only in a
// local draft that is cleared once the import completes, so there is nothing to
// re-download. Which is arguably the right thing: the question worth answering
// is not "what did I upload" but "what is in the system now", and after an
// edited day or a re-upload those are different questions.
//
// So this rebuilds a sheet FROM FIRESTORE — the rosters/<month>_<uid> documents
// the coordinator's board actually reads. If a name is missing here, that person
// has no shifts, whatever the upload said.
//
// The name a roster row was imported under. The field is `employeeName` (see
// importRoster) — `name` is the profile's field, not this document's, and reading
// it here is what made every row of the verify dialog say "no name on roster
// row" while the sheet plainly had names in it. `namesByUid` is an optional
// fallback from the live directory, for rows written before this field existed.
function rosterRowName(row, namesByUid) {
  return (
    row?.employeeName ||
    namesByUid?.get?.(row?.employeeId) ||
    ''
  );
}

// `rosters` is what fetchMonthRosters(month) returned. `month` is 'YYYY-MM'.
//
// THIS SHEET IS MEANT TO GO BACK IN. It is not only a record of what landed —
// downloading a month, adding the people who joined since, and re-uploading is
// the supported way to amend a roster mid-month. Three things follow from that,
// and each of them is load-bearing:
//
//   1. The date headers CARRY THE YEAR. The upload screen reads the roster period
//      out of them and refuses a sheet that doesn't state one, so a yearless
//      "01-Aug" header here would produce a file this app then rejects.
//   2. There is an EMAIL column, blank where the directory has none. A row typed
//      in for somebody with no account can only become an invite if the file
//      names an email — without the column, every new person added by hand comes
//      back as "can't be invited — no email in the file".
//   3. Name and route are read from the LIVE DIRECTORY where it has them, not
//      from the frozen copy on the roster document. Re-importing this sheet
//      overwrites those fields on the profile, so exporting the stale snapshot
//      would quietly revert anyone re-routed or renamed since the last import.
//
// `byUid` is an optional Map of uid → the live employee record. Left out, the
// stored snapshot is used, which is the old behaviour.
export function buildStoredRosterSheet(month, rosters, namesByUid, byUid) {
  const [yearStr, monthStr] = String(month || '').split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const known = Number.isFinite(year) && monthIndex >= 0 && monthIndex <= 11;
  const daysInMonth = known ? new Date(year, monthIndex + 1, 0).getDate() : 31;
  const label = known ? `${MONTHS[monthIndex]} ${year}` : String(month);

  const header = ['Employee ID', 'Employee Name', 'Email', 'Route'];
  for (let d = 1; d <= daysInMonth; d++) {
    const day = String(d).padStart(2, '0');
    header.push(known ? `${day}-${MONTHS[monthIndex]}-${year}` : day);
  }

  const rows = (rosters || []).map((r) => {
    const live = byUid?.get?.(r.employeeId);
    const line = [
      r.empId || live?.empId || '',
      rosterRowName(r, namesByUid),
      live?.email || '',
      // Live route first: the copy on the roster document is frozen at import
      // time, and re-uploading it would undo a re-routing done since.
      live?.roster?.route || r.route || '',
    ];
    for (let d = 1; d <= daysInMonth; d++) {
      // ZERO-PADDED FIRST. importRoster() writes this map keyed "01".."31"
      // (parseRosterFile pads it), so looking up "1" missed every single day and
      // the whole grid exported blank — names and routes, no shift codes. That
      // was survivable while this was only a "show me what landed" download; it
      // is not, now that the sheet is meant to be edited and uploaded back. The
      // unpadded lookups stay as a fallback for any document written by hand.
      // A day with no code is still a genuine blank, not an error.
      line.push(r.days?.[String(d).padStart(2, '0')] ?? r.days?.[String(d)] ?? r.days?.[d] ?? '');
    }
    return line;
  });

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, label.slice(0, 31));
  return { book, fileName: `roster-${month}.xlsx`, rowCount: rows.length };
}

// Download what is actually stored for a month (web — HR works from a desk).
export function downloadStoredRoster(month, rosters, namesByUid, byUid) {
  const { book, fileName, rowCount } = buildStoredRosterSheet(month, rosters, namesByUid, byUid);
  XLSX.writeFile(book, fileName);
  return { fileName, rowCount };
}

// A quick per-employee summary of what a month actually holds, for the verify
// dialog: how many days carry a code, and how many of those are rides rather
// than time off. Counting the CODED days matters because a roster row that
// imported with every cell blank still counts as "1 employee imported" — it just
// generates no rides, which is exactly the failure "Success" hides.
// `policy` is the shift-policy MAP, keyed by code: { A: { label, providePickup,
// provideDrop, working }, WO: { working: false }, ... } — the same object the
// Shift Timings screen edits.
export function summariseStoredRoster(rosters, policy, namesByUid) {
  // A code only produces a ride if the policy says it provides a leg. Evening is
  // the case that matters: it's a real working code with BOTH legs off today, so
  // counting "working" days would promise rides that never appear.
  const givesRide = (code) => {
    const s = policy?.[code];
    return !!s && (s.providePickup === true || s.provideDrop === true);
  };
  return (rosters || []).map((r) => {
    const codes = Object.values(r.days || {}).filter(Boolean);
    return {
      employeeId: r.employeeId,
      name: rosterRowName(r, namesByUid) || '(no name on roster row)',
      empId: r.empId || '',
      route: r.route || '',
      codedDays: codes.length,
      rideDays: codes.filter(givesRide).length,
    };
  });
}
