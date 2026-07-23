// ---------------------------------------------------------------------------
// TRACKING SERVICE
// The bridge between the app and the Realtime Database for LIVE cab location.
//
//   • A driver calls updateCabLocation() to push where the cab is right now.
//   • The employee's Track screen calls subscribeCabLocation() to receive every
//     new position the instant it's written — that's the "real-time" part.
//
// Data shape stored at  cabs/<cabId>/location :
//   { latitude, longitude, updatedAt }
// ---------------------------------------------------------------------------

import { ref, onValue, set } from 'firebase/database';
import { db } from './firebase';

// Where a given cab's live location lives in the database.
function cabLocationRef(cabId) {
  return ref(db, `cabs/${cabId}/location`);
}

// Driver/simulator: write the cab's current position.
// `serverTimeMs` is passed in by the caller (we avoid Date.now() inside shared
// code); it just records when the fix was taken.
export function updateCabLocation(cabId, { latitude, longitude }, serverTimeMs) {
  if (!db) {
    console.warn('[tracking] Firebase not configured — skipping location write.');
    return Promise.resolve();
  }
  return set(cabLocationRef(cabId), {
    latitude,
    longitude,
    updatedAt: serverTimeMs ?? null,
  });
}

// Employee screen: listen for live updates. Calls `onLocation` with
// { latitude, longitude, updatedAt } every time the cab moves.
// Returns an unsubscribe function — call it when the screen unmounts.
export function subscribeCabLocation(cabId, onLocation) {
  if (!db) {
    onLocation(null); // not configured yet — stay in "Waiting…" state
    return () => {};
  }
  const unsubscribe = onValue(cabLocationRef(cabId), (snapshot) => {
    const value = snapshot.val();
    if (value && typeof value.latitude === 'number') {
      onLocation(value);
    } else {
      onLocation(null); // no location yet
    }
  });
  return unsubscribe;
}
