// ---------------------------------------------------------------------------
// SETTINGS SERVICE
// App-wide configuration the admin can edit from the UI (no code change / redeploy).
// Right now this is the Cab routes used in Shift Roster.
//
// Stored as ONE Firestore document at  config/timings :
//   { routes: ['Madhapur', ...] }
// (The document is still named "timings" for historical reasons — it used to
// also hold Pickup/Drop time lists for the old ad-hoc Weekly Schedule, removed
// once ride times moved to Shift Policy. Existing documents may still carry
// those fields; they're simply ignored.)
//
// Until the admin saves anything (or if Firebase isn't configured) we fall back
// to the defaults derived from mockData, so the app behaves exactly as before.
// ---------------------------------------------------------------------------

import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { firestore } from './firebase';
import { CAB_ROUTES } from '../data/mockData';

// Routes (Shift Roster pickup routes) start from the original hardcoded list;
// the admin can add/remove them from Manage Routes, stored in config/timings.
const DEFAULT_ROUTES = CAB_ROUTES;
export const DEFAULT_TIMINGS = {
  routes: DEFAULT_ROUTES,
};

// The single config document these routes live in.
const timingsRef = () => doc(firestore, 'config', 'timings');

// Live subscription to the routes config. Calls cb({ routes }) now and again
// on every change. Falls back to defaults if the doc is missing, empty, or
// Firebase isn't configured. Returns an unsubscribe function.
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
        routes:
          Array.isArray(d.routes) && d.routes.length ? d.routes : DEFAULT_ROUTES,
      });
    },
    onError
  );
}

// Admin saves the edited config. `routes` is an array of route names. Only the
// fields actually passed are written (merge). Throws if the backend isn't
// configured.
export async function saveTimings({ routes }) {
  if (!firestore) throw new Error('Backend not configured — cannot save timings.');
  const payload = {};
  if (Array.isArray(routes)) payload.routes = routes;
  await setDoc(timingsRef(), payload, { merge: true });
}
