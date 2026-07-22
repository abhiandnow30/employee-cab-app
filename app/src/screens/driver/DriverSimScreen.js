// ---------------------------------------------------------------------------
// DRIVER — SIMULATE MOVEMENT (demo)
// A convenience for demos/testing WITHOUT a phone: drives the driver's own cab
// in a straight line from a start point to the pickup, writing a new location
// to Firebase every second. Employees tracking this cab see it move live.
//
// The real driver flow uses "Share Live Location" (actual phone GPS); this is
// only a stand-in when you don't have a phone handy.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import { updateCabLocation } from '../../services/tracking';
import { useApp } from '../../context/AppContext';
import ScreenContainer from '../../components/ScreenContainer';

// A short route across Hyderabad: start → pickup (Gachibowli).
const START = { latitude: 17.42, longitude: 78.37 };
const PICKUP = { latitude: 17.44, longitude: 78.3489 };
const STEPS = 40; // how many hops from start to pickup

export default function DriverSimScreen({ navigation }) {
  const { currentUser, getCabById } = useApp();
  const cabId = currentUser?.cabId;
  const cab = cabId ? getCabById(cabId) : null;

  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const intervalRef = useRef(null);
  const stepRef = useRef(0);

  function stop() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
  }

  function start() {
    if (!cabId) return;
    stop();
    stepRef.current = 0;
    setStep(0);
    setRunning(true);
    intervalRef.current = setInterval(() => {
      const t = stepRef.current / STEPS;
      const latitude = START.latitude + (PICKUP.latitude - START.latitude) * t;
      const longitude = START.longitude + (PICKUP.longitude - START.longitude) * t;
      updateCabLocation(cabId, { latitude, longitude }, Date.now());
      setStep(stepRef.current);
      if (stepRef.current >= STEPS) {
        stop(); // arrived at pickup
      } else {
        stepRef.current += 1;
      }
    }, 1000);
  }

  // Clean up if the user navigates away mid-drive.
  useEffect(() => stop, []);

  const pct = Math.round((step / STEPS) * 100);

  return (
    <ScreenContainer scroll>
      <Card mode="outlined">
        <Card.Content>
          <Text variant="titleMedium">Simulate movement (demo)</Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {cab ? `Drives cab ${cab.cabNumber} ` : 'No cab linked. '}
            from a start point to the pickup — no phone needed. Employees tracking
            your cab see it move live.
          </Text>

          <Text variant="bodyLarge" style={styles.progress}>
            {running ? `Driving… ${pct}%` : step > 0 ? 'Arrived ✓' : 'Idle'}
          </Text>

          <View style={styles.buttons}>
            <Button
              mode="contained"
              icon="play"
              onPress={start}
              disabled={running || !cabId}
              style={styles.btn}
            >
              Start driving
            </Button>
            <Button
              mode="outlined"
              icon="stop"
              onPress={stop}
              disabled={!running}
              style={styles.btn}
            >
              Stop
            </Button>
          </View>

          <Text variant="bodySmall" style={styles.hint}>
            Tip: keep this running and open Track Cab (as the employee) in another
            tab to watch the cab move.
          </Text>
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
  progress: { marginTop: 14, fontWeight: 'bold' },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  btn: { flex: 1 },
  hint: { opacity: 0.6, marginTop: 16 },
  backBtn: { marginTop: 16, alignSelf: 'center' },
});
