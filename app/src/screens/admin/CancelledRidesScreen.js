// ---------------------------------------------------------------------------
// CANCELLED RIDES  (admin)
// A read-only list of every ride that ended up Cancelled, so the transport desk
// can see WHO cancelled, WHICH ride, and WHY. Two ways a ride gets here:
//   • the employee raised a change request (Leave, Cancel one ride, Shift changed
//     — or the retired Absent, on older rows) that the coordinator or admin
//     resolved — cancelReason/
//     cancelStatus/cancelResolvedAt are stamped onto the booking by
//     services/changeRequests.js at resolution time, or
//   • the employee removed the leg from their Weekly Schedule directly (no
//     reason to show, since nothing was ever typed).
// Data is the same live bookings list the admin already has — just filtered.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, Button, Dialog, Portal, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { colors, font, radius, shadow, spacing } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Firestore Timestamp → "24-Jul, 02:15 PM" (or '' if not set yet).
function formatWhen(ts) {
  const secs = ts?.seconds;
  if (!secs) return '';
  const d = new Date(secs * 1000);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}, ${String(h).padStart(2, '0')}:${m} ${ap}`;
}

export default function CancelledRidesScreen() {
  const { bookings, currentUser, hideCancelledRides, unhideCancelledRides } = useApp();
  const isAdmin = currentUser?.role === 'admin';

  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [snack, setSnack] = useState('');
  // The ids cleared by the last press, so it can be undone without another read.
  // Session-only: the flag lives on the booking, so a reload simply shows the
  // tidied list, which is the point of having pressed it.
  const [lastCleared, setLastCleared] = useState([]);

  // Rows the desk has tidied away. `hiddenFromLog` is a DISPLAY flag and nothing
  // more — the ride is still Cancelled, still off the board, still in Reports.
  // See hideCancelledFromLog in services/bookings.js for why the alternative
  // (deleting the bookings) would put every one of these riders back on the
  // coordinator's board as an active ride.
  const hidden = useMemo(
    () => bookings.filter((b) => b.status === 'Cancelled' && b.hiddenFromLog).map((b) => b.id),
    [bookings]
  );

  // Only cancelled rides, newest cancellation first (fall back to booking order).
  const cancelled = useMemo(() => {
    return bookings
      .filter((b) => b.status === 'Cancelled' && !b.hiddenFromLog)
      .sort((a, b) => {
        // cancelledAt first: a DESK cancellation writes only that one, deliberately
        // (it must not touch the employee's request fields), so without it here every
        // desk cancellation sorted to the bottom as timestamp 0.
        const ta =
          a.cancelledAt?.seconds ?? a.cancelResolvedAt?.seconds ?? a.cancelRequestedAt?.seconds ?? 0;
        const tb =
          b.cancelledAt?.seconds ?? b.cancelResolvedAt?.seconds ?? b.cancelRequestedAt?.seconds ?? 0;
        return tb - ta;
      });
  }, [bookings]);

  function renderRide({ item }) {
    const when = formatWhen(item.cancelledAt || item.cancelResolvedAt || item.cancelRequestedAt);
    // THREE WAYS A RIDE GETS CANCELLED, and this report is where they must be told
    // apart. Desk is checked FIRST: it writes no cancelStatus and no cancelReason, so
    // the viaRequest test below would have labelled it a schedule drop by the
    // employee — attributing the desk's decision to the rider.
    const byDesk = item.cancellationSource === 'desk';
    const viaRequest = !byDesk && (!!item.cancelReason || item.cancelStatus === 'Approved');
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.employeeName || 'Employee'}</Text>
            <Chip compact style={styles.chip} textStyle={styles.chipText}>
              Cancelled
            </Chip>
          </View>

          <Text variant="bodyMedium" style={styles.line}>
            {item.direction || '—'}
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            {item.date}
            {item.shift ? ` · ${item.shift}` : ''}
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            Pickup: {item.pickup || '—'} · {item.source === 'adhoc' ? 'One-time ride' : 'Weekly roster'}
          </Text>

          <View style={styles.reasonBox}>
            <MaterialCommunityIcons
              name={
                byDesk ? 'headset' : viaRequest ? 'account-cancel-outline' : 'calendar-remove-outline'
              }
              size={15}
              color={colors.muted}
            />
            <Text variant="bodySmall" style={styles.reasonText}>
              {byDesk
                ? `Cancelled by Transport Desk${
                    item.cancelledByRole ? ` (${item.cancelledByRole})` : ''
                  } — ${item.cancellationReason || 'No reason recorded'}`
                : viaRequest
                  ? `Reason: ${item.cancelReason || 'Not specified'}`
                  : 'Removed from the weekly schedule by the employee'}
              {when ? `  ·  ${when}` : ''}
            </Text>
          </View>
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <View style={styles.headerRow}>
          <Text variant="bodySmall" style={styles.hint}>
            Rides employees have cancelled. Newest first.
          </Text>
          {/* THE BUTTON is HR's, because tidying the log is housekeeping on HR's
              own screen. THE EFFECT is not: `hiddenFromLog` lives on the booking,
              so a cleared row leaves the coordinator's copy of this list too (they
              see it as a tab inside Requests). That is deliberate — one log, one
              state, the same reason both desks share one change-request queue —
              but it means Clear is not a private view setting, and "Show cleared"
              is how either of them gets a row back. */}
          {isAdmin && cancelled.length ? (
            <Button
              mode="text"
              icon="broom"
              compact
              disabled={busy}
              onPress={() => setConfirmClear(true)}
            >
              Clear list
            </Button>
          ) : null}
          {isAdmin && hidden.length ? (
            <Button
              mode="text"
              icon="eye-outline"
              compact
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                const res = await unhideCancelledRides(hidden);
                setBusy(false);
                setSnack(res?.ok ? `${res.shown} row(s) back on the list.` : res?.message || 'Could not restore.');
              }}
            >
              Show {hidden.length} cleared
            </Button>
          ) : null}
          <Chip compact icon="car-off" style={styles.countChip}>
            {cancelled.length}
          </Chip>
        </View>
        <FlatList
          data={cancelled}
          keyExtractor={(item) => item.id}
          renderItem={renderRide}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="car-off" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No cancelled rides yet.
              </Text>
            </View>
          }
        />
      </View>

      {/* Says what it actually does. "Clear" on a screen full of records reads as
          "delete", and the whole point of this action is that it is not one. */}
      <Portal>
        <Dialog visible={confirmClear} onDismiss={() => setConfirmClear(false)}>
          <Dialog.Title>Clear this list?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Hides all {cancelled.length} row{cancelled.length === 1 ? '' : 's'} from this
              screen. Nothing is deleted: the rides stay cancelled, stay off the
              coordinator&apos;s board, keep who cancelled them and when, and still
              count in Reports. You can bring them back with &ldquo;Show cleared&rdquo;.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmClear(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              loading={busy}
              disabled={busy}
              onPress={async () => {
                const ids = cancelled.map((c) => c.id);
                setBusy(true);
                const res = await hideCancelledRides(ids);
                setBusy(false);
                setConfirmClear(false);
                if (res?.ok) {
                  setLastCleared(ids);
                  setSnack(
                    `Cleared ${res.hidden} row${res.hidden === 1 ? '' : 's'}` +
                      (res.failed ? ` · ${res.failed} could not be cleared` : '')
                  );
                } else {
                  setSnack(res?.message || 'Could not clear the list.');
                }
              }}
            >
              Clear
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack('')}
        duration={5000}
        action={
          lastCleared.length
            ? {
                label: 'Undo',
                onPress: async () => {
                  const ids = lastCleared;
                  setLastCleared([]);
                  await unhideCancelledRides(ids);
                },
              }
            : undefined
        }
      >
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerCol: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  hint: { color: colors.muted, flex: 1, lineHeight: 19 },
  countChip: { backgroundColor: colors.dangerSoft },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: { backgroundColor: colors.surfaceAlt },
  chipText: { color: colors.textSecondary, fontSize: 11.5, fontFamily: font.semibold },
  line: { marginTop: spacing.sm, fontFamily: font.semibold, color: colors.text },
  detail: { color: colors.muted, marginTop: 2 },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  reasonText: { flex: 1, color: colors.textSecondary, lineHeight: 19 },
  empty: { alignItems: 'center', marginTop: 56 },
  emptyText: { color: colors.muted, marginTop: spacing.sm },
});
