// ---------------------------------------------------------------------------
// DRIVER (LIVE GPS) — the real driver side.
// Reads the phone's actual GPS with expo-location and writes each new position
// to Firebase. The employee's Track Cab screen shows it move in real time.
//
// Testing tip: run THIS on your phone in Expo Go (real GPS), and open Track Cab
// in a web browser — you'll see your phone's real location on the map. Walk
// around and the marker follows you.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import * as Location from 'expo-location';
import { updateCabLocation } from '../../services/tracking';

const DEMO_CAB_ID = 'c1';

export default function DriverLiveScreen() {
  const [status, setStatus] = useState('idle'); // idle | requesting | sharing | denied | error
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState('');
  const watcherRef = useRef(null);

  async function startSharing() {
    setError('');
    setStatus('requesting');

    // Ask for permission to read location.
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== 'granted') {
      setStatus('denied');
      return;
    }

    try {
      // Stream location: a new fix when the phone moves ~5m or every 3s.
      watcherRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 5,
          timeInterval: 3000,
        },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          setCoords({ latitude, longitude });
          updateCabLocation(DEMO_CAB_ID, { latitude, longitude }, Date.now());
        }
      );
      setStatus('sharing');
    } catch (e) {
      setError(e.message || 'Could not start location updates.');
      setStatus('error');
    }
  }

  function stopSharing() {
    if (watcherRef.current) {
      watcherRef.current.remove();
      watcherRef.current = null;
    }
    setStatus('idle');
  }

  // Stop the GPS watcher if the driver navigates away.
  useEffect(() => stopSharing, []);

  const sharing = status === 'sharing';

  return (
    <View style={styles.container}>
      <Card mode="outlined">
        <Card.Content>
          <Text variant="titleMedium">Driver — share live location</Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Sends this device's real GPS position for cab {DEMO_CAB_ID} to
            Firebase. Employees tracking this cab see you move live.
          </Text>

          <Text variant="bodyLarge" style={styles.status}>
            {status === 'idle' && 'Not sharing'}
            {status === 'requesting' && 'Requesting permission…'}
            {status === 'sharing' && '🟢 Sharing live location'}
            {status === 'denied' && '⛔ Location permission denied'}
            {status === 'error' && '⚠️ Error'}
          </Text>

          {coords && (
            <Text variant="bodySmall" style={styles.coords}>
              {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
            </Text>
          )}
          {status === 'denied' && (
            <Text variant="bodySmall" style={styles.help}>
              Enable location access for the app in your device settings, then try again.
            </Text>
          )}
          {!!error && (
            <Text variant="bodySmall" style={styles.help}>
              {error}
            </Text>
          )}

          <View style={styles.buttons}>
            <Button
              mode="contained"
              icon="crosshairs-gps"
              onPress={startSharing}
              disabled={sharing || status === 'requesting'}
              style={styles.btn}
            >
              Start sharing
            </Button>
            <Button
              mode="outlined"
              icon="stop"
              onPress={stopSharing}
              disabled={!sharing}
              style={styles.btn}
            >
              Stop
            </Button>
          </View>

          {Platform.OS === 'web' && (
            <Text variant="bodySmall" style={styles.help}>
              Note: on a laptop the browser's location is approximate. For a real
              GPS test, run this screen on your phone in Expo Go.
            </Text>
          )}
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  detail: { opacity: 0.85, marginTop: 6 },
  status: { marginTop: 14, fontWeight: 'bold' },
  coords: { opacity: 0.7, marginTop: 4 },
  help: { opacity: 0.7, marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  btn: { flex: 1 },
});
