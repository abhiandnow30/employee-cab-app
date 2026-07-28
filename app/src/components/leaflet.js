// ---------------------------------------------------------------------------
// LEAFLET LOADER  (web only)
// The three web maps (TrackMap, FleetMap, and anything added later) all need
// Leaflet + OpenStreetMap. This is the single place that loads it.
//
//   • Loads the script/stylesheet ONCE, no matter how many maps mount.
//   • Pins the version and checks it with Subresource Integrity, so a
//     compromised or swapped CDN file is rejected by the browser rather than
//     executed with full access to the page.
//   • REJECTS if the CDN is unreachable, so a map can show "map unavailable"
//     instead of a blank box that waits forever.
// ---------------------------------------------------------------------------

const VERSION = '1.9.4';
const LEAFLET_JS = `https://unpkg.com/leaflet@${VERSION}/dist/leaflet.js`;
const LEAFLET_CSS = `https://unpkg.com/leaflet@${VERSION}/dist/leaflet.css`;
// Official Leaflet 1.9.4 SRI digests.
const JS_INTEGRITY = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const CSS_INTEGRITY = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';

// The fallback map centre (Kondapur / Hyderabad — where the office is) used by
// every map before the first real coordinate arrives.
export const DEFAULT_CENTER = { latitude: 17.4588, longitude: 78.3731 };

let loader = null; // the single in-flight / resolved load

export function loadLeaflet() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Leaflet is only available on the web.'));
  }
  if (window.L) return Promise.resolve(window.L);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      link.integrity = CSS_INTEGRITY;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }

    let script = document.getElementById('leaflet-js');
    if (!script) {
      script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = LEAFLET_JS;
      script.integrity = JS_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.async = true;
      document.head.appendChild(script);
    }

    if (window.L) {
      resolve(window.L);
      return;
    }
    script.addEventListener('load', () => {
      if (window.L) resolve(window.L);
      else reject(new Error('Map library loaded but did not initialise.'));
    });
    script.addEventListener('error', () => {
      loader = null; // let a later mount retry
      script.remove();
      reject(new Error('Could not load the map library. Check your connection.'));
    });
  });

  return loader;
}

// The OpenStreetMap tile layer every map uses.
export function addTileLayer(L, map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
}
