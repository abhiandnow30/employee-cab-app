// ---------------------------------------------------------------------------
// DRIVER — SHARE LIVE LOCATION
// Streams this device's location (phone GPS, or browser location on web) to the
// driver's assigned cab, so employees tracking that cab see it move in real time.
//
// The actual GPS watcher lives in AppContext (startSharingLocation /
// stopSharingLocation) so sharing KEEPS RUNNING when the driver leaves this
// screen — the dashboard shows a live "Sharing" indicator based on that state.
// This screen is just the control panel for it.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { colors } from '../../theme';
import ScreenContainer from '../../components/ScreenContainer';

export default function DriverShareLocationScreen({ navigation }) {
  const {
    currentUser,
    getCabById,
    sharingLocation,
    sharingCoords,
    sharingError,
    startSharingLocation,
    stopSharingLocation,
  } = useApp();
  const cabId = currentUser?.cabId;
  const cab = cabId ? getCabById(cabId) : null;

  const [busy, setBusy] = useState(false); // requesting permission / starting
  const [denied, setDenied] = useState(false);

  async function handleStart() {
    setBusy(true);
    setDenied(false);
    const res = await startSharingLocation();
    if (res?.denied) setDenied(true);
    setBusy(false);
  }

  const sharing = sharingLocation;

  return (
    <ScreenContainer scroll>
      <Card mode="outlined">
        <Card.Content>
          <Text variant="titleMedium">Share live location</Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {cab ? `Broadcasting for cab ${cab.cabNumber}.` : 'No cab linked.'} Employees
            assigned to your cab will see you move in real time. Sharing keeps
            running while you use the rest of the app.
          </Text>

          <Text variant="bodyLarge" style={styles.status}>
            {sharing
              ? '🟢 Sharing live location'
              : busy
                ? 'Requesting permission…'
                : denied
                  ? '⛔ Location permission denied'
                  : sharingError
                    ? '⚠️ Error'
                    : 'Not sharing'}
          </Text>

          {sharingCoords && (
            <Text variant="bodySmall" style={styles.coords}>
              {sharingCoords.latitude.toFixed(5)}, {sharingCoords.longitude.toFixed(5)}
            </Text>
          )}
          {denied && (
            <Text variant="bodySmall" style={styles.help}>
              Enable location access for the app in your device settings, then try again.
            </Text>
          )}
          {!!sharingError && !denied && (
            <Text variant="bodySmall" style={styles.help}>
              {sharingError}
            </Text>
          )}

          <View style={styles.buttons}>
            <Button
              mode="contained"
              icon="crosshairs-gps"
              onPress={handleStart}
              disabled={sharing || busy}
              style={styles.btn}
            >
              Start sharing
            </Button>
            <Button
              mode="outlined"
              icon="stop"
              onPress={stopSharingLocation}
              disabled={!sharing}
              style={styles.btn}
            >
              Stop
            </Button>
          </View>

          {Platform.OS === 'web' && (
            <Text variant="bodySmall" style={styles.help}>
              Note: on a laptop the browser's location is approximate. For a real
              GPS test, run this on your phone in Expo Go.
            </Text>
          )}
        </Card.Content>
      </Card>

      <Button
        mode="text"
        icon="arrow-left"
        style={styles.backBtn}
        onPress={() => navigation.navigate('DriverHome')}
      >
        Back to My Trips
      </Button>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  detail: { opacity: 0.85, marginTop: 6 },
  status: { marginTop: 14, fontWeight: 'bold' },
  coords: { color: colors.muted, marginTop: 4 },
  help: { color: colors.muted, marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  btn: { flex: 1 },
  backBtn: { marginTop: 16, alignSelf: 'center' },
});
