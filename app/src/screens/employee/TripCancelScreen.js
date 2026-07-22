// ---------------------------------------------------------------------------
// TRIP CANCEL
// Lists the employee's current (non-cancelled) bookings. Cancelling is now a
// REQUEST, not an instant action:
//   • A request may only be raised at least 4 hours before the ride starts.
//   • It goes to the transport desk (admin), who approves or rejects it.
//   • The ride stays active until the admin approves — then it's "Cancelled".
// Each card shows where the request stands (Requested / Rejected) so the
// employee always knows what to expect.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, Button, Dialog, Portal, TextInput, HelperText } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { statusColors } from '../../theme';
import { SOURCE, CANCEL_STATUS, CANCEL_CUTOFF_HOURS } from '../../data/mockData';
import { canRequestCancel, hoursUntil } from '../../utils/datetime';

function sourceLabel(source) {
  return source === SOURCE.ROSTER ? 'Weekly Schedule' : 'One-time';
}

// A short, friendly "in about N hours / N days" for the ride's start.
function whenLabel(dateKey, shift) {
  const h = hoursUntil(dateKey, shift);
  if (h == null) return null;
  if (h < 0) return 'already started';
  if (h < 1) return `in ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `in ${Math.round(h)} hr`;
  return `in ${Math.round(h / 24)} day(s)`;
}

export default function TripCancelScreen({ navigation }) {
  const { myActiveBookings, requestCancel } = useApp();
  const rides = myActiveBookings();

  const [toCancel, setToCancel] = useState(null); // booking pending confirmation
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  function openRequest(booking) {
    setReason('');
    setToCancel(booking);
  }

  async function submitRequest() {
    if (!toCancel) return;
    setBusy(true);
    try {
      await requestCancel(toCancel.id, reason.trim());
      setToCancel(null);
    } finally {
      setBusy(false);
    }
  }

  function renderCard({ item }) {
    const pending = item.cancelStatus === CANCEL_STATUS.REQUESTED;
    const rejected = item.cancelStatus === CANCEL_STATUS.REJECTED;
    const eligible = canRequestCancel(item.date, item.shift, CANCEL_CUTOFF_HOURS);
    const when = whenLabel(item.date, item.shift);

    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Chip compact style={styles.sourceChip} textStyle={styles.sourceChipText}>
              {sourceLabel(item.source)}
            </Chip>
            <Chip
              compact
              style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
              textStyle={styles.statusChipText}
            >
              {item.status}
            </Chip>
          </View>
          <Text variant="titleMedium" style={styles.direction}>
            {item.direction}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {item.date} · {item.shift}
            {when ? `  (${when})` : ''}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Pickup: {item.pickup}
          </Text>

          {/* --- Cancellation request state --- */}
          {pending ? (
            <View style={[styles.reqBox, styles.reqPending]}>
              <Text variant="labelLarge" style={styles.reqPendingText}>
                Cancellation requested
              </Text>
              <Text variant="bodySmall" style={styles.reqSub}>
                Waiting for the transport desk to approve.
              </Text>
            </View>
          ) : rejected ? (
            <View style={[styles.reqBox, styles.reqRejected]}>
              <Text variant="labelLarge" style={styles.reqRejectedText}>
                Cancellation rejected
              </Text>
              <Text variant="bodySmall" style={styles.reqSub}>
                The transport desk kept this ride on.
                {eligible ? ' You can request again below.' : ''}
              </Text>
            </View>
          ) : null}

          {/* --- Action --- */}
          {!pending && (
            <>
              <Button
                mode="outlined"
                textColor="#C62828"
                icon="close-circle"
                style={styles.cancelBtn}
                disabled={!eligible}
                onPress={() => openRequest(item)}
              >
                {rejected ? 'Request again' : 'Request cancellation'}
              </Button>
              {!eligible && (
                <HelperText type="error" visible={true} style={styles.cutoffHint}>
                  Cancellations must be requested at least {CANCEL_CUTOFF_HOURS} hours before the
                  ride. It's too late to cancel this one — contact the transport desk.
                </HelperText>
              )}
            </>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <Text variant="bodySmall" style={styles.pageHint}>
        Cancellations need transport-desk approval and must be requested at least{' '}
        {CANCEL_CUTOFF_HOURS} hours before the ride.
      </Text>

      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>No current bookings to cancel.</Text>
        }
        renderItem={renderCard}
      />

      {/* Always-visible return to Home */}
      <Button
        mode="contained"
        icon="home"
        style={styles.homeBtn}
        onPress={() => navigation.navigate('EmployeeHome')}
      >
        Back to Home
      </Button>

      {/* Request dialog */}
      <Portal>
        <Dialog visible={!!toCancel} onDismiss={() => !busy && setToCancel(null)}>
          <Dialog.Title>Request cancellation?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogText}>
              {toCancel
                ? `Ask the transport desk to cancel ${toCancel.direction} on ${toCancel.date} (${toCancel.shift}). The ride stays booked until they approve.`
                : ''}
            </Text>
            <TextInput
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              mode="outlined"
              placeholder="e.g. Plans changed, working from home"
              multiline
              numberOfLines={2}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setToCancel(null)} disabled={busy}>
              Keep ride
            </Button>
            <Button textColor="#C62828" onPress={submitRequest} loading={busy} disabled={busy}>
              Send request
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  pageHint: { opacity: 0.7, paddingHorizontal: 14, paddingTop: 12 },
  listContent: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sourceChip: { backgroundColor: '#E3F2FD' },
  sourceChipText: { color: '#1565C0', fontSize: 12 },
  statusChipText: { color: 'white', fontSize: 12 },
  direction: { marginBottom: 2 },
  detail: { opacity: 0.8, marginTop: 2 },
  reqBox: { marginTop: 12, borderRadius: 8, padding: 10 },
  reqPending: { backgroundColor: '#FFF6E5' },
  reqPendingText: { color: '#B26A00' },
  reqRejected: { backgroundColor: '#FDECEA' },
  reqRejectedText: { color: '#C62828' },
  reqSub: { opacity: 0.75, marginTop: 2 },
  cancelBtn: { marginTop: 12, borderColor: '#C62828', alignSelf: 'flex-start' },
  cutoffHint: { paddingHorizontal: 0 },
  empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
  homeBtn: { margin: 12, paddingVertical: 4 },
  dialogText: { marginBottom: 12 },
});
