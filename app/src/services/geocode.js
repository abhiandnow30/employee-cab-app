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
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q=` +
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
