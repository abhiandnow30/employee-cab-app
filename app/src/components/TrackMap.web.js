// ---------------------------------------------------------------------------
// TrackMap (WEB) — a live map for the browser.
// Uses Leaflet + OpenStreetMap tiles (free, no API key). Shows one marker for
// the cab and re-centers as the cab moves. On native we use a different file
// (TrackMap.native.js) — Metro picks the right one per platform automatically.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { loadLeaflet, addTileLayer, DEFAULT_CENTER } from './leaflet';
import { colors } from '../theme';

export default function TrackMap({ latitude, longitude, route, destination }) {
  const containerRef = useRef(null); // the DOM <div> Leaflet draws into
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const routeRef = useRef(null); // the route polyline
  const destRef = useRef(null); // the pickup/destination marker
  const [loadError, setLoadError] = useState('');

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const startLat = typeof latitude === 'number' ? latitude : DEFAULT_CENTER.latitude;
        const startLng = typeof longitude === 'number' ? longitude : DEFAULT_CENTER.longitude;
        const map = L.map(containerRef.current).setView([startLat, startLng], 15);
        addTileLayer(L, map);
        mapRef.current = map;
        // The container often has no size on first paint; nudge Leaflet to remeasure.
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

  // Draw / update the pickup (destination) marker.
  useEffect(() => {
    const L = window.L;
    if (!mapRef.current || !L || !destination) return;
    const pos = [destination.latitude, destination.longitude];
    if (!destRef.current) {
      // A distinct green pin for the pickup point.
      const icon = L.divIcon({
        className: '',
        html: '<div style="background:#2E7D32;width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 16],
      });
      destRef.current = L.marker(pos, { icon }).addTo(mapRef.current).bindPopup('Pickup');
    } else {
      destRef.current.setLatLng(pos);
    }
  }, [destination]);

  // Draw / update the route line, and fit the map to show the whole route.
  useEffect(() => {
    const L = window.L;
    if (!mapRef.current || !L) return;
    if (routeRef.current) {
      routeRef.current.remove();
      routeRef.current = null;
    }
    if (route && route.length > 1) {
      routeRef.current = L.polyline(route, { color: '#1565C0', weight: 5, opacity: 0.75 }).addTo(
        mapRef.current
      );
      mapRef.current.fitBounds(routeRef.current.getBounds(), { padding: [40, 40] });
    }
  }, [route]);

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
  map: { flex: 1, minHeight: 320, borderRadius: 8, overflow: 'hidden' },
  fallback: { backgroundColor: '#E8EEF5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  fallbackText: { color: colors.muted, textAlign: 'center' },
});
