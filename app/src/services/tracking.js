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

import { ref, onValue, set, remove, serverTimestamp, onDisconnect } from 'firebase/database';
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

// TELL THE SERVER TO CLEAN UP IF WE VANISH.
//
// stopSharing() removes the node, but it only runs when the app is alive enough to
// run it. A crash, a force-kill, a phone in a tunnel, a battery that dies — all of
// those leave the last fix sitting in the database, and the cab reads as parked at
// wherever it was when the lights went out.
//
// onDisconnect is registered ON THE SERVER at the moment sharing starts: when the
// socket drops for any reason, Firebase itself deletes the node. Nothing on the
// device has to survive for the cleanup to happen.
//
// IT DOES NOT REPLACE LIVE_WINDOW_MS, and the two cover different failures:
//   • onDisconnect fires when the CONNECTION drops — but Firebase waits for its
//     own keepalive to time out first, which can take a minute or two, and it
//     never fires at all while the socket is healthy.
//   • LIVE_WINDOW_MS catches the case onDisconnect cannot see: still connected,
//     still authenticated, but no new fix — GPS lost indoors, permission revoked
//     mid-trip, the OS throttling a backgrounded app.
// Keep both.
// NEVER BLOCKS. `.remove()` resolves only when the RTDB SERVER acknowledges the
// registration, so if the socket is slow, proxied or blocked, the promise simply
// never settles. Awaiting it once meant a driver on a restricted network could not
// turn sharing on at all — the switch sat disabled forever waiting for an
// acknowledgement that a safety net needed, not the tracking itself.
//
// So it settles either way: on ack, on error, or after ARM_TIMEOUT_MS with a
// warning. If it timed out, the registration may still land later when the socket
// comes up — and if it never does, LIVE_WINDOW_MS is the safeguard that covers it.
// That is the whole reason both exist.
const ARM_TIMEOUT_MS = 5000;

export function claimLocationNode(driverUid) {
  if (!db || !driverUid) return Promise.resolve();
  const armed = onDisconnect(driverLocationRef(driverUid))
    .remove()
    .catch((e) => console.warn('[tracking] could not arm onDisconnect:', e?.message));
  const timeout = new Promise((resolve) =>
    setTimeout(() => {
      console.warn(
        '[tracking] onDisconnect not acknowledged in ' +
          ARM_TIMEOUT_MS +
          'ms — continuing; stale fixes are still caught by the live window.'
      );
      resolve();
    }, ARM_TIMEOUT_MS)
  );
  return Promise.race([armed, timeout]);
}

// Cancel that standing instruction — used when sharing is stopped deliberately, so
// a later reconnect on the same session can't schedule a delete against a node the
// driver has since started publishing to again.
export function releaseLocationNode(driverUid) {
  if (!db || !driverUid) return Promise.resolve();
  const cancelled = onDisconnect(driverLocationRef(driverUid))
    .cancel()
    .catch((e) => console.warn('[tracking] could not cancel onDisconnect:', e?.message));
  // Same timeout as arming, and for the same reason — a stop must not be able to
  // wait forever on a server acknowledgement.
  const timeout = new Promise((resolve) => setTimeout(resolve, ARM_TIMEOUT_MS));
  return Promise.race([cancelled, timeout]);
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
