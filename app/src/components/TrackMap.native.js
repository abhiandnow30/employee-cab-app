// ---------------------------------------------------------------------------
// TrackMap (NATIVE) — one cab, live, on a real map.
//
// Replaces the "🗺️ Map on mobile — Stage 3" placeholder that printed coordinates.
//
// SAME PROPS, SAME MEANING as TrackMap.web.js — Metro picks one file per platform,
// so the two have to be interchangeable from the screen's point of view:
//   latitude / longitude   the cab's current position (undefined until a first fix)
//   route                  OSRM polyline to draw, or null when the fix is stale
//   destination            the pickup/drop pin, { latitude, longitude }
// The screen decides all of that (see TrackCabScreen) and NOTHING about the live /
// stale / no-fix logic is duplicated here. This file only draws.
//
// PROVIDER. react-native-maps: Google Maps on Android, Apple Maps on iOS. Apple
// Maps needs no key; Android reads the key injected by app.config.js. Chosen over
// expo-maps because the SDK 57 docs list expo-maps as ALPHA with frequent breaking
// changes, which is not what a driver-facing production screen should sit on.
//
// NEEDS A DEVELOPMENT BUILD for the Android key to be present. The component itself
// renders in Expo Go; a blank grey Android map means the key didn't reach the build.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DEFAULT_CENTER } from './leaflet';
import { colors } from '../theme';

// Tight enough to see which road the cab is on. Matches the web map's zoom 15.
const SPAN = 0.01;

export default function TrackMap({ latitude, longitude, route, destination }) {
  const mapRef = useRef(null);
  const hasFix = typeof latitude === 'number' && typeof longitude === 'number';

  // Follow the cab as new fixes arrive. animateCamera rather than a re-render with
  // a new `region`, so the marker glides instead of the map jumping — and so the
  // rider can pan away without being dragged back on every update.
  useEffect(() => {
    if (!hasFix || !mapRef.current) return;
    mapRef.current.animateCamera({ center: { latitude, longitude } }, { duration: 600 });
  }, [latitude, longitude, hasFix]);

  // With a route drawn, show the whole thing — a cab-centred camera hides where it
  // is heading, which is the question the map is being asked.
  useEffect(() => {
    if (!mapRef.current || !route || route.length < 2) return;
    mapRef.current.fitToCoordinates(route, {
      edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
      animated: true,
    });
  }, [route]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: hasFix ? latitude : DEFAULT_CENTER.latitude,
          longitude: hasFix ? longitude : DEFAULT_CENTER.longitude,
          latitudeDelta: SPAN,
          longitudeDelta: SPAN,
        }}
        // The rider is watching a cab, not surveying a city.
        showsPointsOfInterest={false}
        toolbarEnabled={false}
      >
        {hasFix ? (
          <Marker
            coordinate={{ latitude, longitude }}
            title="Your cab"
            pinColor={colors.primary}
            // Redraws in place instead of being torn down and re-added on every
            // fix, which is what makes the movement smooth on Android.
            tracksViewChanges={false}
          />
        ) : null}

        {destination ? (
          <Marker
            coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
            title="Pickup"
            pinColor={colors.success}
            tracksViewChanges={false}
          />
        ) : null}

        {route && route.length > 1 ? (
          <Polyline coordinates={route} strokeWidth={4} strokeColor={colors.primary} />
        ) : null}
      </MapView>

      {/* NO FIX YET is a state of its own, and it must not look like a map of
          nowhere. The screen above already says whether the cab is LIVE, stale or
          not sharing; this only covers "there is nothing to draw". */}
      {!hasFix ? (
        <View style={styles.overlay} pointerEvents="none">
          <MaterialCommunityIcons name="crosshairs-question" size={30} color={colors.muted} />
          <Text variant="bodyMedium" style={styles.overlayText}>
            Waiting for the cab's location…
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
    gap: 8,
    backgroundColor: 'rgba(238,242,248,0.92)',
    padding: 16,
  },
  overlayText: { color: colors.muted, textAlign: 'center' },
});
