// ---------------------------------------------------------------------------
// FleetMap (NATIVE fallback) — the multi-cab admin map is a web feature.
// On a phone we show a simple placeholder instead of the Leaflet map so native
// builds keep working. (Admins use the web dashboard for live fleet tracking.)
// ---------------------------------------------------------------------------

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme';

export default function FleetMap({ cabs = [] }) {
  const located = cabs.filter(
    (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number'
  );
  return (
    <View style={styles.wrap}>
      <MaterialCommunityIcons name="map-marker-radius" size={44} color={colors.muted} />
      <Text variant="titleMedium" style={styles.title}>
        {located.length} cab{located.length === 1 ? '' : 's'} sharing location
      </Text>
      <Text variant="bodySmall" style={styles.body}>
        The live fleet map opens on the web dashboard.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EEF2F8',
    borderRadius: 8,
    padding: 24,
  },
  title: { marginTop: 6 },
  body: { color: colors.muted, textAlign: 'center' },
});
