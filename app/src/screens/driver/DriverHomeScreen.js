// ---------------------------------------------------------------------------
// DRIVER HOME  (My Trips) — Step 9
// The trips the coordinator assigned to THIS driver's cab, in PICKUP SEQUENCE:
// sorted by date then pickup time, and numbered within each run so a carpool
// reads as "Stop 2 of 4" rather than an unordered list. The driver advances
// each trip's status: Cab assigned → On the way → Arrived → Completed.
// A "Share Live Location" button broadcasts the driver's GPS for the cab.
//
// RIDERS ARE IDENTIFIED BY EMPLOYEE ID HERE, NOT BY NAME. The driver needs to know
// who to collect and where; a name on a screen a driver carries around adds nothing
// operationally and is more of the rider's identity than the job requires. The ID
// is on the booking (`empId`) because the security rules don't let a driver read
// employee profiles to look one up.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, Button, Divider, Snackbar, Portal, Dialog } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { statusColors, colors } from '../../theme';
import { SUPPORT_HELPLINE } from '../../branding';
import { tripPickupPoint, tripPlaceLabels } from '../../services/directions';
import { timeToMinutes } from '../../utils/datetime';
import { openDirections, callNumber } from '../../utils/externalLinks';

// Open maps directions to where the driver collects this employee. Platform
// details (Google/Apple Maps app vs. web tab) live in utils/externalLinks.
function navigateToPickup(booking) {
  openDirections(tripPickupPoint(booking));
}

