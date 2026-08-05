// ---------------------------------------------------------------------------
// FleetMap (WEB) — one live map showing MANY cabs at once (admin tracking).
// Leaflet + OpenStreetMap (free, no key). Each cab is a labelled marker that
// moves as new positions arrive; the map fits all cabs into view when the set
// of tracked cabs changes. On native we use FleetMap.native.js instead.
//
// Props: cabs = [{ id, latitude, longitude, label, sub }]
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { loadLeaflet, addTileLayer, DEFAULT_CENTER } from './leaflet';
import { colors } from '../theme';

// A blue pin with a car glyph + the cab label underneath.
function cabIcon(L, label) {
  return L.divIcon({
    className: '',
    html:
      `<div style="display:flex;flex-direction:column;align-items:center">` +
      `<div style="background:${colors.primary};color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;` +
      `transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);` +
      `display:flex;align-items:center;justify-content:center">` +
      `<span style="transform:rotate(45deg);font-size:13px">🚕</span></div>` +
      `<span style="margin-top:2px;background:#fff;padding:1px 5px;border-radius:6px;font-size:11px;` +
      `font-weight:600;color:${colors.primaryDark};box-shadow:0 1px 3px rgba(0,0,0,.25);white-space:nowrap">${label}</span>` +
      `</div>`,
    iconSize: [26, 42],
    iconAnchor: [13, 26],
  });
}

export default function FleetMap({ cabs = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({}); // cabId -> Leaflet marker
  const prevCountRef = useRef(0);
  const [loadError, setLoadError] = useState('');

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current).setView(
          [DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude],
          12
        );
        addTileLayer(L, map);
        mapRef.current = map;
        setTimeout(() => map.invalidateSize(), 200);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current = {};
      }
    };
  }, []);

  // Sync markers whenever the cab positions change.
  useEffect(() => {
    const L = window.L;
    if (!mapRef.current || !L) return;
    const markers = markersRef.current;
    const seen = new Set();

    cabs.forEach((c) => {
      if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return;
      seen.add(c.id);
      const pos = [c.latitude, c.longitude];
      const popup = `<b>${c.label || 'Cab'}</b><br/>${c.sub || ''}`;
      if (!markers[c.id]) {
        markers[c.id] = L.marker(pos, { icon: cabIcon(L, c.label || 'Cab') })
          .addTo(mapRef.current)
          .bindPopup(popup);
      } else {
        markers[c.id].setLatLng(pos).setPopupContent(popup);
      }
    });

    // Remove markers for cabs no longer present / located.
    Object.keys(markers).forEach((id) => {
      if (!seen.has(id)) {
        markers[id].remove();
        delete markers[id];
      }
    });

    // Fit all cabs into view when the number of located cabs changes (not on
    // every position tick, so the map doesn't constantly re-zoom).
    const ids = Object.keys(markers);
    if (ids.length && ids.length !== prevCountRef.current) {
      const group = L.featureGroup(ids.map((id) => markers[id]));
      mapRef.current.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15 });
    }
    prevCountRef.current = ids.length;
  }, [cabs]);

  // The map library itself couldn't load — say so instead of showing an empty box.
  if (loadError) {
    return (
      <View style={[styles.map, styles.fallback]}>
        <Text variant="bodyMedium" style={styles.fallbackText}>
          {loadError}
        </Text>
      </View>
    );
  }

  return <View ref={containerRef} style={styles.map} />;
}

const styles = StyleSheet.create({
  map: { flex: 1, minHeight: 360, borderRadius: 8, overflow: 'hidden' },
  fallback: { backgroundColor: '#E8EEF5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  fallbackText: { color: colors.muted, textAlign: 'center' },
});
