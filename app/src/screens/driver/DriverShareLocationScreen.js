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
import { colors, font, radius, spacing } from '../../theme';
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
    sharingBackground,
    trackingFresh,
  } = useApp();
  const cabId = currentUser?.cabId;
  const cab = cabId ? getCabById(cabId) : null;
  // Positions are published under the DRIVER's own id, and the cab record says
  // which driver it follows. If the cab doesn't point back at this account,
  // sharing "works" but nobody is listening — so say so rather than letting the
  // driver think employees can see them.
  const linkBroken = !!cab && cab.driverUid !== currentUser?.uid;

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

          {linkBroken ? (
            <View style={styles.warnBox}>
              <Text variant="bodySmall" style={styles.warnText}>
                Cab {cab.cabNumber} isn't linked to your account yet, so employees
                won't see you move. Ask the transport desk to re-pick your cab in
                Manage Drivers.
              </Text>
            </View>
          ) : null}

          {/* The same four states the dashboard shows, for the same reason: a screen
              that says "sharing" while nothing is published is worse than one that
              admits it doesn't know. */}
          <Text variant="bodyLarge" style={styles.status}>
            {sharing
              ? trackingFresh === false
                ? '⚠️ On, but no GPS signal reaching the server'
                : trackingFresh === null
                  ? '🟡 Starting — waiting for the first fix'
                  : sharingBackground
                    ? '🟢 Sharing live location (continues in the background)'
                    : '🟢 Sharing live location — only while this app is open'
              : busy
                ? 'Requesting permission…'
                : denied
                  ? '⛔ Location permission denied'
                  : sharingError
                    ? '⚠️ Error'
                    : 'Not sharing'}
          </Text>
          {/* WHY THIS DISTINCTION IS SPELLED OUT. Foreground-only means the cab goes
              dark the moment the driver locks the phone or opens Google Maps from the
              Navigate button — which is most of a trip. The fix is a system setting,
              so the driver has to be told what to change. */}
          {sharing && !sharingBackground ? (
            <View style={styles.warnBox}>
              <Text variant="bodySmall" style={styles.warnText}>
                Set location access to “Allow all the time” in your phone's settings
                so employees keep seeing your cab when your screen is off or you
                switch to a navigation app.
              </Text>
            </View>
          ) : null}

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
  detail: { color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 21 },
  warnBox: {
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  warnText: { color: colors.warning, lineHeight: 19 },
  status: { marginTop: spacing.lg, fontFamily: font.semibold, color: colors.text },
  coords: { color: colors.muted, marginTop: spacing.xs },
  help: { color: colors.muted, marginTop: spacing.sm, lineHeight: 19 },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  btn: { flex: 1, borderRadius: radius.md },
  backBtn: { marginTop: spacing.lg, alignSelf: 'center' },
});
