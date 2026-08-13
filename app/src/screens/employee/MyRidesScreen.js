// ---------------------------------------------------------------------------
// MY RIDES  (employee)
// The cabs assigned to this employee's rostered shifts, with their status. Rides
// are generated from the monthly roster, so there is nothing to book here — the
// actions are cancelling a ride you no longer need, and raising a change request.
//
// Cancelling here is the "I'm on leave today" case: it takes effect immediately
// rather than going to the desk for approval, so the seat is freed while there
// is still time to use it. It closes 4 hours before the ride — the app's
// existing cancellation cutoff (CANCEL_CUTOFF_HOURS), not a second rule — and
// that same cutoff is enforced again in AppContext at submit time and once more
// in firestore.rules against the server clock.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Chip, FAB, Divider, Button, Portal, Dialog, TextInput,
  HelperText, Snackbar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import RideStartCode from '../../components/RideStartCode';
import { statusColors, colors } from '../../theme';
import { callNumber } from '../../utils/externalLinks';
import { formatDeadline } from '../../utils/datetime';
import { STATUS } from '../../data/mockData';

export default function MyRidesScreen({ navigation }) {
  const { myBookings, getCabById, currentUser, rideCancelState, cancelAssignedRide } = useApp();
  const rides = myBookings();
  // The employee's home pickup route, set by the admin in Shift Roster
  // (employees/<uid>.roster.route, e.g. "ECIL Cab"). Shown in brackets after a
  // "Home" pickup so the employee sees which route their cab comes on.
  const homeRoute = currentUser?.roster?.route;

  // The ride whose cancellation dialog is open, plus the typed reason.
  const [cancelFor, setCancelFor] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  // A minute tick. Without it the deadline is only evaluated when something else
  // re-renders, so a screen left open at 4:59 PM keeps offering a button that
  // stopped working at 5:00. Re-rendering once a minute is enough for an hours
  // -based cutoff and costs nothing.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  function openCancel(ride) {
    setReason('');
    setError('');
    setCancelFor(ride);
  }

  async function submitCancel() {
    if (!cancelFor) return;
    setError('');
    if (!reason.trim()) {
      setError('Please tell us why, so the transport desk knows.');
      return;
    }
    setBusy(true);
    // Re-read the ride from the live list: the dialog may have been open a
    // while, and this is what it is being cancelled against.
    const res = await cancelAssignedRide(cancelFor.id, reason);
    setBusy(false);
    if (res?.ok) {
      setCancelFor(null);
      setReason('');
      setSnack('Ride cancelled. The transport desk can see your reason.');
    } else {
      setError(res?.message || 'Could not cancel that ride.');
    }
  }

  function renderRide({ item }) {
    const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;
    // Only annotate a Home pickup, and only when a route has been assigned.
    // Show the route name without a trailing "Cab" (e.g. "ECIL Cab" -> "ECIL").
    const routeLabel = homeRoute ? homeRoute.replace(/\s*cab$/i, '').trim() : '';
    const pickupSuffix =
      item.pickup === 'Home' && routeLabel ? ` (${routeLabel})` : '';

    // Cancelling is offered on rides that have a cab — the case this exists for
    // is "a cab is coming and I don't need it". The state (and the sentence
    // shown when it can't be cancelled) comes from AppContext, so this screen
    // and the submit path can never disagree about the deadline.
    const cancelState = rideCancelState(item);
    const showCancel = !!item.assignedCabId && item.status !== STATUS.CANCELLED;

    return (
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.direction}</Text>
            <Chip
              compact
              style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
              textStyle={styles.chipText}
            >
              {item.status}
            </Chip>
          </View>

          <Text variant="bodyMedium" style={styles.detail}>
            {/* The shift's own start/end — a deadline (pickup) or
                earliest-bound (drop), never a promised cab instant; the
                driver/desk coordinate the exact timing. */}
            {item.date} · {item.direction === 'Home → Office' ? 'by' : 'after'} {item.shift}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Pickup: {item.pickup}{pickupSuffix}
          </Text>

          {/* Why this ride was cancelled, on the rider's own copy — so someone
              looking back at the list can see it was them and what they said. */}
          {item.status === STATUS.CANCELLED && item.cancellationReason ? (
            <Text variant="bodySmall" style={styles.cancelledNote}>
              You cancelled this ride: “{item.cancellationReason}”
            </Text>
          ) : null}

          {/* Shown from the moment a cab is assigned rather than only on arrival:
              a rider who already has the code in front of them doesn't have to
              find it while a driver waits. It disappears once they're on board. */}
          <RideStartCode booking={item} />

          {cab && (
            <>
              <Divider style={styles.divider} />
              <Text variant="labelLarge">Your cab</Text>
              <Text variant="bodyMedium" style={styles.detail}>
                {cab.cabNumber}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
                Driver: {cab.driverName}
              </Text>
              {/* Tappable, not just printed. This was plain text, so a rider
                  standing on the road at 8 PM had to memorise the number and
                  retype it into the dialer. callNumber() opens the dialer
                  pre-filled — the person still presses call. */}
              {cab.driverPhone ? (
                <Button
                  mode="text"
                  icon="phone"
                  compact
                  onPress={() => callNumber(cab.driverPhone)}
                  style={styles.callBtn}
                  contentStyle={styles.callBtnContent}
                >
                  {cab.driverPhone}
                </Button>
              ) : null}
            </>
          )}

          {showCancel ? (
            <>
              <Divider style={styles.divider} />
              <Button
                mode="outlined"
                icon="calendar-remove"
                onPress={() => openCancel(item)}
                // Greyed out once the deadline is behind us. The submit path
                // refuses it too — this is the courtesy, not the control.
                disabled={!cancelState.canCancel}
                textColor={colors.danger}
                style={styles.cancelBtn}
              >
                Cancel Ride
              </Button>
              {cancelState.canCancel ? (
                cancelState.deadline ? (
                  <Text variant="bodySmall" style={styles.deadlineHint}>
                    You can cancel until {formatDeadline(cancelState.deadline)}.
                  </Text>
                ) : null
              ) : (
                <View style={styles.closedRow}>
                  <MaterialCommunityIcons
                    name="clock-alert-outline"
                    size={15}
                    color={colors.warning}
                  />
                  <Text variant="bodySmall" style={styles.closedText}>
                    {cancelState.reason}
                  </Text>
                </View>
              )}
            </>
          ) : null}
        </Card.Content>
      </Card>
    );
  }

  // Recomputed as the dialog renders, so a dialog left open past the deadline
  // shows the closure instead of an armed Cancel button.
  const dialogState = cancelFor ? rideCancelState(cancelFor) : null;

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
      <Button
        icon="home"
        mode="contained-tonal"
        onPress={() => navigation.navigate('EmployeeHome')}
        style={styles.homeBtn}
      >
        Back to Home
      </Button>

      {rides.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="titleMedium" style={styles.emptyTitle}>
            No rides yet
          </Text>
          <Text variant="bodyMedium" style={styles.emptyText}>
            Your cabs appear here once the transport desk assigns them to your
            rostered shifts.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(item) => item.id}
          renderItem={renderRide}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Rides come from the roster, so there's nothing to "book" — the action
          available here is flagging a change to one. */}
      <FAB
        icon="calendar-edit"
        label="Change request"
        style={styles.fab}
        onPress={() => navigation.navigate('ChangeRequest')}
      />
      </View>

      {/* Confirm the cancellation, and take the reason. The ride's date, time
          and the cutoff are all repeated here: this is the last screen before
          a cab is stood down, and "which ride was that again?" should not need
          a trip back to the list. */}
      <Portal>
        <Dialog
          visible={!!cancelFor}
          onDismiss={() => !busy && setCancelFor(null)}
          style={styles.dialog}
        >
          <Dialog.Title>Cancel this ride?</Dialog.Title>
          <Dialog.Content>
            {cancelFor ? (
              <View style={styles.summary}>
                <Text variant="bodyMedium" style={styles.summaryLine}>
                  {cancelFor.direction}
                </Text>
                <Text variant="bodySmall" style={styles.summaryMeta}>
                  {cancelFor.date} ·{' '}
                  {cancelFor.direction === 'Home → Office' ? 'by' : 'after'}{' '}
                  {cancelFor.shift}
                </Text>
                {dialogState?.deadline ? (
                  <Text variant="bodySmall" style={styles.summaryMeta}>
                    Cancellation closes {formatDeadline(dialogState.deadline)}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {dialogState && !dialogState.canCancel ? (
              <View style={styles.closedBox}>
                <MaterialCommunityIcons
                  name="clock-alert-outline"
                  size={16}
                  color={colors.warning}
                />
                <Text variant="bodySmall" style={styles.closedText}>
                  {dialogState.reason}
                </Text>
              </View>
            ) : (
              <>
                <TextInput
                  label="Reason for cancelling"
                  value={reason}
                  onChangeText={setReason}
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  placeholder="e.g. I'm on leave today, so I don't need the cab."
                  disabled={busy}
                  style={styles.reasonInput}
                />
                <HelperText type="info" visible>
                  The transport desk sees this, so the seat can be given to
                  someone else.
                </HelperText>
              </>
            )}

            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setCancelFor(null)} disabled={busy}>
              Keep my ride
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              icon="calendar-remove"
              onPress={submitCancel}
              loading={busy}
              // Blocked on the deadline as well as on an empty reason — the
              // dialog can outlive the cutoff it was opened before.
              disabled={busy || !dialogState?.canCancel || !reason.trim()}
            >
              Cancel ride
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3500}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  homeBtn: { margin: 12, marginBottom: 0, alignSelf: 'flex-start' },
  listContent: { padding: 12, paddingBottom: 90 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chipText: { color: 'white', fontSize: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  // Pulled flush with the text above it — a default Button's padding would make
  // the number look like a separate action block rather than the driver's line.
  callBtn: { alignSelf: 'flex-start', marginLeft: -8, marginTop: 2 },
  callBtnContent: { paddingHorizontal: 4 },
  divider: { marginVertical: 10 },
  cancelBtn: { alignSelf: 'flex-start' },
  deadlineHint: { marginTop: 6, opacity: 0.7 },
  closedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  closedText: { color: colors.warning, flex: 1 },
  cancelledNote: { marginTop: 6, fontStyle: 'italic', color: colors.danger },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { marginBottom: 6 },
  emptyText: { textAlign: 'center', opacity: 0.7 },
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  summary: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  summaryLine: { fontWeight: 'bold' },
  summaryMeta: { opacity: 0.75, marginTop: 2 },
  reasonInput: { marginTop: 2 },
  closedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF6E5',
    borderRadius: 8,
    padding: 10,
  },
});
