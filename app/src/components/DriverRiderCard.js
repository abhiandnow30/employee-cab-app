// ---------------------------------------------------------------------------
// DriverRiderCard — ONE rider, and the one decision the driver owes them.
//
// The card answers three questions in order — who am I collecting, where do I
// go, what do I press now — and carries nothing else. The cab-level actions
// ("At the office", "Start trip", "Trip complete") are deliberately NOT here:
// they belong to the run, and mixing the two is what made the old screen a flat
// ladder of buttons where nothing said which one applied to whom.
//
// RIDERS ARE IDENTIFIED BY NAME. The name comes from `employeeName` on the
// BOOKING, denormalised there when the ride was created — the security rules
// deliberately don't let a driver read employee profiles, so there is nothing to
// look up. The ID is the fallback for older bookings written before the name was
// carried across.
//
// THE CODE ENTRY IS INLINE, not a dialog. It used to be a modal that had to be
// opened, which put a tap and a full-screen context switch between "the rider is
// here" and "type what they are reading out". Inline, the field is simply the
// next thing on the card once they have arrived.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button, TextInput, ActivityIndicator } from 'react-native-paper';
import { RIDE_OTP_LENGTH, STATUS } from '../data/mockData';
import { statusColors, colors, font, radius, shadow, spacing } from '../theme';
import { tripPickupPoint, tripDropPoint, tripPlaceLabels } from '../services/directions';
import { openDirections } from '../utils/externalLinks';
import { HJ_SUPPRESS } from '../analytics/hotjar';

// How a rider appears on the driver's screen: their name, falling back to their
// employee ID and then to a plain label. Both fallbacks matter — a card with no
// heading at all reads as a rendering fault, and the driver still has to collect
// whoever this is.
export function riderLabel(booking) {
  const name = String(booking?.employeeName || '').trim();
  if (name) return name;
  const id = String(booking?.empId || '').trim();
  return id ? `Employee ID ${id}` : 'Employee (name not on record)';
}

// Where this trip has to be NEXT: the kerb until the rider is in, their
// destination after. One function, because "Navigate" means the next place the
// cab has to be, and that changes the moment someone gets in. The old screen
// always routed to the pickup, so on a drop run it sent a full cab back to the
// office they had just pulled out of.
function navigateFor(booking) {
  openDirections(
    booking?.status === STATUS.ON_BOARD ? tripDropPoint(booking) : tripPickupPoint(booking)
  );
}

// A rider with nothing to decide RIGHT NOW: one line, not a card.
//
// Used for two different situations that want the same thing on screen — a
// rider already dealt with (boarded, no-showed, delivered), and a rider whose
// turn has not come yet (waiting at the office for the cab-level "At the
// office"). Both still have to be visible: a driver checks the list against the
// faces in front of them, and a name that vanishes reads as a lost rider. What
// neither may do is compete with the decisions that ARE open.
export function RiderLine({ booking, onUndoNoShow, busy }) {
  const color = statusColors[booking.status] || colors.muted;
  const noShow = booking.status === STATUS.NO_SHOW;
  // Waiting riders read better as a plain "Waiting" than as the internal status
  // string, which is desk vocabulary the driver has no use for.
  const word =
    booking.status === STATUS.ASSIGNED || booking.status === STATUS.ON_THE_WAY
      ? 'Waiting'
      : booking.status;
  return (
    <View style={styles.doneRow}>
      <View style={[styles.doneDot, { backgroundColor: color }]} />
      <Text variant="bodyMedium" style={styles.doneName} numberOfLines={1}>
        {riderLabel(booking)}
      </Text>
      <Text variant="bodySmall" style={[styles.doneStatus, { color }]}>
        {word}
      </Text>
      {/* A mis-tapped no-show marks a real employee absent to the desk, and it
          used to be permanent from the driver's side. 'Arrived' is reachable
          from any status in firestore.rules, so putting it back costs nothing —
          and is offered only while the run is still boarding, because after the
          cab has gone the claim is no longer a slip, it is history. */}
      {noShow && onUndoNoShow ? (
        <Button
          mode="text"
          compact
          icon="undo"
          disabled={busy}
          onPress={() => onUndoNoShow(booking)}
          labelStyle={styles.undoLabel}
        >
          Undo
        </Button>
      ) : null}
    </View>
  );
}

