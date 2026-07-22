// ---------------------------------------------------------------------------
// SETTINGS SERVICE
// App-wide configuration the admin can edit from the UI (no code change / redeploy).
// Right now this is the Weekly Schedule PICKUP / DROP time options.
//
// Stored as ONE Firestore document at  config/timings :
//   { pickupTimes: ['09:00 PM', ...], dropTimes: ['04:00 AM', ...] }
// The "NA" sentinel is NOT stored — it's a UI-only "no ride this leg" choice
// that the Self Roster screen adds itself. So these arrays hold real times only.
//
// Until the admin saves anything (or if Firebase isn't configured) we fall back
// to the defaults derived from mockData, so the app behaves exactly as before.
// ---------------------------------------------------------------------------

import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { firestore } from './firebase';
import { PICKUP_TIMES, DROP_TIMES, NONE } from '../data/mockData';

// Defaults = the original hardcoded lists, minus the "NA" sentinel.
const DEFAULT_PICKUP = PICKUP_TIMES.filter((t) => t !== NONE);
const DEFAULT_DROP = DROP_TIMES.filter((t) => t !== NONE);
export const DEFAULT_TIMINGS = { pickupTimes: DEFAULT_PICKUP, dropTimes: DEFAULT_DROP };

// The single config document these timings live in.
const timingsRef = () => doc(firestore, 'config', 'timings');

// Live subscription to the timings config. Calls cb({ pickupTimes, dropTimes })
// now and again on every change. Falls back to defaults if the doc is missing,
// empty, or Firebase isn't configured. Returns an unsubscribe function.
export function subscribeTimings(cb, onError) {
  if (!firestore) {
    cb(DEFAULT_TIMINGS);
    return () => {};
  }
  return onSnapshot(
    timingsRef(),
    (snap) => {
      const d = snap.exists() ? snap.data() : {};
      cb({
        pickupTimes:
          Array.isArray(d.pickupTimes) && d.pickupTimes.length ? d.pickupTimes : DEFAULT_PICKUP,
        dropTimes:
          Array.isArray(d.dropTimes) && d.dropTimes.length ? d.dropTimes : DEFAULT_DROP,
      });
    },
    onError
  );
}

// Admin saves the edited timings. `pickupTimes` / `dropTimes` are arrays of
// "hh:mm AM/PM" strings (no "NA"). Throws if the backend isn't configured.
export async function saveTimings({ pickupTimes, dropTimes }) {
  if (!firestore) throw new Error('Backend not configured — cannot save timings.');
  await setDoc(timingsRef(), { pickupTimes, dropTimes }, { merge: true });
}
