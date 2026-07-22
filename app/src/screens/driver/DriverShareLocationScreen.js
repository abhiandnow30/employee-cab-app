// ---------------------------------------------------------------------------
// DRIVER — SHARE LIVE LOCATION
// Streams this phone's real GPS (expo-location) to the driver's assigned cab,
// so employees tracking that cab see it move in real time.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import * as Location from 'expo-location';
import { updateCabLocation } from '../../services/tracking';
import { useApp } from '../../context/AppContext';
import { colors } from '../../theme';
import ScreenContainer from '../../components/ScreenContainer';

export default function DriverShareLocationScreen({ navigation }) {
  const { currentUser, getCabById } = useApp();
  const cabId = currentUser?.cabId;
  const cab = cabId ? getCabById(cabId) : null;

  const [status, setStatus] = useState('idle'); // idle | requesting | sharing | denied | error
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState('');
  const watcherRef = useRef(null);

  async function startSharing() {
    setError('');
    if (!cabId) {
      setError('No cab is linked to your account.');
      return;
    }
    setStatus('requesting');

    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== 'granted') {
      setStatus('denied');
      return;
    }

    try {
      watcherRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          setCoords({ latitude, longitude });
          updateCabLocation(cabId, { latitude, longitude }, Date.now());
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
    <ScreenContainer scroll>
      <Card mode="outlined">
        <Card.Content>
          <Text variant="titleMedium">Share live location</Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {cab ? `Broadcasting for cab ${cab.cabNumber}.` : 'No cab linked.'} Employees
            assigned to your cab will see you move in real time.
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
