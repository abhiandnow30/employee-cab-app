// ---------------------------------------------------------------------------
// FleetMap (NATIVE) — every sharing cab on one map, for the desk.
//
// Replaces the placeholder that printed "N cabs sharing location" with no map.
//
// SAME PROP AS FleetMap.web.js, item for item, because Metro swaps the file per
// platform and TrackCabsScreen must not care which it got:
//   cabs: [{ id, latitude, longitude, label, sub }]
// The screen builds that list, decides which cabs are live, and owns the per-cab
// status rows underneath (see TrackCabsScreen). This file only draws pins.
//
// PROVIDER. react-native-maps — Google Maps on Android (key injected by
// app.config.js), Apple Maps on iOS (no key). Same choice and same reasoning as
// TrackMap.native.js.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DEFAULT_CENTER } from './leaflet';
import { colors } from '../theme';

// Wide enough to hold a city's worth of cabs before any fitting happens.
const SPAN = 0.08;

export default function FleetMap({ cabs = [] }) {
  const mapRef = useRef(null);
  const located = cabs.filter(
    (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number'
  );
  // The set of cabs on screen, as a string — so the camera refits when a cab joins
  // or drops out, but NOT on every position update. Refitting on movement would
  // make the map lurch every three seconds with a dozen cabs reporting.
  const shape = located.map((c) => c.id).sort().join(',');

  useEffect(() => {
    if (!mapRef.current || !located.length) return;
    if (located.length === 1) {
      mapRef.current.animateCamera(
        { center: { latitude: located[0].latitude, longitude: located[0].longitude }, zoom: 14 },
        { duration: 600 }
      );
      return;
    }
    mapRef.current.fitToCoordinates(
      located.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }
    );
    // `shape` is the dependency, not `located` — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: located[0]?.latitude ?? DEFAULT_CENTER.latitude,
          longitude: located[0]?.longitude ?? DEFAULT_CENTER.longitude,
          latitudeDelta: SPAN,
          longitudeDelta: SPAN,
        }}
        showsPointsOfInterest={false}
        toolbarEnabled={false}
      >
        {located.map((c) => (
          <Marker
            key={c.id}
            coordinate={{ latitude: c.latitude, longitude: c.longitude }}
            title={c.label || 'Cab'}
            description={c.sub || undefined}
            pinColor={colors.primary}
            tracksViewChanges={false}
          />
        ))}
      </MapView>

      {/* EMPTY IS NOT AN ERROR. "No cab is sharing" is a normal state between runs,
          and the desk needs to be able to tell it apart from a map that failed. */}
      {located.length === 0 ? (
        <View style={styles.overlay} pointerEvents="none">
          <MaterialCommunityIcons name="map-marker-off-outline" size={34} color={colors.muted} />
          <Text variant="titleSmall" style={styles.overlayText}>
            No cab is sharing location
          </Text>
          <Text variant="bodySmall" style={styles.overlayHint}>
            Pins appear here as drivers turn location sharing on.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', borderRadius: 8, backgroundColor: colors.background },
  map: { ...StyleSheet.absoluteFillObject },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(238,242,248,0.92)',
    padding: 16,
  },
  overlayText: { color: colors.text },
  overlayHint: { color: colors.muted, textAlign: 'center', maxWidth: 280 },
});