// How a rider appears on the driver's screen. Bookings created before the ID was
// carried onto them have no `empId`, and falling back to the name would quietly
// undo the point of this — so those read as an unknown ID instead.
function riderLabel(booking) {
  const id = String(booking?.empId || '').trim();
  return id ? `Employee ID ${id}` : 'Employee ID not on record';
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
    myCab,
    updateBookingStatus,
    markNoShow,
    getCabById,
    sharingLocation,
    stopSharingLocation,
  } = useApp();

  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null); // the trip whose write is in flight
  const [noShowFor, setNoShowFor] = useState(null); // trip pending no-show confirmation

  // Both driver actions used to be fire-and-forget: if the write was rejected
  // the button just did nothing. Now they wait, and say so when they fail.
  async function advance(booking, nextStatus) {
    setError('');
    setBusyId(booking.id);
    const res = await updateBookingStatus(booking.id, nextStatus);
    setBusyId(null);
    if (!res?.ok) setError(res?.message || 'Could not update the trip. Please try again.');
  }

  // Flagging a no-show ends the trip and is visible to the transport desk, so it
  // asks first — one mis-tap used to be enough.
  async function confirmNoShow() {
    const booking = noShowFor;
    if (!booking) return;
    setError('');
    setBusyId(booking.id);
    const res = await markNoShow(booking.id);
    setBusyId(null);
    setNoShowFor(null);
    if (!res?.ok) setError(res?.message || 'Could not flag the no-show. Please try again.');
  }

  // The vehicle this driver is on. Looked up by ownership (the cab pointing at
  // them) rather than by the profile's stored cabId, so the two can't disagree —
  // the old code read "No cab assigned" while trips for a since-deleted cab still
  // showed. The coordinator sets this link; the driver only reads it.
  const cab = myCab || (currentUser?.cabId ? getCabById(currentUser.cabId) : null);
  const needsCab = !myCab;
  // Trips for THIS driver's cab that aren't cancelled. The context subscription
  // (subscribeCabBookings) already scopes `bookings` to this cab, but we filter
  // by assignedCabId explicitly too so a driver can never see another cab's
  // trips even if that ever changes.
  //
  // Step 9 — PICKUP SEQUENCE. A carpool is several riders at the same time going
  // the same way, and the driver needs them in the order they'll be collected,
  // not in whatever order the desk happened to assign them. Trips are sorted by
  // date, then pickup time, then rider name, and each gets a stop number within
  // its run so "Stop 2 of 4" is meaningful.
  const trips = useMemo(() => {
    const mine = bookings.filter(
      (b) => b.status !== 'Cancelled' && b.assignedCabId === currentUser?.cabId
    );
    const sorted = [...mine].sort((a, b) => {
      const byDate = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDate) return byDate;
      const byTime = (timeToMinutes(a.shift) ?? 0) - (timeToMinutes(b.shift) ?? 0);
      if (byTime) return byTime;
      // Same date and time (a carpool) — keep the order stable and predictable.
      return String(a.empId || '').localeCompare(String(b.empId || ''));
    });
    // Number the stops within each run (same date + time + direction).
    // How many stops each run has, so a card can say "of 4".
    const runs = {};
    sorted.forEach((b) => {
      const run = `${b.date}|${b.shift}|${b.direction}`;
      runs[run] = (runs[run] || 0) + 1;
    });
    const seen = {};
    return sorted.map((b) => {
      const run = `${b.date}|${b.shift}|${b.direction}`;
      seen[run] = (seen[run] || 0) + 1;
      return { ...b, stopNumber: seen[run], stopCount: runs[run], runKey: run };
    });
  }, [bookings, currentUser?.cabId]);

  function renderTrip({ item }) {
    const action = NEXT_ACTION[item.status];
    const places = tripPlaceLabels(item); // real pickup/drop addresses
    return (
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <View style={styles.rowBetween}>
            <View style={styles.nameWrap}>
              {/* Only worth showing when the cab is actually sharing a run. */}
              {item.stopCount > 1 ? (
                <View style={styles.stopBadge}>
                  <Text style={styles.stopBadgeText}>{item.stopNumber}</Text>
                </View>
              ) : null}
              <View style={styles.nameCol}>
                <Text variant="titleMedium">{riderLabel(item)}</Text>
                {item.stopCount > 1 ? (
                  <Text variant="bodySmall" style={styles.stopText}>
                    Stop {item.stopNumber} of {item.stopCount}
                  </Text>
                ) : null}
              </View>
            </View>
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
            {/* The shift's own start/end — a deadline (pickup) or
                earliest-bound (drop). Exact departure timing is your call. */}
            {item.date} · {item.direction === 'Home → Office' ? 'by' : 'after'} {item.shift}
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
                onPress={() => advance(item, action.next)}
                loading={busyId === item.id}
                disabled={busyId === item.id}
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
                  onPress={() => setNoShowFor(item)}
                  disabled={busyId === item.id}
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
          {cab ? `Cab ${cab.cabNumber}` : 'No cab linked yet'}
        </Text>
      </View>

      {/* Until the coordinator links a cab to this account there are no trips to
          show and nothing to broadcast, so say what's needed rather than leaving
          a dead screen. */}
      {needsCab ? (
        <Card mode="outlined" style={styles.setupCard}>
          <Card.Content>
            <View style={styles.setupRow}>
              <MaterialCommunityIcons name="car-clock" size={26} color={colors.primary} />
              <View style={styles.setupText}>
                <Text variant="titleSmall">Waiting for a cab</Text>
                <Text variant="bodySmall" style={styles.setupBody}>
                  The transport coordinator hasn't linked a vehicle to your account
                  yet. Once they do, your trips appear here and you can share your
                  location. Call the desk on {SUPPORT_HELPLINE} if today's shift has
                  started.
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      <Button
        icon={sharingLocation ? 'access-point-check' : 'crosshairs-gps'}
        mode="contained"
        style={styles.shareBtn}
        contentStyle={styles.shareBtnContent}
        onPress={() => navigation.navigate('DriverShareLocation')}
        disabled={needsCab}
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

      <Portal>
        <Dialog visible={!!noShowFor} onDismiss={() => setNoShowFor(null)} style={styles.dialog}>
          <Dialog.Title>Flag a no-show?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This ends the trip for {noShowFor ? riderLabel(noShowFor) : 'this rider'} and
              tells the transport desk they weren't at the pickup.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setNoShowFor(null)} disabled={!!busyId}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={confirmNoShow}
              loading={!!busyId}
              disabled={!!busyId}
            >
              Flag no-show
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!error} onDismiss={() => setError('')} duration={4000}>
        {error}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { marginBottom: 12 },
  name: { fontWeight: 'bold' },
  sub: { color: colors.muted, marginTop: 2 },
  setupCard: { marginBottom: 12, borderColor: colors.primary },
  setupRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  setupText: { flex: 1 },
  setupBody: { color: colors.muted, marginTop: 2, lineHeight: 18 },
  setupBtn: { marginTop: 12, borderRadius: 8 },
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
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  nameCol: { flex: 1 },
  stopBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBadgeText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
  stopText: { color: colors.muted, marginTop: 1 },
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
