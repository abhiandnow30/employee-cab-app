// ---------------------------------------------------------------------------
// BACKGROUND LOCATION TASK — WEB STUB
//
// There is no background location in a browser. `expo-task-manager` has no web
// implementation, and a hidden tab gets throttled and then suspended, so nothing
// here can honestly promise to keep publishing.
//
// This file exists because Metro resolves `require('../services/locationTask')`
// STATICALLY — even inside an `if (Platform.OS !== 'web')` branch — so without a
// web sibling the native module (and its module-scope TaskManager.defineTask) was
// being bundled into the browser build. Verified: the task name string appeared in
// dist/_expo/static/js/web/index-*.js. It never ran, but shipping it was luck
// rather than design. Same `*.web.js` / `*.native.js` split the maps use.
//
// AppContext still guards every call with Platform.OS; these no-ops are the second
// layer, so a future caller that forgets the guard degrades to foreground-only web
// tracking instead of throwing at load.
// ---------------------------------------------------------------------------

export const LOCATION_TASK = 'cab-service-driver-location';

// The driver's intent is only persisted for the resume-after-restart path, which is
// native-only (a browser reload re-runs the whole app and the driver is looking at
// it). Reporting "not wanted" keeps that effect a no-op on web.
export async function readSharingIntent() {
  return { wanted: false, uid: null };
}

export async function rememberSharingDriver() {}
export async function forgetSharingDriver() {}
export async function isTaskRunning() {
  return false;
}
export async function startBackgroundUpdates() {}
export async function stopBackgroundUpdates() {}
