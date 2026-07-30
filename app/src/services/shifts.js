// ---------------------------------------------------------------------------
// SHIFT POLICY SERVICE
// The transport policy — which shift codes exist, when each runs, and how long
// before/after the cab collects and returns — lives in ONE Firestore document at
// config/shifts. HR/Admin edits it from the Shift Policy screen.
//
// Everyone signed in can READ it (the coordinator needs it to work out pickup
// times, employees to read their calendar); only an admin can WRITE it.
//
// Falls back to DEFAULT_SHIFT_POLICY when the document is missing or Firebase
// isn't configured, so a fresh project behaves sensibly on first run.
// ---------------------------------------------------------------------------

import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { firestore } from './firebase';
import { DEFAULT_SHIFT_POLICY, hhmmToMinutes, ALL_SHIFT_CODES } from '../data/shifts';

const shiftsRef = () => doc(firestore, 'config', 'shifts');

// Merge a stored policy over the defaults, dropping anything malformed. A bad
// value in Firestore must never make the whole app unable to read a roster, and
// a working shift with an unparseable time would silently produce no rides — so
// those entries fall back to the default instead.
function normalize(stored) {
  const out = { ...DEFAULT_SHIFT_POLICY };
  if (!stored || typeof stored !== 'object') return out;

  Object.keys(stored).forEach((code) => {
    const s = stored[code];
    if (!s || typeof s !== 'object') return;
    const working = s.working === true;
    if (working && (hhmmToMinutes(s.start) == null || hhmmToMinutes(s.end) == null)) {
      // Keep the default (or skip an unknown code) rather than a broken shift.
      return;
    }
    // WHICH LEGS RUN. A stored policy saved before these fields existed carries
    // neither, and inferring them from the service window is not the same policy:
    // the night shift ends at 06:00, which IS inside cab hours, yet no drop is
    // provided. So a missing flag inherits the company default for that code, and
    // only a code with no default at all falls back to the window (undefined,
    // which is what legsForShift treats as "ask the window").
    const fallback = DEFAULT_SHIFT_POLICY[code];
    const leg = (key) =>
      typeof s[key] === 'boolean' ? s[key] : fallback?.[key];

    out[code] = {
      label: String(s.label || code),
      working,
      ...(working
        ? {
            start: s.start,
            end: s.end,
            pickupLeadMin: Number(s.pickupLeadMin) || 0,
            dropDelayMin: Number(s.dropDelayMin) || 0,
            providePickup: leg('providePickup'),
            provideDrop: leg('provideDrop'),
          }
        : {}),
    };
  });
  return out;
}

// Live subscription to the policy. Calls cb(policy) now and on every change.
// Returns an unsubscribe function.
export function subscribeShiftPolicy(cb, onError) {
  if (!firestore) {
    cb(DEFAULT_SHIFT_POLICY);
    return () => {};
  }
  return onSnapshot(
    shiftsRef(),
    (snap) => cb(normalize(snap.exists() ? snap.data() : null)),
    onError
  );
}

// Admin saves the edited policy. Validated here as well as in the UI so a bad
// write can't reach Firestore from anywhere.
export async function saveShiftPolicy(policy) {
  if (!firestore) throw new Error('Backend not configured — cannot save the policy.');

  const clean = {};
  Object.keys(policy || {}).forEach((code) => {
    const s = policy[code];
    if (!s) return;
    if (s.working === true) {
      if (hhmmToMinutes(s.start) == null || hhmmToMinutes(s.end) == null) {
        throw new Error(`${code}: start and end must look like 16:00.`);
      }
      clean[code] = {
        label: String(s.label || code).trim() || code,
        working: true,
        start: s.start,
        end: s.end,
        pickupLeadMin: Math.max(0, Number(s.pickupLeadMin) || 0),
        dropDelayMin: Math.max(0, Number(s.dropDelayMin) || 0),
        // Which legs a cab actually runs. Written explicitly (never left to the
        // service window) so the saved document says what the company provides —
        // these used to be stripped here, which is why the screen had no way to
        // express "night shift: pickup only".
        providePickup: s.providePickup === true,
        provideDrop: s.provideDrop === true,
      };
    } else {
      clean[code] = { label: String(s.label || code).trim() || code, working: false };
    }
  });

  // At least one working shift, or the roster can never produce a single ride.
  if (!Object.values(clean).some((s) => s.working)) {
    throw new Error('At least one shift must be a working shift.');
  }
  // The non-working codes the roster relies on must survive an edit.
  const missing = ALL_SHIFT_CODES.filter((c) => !clean[c]);
  if (missing.length) {
    throw new Error(`These codes are still used by rosters and can't be removed: ${missing.join(', ')}.`);
  }

  await setDoc(shiftsRef(), clean);
}
