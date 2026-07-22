// ---------------------------------------------------------------------------
// GEOCODING SERVICE
// Turns a typed address into map coordinates using the FREE OpenStreetMap
// Nominatim service (no API key, no billing). Used by the pickup-location
// search box so employees can type their address and drop the pin there.
//
// Nominatim etiquette: light use only (≈1 request/second). Fine for a person
// occasionally setting their home; not for bulk lookups.
// ---------------------------------------------------------------------------

export async function searchAddress(query) {
  const q = (query || '').trim();
  if (!q) return null;
  // Bias to India (countrycodes=in) and prefer English names so local queries
  // like "Kondapur, Hyderabad, 500084" resolve reliably.
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0` +
    `&countrycodes=in&accept-language=en&q=` +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Address lookup failed. Please try again.');
  const data = await res.json();
  if (!data.length) return null;
  const r = data[0];
  return {
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
    displayName: r.display_name,
  };
}

// Locate an address from its structured parts. OpenStreetMap rarely knows
// individual buildings/apartments (Google does, but its web service can't be
// called from a browser), so we try progressively broader queries and return
// the first hit. `relaxed` is true when we had to drop the specific street/
// building line — the caller can then ask the user to nudge the pin.
export async function geocodeParts({ line1, area, city, pincode } = {}) {
  const clean = (s) => (s || '').trim();
  const l1 = clean(line1);
  const ar = clean(area);
  const ci = clean(city);
  const pin = clean(pincode);

  // Most specific → broadest. Each entry: [parts, relaxed?].
  const candidates = [
    [[l1, ar, ci, pin], false], // full address as typed
    [[ar, ci, pin], true], // drop the building/street line
    [[ar, pin], true], // area + pincode
    [[ci, pin], true], // city + pincode
    [[pin], true], // pincode centroid
    [[ar, ci], true], // area + city (no pincode)
  ];

  const seen = new Set();
  for (const [parts, relaxed] of candidates) {
    const query = parts.filter(Boolean).join(', ');
    if (!query || seen.has(query)) continue;
    seen.add(query);
    const hit = await searchAddress(query);
    if (hit) return { ...hit, relaxed, query };
  }
  return null;
}

// Reverse geocoding: turn a map pin (lat/lng) into a readable address, so the
// employee can confirm the pin is at the right place. Also returns the broken-
// out parts so we can offer to auto-fill the address fields.
export async function reverseGeocode(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1` +
    `&lat=${latitude}&lon=${longitude}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Could not look up that location.');
  const data = await res.json();
  if (!data || !data.address) return null;
  const a = data.address;
  return {
    displayName: data.display_name || '',
    line1: [a.house_number, a.road].filter(Boolean).join(', '),
    area: a.suburb || a.neighbourhood || a.village || a.hamlet || '',
    city: a.city || a.town || a.municipality || a.county || a.state_district || '',
    pincode: a.postcode || '',
  };
}
