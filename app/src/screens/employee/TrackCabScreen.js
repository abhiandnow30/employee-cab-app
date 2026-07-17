// ---------------------------------------------------------------------------
// TRACK CAB
// Shows the employee where THEIR cab is, live. It finds the cab assigned to the
// employee's current booking (by the admin) and subscribes to that cab's
// location in Firebase — updating the map every time a new position arrives.
//
// States handled:
//   • No active bookings          → "No upcoming rides"
//   • Booking but no cab assigned  → "Cab not assigned yet"
//   • Cab assigned                 → live map + trip details
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Card, Chip, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeCabLocation } from '../../services/tracking';
import {
  getRoute,
  tripDestination,
  distanceMeters,
  formatEta,
  formatDistance,
} from '../../services/directions';
import TrackMap from '../../components/TrackMap';

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
  const { myActiveBookings, getCabById, currentUser } = useApp();

  const active = myActiveBookings();
  // Track the first active booking that actually has a cab assigned.
  const trackedBooking = active.find((b) => b.assignedCabId) || null;
  const cabId = trackedBooking?.assignedCabId || null;
  const cab = cabId ? getCabById(cabId) : null;

  const [location, setLocation] = useState(null); // { latitude, longitude, updatedAt }
  const [route, setRoute] = useState(null); // { durationSec, distanceMeters, coordinates, source }

  // Where the cab is heading: the fixed office (Home → Office) or the
  // employee's saved home (Office → Home).
  const destination = trackedBooking
    ? tripDestination(trackedBooking.direction, currentUser?.home, trackedBooking.pickup)
    : null;
  const lastFetchRef = useRef({ time: 0, lat: 0, lng: 0 });

  useEffect(() => {
    if (!cabId) {
      setLocation(null);
      return;
    }
    const unsubscribe = subscribeCabLocation(cabId, setLocation);
    return unsubscribe;
  }, [cabId]);

  // Recompute the route + ETA as the cab moves — but throttled, so we don't hit
  // the routing service on every single GPS ping (only every ~8s or after 80m).
  useEffect(() => {
    if (!location || !destination) return;
    const now = Date.now();
    const last = lastFetchRef.current;
    const movedFar =
      distanceMeters(location, { latitude: last.lat, longitude: last.lng }) > 80;
    if (route && now - last.time < 8000 && !movedFar) return;

    lastFetchRef.current = { time: now, lat: location.latitude, lng: location.longitude };
    let cancelled = false;
    getRoute(location, destination).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [location, destination]);

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

  // Booking exists but no cab assigned yet.
  if (!cabId) {
    return (
      <EmptyState
        navigation={navigation}
        icon="clock-outline"
        title="Cab not assigned yet"
        body="Your booking is confirmed, but the transport desk hasn't assigned a cab yet. This screen will show your cab live as soon as they do."
      />
    );
  }

  const isLive = !!location;

  return (
    <View style={styles.container}>
      <Card style={styles.infoCard} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{cab?.cabNumber || 'Your cab'}</Text>
            <Chip
              compact
              icon={isLive ? 'circle' : 'circle-outline'}
              style={{ backgroundColor: isLive ? '#E8F5E9' : '#FFF3E0' }}
              textStyle={{ color: isLive ? '#2E7D32' : '#E65100', fontSize: 12 }}
            >
              {isLive ? 'LIVE' : 'Waiting…'}
            </Chip>
          </View>

          {/* Which trip this is */}
          <Text variant="bodyMedium" style={styles.trip}>
            {trackedBooking.direction} · {trackedBooking.date} · {trackedBooking.shift}
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            Pickup: {trackedBooking.pickup || '—'}
          </Text>

          {/* Driver */}
          <Text variant="bodyMedium" style={styles.driver}>
            Driver: {cab?.driverName || '—'} · {cab?.driverPhone || '—'}
          </Text>

          {/* ETA — shown once we have a live location and a computed route */}
          {location && route ? (
            <View style={styles.etaRow}>
              <MaterialCommunityIcons name="map-marker-distance" size={18} color="#1565C0" />
              <Text variant="titleSmall" style={styles.eta}>
                Arriving in {formatEta(route.durationSec)} · {formatDistance(route.distanceMeters)}
                {route.source === 'estimate' ? ' (approx)' : ''}
              </Text>
            </View>
          ) : location ? (
            <Text variant="bodySmall" style={styles.coords}>
              Calculating route…
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
          route={route?.coordinates}
          destination={destination}
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
  container: { flex: 1, padding: 12 },
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
  eta: { color: '#1565C0' },
  coords: { opacity: 0.7, marginTop: 4 },
  mapWrap: { flex: 1 },
  homeBtn: { marginTop: 12, paddingVertical: 4 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { marginTop: 6 },
  emptyBody: { textAlign: 'center', opacity: 0.7, marginBottom: 12 },
});
