// ---------------------------------------------------------------------------
// BACKGROUND LOCATION TASK  (native only)
//
// WHY THIS EXISTS. Sharing used to be `watchPositionAsync` with FOREGROUND
// permission only, which stops the moment the app isn't in front — the driver
// locks the phone, takes a call, or taps Navigate and switches to Google Maps,
// and the cab goes dark for the rest of the trip. Since Navigate is a button this
// app gives them, foreground-only tracking was broken by design.
//
// WHAT THIS IS. One `TaskManager` task, registered at module load, that
// `Location.startLocationUpdatesAsync` drives from the OS. Android keeps it alive
// with a foreground service (the persistent notification the driver sees); iOS
// keeps delivering via the `location` background mode.
//
// IT IS NOT A SECOND TRACKING SYSTEM. Every fix still goes through the existing
// `updateMyLocation()` in services/tracking.js, to the same
// driverLocations/<driverUid> node, with the same server timestamp. This file only
// changes WHO drives the updates: the OS instead of a screen.
//
// THE HARD PART — WHO AM I, IN A HEADLESS CONTEXT.
// When Android restarts the task after the process was killed, the JS context is
// fresh: no screens, no React, and `auth.currentUser` is null until the Firebase
// SDK has restored the session. So the task cannot ask the app who the driver is.
// Two things solve it:
//   1. The uid is written to AsyncStorage when sharing starts, so the task can
//      read it with no Firebase state at all.
//   2. Before writing, it waits briefly for Auth to come back, because the RTDB
//      rules require `auth.uid === $uid` — a write with no token is refused, as it
//      should be. If auth never arrives the fix is DROPPED rather than retried
//      forever: a dropped fix goes stale within LIVE_WINDOW_MS and reads as "last
//      seen", which is the honest outcome.
//
// NEVER IMPORTED FROM WEB CODE. expo-task-manager has no web implementation;
// AppContext keeps the existing watchPositionAsync path for the browser and pulls
// this in only on native.
// ---------------------------------------------------------------------------

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from './firebase';
import { updateMyLocation } from './tracking';

// A stable string, NOT a generated id: the OS remembers it across process death,
// so it has to match on the other side of a restart.
export const LOCATION_TASK = 'cab-service-driver-location';

// Whose location the task is publishing.
const UID_KEY = 'tracking.driverUid';
// The driver's INTENT, kept apart from whether the OS is currently running the
// task. "I turned it on" and "it is running" are different facts, and treating
// them as one is how a screen ends up claiming to share when it isn't.
const INTENT_KEY = 'tracking.sharingIntent';

// How long a headless write waits for Firebase Auth to restore before giving up.
// Generous enough for a cold start on a slow phone, short enough that fixes don't
// queue behind each other (the OS delivers every few seconds).
const AUTH_WAIT_MS = 8000;

export async function rememberSharingDriver(uid) {
  await AsyncStorage.multiSet([
    [UID_KEY, String(uid || '')],
    [INTENT_KEY, 'on'],
  ]);
}

export async function forgetSharingDriver() {
  // The uid stays: it is what a restart needs in order to clear the right RTDB
  // node. Only the intent flips.
  await AsyncStorage.setItem(INTENT_KEY, 'off');
}

export async function readSharingIntent() {
  const pairs = await AsyncStorage.multiGet([INTENT_KEY, UID_KEY]);
  const intent = pairs[0]?.[1];
  const uid = pairs[1]?.[1];
  return { wanted: intent === 'on', uid: uid || null };
}

// Resolves to the signed-in uid, waiting for Auth to restore if it hasn't yet.
function currentUid() {
  if (!auth) return Promise.resolve(null);
  if (auth.currentUser?.uid) return Promise.resolve(auth.currentUser.uid);
  return new Promise((resolve) => {
    let settled = false;
    let unsub = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof unsub === 'function') unsub();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), AUTH_WAIT_MS);
    unsub = auth.onAuthStateChanged((user) => finish(user?.uid || null));
  });
}

// THE TASK. Defined at module scope, which is what lets the OS find it again in a
// fresh JS context — a task defined inside a component or an effect would not
// exist when Android relaunches the app headless.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[locationTask]', error.message);
    return;
  }
  const locations = data?.locations;
  if (!locations?.length) return;

  // The OS may hand over a batch it buffered while offline. Only the newest one
  // matters: the node holds a single current position, so writing the older fixes
  // would publish the cab moving backwards.
  const newest = locations[locations.length - 1];
  const latitude = newest?.coords?.latitude;
  const longitude = newest?.coords?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return;

  // Intent is re-read on every batch rather than trusted from when the task
  // started. If the driver turned sharing off and the OS delivers one more
  // buffered batch, this is what stops a position being published after the
  // switch says OFF.
  const { wanted, uid: storedUid } = await readSharingIntent();
  if (!wanted) return;

  // The rules need a live token, not just a uid, so both are required: the stored
  // uid says which node, and Auth says we may write to it.
  const authedUid = await currentUid();
  const uid = storedUid || authedUid;
  if (!uid || !authedUid) {
    console.warn('[locationTask] no authenticated driver — dropping fix');
    return;
  }

  try {
    await updateMyLocation(uid, { latitude, longitude });
  } catch (e) {
    // Offline or refused. Nothing to usefully retry against — the next fix is
    // seconds away, and a gap shows as "last seen" rather than a wrong position.
    console.warn('[locationTask] write failed:', e?.message);
  }
});

// --- The controls AppContext calls -----------------------------------------

export async function isTaskRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

// Starts the OS-driven updates. The caller owns permissions — see
// startSharingLocation in AppContext — because the wording of a refusal belongs
// to the screen, not here.
export async function startBackgroundUpdates() {
  if (await isTaskRunning()) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    // The same cadence the foreground watcher used, so the freshness window and
    // the employee's LIVE badge behave identically on both paths.
    timeInterval: 3000,
    distanceInterval: 5,
    // ANDROID: without this the OS kills the service within minutes. The
    // notification is not decoration — it is the price of background location,
    // and it also means the driver can always see that the cab is being tracked.
    foregroundService: {
      notificationTitle: 'Sharing your location',
      notificationBody: 'Employees can see your cab while you are on a trip.',
      notificationColor: '#0129AC',
      // Don't leave a service running with nobody watching it.
      killServiceOnDestroy: true,
    },
    // iOS: stops the OS pausing updates while the driver waits at a gate, and
    // keeps the background indicator visible so tracking is never invisible.
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
  });
}

export async function stopBackgroundUpdates() {
  if (!(await isTaskRunning())) return;
  try {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch (e) {
    console.warn('[locationTask] could not stop updates:', e?.message);
  }
}
