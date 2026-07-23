// ---------------------------------------------------------------------------
// DIRECTIONS SERVICE
// Given the cab's current location and the pickup point, returns the driving
// route + ETA + distance for the Track Cab screen.
//
// WEB routing uses OSRM (free, no key, allows browser calls). We do NOT use the
// Google Directions REST API on web because Google blocks browser (CORS) calls
// to it — Google's key is instead used on the phone in Stage 4d. If OSRM is
// unreachable we fall back to a straight-line estimate so the UI still works.
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

// Fallback pickup coords for demo pickup names, used only if an employee hasn't
// set their exact home location in their profile yet.
const PICKUP_COORDS = {
  gachibowli: { latitude: 17.44, longitude: 78.3489 },
  'hitec city': { latitude: 17.4435, longitude: 78.3772 },
  kondapur: { latitude: 17.4615, longitude: 78.3521 },
  madhapur: { latitude: 17.4483, longitude: 78.3915 },
};
const DEFAULT_DEST = { latitude: 17.44, longitude: 78.3489 }; // Gachibowli

// Turn a pickup name (e.g. "Gachibowli") into coordinates.
export function resolvePickup(name) {
  if (!name) return DEFAULT_DEST;
  return PICKUP_COORDS[name.trim().toLowerCase()] || DEFAULT_DEST;
}

// Where the cab is heading for a given trip:
//   • Home → Office  → the fixed office
//   • Office → Home  → the employee's saved home (falls back to pickup area)
export function tripDestination(direction, employeeHome, pickupName) {
  if (direction === 'Office → Home') {
    return employeeHome || resolvePickup(pickupName);
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
  const home = booking?.employeeHome;
  const hasCoords = home && typeof home.latitude === 'number';
  return {
    coords: hasCoords ? home : null,
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

async function osrmRoute(origin, dest) {
  // OSRM wants lng,lat order.
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.longitude},${origin.latitude};${dest.longitude},${dest.latitude}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error('no route');
  const r = json.routes[0];
  return {
    durationSec: r.duration,
    distanceMeters: r.distance,
    coordinates: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    source: 'osrm',
  };
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
