// ---------------------------------------------------------------------------
// TRACKING SERVICE
// The bridge between the app and the Realtime Database for LIVE cab location.
//
//   • A driver calls updateMyLocation() to push where they are right now.
//   • The employee's Track screen calls subscribeDriverLocation() to receive
//     every new position the instant it's written — the "real-time" part.
//
// Data lives PER DRIVER, at  driverLocations/<driverUid> :
//   { latitude, longitude, updatedAt }
//
// Why per driver and not per cab: the database rules can then insist that
// auth.uid === the node key, so a driver can only ever write their OWN
// position. (When this was keyed by cab id, every signed-in user could write
// any cab's location and spoof the fleet.) Which cab a driver is currently on
// is decided by the admin in Firestore — cabs/<cabId>.driverUid — so screens
// look the uid up from the cab before subscribing.
//
// `updatedAt` is the SERVER's clock (ServerValue.TIMESTAMP), so "how fresh is
// this fix" can't be faked by a device with a wrong clock.
// ---------------------------------------------------------------------------

import { ref, onValue, set, remove, serverTimestamp } from 'firebase/database';
import { db } from './firebase';

// A fix older than this (ms) is stale — the cab is no longer "live". Shared by
// the employee Track screen and the admin fleet map so they agree.
export const LIVE_WINDOW_MS = 60 * 1000;

// Where a given driver's live location lives in the database.
function driverLocationRef(driverUid) {
  return ref(db, `driverLocations/${driverUid}`);
}

// Driver: write my own current position. The uid must be the signed-in driver's
// — the database rules reject anything else.
export function updateMyLocation(driverUid, { latitude, longitude }) {
  if (!db) {
    console.warn('[tracking] Firebase not configured — skipping location write.');
    return Promise.resolve();
  }
  if (!driverUid) return Promise.resolve();
  return set(driverLocationRef(driverUid), {
    latitude,
    longitude,
    updatedAt: serverTimestamp(),
  });
}

// Driver stops sharing: remove the node entirely. Leaving the last position
// behind made a parked, hours-old fix look like a live cab to every employee
// watching.
export function clearMyLocation(driverUid) {
  if (!db || !driverUid) return Promise.resolve();
  return remove(driverLocationRef(driverUid));
}

// Employee / admin screen: listen for live updates from one driver. Calls
// `onLocation` with { latitude, longitude, updatedAt } on every move, or null
// when there's nothing to show. Returns an unsubscribe function — call it when
// the screen unmounts.
export function subscribeDriverLocation(driverUid, onLocation, onError) {
  if (!db || !driverUid) {
    onLocation(null); // not configured / no driver linked — stay in "Waiting…"
    return () => {};
  }
  return onValue(
    driverLocationRef(driverUid),
    (snapshot) => {
      const value = snapshot.val();
      if (value && typeof value.latitude === 'number') onLocation(value);
      else onLocation(null); // no location yet
    },
    onError
  );
}

// True if a fix is recent enough to call the cab "live".
export function isLiveFix(location, now) {
  return !!location?.updatedAt && now - location.updatedAt < LIVE_WINDOW_MS;
}
