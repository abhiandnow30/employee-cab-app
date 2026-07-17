// ---------------------------------------------------------------------------
// LocationPicker (WEB) — a small map to set an exact location by pin.
// Tap anywhere on the map (or drag the pin) to choose a spot; the coordinates
// are reported via onChange({ latitude, longitude }). Uses free OpenStreetMap.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

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

export default function LocationPicker({ value, onChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Create the map + draggable marker once.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const lat = value?.latitude ?? 17.44;
      const lng = value?.longitude ?? 78.3489;
      const map = L.map(containerRef.current).setView([lat, lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onChangeRef.current({ latitude: p.lat, longitude: p.lng });
      });
      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        onChangeRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng });
      });
      mapRef.current = map;
      markerRef.current = marker;
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

  // Reflect an externally-set value (e.g. "use my current location").
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !value) return;
    const pos = [value.latitude, value.longitude];
    markerRef.current.setLatLng(pos);
    mapRef.current.panTo(pos);
  }, [value?.latitude, value?.longitude]);

  return <View ref={containerRef} style={styles.map} />;
}

const styles = StyleSheet.create({
  map: { height: 240, borderRadius: 8, overflow: 'hidden' },
});
