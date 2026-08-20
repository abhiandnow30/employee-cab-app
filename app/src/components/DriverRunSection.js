// ---------------------------------------------------------------------------
// DriverRunSection — ONE run: one cab, one departure, everyone in it.
//
// This is the half of the redesign that did not exist before. The driver used to
// get a flat list of rider cards and had to reconstruct "where is this cab up
// to" by reading all of them; the whole-cab actions were per-rider buttons
// repeated N times. Here the run is the object: it says who is on it and how far
// along it is, the riders sit inside it, and there is exactly ONE cab-level
// button — whose label is the next thing the cab does.
//
// The phase decides everything, and the phase is derived from the riders'
// statuses (services/driverRun.js). Nothing about a run is stored.
//
//   PICKUP   boarding, one card per stop  ->  [Start trip]  ->  [Trip complete]
//   DROP     [At the office]  ->  boarding  ->  [Start trip]  ->  a card per drop
//
// The mirror is the point: exactly one half of any journey is spread across
// stops, and that half gets the cards. The other half is one place, and gets one
// button.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { STATUS } from '../data/mockData';
import { colors, font, radius, shadow, spacing } from '../theme';
import { RUN_PHASE, idsToMarkArrived, idsToComplete } from '../services/driverRun';
import { relativeDayLabel, prettyDateKey } from '../utils/datetime';
import { tripDropPoint } from '../services/directions';
import { openDirections } from '../utils/externalLinks';
import DriverRiderCard, { RiderLine } from './DriverRiderCard';

