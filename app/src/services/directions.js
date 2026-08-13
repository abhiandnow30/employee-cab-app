// ---------------------------------------------------------------------------
// DIRECTIONS SERVICE
// Given the cab's current location and the pickup point, returns the driving
// route + ETA + distance for the Track Cab screen.
//
// WEB routing uses OSRM (free, no key, allows browser calls). We do NOT use the
// Google Directions REST API on web because Google blocks browser (CORS) calls
// to it — Google's key is instead used on the phone in Stage 4d. If OSRM is
// unreachable, refuses, or is simply too slow (see ROUTE_TIMEOUT_MS) we fall back
// to a straight-line estimate so the UI still works. The fallback marks itself
// `source: 'estimate'`, which is what puts "(approx)" next to the ETA — a rough
// number the rider can see is rough beats a spinner that never resolves.
//
// Returns: { durationSec, distanceMeters, coordinates: [[lat,lng]...], source }
// ---------------------------------------------------------------------------

// The company office — a FIXED location. All "Home → Office" trips route here.
// Vamsiram Jyothi Granules, Tower 2, Kondapur, Hyderabad 500084.
// (Approx. Kondapur coordinates; for the exact building spot, replace with the
//  lat,lng from Google Maps → right-click the building → copy.)
export const OFFICE = {
  latitude: 17.4588,
  longitude: 78.3731,
  label: 'Office — Vamsiram Jyothi Granules, Kondapur',
};

// A home record that can actually be routed to, or null.
//
// A profile can hold an address as TEXT with no pin dropped on it — enough to
// print on a driver's trip sheet, not enough to compute a route to. Both halves
// have to be real numbers before this counts as a location.
function homePin(home) {
  return home &&
    typeof home.latitude === 'number' &&
    typeof home.longitude === 'number'
    ? home
    : null;
}

// Where the cab is heading for a given trip:
//   • Home → Office  → the fixed office, which is always known
//   • Office → Home  → the employee's saved home pin, or NULL if they have none
//
// It returns null rather than guessing, and that is the whole point of this
// function. There used to be a fallback chain here: no home pin → look the
// pickup AREA name up in a four-entry table of demo coordinates → and anything
// not in that table → Gachibowli. So an employee living in Kukatpally with no
// pin on file was shown "Reaching your drop in 18 min" for a journey to a suburb
// they have nothing to do with, with no hint the number was about somewhere
// else. And this was the NORMAL case, not an edge one: roster-generated bookings
// carry employeeHome: null by construction (see bookingFromRide in rides.js) and
// every ride in this company comes from the roster.
//
// A missing ETA is a gap the rider can see and work around. A confident wrong
// one is a gap they can't.
//
// `pickupName` is no longer read — it is kept so the call signature doesn't
// change, and named here as what it was: the input that produced the wrong
// answer.
// eslint-disable-next-line no-unused-vars
export function tripDestination(direction, employeeHome, pickupName) {
  if (direction === 'Office → Home') {
    return homePin(employeeHome);
  }
  return OFFICE; // Home → Office (and any other case)
}

// Readable address for the employee's home. The home pin saved on the profile
// has shape { latitude, longitude, line1, area, city, pincode, landmark,
// displayName }; we prefer its `displayName`, then a composed street address,
// then the address typed at sign-up. Returns '' if nothing is on file.
export function homeLabel(booking) {
  const h = booking?.employeeHome;
  if (h) {
    if (h.displayName) return h.displayName;
    const parts = [h.line1, h.area, h.city, h.pincode].filter(Boolean);
    if (parts.length) return parts.join(', ');
    if (h.label) return h.label; // legacy/seed shape
  }
  return (booking?.employeeAddress || '').trim();
}

// Where the DRIVER collects the employee for this trip (the pickup point):
//   • Home → Office  → the employee's home
//   • Office → Home  → the fixed office
// Returns { coords, label }. `coords` may be null if we only know an address
// string — openDirections() then falls back to a text search.
export function tripPickupPoint(booking) {
  if (booking?.direction === 'Office → Home') {
    return { coords: OFFICE, label: OFFICE.label };
  }
  return {
    // Same test as the drop side — a longitude of undefined routes as readily
    // as a missing home does, which is to say not at all.
    coords: homePin(booking?.employeeHome),
    label: homeLabel(booking) || 'Employee home',
  };
}

// Human-readable PICKUP and DROP labels for a booking. Resolves the generic
// word "Home" to the employee's real address so the driver knows where to go:
//   • Home → Office → pickup = employee's home,   drop = office
//   • Office → Home → pickup = office,             drop = employee's home
export function tripPlaceLabels(booking) {
  const home = homeLabel(booking) || 'Home (address not set)';
  const officeLabel = booking?.officeLocation || OFFICE.label;
  return booking?.direction === 'Office → Home'
    ? { pickup: officeLabel, drop: home }
    : { pickup: home, drop: officeLabel };
}

// Straight-line distance in metres between two {latitude, longitude} points.
export function distanceMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// How long to wait for OSRM before giving up and estimating instead.
//
// This is a PUBLIC demo server with no uptime promise, and `fetch` has no
// timeout of its own — a request that hangs hangs until the platform gives up,
// which on some networks is a minute or more. Track Cab asks for a fresh route
// about every 8 seconds, so anything slower than that has already been overtaken
// by the next attempt; 6s leaves room for a slow-but-working reply while
// guaranteeing the screen gets *some* answer before it asks again. A late reply
// isn't worth waiting for — it describes where the cab was, not where it is.
export const ROUTE_TIMEOUT_MS = 6000;

async function osrmRoute(origin, dest) {
  // OSRM wants lng,lat order.
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.longitude},${origin.latitude};${dest.longitude},${dest.latitude}` +
    `?overview=full&geometries=geojson`;

  // Abort rather than merely stop waiting: an un-aborted request holds its
  // connection and still delivers a reply nobody wants, and this is a screen
  // that fires one every few seconds.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  try {
    // The whole exchange is inside the timeout, not just the fetch. Headers can
    // arrive promptly and the body then stall — reading it is a second wait, and
    // an unbounded one if the timer is cleared as soon as `fetch` resolves.
    const res = await fetch(url, { signal: controller.signal });
    // A 5xx or a rate-limit reply is not a route. Left unchecked, the body is
    // parsed as JSON anyway and fails in a less obvious way.
    if (!res.ok) throw new Error(`routing service returned ${res.status}`);
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) throw new Error('no route');
    const r = json.routes[0];
    return {
      durationSec: r.duration,
      distanceMeters: r.distance,
      coordinates: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      source: 'osrm',
    };
  } finally {
    // Every outcome — replied, refused, timed out — so a finished request never
    // leaves a timer running behind it.
    clearTimeout(timer);
  }
}

// Rough fallback: straight line + city-average speed (~22 km/h).
function estimateRoute(origin, dest) {
  const d = distanceMeters(origin, dest);
  return {
    durationSec: d / (22000 / 3600),
    distanceMeters: d,
    coordinates: [
      [origin.latitude, origin.longitude],
      [dest.latitude, dest.longitude],
    ],
    source: 'estimate',
  };
}

// Always resolves, and within ROUTE_TIMEOUT_MS: unreachable, refused, malformed
// and too-slow all land on the estimate. Callers can rely on getting an answer,
// so a caller that shows "Calculating…" until this returns is never stuck there.
export async function getRoute(origin, dest) {
  try {
    return await osrmRoute(origin, dest);
  } catch {
    return estimateRoute(origin, dest);
  }
}

export function formatEta(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  return `${min} min`;
}

export function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