export default function DriverRiderCard({
  booking,
  mode, // 'board' | 'drop'
  confirming = false, // an OTP write for this rider is in flight
  busy = false,
  onArrived,
  onBoard,
  onNoShow,
  onUndoNoShow,
  onDropped,
  onHelp,
}) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const places = tripPlaceLabels(booking);
  const status = booking.status;

  // CONFIRMING COMES FIRST, before any status branch.
  //
  // Firestore updates its local cache the instant a write is issued, so the
  // rider's status flips to "On board" on screen while the code is still on its
  // way to the server — and the server is the only thing that can judge the
  // code. Offline at a kerb, that means a card that says boarded and silently
  // un-boards itself minutes later when the write is finally refused. So the
  // card holds here until the write is ACKNOWLEDGED, and nothing downstream
  // (including the run's cab-level button) may advance while it does.
  if (confirming) {
    return (
      <View style={styles.card}>
        <Text variant="titleMedium" style={styles.name} numberOfLines={1}>
          {riderLabel(booking)}
        </Text>
        <View style={styles.confirmRow}>
          <ActivityIndicator size={16} />
          <Text variant="bodyMedium" style={styles.confirmText}>
            Checking the code…
          </Text>
        </View>
      </View>
    );
  }

  const done = status === STATUS.ON_BOARD || status === STATUS.NO_SHOW || status === STATUS.COMPLETED;
  if (mode === 'board' && done) {
    return <RiderLine booking={booking} onUndoNoShow={onUndoNoShow} busy={busy} />;
  }

  const atKerb = status === STATUS.ARRIVED;
  const dropping = mode === 'drop';

  async function submit() {
    setErr('');
    const res = await onBoard(booking, code);
    if (res?.ok) {
      setCode('');
      return;
    }
    setErr(res?.message || 'Could not start the ride. Please try again.');
  }

  return (
    <View style={styles.card}>
      {/* WHO — the largest text here: it is what the driver calls out at a gate. */}
      <Text variant="titleMedium" style={styles.name} numberOfLines={2}>
        {riderLabel(booking)}
      </Text>

      {/* WHERE — label above value, so a long address reads as its own block
          instead of trailing off the end of a sentence. Which address depends on
          what the driver is doing: collecting them, or delivering them. */}
      <View style={styles.place}>
        <Text variant="labelSmall" style={styles.placeLabel}>
          {dropping ? 'DROP' : 'PICKUP'}
        </Text>
        <Text variant="bodyLarge" style={styles.placeValue}>
          {dropping ? places.drop : places.pickup}
        </Text>
      </View>

      {/* WHAT NOW. */}
      {dropping ? (
        <Button
          mode="contained"
          icon="flag-checkered"
          style={styles.mainBtn}
          contentStyle={styles.mainBtnContent}
          labelStyle={styles.mainBtnLabel}
          loading={busy}
          disabled={busy}
          onPress={() => onDropped(booking)}
        >
          Dropped
        </Button>
      ) : atKerb ? (
        <>
          {/* The rider reads six digits off their own screen. The check happens
              in firestore.rules against a document this app cannot read, so
              there is nothing here to work around — the write is what's judged. */}
          <Text variant="bodySmall" style={styles.otpIntro}>
            Ask them for the {RIDE_OTP_LENGTH}-digit code in their app.
          </Text>
          <View style={styles.otpRow}>
            {/* The rider's code, keystroke by keystroke — never recorded. */}
            <TextInput
              {...HJ_SUPPRESS}
              mode="outlined"
              label="Code"
              value={code}
              onChangeText={(t) => {
                setErr('');
                setCode(t.replace(/[^0-9]/g, '').slice(0, RIDE_OTP_LENGTH));
              }}
              keyboardType="number-pad"
              maxLength={RIDE_OTP_LENGTH}
              autoComplete="off"
              style={styles.otpInput}
              contentStyle={styles.otpInputText}
              onSubmitEditing={submit}
              error={!!err}
              disabled={busy}
            />
            <Button
              mode="contained"
              icon="account-check"
              style={styles.boardBtn}
              contentStyle={styles.mainBtnContent}
              labelStyle={styles.mainBtnLabel}
              loading={busy}
              disabled={busy || code.length !== RIDE_OTP_LENGTH}
              onPress={submit}
            >
              On board
            </Button>
          </View>
          {err ? (
            <Text variant="bodySmall" style={styles.otpError}>
              {err}
            </Text>
          ) : null}
        </>
      ) : (
        <Button
          mode="contained"
          icon="map-marker-check"
          style={styles.mainBtn}
          contentStyle={styles.mainBtnContent}
          labelStyle={styles.mainBtnLabel}
          loading={busy}
          disabled={busy}
          onPress={() => onArrived(booking)}
        >
          Arrived
        </Button>
      )}

      <View style={styles.secondaryRow}>
        <Button
          mode="outlined"
          icon="navigation-variant"
          compact
          style={styles.navBtn}
          onPress={() => navigateFor(booking)}
        >
          Navigate
        </Button>
        {/* Not offered on a drop: "no show" answers whether someone got IN, and
            by this point they are in the car. */}
        {!dropping ? (
          <Button
            mode="text"
            icon="account-alert"
            compact
            textColor={colors.danger}
            disabled={busy}
            onPress={() => onNoShow(booking)}
          >
            No show
          </Button>
        ) : null}
        <Button
          mode="text"
          icon="help-circle-outline"
          compact
          textColor={colors.muted}
          onPress={onHelp}
        >
          Help
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.xs,
  },
  name: { fontFamily: font.bold, color: colors.text },

  place: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  placeLabel: { color: colors.muted, letterSpacing: 0.9, textTransform: 'uppercase' },
  placeValue: { color: colors.text, marginTop: 2, lineHeight: 23, fontFamily: font.medium },

  otpIntro: { color: colors.textSecondary, marginTop: spacing.md },
  // The field and the button on one row: the driver's thumb travels from the
  // last digit straight to the confirm.
  otpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  otpInput: { flex: 1, backgroundColor: colors.surface },
  // Read aloud across a car window and typed in the dark, often one-handed.
  otpInputText: { fontSize: 22, letterSpacing: 6 },
  boardBtn: { borderRadius: radius.md, ...shadow.brand },
  otpError: { color: colors.danger, marginTop: spacing.sm },

  // Tall and full width — pressed one-handed, often in the dark.
  mainBtn: { marginTop: spacing.md, borderRadius: radius.md, ...shadow.brand },
  mainBtnContent: { paddingVertical: 8 },
  mainBtnLabel: { fontSize: 15, fontFamily: font.semibold, letterSpacing: 0.2 },

  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  navBtn: { borderColor: colors.borderStrong, borderRadius: radius.md },

  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  confirmText: { color: colors.textSecondary },

  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneDot: { width: 8, height: 8, borderRadius: radius.pill },
  doneName: { flex: 1, minWidth: 0, color: colors.textSecondary },
  doneStatus: { fontFamily: font.semibold },
  undoLabel: { fontFamily: font.semibold },
});
