// ---------------------------------------------------------------------------
// TrackMap (NATIVE placeholder) — Android/iOS version.
// The real native map uses `expo-maps` (Google Maps on Android, Apple Maps on
// iOS) and needs a custom dev build + your Google Maps API key. We wire that up
// in Stage 3. For now this shows the live coordinates so the screen still works
// if opened on a device.
// ---------------------------------------------------------------------------

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

export default function TrackMap({ latitude, longitude }) {
  const hasFix = typeof latitude === 'number' && typeof longitude === 'number';
  return (
    <View style={styles.map}>
      <Text variant="titleMedium">🗺️ Map on mobile — Stage 3</Text>
      <Text style={styles.coords}>
        {hasFix ? `Cab at ${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : 'Waiting for location…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
    minHeight: 320,
    borderRadius: 8,
    backgroundColor: '#E8EEF5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  coords: { marginTop: 8, opacity: 0.8 },
});
