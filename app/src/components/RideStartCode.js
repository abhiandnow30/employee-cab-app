// ---------------------------------------------------------------------------
// RideStartCode — the six digits that start a ride, shown to the two parties
// allowed to see them: the rider it belongs to, and the desk, who read it down
// the phone when a rider's battery has died.
//
// Never rendered on a driver's screen. The rules refuse them the underlying
// document, so it would show nothing there anyway — but the reason it isn't
// wired into their screens is the point, not the outcome.
//
// TWO VARIANTS, AND THEY FETCH DIFFERENTLY ON PURPOSE
//
//   panel  — the rider's own card. One or two rides, and they need the code in
//            front of them the moment the cab pulls up, so it's LIVE: a re-
//            assignment issues a new code, and someone reciting the old one to a
//            driver whose app keeps refusing it is a support call.
//
//   inline — the coordinator's board, which renders every ride of the evening.
//            A live listener per row would be ~200 subscriptions and ~200 billed
//            reads for codes nobody asked for, printed across a screen anyone
//            walking past the desk can read. So it fetches ONE code, ON DEMAND,
//            when the coordinator actually has a stranded rider on the phone.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRideOtp } from '../utils/useRideOtp';
import { getRideOtp } from '../services/rideOtp';
import { STATUS } from '../data/mockData';
import { colors, font, radius, shadow, spacing } from '../theme';
import { HJ_SUPPRESS } from '../analytics/hotjar';

// The statuses where a code still has a job to do. Mirrors the gate inside
// useRideOtp, for the on-demand path which doesn't go through it.
const AWAITING_BOARDING = [STATUS.ASSIGNED, STATUS.ON_THE_WAY, STATUS.ARRIVED];

// --- The rider's own card ---------------------------------------------------
function RiderPanel({ booking }) {
  const code = useRideOtp(booking);

  // No code is a real, ordinary state — no cab yet, already boarded, or a ride
  // assigned before this feature existed. Show nothing rather than a placeholder
  // implying something has gone wrong.
  if (!code) return null;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <MaterialCommunityIcons name="shield-key" size={18} color={colors.primary} />
        <Text variant="labelLarge" style={styles.panelTitle}>
          Ride start code
        </Text>
      </View>
      {/* The credential itself — kept out of session recordings. */}
      <Text style={styles.code} {...HJ_SUPPRESS}>{code}</Text>
      <Text variant="bodySmall" style={styles.help}>
        Give this to your driver when the cab arrives. The ride can't be started
        without it.
      </Text>
    </View>
  );
}

// --- The desk's board -------------------------------------------------------
function DeskReveal({ booking }) {
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const eligible =
    !!booking?.id && !!booking?.assignedCabId && AWAITING_BOARDING.includes(booking.status);
  if (!eligible) return null;

  async function reveal() {
    if (busy || code) return;
    setBusy(true);
    setFailed(false);
    const value = await getRideOtp(booking.id).catch(() => null);
    setBusy(false);
    if (value) setCode(value);
    else setFailed(true); // a pre-feature ride, or the read was refused
  }

  // The coordinator's ride card is itself a Pressable that ticks the ride for
  // assignment. Claiming the responder here stops "show me the code" from also
  // selecting the rider — on web, where the press would otherwise bubble.
  return (
    <View onStartShouldSetResponder={() => true}>
    <Pressable onPress={reveal} style={styles.inlineRow} disabled={!!code}>
      <MaterialCommunityIcons name="shield-key-outline" size={14} color={colors.muted} />
      {code ? (
        <>
          <Text variant="bodySmall" style={styles.inlineLabel}>
            Start code
          </Text>
          <Text variant="bodySmall" style={styles.inlineCode} {...HJ_SUPPRESS}>
            {code}
          </Text>
        </>
      ) : (
        <Text variant="bodySmall" style={styles.inlineAction}>
          {busy ? 'Reading…' : failed ? 'No start code for this ride' : 'Show start code'}
        </Text>
      )}
      {busy ? <ActivityIndicator size={12} /> : null}
    </Pressable>
    </View>
  );
}

export default function RideStartCode({ booking, variant = 'panel' }) {
  if (variant === 'inline') return <DeskReveal booking={booking} />;
  return <RiderPanel booking={booking} />;
}

const styles = StyleSheet.create({
  // The rider's code is the single most important thing on the screen while a
  // cab is on its way, so it gets a tinted brand panel rather than another
  // white card lost among the rest.
  panel: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.primarySofter,
    ...shadow.xs,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.primary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  code: {
    fontSize: 38,
    lineHeight: 50,
    fontFamily: font.bold,
    letterSpacing: 10,
    textAlign: 'center',
    color: colors.primaryDark,
    marginVertical: spacing.sm,
    // The letter spacing above pads every glyph on both sides, including the
    // last one, which drags the centred string visibly left. This puts it back.
    paddingLeft: 10,
  },
  help: { color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.xs,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inlineLabel: { color: colors.muted },
  inlineCode: { fontFamily: font.bold, letterSpacing: 2, color: colors.text },
  inlineAction: { color: colors.primary, fontFamily: font.medium },
});
