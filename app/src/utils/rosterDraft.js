// ---------------------------------------------------------------------------
// ROSTER UPLOAD DRAFT  —  keep a chosen spreadsheet on screen across a reload
//
// Choosing a file parses it in the page; nothing is written to Firestore until
// HR presses Import. That is the right design — an unreviewed roster shouldn't
// touch the database — but it had a jarring consequence: a refresh, an accidental
// tab close, or a dev-server hot reload silently threw the whole preview away and
// the screen came back looking as though the file had never been chosen.
//
// So the PARSED SHEET is stashed in the browser, and only in the browser. Three
// things follow from that choice:
//
//   * It is still not saved. localStorage is this browser on this machine; no
//     other user, device or admin can see it, and Import remains the only thing
//     that writes anything.
//   * We keep the PARSED sheet, not the validation report. The report is only
//     true relative to the employee directory at the moment it was produced —
//     restoring one after HR had added the missing people would show stale
//     "Unknown employee" errors. Re-validating on restore is always correct.
//   * A draft expires. A month-old preview of a file nobody remembers choosing
//     is confusing, so anything past DRAFT_TTL_MS is dropped on read.
// ---------------------------------------------------------------------------

import { Platform } from 'react-native';

const KEY = 'cab.rosterUpload.draft.v1';

// Long enough to survive a reload, a lunch break, or a crashed tab. Short enough
// that a forgotten draft doesn't reappear next week.
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// localStorage rejects writes past roughly 5 MB, and a huge roster is exactly
// when a QuotaExceededError would strike. A 500-employee sheet lands near 1 MB,
// so this leaves plenty of head-room while refusing anything pathological.
const MAX_BYTES = 3 * 1024 * 1024;

function store() {
  // Native has no localStorage, and this screen is web-only anyway. Private
  // browsing can also make access throw rather than return null.
  if (Platform.OS !== 'web') return null;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Persist a parsed sheet plus what the file was. Returns true if it was stored,
// false if it couldn't be — the caller treats that as "no draft", never an error,
// because failing to cache a preview must not block the upload.
export function saveDraft({ parsed, picked, year, fileBytes }) {
  const s = store();
  if (!s || !parsed) return false;
  // Drop any previous draft FIRST. If this save then fails — quota, a serialising
  // error, private browsing — we're left with no draft rather than the previous
  // one, which would otherwise be restored on the next reload and quietly show HR
  // an older file than the one they just chose.
  try {
    s.removeItem(KEY);
  } catch {
    return false;
  }
  try {
    const base = { savedAt: Date.now(), year, picked, parsed };
    // Try to keep the original file too, but never at the cost of losing the
    // preview: if bytes push it over the ceiling, store the preview alone.
    if (fileBytes) {
      const withFile = JSON.stringify({ ...base, fileBytes });
      if (withFile.length <= MAX_BYTES) {
        s.setItem(KEY, withFile);
        return true;
      }
    }
    const payload = JSON.stringify(base);
    if (payload.length > MAX_BYTES) return false;
    s.setItem(KEY, payload);
    return true;
  } catch {
    // A partially-written value is not a thing localStorage produces, but a failed
    // write on some engines leaves the key set to a truncated string.
    try {
      s.removeItem(KEY);
    } catch {
      /* it will fail the shape check on read */
    }
    return false;
  }
}

// The stored draft, or null. Anything unreadable, unrecognised or expired is
// removed rather than returned — a corrupt draft should self-heal on next load.
export function loadDraft() {
  const s = store();
  if (!s) return null;
  let raw;
  try {
    raw = s.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    const stale = !d?.savedAt || Date.now() - d.savedAt > DRAFT_TTL_MS;
    // `rows` and `month` are what every consumer needs; without them this isn't
    // a draft we can restore, whatever else it contains.
    const usable = Array.isArray(d?.parsed?.rows) && !!d?.parsed?.month;
    if (stale || !usable) {
      s.removeItem(KEY);
      return null;
    }
    return d;
  } catch {
    try {
      s.removeItem(KEY);
    } catch {
      /* nothing more we can do */
    }
    return null;
  }
}

export function clearDraft() {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* a draft we can't clear is harmless — it expires */
  }
}

// "just now" / "14 minutes ago" / "3 hours ago" — used to tell HR that what
// they're looking at was restored rather than freshly read.
// --- the original file itself ----------------------------------------------
//
// The grid on screen is the app's READING of the spreadsheet. When they disagree,
// the question is always "what does the actual file say?" — so keep the bytes and
// let HR open them in Excel. Base64 because localStorage holds strings only.

export function encodeBytes(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    let s = '';
    // Chunked: String.fromCharCode(...) on a 500 KB array blows the argument limit.
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return typeof btoa === 'function' ? btoa(s) : null;
  } catch {
    return null;
  }
}

export function decodeBytes(base64) {
  try {
    if (!base64 || typeof atob !== 'function') return null;
    const s = atob(base64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// Hand the original spreadsheet back to the browser so it opens in Excel. Returns
// false when there are no bytes to give — a draft saved before this existed, or a
// file too big to have been kept.
export function openOriginalFile(base64, fileName) {
  const bytes = decodeBytes(base64);
  if (!bytes || typeof document === 'undefined') return false;
  try {
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'roster.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the download a moment to start before the blob is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}

export function describeAge(savedAt) {
  if (!savedAt) return '';
  const mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return 'yesterday';
}
