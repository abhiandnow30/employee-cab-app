// ---------------------------------------------------------------------------
// TRACK CAB
// Shows the employee where THEIR cab is, live. It finds the cab assigned to the
// ride that's actually happening (see trackableBooking in AppContext), looks up
// that cab's linked driver, and subscribes to that driver's live position —
// updating the map every time a new fix arrives.
//
// The ETA points at the RIGHT place for the stage of the trip:
//   • before the driver arrives → the cab's route to the PICKUP point
//     ("Arriving in 6 min" — the thing the employee is waiting for)
//   • once they've been picked up → the route to the DESTINATION
// It used to always route to the office, so "Arriving in …" showed the wrong
// number entirely on a Home → Office ride.
//
// States handled:
//   • No active bookings           → "No upcoming rides"
//   • Nothing in progress          → "Nothing to track right now"
//   • Cab assigned, driver offline → "Waiting for the driver…" / last seen
//   • Cab assigned, driver live    → live map + trip details
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Card, Chip, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeDriverLocation, isLiveFix, LIVE_WINDOW_MS } from '../../services/tracking';
import {
  getRoute,
  tripDestination,
  tripPickupPoint,
  distanceMeters,
  formatEta,
  formatDistance,
} from '../../services/directions';
import { STATUS } from '../../data/mockData';
import TrackMap from '../../components/TrackMap';
import { colors } from '../../theme';

