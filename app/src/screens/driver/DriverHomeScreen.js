// ---------------------------------------------------------------------------
// DRIVER HOME  (My Trips)
// Shows the trips the admin assigned to THIS driver's cab. The driver advances
// each trip's status: Cab assigned → On the way → Arrived → Completed.
// A "Share Live Location" button broadcasts the driver's GPS for the cab.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, Button, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { statusColors, colors } from '../../theme';
import { SUPPORT_HELPLINE } from '../../branding';
import { tripPickupPoint, tripPlaceLabels } from '../../services/directions';
import { openDirections, callNumber } from '../../utils/externalLinks';

// Open maps directions to where the driver collects this employee. Platform
// details (Google/Apple Maps app vs. web tab) live in utils/externalLinks.
function navigateToPickup(booking) {
  openDirections(tripPickupPoint(booking));
}

// What the driver can do next, per current status.
const NEXT_ACTION = {
  'Cab assigned': { next: 'On the way', label: 'Start trip', icon: 'play' },
  'On the way': { next: 'Arrived', label: 'Mark arrived', icon: 'map-marker-check' },
  Arrived: { next: 'Completed', label: 'Complete trip', icon: 'flag-checkered' },
};

export default function DriverHomeScreen({ navigation }) {
  const {
    currentUser,
    bookings,
    updateBookingStatus,
    markNoShow,
    getCabById,
    sharingLocation,
    stopSharingLocation,
  } = useApp();

  const cab = currentUser?.cabId ? getCabById(currentUser.cabId) : null;
  // Trips for THIS driver's cab that aren't cancelled. The context subscription
  // (subscribeCabBookings) already scopes `bookings` to this cab, but we filter
  // by assignedCabId explicitly too so a driver can never see another cab's
  // trips even if that ever changes.
  const trips = bookings.filter(
    (b) => b.status !== 'Cancelled' && b.assignedCabId === currentUser?.cabId
  );

  function renderTrip({ item }) {
    const action = NEXT_ACTION[item.status];
    const places = tripPlaceLabels(item); // real pickup/drop addresses
    return (
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.employeeName}</Text>
            <Chip
              compact
              style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
              textStyle={styles.chipText}
            >
              {item.status}
            </Chip>
          </View>
          <Text variant="bodyMedium" style={styles.detail}>
            {item.direction}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {item.date} · {item.shift}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Pickup: {places.pickup}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Drop: {places.drop}
          </Text>
          {/* Privacy: drivers never see the rider's personal mobile — they
              reach the rider through the central transport-desk helpline. */}
          <Text variant="bodyMedium" style={styles.detail}>
            Helpline: {SUPPORT_HELPLINE}
          </Text>

          {/* Contact actions: navigate to the pickup + call the helpline. */}
          <View style={styles.contactRow}>
            <Button
              mode="contained-tonal"
              icon="navigation-variant"
              compact
              style={styles.contactBtn}
              onPress={() => navigateToPickup(item)}
            >
              Navigate
            </Button>
            <Button
              mode="contained-tonal"
              icon="phone"
              compact
              style={styles.contactBtn}
              onPress={() => callNumber(SUPPORT_HELPLINE)}
            >
              Call helpline
            </Button>
          </View>

          {action && (
            <>
              <Divider style={styles.divider} />
              <Button
                mode="contained"
                icon={action.icon}
                onPress={() => updateBookingStatus(item.id, action.next)}
              >
                {action.label}
              </Button>
              {/* At the pickup but the employee isn't here → flag a no-show,
                  which the admin sees in red on the Bookings screen. */}
              {item.status === 'Arrived' && (
                <Button
                  mode="outlined"
                  icon="account-alert"
                  textColor={colors.danger}
                  style={styles.noShowBtn}
                  onPress={() => markNoShow(item.id)}
                >
                  Employee not here (No-show)
                </Button>
              )}
            </>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      {/* Driver + cab header */}
      <View style={styles.header}>
        <Text variant="titleLarge" style={styles.name}>
          {currentUser?.name}
        </Text>
        <Text variant="bodyMedium" style={styles.sub}>
          {cab ? `Cab ${cab.cabNumber}` : 'No cab assigned'}
        </Text>
      </View>

      <Button
        icon={sharingLocation ? 'access-point-check' : 'crosshairs-gps'}
        mode="contained"
        style={styles.shareBtn}
        contentStyle={styles.shareBtnContent}
        onPress={() => navigation.navigate('DriverShareLocation')}
      >
        {sharingLocation ? 'Location Sharing — On' : 'Share Live Location'}
      </Button>

      {/* Live status so the driver never forgets sharing is off (or on). */}
      {sharingLocation ? (
        <View style={styles.sharingBanner}>
          <View style={styles.liveDot} />
          <Text variant="bodyMedium" style={styles.sharingText}>
            Sharing your live location
          </Text>
          <Button compact mode="text" textColor={colors.danger} onPress={stopSharingLocation}>
            Stop
          </Button>
        </View>
      ) : (
        <View style={styles.sharingOffRow}>
          <MaterialCommunityIcons name="map-marker-off-outline" size={16} color={colors.muted} />
          <Text variant="bodySmall" style={styles.sharingOffText}>
            Location off — employees can't see your cab
          </Text>
        </View>
      )}

      <Text variant="titleMedium" style={styles.sectionTitle}>
        My Trips
      </Text>

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        renderItem={renderTrip}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="car-clock" size={44} color={colors.muted} />
            <Text variant="bodyMedium" style={styles.emptyText}>
              No trips assigned yet.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { marginBottom: 12 },
  name: { fontWeight: 'bold' },
  sub: { color: colors.muted, marginTop: 2 },
  shareBtn: { borderRadius: 10, marginBottom: 10 },
  shareBtnContent: { paddingVertical: 8 },
  sharingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E7F4E8',
    borderRadius: 10,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    marginBottom: 20,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  sharingText: { color: colors.success, fontWeight: '600', flex: 1 },
  sharingOffRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20, paddingLeft: 2 },
  sharingOffText: { color: colors.muted },
  sectionTitle: { marginBottom: 10 },
  listContent: { paddingBottom: 24 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chipText: { color: 'white', fontSize: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  contactBtn: { flex: 1, borderRadius: 8 },
  divider: { marginVertical: 12 },
  noShowBtn: { marginTop: 8, borderColor: colors.danger },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
