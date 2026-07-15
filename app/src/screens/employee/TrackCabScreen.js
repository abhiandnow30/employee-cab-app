// ---------------------------------------------------------------------------
// TRACK CAB
// Shows the employee where their cab is, live. It subscribes to the cab's
// location in Firebase (via the tracking service) and updates the map + the
// info card every time a new position arrives — no refresh needed.
//
// Which cab? We track the cab assigned to the employee's first active booking;
// if none is assigned yet, we fall back to a demo cab ('c1') so there's always
// something to watch during development.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Card, Chip, Button } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { subscribeCabLocation } from '../../services/tracking';
import TrackMap from '../../components/TrackMap';

const DEMO_CAB_ID = 'c1'; // used when no cab is assigned yet

export default function TrackCabScreen({ navigation }) {
  const { myActiveBookings, getCabById } = useApp();

  // Pick the cab to track.
  const activeWithCab = myActiveBookings().find((b) => b.assignedCabId);
  const cabId = activeWithCab?.assignedCabId || DEMO_CAB_ID;
  const cab = getCabById(cabId);

  const [location, setLocation] = useState(null); // { latitude, longitude, updatedAt }

  useEffect(() => {
    // Start listening; clean up when leaving the screen or switching cabs.
    const unsubscribe = subscribeCabLocation(cabId, setLocation);
    return unsubscribe;
  }, [cabId]);

  const isLive = !!location;

  return (
    <View style={styles.container}>
      <Card style={styles.infoCard} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{cab?.cabNumber || 'Cab'}</Text>
            <Chip
              compact
              icon={isLive ? 'circle' : 'circle-outline'}
              style={{ backgroundColor: isLive ? '#E8F5E9' : '#FFF3E0' }}
              textStyle={{ color: isLive ? '#2E7D32' : '#E65100', fontSize: 12 }}
            >
              {isLive ? 'LIVE' : 'Waiting…'}
            </Chip>
          </View>
          <Text variant="bodyMedium" style={styles.detail}>
            Driver: {cab?.driverName || '—'} · {cab?.driverPhone || '—'}
          </Text>
          {location ? (
            <Text variant="bodySmall" style={styles.coords}>
              Position: {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
            </Text>
          ) : (
            <Text variant="bodySmall" style={styles.coords}>
              No location yet. Start the Driver (demo) screen to see the cab move.
            </Text>
          )}
        </Card.Content>
      </Card>

      <View style={styles.mapWrap}>
        <TrackMap latitude={location?.latitude} longitude={location?.longitude} />
      </View>

      <Button
        mode="contained"
        icon="home"
        style={styles.homeBtn}
        onPress={() => navigation.navigate('EmployeeHome')}
      >
        Back to Home
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  infoCard: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  detail: { opacity: 0.85 },
  coords: { opacity: 0.7, marginTop: 4 },
  mapWrap: { flex: 1 },
  homeBtn: { marginTop: 12, paddingVertical: 4 },
});