// "45s ago" / "3m ago" / "2h ago" — how old the last fix is.
function timeAgo(updatedAt, now) {
  if (!updatedAt) return null;
  const secs = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// Shown when there's nothing (yet) to track.
function EmptyState({ navigation, icon, title, body }) {
  return (
    <View style={styles.emptyWrap}>
      <MaterialCommunityIcons name={icon} size={56} color="#90A4AE" />
      <Text variant="titleMedium" style={styles.emptyTitle}>
        {title}
      </Text>
      <Text variant="bodyMedium" style={styles.emptyBody}>
        {body}
      </Text>
      <Button mode="contained" icon="home" onPress={() => navigation.navigate('EmployeeHome')}>
        Back to Home
      </Button>
    </View>
  );
}

export default function TrackCabScreen({ navigation }) {
  const { myActiveBookings, trackableBooking, getCabById, currentUser } = useApp();

  const active = myActiveBookings();
  // The ride actually in progress — not any old booking that once had a cab.
  const trackedBooking = trackableBooking();
  const cabId = trackedBooking?.assignedCabId || null;
  const cab = cabId ? getCabById(cabId) : null;
  // Live positions are published per DRIVER (so the database rules can stop
  // anyone writing someone else's location), so we follow the cab's linked
  // driver account.
  const driverUid = cab?.driverUid || null;

  const [location, setLocation] = useState(null); // { latitude, longitude, updatedAt }
  const [route, setRoute] = useState(null); // { durationSec, distanceMeters, coordinates, source }
  const [now, setNow] = useState(() => Date.now());

  // Before the driver arrives, the cab is on its way to the PICKUP point; after
  // that it's heading to the trip's destination.
  const onBoard = trackedBooking?.status === STATUS.ARRIVED;
  const pickupPoint = trackedBooking ? tripPickupPoint(trackedBooking) : null;
  const target = !trackedBooking
    ? null
    : onBoard
    ? tripDestination(trackedBooking.direction, currentUser?.home, trackedBooking.pickup)
    : pickupPoint?.coords || null;
  const targetLabel = onBoard ? 'Reaching your drop in' : 'Arriving in';

  const lastFetchRef = useRef({ time: 0, lat: 0, lng: 0 });

  useEffect(() => {
    if (!driverUid) {
      setLocation(null);
      return;
    }
    return subscribeDriverLocation(driverUid, setLocation, (e) =>
      console.warn('[tracking] subscription error:', e?.message)
    );
  }, [driverUid]);

  // Tick, so "LIVE" can expire and "last seen" stays truthful without needing a
  // new position to arrive.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // Recompute the route + ETA as the cab moves — but throttled, so we don't hit
  // the routing service on every single GPS ping (only every ~8s or after 80m).
  useEffect(() => {
    if (!location || !target) return;
    const stamp = Date.now();
    const last = lastFetchRef.current;
    const movedFar =
      distanceMeters(location, { latitude: last.lat, longitude: last.lng }) > 80;
    if (route && stamp - last.time < 8000 && !movedFar) return;

    lastFetchRef.current = { time: stamp, lat: location.latitude, lng: location.longitude };
    let cancelled = false;
    getRoute(location, target).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, target?.latitude, target?.longitude]);

  // No bookings at all.
  if (active.length === 0) {
    return (
      <EmptyState
        navigation={navigation}
        icon="calendar-remove"
        title="No upcoming rides"
        body="You have no active bookings to track. Book a cab, and once the transport desk assigns one you can follow it here."
      />
    );
  }

  // Nothing in progress: either no cab yet, or the trip is already over.
  if (!trackedBooking) {
    return (
      <EmptyState
        navigation={navigation}
        icon="clock-outline"
        title="Nothing to track right now"
        body="Tracking opens once the transport desk assigns a cab to an upcoming ride, and closes when that trip is finished."
      />
    );
  }
  if (!cab) {
    return (
      <EmptyState
        navigation={navigation}
        icon="car-off"
        title="Cab unavailable"
        body="The cab on this ride is no longer in the fleet. Please contact the transport desk."
      />
    );
  }

  // A fix is only "LIVE" while it's fresh — a stale position used to be shown as
  // live indefinitely, so a parked cab looked like it was on its way.
  const live = isLiveFix(location, now);
  const lastSeen = timeAgo(location?.updatedAt, now);
  const staleMins = Math.round(LIVE_WINDOW_MS / 60000);

  return (
    <View style={styles.container}>
      <Card style={styles.infoCard} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{cab.cabNumber || 'Your cab'}</Text>
            <Chip
              compact
              icon={live ? 'circle' : 'circle-outline'}
              style={{ backgroundColor: live ? '#E8F5E9' : '#FFF3E0' }}
              textStyle={{ color: live ? '#2E7D32' : '#E65100', fontSize: 12 }}
            >
              {live ? 'LIVE' : location ? `Last seen ${lastSeen}` : 'Waiting…'}
            </Chip>
          </View>

          {/* Which trip this is */}
          <Text variant="bodyMedium" style={styles.trip}>
            {trackedBooking.direction} · {trackedBooking.date} · {trackedBooking.shift}
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            Pickup: {pickupPoint?.label || trackedBooking.pickup || '—'}
          </Text>

          {/* Driver */}
          <Text variant="bodyMedium" style={styles.driver}>
            Driver: {cab.driverName || '—'} · {cab.driverPhone || '—'}
          </Text>

          {/* ETA — only while the fix is fresh AND we know where the cab is
              headed. A stale position would give a confidently wrong number. */}
          {live && route && target ? (
            <View style={styles.etaRow}>
              <MaterialCommunityIcons name="map-marker-distance" size={18} color={colors.primary} />
              <Text variant="titleSmall" style={styles.eta}>
                {targetLabel} {formatEta(route.durationSec)} ·{' '}
                {formatDistance(route.distanceMeters)}
                {route.source === 'estimate' ? ' (approx)' : ''}
              </Text>
            </View>
          ) : live && !target ? (
            <Text variant="bodySmall" style={styles.coords}>
              Your pickup point isn't pinned yet, so we can't estimate an arrival
              time. The map still shows where the cab is.
            </Text>
          ) : live ? (
            <Text variant="bodySmall" style={styles.coords}>
              Calculating route…
            </Text>
          ) : location ? (
            <Text variant="bodySmall" style={styles.stale}>
              No update for over {staleMins} minute{staleMins > 1 ? 's' : ''} — the
              driver may have stopped sharing. Last known position shown below.
            </Text>
          ) : (
            <Text variant="bodySmall" style={styles.coords}>
              Waiting for the driver to start sharing location…
            </Text>
          )}
        </Card.Content>
      </Card>

      <View style={styles.mapWrap}>
        <TrackMap
          latitude={location?.latitude}
          longitude={location?.longitude}
          route={live ? route?.coordinates : null}
          destination={target}
        />
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
  container: { flex: 1, padding: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  infoCard: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  trip: { marginTop: 2 },
  detail: { opacity: 0.8, marginTop: 2 },
  driver: { marginTop: 8 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  eta: { color: colors.primary },
  coords: { opacity: 0.7, marginTop: 4 },
  stale: { color: '#E65100', marginTop: 6 },
  mapWrap: { flex: 1 },
  homeBtn: { marginTop: 12, paddingVertical: 4 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { marginTop: 6 },
  emptyBody: { textAlign: 'center', opacity: 0.7, marginBottom: 12 },
});
