// ---------------------------------------------------------------------------
// TrackMap (WEB) — a live map for the browser.
// Uses Leaflet + OpenStreetMap tiles (free, no API key). Shows one marker for
// the cab and re-centers as the cab moves. On native we use a different file
// (TrackMap.native.js) — Metro picks the right one per platform automatically.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

// Load Leaflet's script + stylesheet once, then resolve with window.L.
function loadLeaflet() {
  return new Promise((resolve) => {
    if (window.L) return resolve(window.L);

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    let script = document.getElementById('leaflet-js');
    if (!script) {
      script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = LEAFLET_JS;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => resolve(window.L));
    if (window.L) resolve(window.L);
  });
}

export default function TrackMap({ latitude, longitude, route, destination }) {
  const containerRef = useRef(null); // the DOM <div> Leaflet draws into
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const routeRef = useRef(null); // the route polyline
  const destRef = useRef(null); // the pickup/destination marker

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const startLat = typeof latitude === 'number' ? latitude : 17.44;
      const startLng = typeof longitude === 'number' ? longitude : 78.3489;
      const map = L.map(containerRef.current).setView([startLat, startLng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      // The container often has no size on first paint; nudge Leaflet to remeasure.
      setTimeout(() => map.invalidateSize(), 200);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the marker whenever a new location arrives.
  useEffect(() => {
    const L = window.L;
    if (!mapRef.current || !L || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return;
    }
    const pos = [latitude, longitude];
    if (!markerRef.current) {
      markerRef.current = L.marker(pos).addTo(mapRef.current).bindPopup('Your cab');
    } else {
      markerRef.current.setLatLng(pos);
    }
    mapRef.current.panTo(pos);
  }, [latitude, longitude]);

  return <View ref={containerRef} style={styles.map} />;
}

const styles = StyleSheet.create({
  map: { flex: 1, minHeight: 320, borderRadius: 8, overflow: 'hidden' },
});
