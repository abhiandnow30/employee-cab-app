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

// Known demo pickup points → coordinates. (Real bookings would store coords or
// be geocoded; this keeps the demo working without an extra API.)
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
