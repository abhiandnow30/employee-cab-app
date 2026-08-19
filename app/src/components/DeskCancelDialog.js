// ---------------------------------------------------------------------------
// DESK CANCEL DIALOG — "the employee messaged us, stand their cab down"
//
// One component, two screens: the coordinator's day board (where the day is run)
// and All Bookings. Shared rather than written twice so the confirmation the desk
// sees is identical wherever they reach it from.
//
// NO REASON IS COLLECTED, AND NOTHING IS EXPLAINED ON SCREEN — both decided
// deliberately, at explicit request, after the picker was built and seen. The dialog
// is a bare confirmation: which ride, and two buttons.
//
// The employee IS still told. A ride vanishing from their My Rides with no word is
// how a rider turns up at the gate anyway, so the in-app notification stays — see
// deskCancelRide in AppContext (NOTIFY.RIDE_CANCELLED). What was removed is only the
// line on the desk's own screen saying so; the notice itself is not cosmetic.
//
// WHAT THE MISSING REASON COSTS, stated plainly because it is easy to forget later:
// the employee's ride card, the Cancelled Rides report, and anybody reviewing the
// decision weeks afterwards all read "Cancelled by Transport Desk" and nothing more.
// WHO, WHEN and IN WHAT ROLE are still recorded (see deskCancelBooking in
// services/bookings.js); only WHY is gone.
//
// Re-adding it later is small: the reason field is still accepted by the service
// function and by firestore.rules, and every screen already prints it when present.
// That is why the plumbing was left in place rather than stripped out.
//
// WHY IT STILL RESTATES THE RIDE. This is the last screen before a cab is stood
// down for someone expecting it, usually while the desk is on the phone. On a board
// of a dozen riders, the name, day, time and direction are the only thing between
// cancelling the right cab and the wrong one — and with the reason gone, this
// summary is now the ONLY check in the flow.
//
// It takes a DERIVED ride or a BOOKING. The board's rides and All Bookings' rows
// are different shapes carrying the same facts, so the small amount of normalising
// below is what lets one dialog serve both.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button, Portal, Dialog } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { prettyDateKey, relativeDayLabel } from '../utils/datetime';
import { colors } from '../theme';

export default function DeskCancelDialog({
  visible,
  ride,
  cab,
  busy = false,
  onDismiss,
  onConfirm,
}) {
  const name = ride?.employeeName || 'this employee';
  const date = ride?.date;
  const relative = date ? relativeDayLabel(date) : null;
  // 'in' | 'out' on a derived ride; All Bookings rows only carry `direction`.
  const isIn = ride?.leg ? ride.leg === 'in' : ride?.direction === 'Home → Office';

  return (
    <Portal>
      <Dialog visible={!!visible} onDismiss={busy ? undefined : onDismiss} style={styles.dialog}>
        <Dialog.Title>Cancel this ride?</Dialog.Title>
        <Dialog.Content>
          {/* SAYS EXACTLY WHAT IT DOES, AND WHAT IT DOESN'T.
              This read "The employee will no longer be expected to travel", which
              overstates it badly: that sentence describes somebody being marked off
              work, and this button does nothing of the kind. One leg of one day is
              cancelled — `rosters/<month>_<uid>.days[DD]` is untouched, so the rider
              is still down as working, tomorrow's rides still generate, and if the
              shift provides both a pickup and a drop the other leg is still on.
              Somebody reading the old wording could reasonably have cancelled one cab
              believing they had stood the whole day down. */}
          <Text variant="bodyMedium">
            Cancels this ride only. {name}&apos;s roster and any other rides stay as
            they are.
          </Text>

          {/* WHICH RIDE. Tinted block rather than loose lines, so it reads as the
              subject of the question and not as more instructions. */}
          <View style={styles.summary}>
            <View style={styles.summaryHead}>
              <Text variant="titleSmall" style={styles.summaryName}>
                {name}
              </Text>
              <View
                style={[styles.legBadge, { backgroundColor: isIn ? colors.primary : '#00695C' }]}
              >
                <Text style={styles.legBadgeText}>{isIn ? 'IN' : 'OUT'}</Text>
              </View>
            </View>
            <Text variant="bodySmall" style={styles.summaryLine}>
              {relative ? `${relative} · ` : ''}
              {date ? prettyDateKey(date) : '—'}
              {ride?.shift ? ` · ${ride.shift}` : ''}
            </Text>
            <Text variant="bodySmall" style={styles.summaryLine}>
              {ride?.direction || (isIn ? 'Home → Office' : 'Office → Home')}
            </Text>
            {/* Only when a cab is actually on it — "no cab assigned" is the normal
                state for most of the board and isn't worth a line. */}
            {cab ? (
              <View style={styles.cabRow}>
                <MaterialCommunityIcons name="car-side" size={15} color={colors.success} />
                <Text variant="bodySmall" style={styles.cabText}>
                  {cab.cabNumber}
                  {cab.driverName ? ` · ${cab.driverName}` : ''} — this seat frees up
                </Text>
              </View>
            ) : null}
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} disabled={busy}>
            Keep Ride
          </Button>
          <Button
            mode="contained"
            buttonColor={colors.danger}
            icon="calendar-remove"
            onPress={onConfirm}
            loading={busy}
            disabled={busy}
          >
            Cancel Ride
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  summary: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryName: { fontWeight: 'bold', color: colors.text, flex: 1, minWidth: 0 },
  legBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  legBadgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  summaryLine: { color: colors.muted, marginTop: 2 },
  cabRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  cabText: { color: colors.success, flex: 1 },
});
