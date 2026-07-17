// ---------------------------------------------------------------------------
// LocationPicker (NATIVE placeholder)
// The interactive map picker needs expo-maps + a dev build (Stage 4d). On the
// phone for now, employees set their location with "Use my current location"
// (handled in the Profile screen); this just shows the chosen coordinates.
// ---------------------------------------------------------------------------

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

export default function LocationPicker({ value }) {
  return (
    <View style={styles.box}>
      <Text variant="bodyMedium">📍 Map picker (mobile) coming with the app build.</Text>
      <Text style={styles.coords}>
        {value ? `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}` : 'No location set yet'}
      </Text>
      <Text variant="bodySmall" style={styles.hint}>
        Use "Use my current location" below to set it.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 240,
    borderRadius: 8,
    backgroundColor: '#E8EEF5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  coords: { marginTop: 8, fontWeight: 'bold' },
  hint: { marginTop: 6, opacity: 0.7 },
});
