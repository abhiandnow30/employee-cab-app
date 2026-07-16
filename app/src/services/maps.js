// ---------------------------------------------------------------------------
// MAPS CONFIG
// One place the whole app reads the Google Maps API key from. The value comes
// from the .env file (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) — never hard-coded here.
//
// Used by: ETA/Directions (Stage 4c) and the native phone map (Stage 4d).
// The web map uses free OpenStreetMap and does NOT need this key.
// ---------------------------------------------------------------------------

export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Handy flag so screens can show a friendly message if the key is missing.
export const hasGoogleMapsKey = GOOGLE_MAPS_API_KEY.length > 0;
