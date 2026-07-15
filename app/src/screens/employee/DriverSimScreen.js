// ---------------------------------------------------------------------------
// DRIVER (DEMO) — a stand-in for a real driver's phone.
// Press "Start driving" and it writes a new GPS position to Firebase every
// second, moving the cab in a straight line from a start point toward the
// pickup. The employee's Track Cab screen receives each update live.
//
// In Stage 3 this is replaced by a real driver screen that reads the phone's
// actual GPS with expo-location. The Firebase side stays exactly the same.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import { updateCabLocation } from '../../services/tracking';

const DEMO_CAB_ID = 'c1';

// A short route across Hyderabad: start → pickup (Gachibowli).
const START = { latitude: 17.4200, longitude: 78.3700 };
const PICKUP = { latitude: 17.4400, longitude: 78.3489 };
const STEPS = 40; // how many hops from start to pickup

export default function DriverSimScreen() {
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
    stop();
    stepRef.current = 0;
    setStep(0);
    setRunning(true);
    intervalRef.current = setInterval(() => {
      const t = stepRef.current / STEPS;
      const latitude = START.latitude + (PICKUP.latitude - START.latitude) * t;
      const longitude = START.longitude + (PICKUP.longitude - START.longitude) * t;
      updateCabLocation(DEMO_CAB_ID, { latitude, longitude }, Date.now());
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
    <View style={styles.container}>
      <Card mode="outlined">
        <Card.Content>
          <Text variant="titleMedium">Driver simulator</Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Sends cab {DEMO_CAB_ID}'s location to Firebase once per second, driving
            from the start point to the pickup.
          </Text>
          <Text variant="bodyLarge" style={styles.progress}>
            {running ? `Driving… ${pct}%` : step > 0 ? 'Arrived ✓' : 'Idle'}
          </Text>

          <View style={styles.buttons}>
            <Button
              mode="contained"
              icon="play"
              onPress={start}
              disabled={running}
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
            Tip: open this in one browser tab and Track Cab in another to watch the
            cab move live.
          </Text>
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  detail: { opacity: 0.85, marginTop: 6 },
  progress: { marginTop: 14, fontWeight: 'bold' },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  btn: { flex: 1 },
  hint: { opacity: 0.6, marginTop: 16 },
});