export default function DriverRunSection({
  run,
  departed,
  onDepart,
  sharingLocation,
  trackingFresh,
  onTurnOnLocation,
  sharingBusy,
  confirmingIds,
  busyId,
  runBusy,
  onArrived,
  onBoard,
  onNoShow,
  onUndoNoShow,
  onDropped,
  onRunAction,
  onHelp,
}) {
  const { riders, out } = run;
  const day = relativeDayLabel(run.date) || prettyDateKey(run.date);
  const confirming = riders.some((b) => confirmingIds.has(b.id));

  // A CODE STILL IN FLIGHT FREEZES THE RUN. Firestore shows the write locally
  // before the server has judged it, so without this the cab button would appear
  // — and could be pressed — on the strength of a boarding that may still be
  // refused. See the note in DriverRiderCard.
  const phase = confirming ? RUN_PHASE.BOARDING : run.phase;

  // Location is the run's ignition now, so it is stated once here rather than
  // hidden behind a rider's button. It gates the run OPENING and nothing else:
  // once the cab is working, refusing to board someone because a phone lost GPS
  // would strand a real employee at a kerb, which is the worse failure.
  const [override, setOverride] = useState(false);
  const locked = !sharingLocation && !override;

  return (
    <Card style={styles.run} mode="elevated">
      <Card.Content>
        <View style={styles.head}>
          <View style={[styles.legBadge, { backgroundColor: out ? '#00695C' : colors.primary }]}>
            <Text style={styles.legBadgeText}>{out ? 'OUT' : 'IN'}</Text>
          </View>
          <Text variant="titleMedium" style={styles.headTitle} numberOfLines={1}>
            {day} · {run.shift}
          </Text>
        </View>

        {/* Replaces "STOP 1 OF 2", which was alphabetical by rider name and so
            implied a route order the app has never modelled. This counts what is
            actually true. */}
        <Text variant="bodySmall" style={styles.progress}>
          {riders.length} rider{riders.length === 1 ? '' : 's'} · {run.boarded} on board
          {run.noShow ? ` · ${run.noShow} no-show` : ''}
        </Text>

        {!sharingLocation ? (
          <View style={styles.gate}>
            <MaterialCommunityIcons name="map-marker-off-outline" size={16} color={colors.warning} />
            <Text variant="bodySmall" style={styles.gateText}>
              Turn on location sharing so your riders can see the cab.
            </Text>
            <Button compact mode="text" loading={sharingBusy} onPress={onTurnOnLocation}>
              Turn on
            </Button>
            {locked ? (
              <Button compact mode="text" textColor={colors.muted} onPress={() => setOverride(true)}>
                Start without it
              </Button>
            ) : null}
          </View>
        ) : trackingFresh === false ? (
          <View style={styles.gate}>
            <MaterialCommunityIcons name="alert-outline" size={16} color={colors.warning} />
            <Text variant="bodySmall" style={styles.gateText}>
              Location is on but no signal is reaching the server — riders may not see this cab move.
            </Text>
          </View>
        ) : null}

        {/* ---- DROP RUN, BEFORE BOARDING -------------------------------------
            One button, because everyone gets in at the same place. It is also
            the only thing that can put these riders at 'Arrived', and
            firestore.rules will not let anyone board from any other status. */}
        {phase === RUN_PHASE.AT_OFFICE ? (
          <>
            <Text variant="bodySmall" style={styles.hint}>
              Everyone boards at the office. Tap when you are there, then take each
              rider's code.
            </Text>
            {riders.map((b) => (
              <RiderLine key={b.id} booking={b} />
            ))}
            <Button
              mode="contained"
              icon="office-building-marker"
              style={styles.runBtn}
              contentStyle={styles.runBtnContent}
              labelStyle={styles.runBtnLabel}
              loading={runBusy}
              disabled={runBusy || locked}
              onPress={() => onRunAction(idsToMarkArrived(riders), STATUS.ARRIVED)}
            >
              At the office
            </Button>
          </>
        ) : null}

        {/* ---- BOARDING — the spread-out half, one card per rider ----------- */}
        {phase === RUN_PHASE.BOARDING
          ? riders.map((b) => (
              <DriverRiderCard
                key={b.id}
                booking={b}
                mode="board"
                confirming={confirmingIds.has(b.id)}
                busy={busyId === b.id}
                onArrived={onArrived}
                onBoard={onBoard}
                onNoShow={onNoShow}
                onUndoNoShow={onUndoNoShow}
                onHelp={onHelp}
              />
            ))
          : null}

        {/* ---- READY — everyone resolved, the cab can leave ------------------
            The cards collapse to a line each so the button is on screen without
            scrolling past four tall cards. */}
        {phase === RUN_PHASE.READY && !departed ? (
          <>
            {riders.map((b) => (
              <RiderLine key={b.id} booking={b} onUndoNoShow={onUndoNoShow} busy={busyId === b.id} />
            ))}
            <Button
              mode="contained"
              icon="play"
              style={styles.runBtn}
              contentStyle={styles.runBtnContent}
              labelStyle={styles.runBtnLabel}
              onPress={onDepart}
            >
              Start trip
            </Button>
          </>
        ) : null}

        {/* ---- PICKUP, DRIVING — one button ends the whole run at the office */}
        {!out && phase === RUN_PHASE.READY && departed ? (
          <>
            {riders.map((b) => (
              <RiderLine key={b.id} booking={b} />
            ))}
            <Button
              mode="outlined"
              icon="navigation-variant"
              style={styles.navRunBtn}
              onPress={() => openDirections(tripDropPoint(riders[0]))}
            >
              Navigate to office
            </Button>
            <Button
              mode="contained"
              icon="flag-checkered"
              style={styles.runBtn}
              contentStyle={styles.runBtnContent}
              labelStyle={styles.runBtnLabel}
              loading={runBusy}
              disabled={runBusy}
              onPress={() => onRunAction(idsToComplete(riders), STATUS.COMPLETED)}
            >
              Trip complete
            </Button>
          </>
        ) : null}

        {/* ---- DROP, DRIVING — the spread-out half is the drop -------------- */}
        {out && phase === RUN_PHASE.DROPPING ? (
          <>
            {riders
              .filter((b) => b.status === STATUS.ON_BOARD)
              .map((b) => (
                <DriverRiderCard
                  key={b.id}
                  booking={b}
                  mode="drop"
                  busy={busyId === b.id}
                  onDropped={onDropped}
                  onHelp={onHelp}
                />
              ))}
            {riders
              .filter((b) => b.status !== STATUS.ON_BOARD)
              .map((b) => (
                <RiderLine key={b.id} booking={b} />
              ))}
          </>
        ) : null}

        {phase === RUN_PHASE.DONE ? (
          <>
            {riders.map((b) => (
              <RiderLine key={b.id} booking={b} />
            ))}
            <View style={styles.doneRun}>
              <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.success} />
              <Text variant="bodySmall" style={styles.doneRunText}>
                Run finished.
              </Text>
            </View>
          </>
        ) : null}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  run: {
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legBadge: {
    borderRadius: radius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  legBadgeText: {
    color: '#FFFFFF',
    fontFamily: font.bold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
  },
  headTitle: { flex: 1, minWidth: 0, color: colors.text, fontFamily: font.semibold },
  progress: { color: colors.muted, marginTop: 2, marginBottom: spacing.md },

  gate: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  gateText: { color: colors.warning, flex: 1, minWidth: 180, lineHeight: 18 },
  hint: { color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 19 },

  // THE ONE CAB-LEVEL BUTTON. Bigger than anything on a rider card, and always
  // last, so the run reads: who is on it, what is left, the one thing to press.
  runBtn: { marginTop: spacing.sm, borderRadius: radius.md, ...shadow.brand },
  runBtnContent: { paddingVertical: 10 },
  runBtnLabel: { fontSize: 16, fontFamily: font.semibold, letterSpacing: 0.2 },
  navRunBtn: { marginTop: spacing.sm, borderColor: colors.borderStrong, borderRadius: radius.md },

  doneRun: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  doneRunText: { color: colors.success, fontFamily: font.medium },
});
