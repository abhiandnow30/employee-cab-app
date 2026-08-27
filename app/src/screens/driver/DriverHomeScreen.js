// ---------------------------------------------------------------------------
// DRIVER HOME  (My Trips)
//
// THE SCREEN IS BUILT AROUND A RUN, NOT A RIDER. A run is one cab, one
// departure — everyone travelling together. That is the unit the driver
// actually works in, and splitting it out is the whole point of this screen:
//
//   PER RIDER   the decision only that person can settle — are they in the cab
//               (which needs their own code), or are they not coming?
//   PER CAB     the decisions that belong to the vehicle — we are at the office,
//               we are leaving, we are done.
//
// It used to be one flat list with a four-step ladder repeated on every card
// (Start Trip → Arrived → Enter OTP → Complete Trip), so a carpool of four was
// sixteen taps and every one of them was a question about which button belonged
// to whom. Now there is one card per open decision, and exactly one cab-level
// button per run.
//
// EXACTLY ONE HALF OF ANY JOURNEY IS SPREAD ACROSS STOPS, and that half gets the
// cards; the other half happens in one place and gets one button:
//
//   PICKUP (Home → Office)   board at each kerb  ·  drop everyone at the office
//   DROP   (Office → Home)   board at the office ·  drop at each home
//
// SHARING IS THE IGNITION. Turning location sharing on is what moves the run's
// riders to "On the way" — see the effect in AppContext. No button here sets
// that status, because a driver who taps "start" while broadcasting nothing
// leaves the rider watching a map with no cab on it.
//
// WHAT THIS SCREEN CANNOT DO, BY DESIGN: reach "On board" without the rider's
// rider’s code. That check lives in firestore.rules against a document this
// app cannot read, so there is nothing here to work around — and "Completed" is
// only reachable from "On board", which is what stops a trip being marked
// finished for someone who never got in.
//
// RIDERS ARE IDENTIFIED BY NAME (see DriverRiderCard) — a driver calling out
// "Employee 1415?" at a gate is not how anyone finds the person they are
// collecting.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList, Pressable } from 'react-native';
import { Text, Card, Button, Snackbar, Portal, Dialog, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { STATUS } from '../../data/mockData';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { SUPPORT_HELPLINE } from '../../branding';
import { timeToMinutes, todayKey, shiftDateKey } from '../../utils/datetime';
import { callNumber } from '../../utils/externalLinks';
import { groupRuns } from '../../services/driverRun';
import DriverRunSection from '../../components/DriverRunSection';
import { riderLabel } from '../../components/DriverRiderCard';

export default function DriverHomeScreen({ navigation }) {
  const {
    currentUser,
    bookings,
    myCab,
    updateBookingStatus,
    updateBookingStatuses,
    startRideWithOtp,
    markNoShow,
    getCabById,
    sharingLocation,
    startSharingLocation,
    stopSharingLocation,
    sharingBackground,
    sharingError,
    trackingFresh,
  } = useApp();

  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null); // the trip whose write is in flight
  const [runBusyKey, setRunBusyKey] = useState(null); // the run whose batch is in flight
  const [noShowFor, setNoShowFor] = useState(null); // trip pending no-show confirmation
  // Riders whose code has been sent but NOT yet acknowledged by the server. See
  // the note in DriverRiderCard: Firestore shows the write locally straight away
  // and only the server can judge the code, so a run must not advance on the
  // strength of a boarding that might still be refused.
  const [confirmingIds, setConfirmingIds] = useState(() => new Set());
  // Runs the driver has said have pulled away. Deliberately screen state and not
  // a document: a driver may only write a booking's status, and there is no
  // status for "the cab left" that isn't a claim about one of the riders. Losing
  // it — an app restart — costs one harmless tap and records nothing wrong.
  const [departedKeys, setDepartedKeys] = useState(() => new Set());
  // The helpline, behind one small button. Shared by every card because it dials
  // the same desk whichever trip you were looking at.
  const [helpOpen, setHelpOpen] = useState(false);
  // Turning sharing on asks the OS for location permission, which is a round trip —
  // the switch is held disabled meanwhile so it can't be flipped twice.
  const [sharingBusy, setSharingBusy] = useState(false);

  // Every driver write waits and reports. They used to be fire-and-forget: a
  // rejected write simply did nothing and the button sat there.
  async function advance(booking, nextStatus) {
    setError('');
    setBusyId(booking.id);
    const res = await updateBookingStatus(booking.id, nextStatus);
    setBusyId(null);
    if (!res?.ok) setError(res?.message || 'Could not update the trip. Please try again.');
  }

  // A cab-level action: the same status onto every rider the run's selectors say
  // it is legal for. `ids` arrives already filtered (services/driverRun.js) —
  // the batch is atomic, so one ineligible rider would refuse the lot.
  async function runAction(runKey, ids, status) {
    setError('');
    if (!ids.length) return;
    setRunBusyKey(runKey);
    const res = await updateBookingStatuses(ids, status);
    setRunBusyKey(null);
    if (!res?.ok) setError(res?.message || 'Could not update the trips. Please try again.');
  }

  // The rider's code. A wrong one is refused by the rules, not by this screen.
  //
  // The id is held in `confirmingIds` for the WHOLE round trip, not just while a
  // spinner turns: that set is what stops the run's cab button appearing on an
  // unconfirmed boarding, which is the difference between a driver waiting two
  // seconds and a driver pulling away from someone who never actually boarded.
  async function board(booking, code) {
    setError('');
    setConfirmingIds((prev) => new Set(prev).add(booking.id));
    const res = await startRideWithOtp(booking.id, code);
    setConfirmingIds((prev) => {
      const next = new Set(prev);
      next.delete(booking.id);
      return next;
    });
    return res;
  }

  // Putting a mis-tapped no-show back. 'Arrived' is reachable from any status in
  // firestore.rules, so this is an ordinary write — and it is the only way a
  // driver can correct a claim that otherwise reaches the desk as fact.
  async function undoNoShow(booking) {
    await advance(booking, STATUS.ARRIVED);
  }

  // ONE SWITCH, BOTH DIRECTIONS. It was a button that navigated to another screen
  // to turn on and a "Stop" link to turn off — two different controls for two halves
  // of one setting, and the "on" half meant leaving the trips behind to do it.
  //
  // startSharingLocation() asks the OS for permission itself and reports back
  // ({ denied } or { message }), so nothing had to move out of AppContext: the same
  // call the sharing screen makes is the one this switch makes. A refusal flips the
  // switch straight back, because `sharingLocation` never became true — the switch
  // reads that state rather than remembering its own.
  // One wording for a refused start, wherever it was asked for — the switch above
  // and the prompt before the OTP both end up here.
  function reportSharingFailure(res) {
    setError(
      res?.denied
        ? 'Location permission denied. Allow location for this app in your device settings, then try again.'
        : res?.message || 'Could not start location sharing.'
    );
  }

  async function toggleSharing(next) {
    if (!next) {
      stopSharingLocation();
      return;
    }
    setSharingBusy(true);
    const res = await startSharingLocation();
    setSharingBusy(false);
    if (!res?.ok) reportSharingFailure(res);
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
  // THIS DAY'S RUN, NOT THE CAB'S HISTORY. The subscription used to be unbounded
  // and this list had no date filter either, so a driver opening My Trips saw last
  // week's completed and no-show trips above tonight's, each still offering its
  // action buttons.
  //
  // subscribeCabBookings fetches only today and yesterday (DRIVER_WINDOW_DAYS),
  // and this is the second, narrower gate on top of it:
  //
  //   • TODAY — everything, finished or not. A driver should be able to see the
  //     stops they have already completed on tonight's run, not just the ones left.
  //   • YESTERDAY — only trips still UNFINISHED. This is the midnight case and
  //     nothing else: the 10 PM drop is still being driven at 00:10, and a strict
  //     "today only" rule would empty the screen mid-run. Yesterday's Completed and
  //     No-show rows are history, so they go.
  //
  // Cancelled is excluded at every date — a stood-down ride is not a stop. It is
  // also what makes a mid-run cancellation resolve itself: the rider drops out of
  // the run entirely, so if they were the last one unresolved the run recomputes
  // straight to ready with no stuck phase and nothing for the driver to clear.
  const today = todayKey();
  const yesterday = shiftDateKey(today, -1);
  const runs = useMemo(() => {
    const mine = bookings.filter((b) => {
      if (b.status === STATUS.CANCELLED) return false;
      if (b.assignedCabId !== currentUser?.cabId) return false;
      const date = String(b.date || '');
      if (date === today) return true;
      if (date !== yesterday) return false;
      return b.status !== STATUS.COMPLETED && b.status !== STATUS.NO_SHOW;
    });
    // Riders within a run are ordered by the SAME label the cards show, so the
    // sequence on screen is one the driver can scan. It is NOT a route order and
    // is no longer presented as one — the old "STOP 2 OF 4" implied a sequence
    // the app has never modelled.
    const sorted = [...mine].sort((a, b) => {
      const byDate = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDate) return byDate;
      const byTime = (timeToMinutes(a.shift) ?? 0) - (timeToMinutes(b.shift) ?? 0);
      if (byTime) return byTime;
      return riderLabel(a).localeCompare(riderLabel(b));
    });
    return groupRuns(sorted, departedKeys);
  }, [bookings, currentUser?.cabId, today, yesterday, departedKeys]);

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

      {/* LOCATION SHARING, IN ONE LINE WITH A SWITCH. It was a full-width filled
          button plus a banner underneath — two rows and the loudest thing on the
          screen, competing with the trip actions for attention. It is a background
          setting, and a switch is what a setting looks like:
            ⌖ Location sharing ON   [on]
            ⦸ Location sharing OFF  [off]
          The pin and the word are still there because the switch alone is a small
          target to read at a glance in a moving car — three cues for one state,
          and the pin is the one that says what the row is FOR without being read.
          Share Location is still in the driver's menu: that screen keeps the live
          coordinates readout and the warning for a cab that isn't linked back, which
          are worth a screen and not worth a row here. */}
      <View style={styles.shareRow}>
        {/* THE WORDS OPEN THE DETAILS, THE SWITCH DOES THE THING. Two targets on one
            row, split the way the driver already reads it: the state on the left, the
            control on the right. This is also the only way into the sharing screen
            now that its menu row is gone — that screen still holds the live
            coordinates and the "your cab isn't linked back" warning, and a screen
            nothing can reach is how those quietly stop existing. */}
        <Pressable
          style={styles.shareLabel}
          onPress={() => navigation.navigate('DriverShareLocation')}
          accessibilityRole="button"
          accessibilityLabel="Location sharing details"
        >
          {/* FOUR STATES, NOT TWO. "ON" alone was a claim about a switch; these are
              claims about the feed:
                ON            — publishing, fresh fix inside the live window
                ON · no GPS   — switch on, nothing reaching the database. The one
                                case the old UI got wrong, and the one that matters:
                                the driver believes they are visible and they are not.
                Starting…     — on, first fix not in yet. Normal for a few seconds.
                OFF           — not sharing.
              trackingFresh is null until the first fix, which is what separates
              "starting" from "failing". */}
          {/* A LOCATION PIN, NOT A COLOURED DOT. The dot said "something is in one
              of two states" and left the driver to remember which thing — fine for
              anyone who set it up, useless at a glance from the driver's seat. A
              map pin says WHAT the row is about before a word is read, which is
              the point for a screen used one-handed at a kerb, at night, by
              someone who may not read the English beside it.

              THE SHAPE CHANGES WITH THE STATE, not just the colour. The old dot
              carried its meaning almost entirely in green-vs-grey, and the one
              state that matters most — switch on, nothing actually reaching the
              database — was amber against green, the exact pair red-green colour
              blindness merges. A struck-through pin, a pin with a warning, and a
              pin with signal rings are told apart without any colour at all. */}
          <MaterialCommunityIcons
            name={
              !sharingLocation
                ? 'map-marker-off'
                : trackingFresh === false
                ? 'map-marker-alert'
                : trackingFresh === null
                ? 'crosshairs-gps'
                : 'map-marker-radius'
            }
            size={22}
            color={
              !sharingLocation
                ? colors.muted
                : trackingFresh === false
                ? colors.warning
                : trackingFresh === null
                ? colors.muted
                : colors.success
            }
          />
          <Text
            variant="bodyMedium"
            style={[
              styles.shareText,
              sharingLocation && trackingFresh !== false && styles.shareTextOn,
              sharingLocation && trackingFresh === false && styles.shareTextWarn,
            ]}
          >
            {!sharingLocation
              ? 'Location sharing OFF'
              : trackingFresh === false
              ? 'Location ON · no GPS signal'
              : trackingFresh === null
              ? 'Location starting…'
              : sharingBackground
              ? 'Location sharing ON'
              : 'Location ON · app must stay open'}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
        </Pressable>
        <Switch
          value={sharingLocation}
          onValueChange={toggleSharing}
          // No cab linked means there is nothing to broadcast for — the write
          // would be refused by the rules anyway.
          disabled={needsCab || sharingBusy}
          color={colors.success}
          accessibilityLabel={
            sharingLocation ? 'Location sharing is on. Turn it off' : 'Turn location sharing on'
          }
        />
      </View>

      {/* Whatever went wrong with sharing, said where the switch is rather than only
          in a snackbar that has since disappeared — a resumed session that could not
          get its permission back reports itself here on launch. */}
      {sharingError ? (
        <View style={styles.shareErrRow}>
          <MaterialCommunityIcons name="alert-outline" size={15} color={colors.warning} />
          <Text variant="bodySmall" style={styles.shareErrText}>
            {sharingError}
          </Text>
        </View>
      ) : null}

      <Text variant="titleMedium" style={styles.sectionTitle}>
        My Trips
      </Text>

      {/* ONE ITEM PER RUN, riders mapped inside it rather than a nested list —
          a FlatList inside a FlatList warns in React Native and buys nothing at
          the four-to-seven rows a cab actually holds. */}
      <FlatList
        data={runs}
        keyExtractor={(run) => run.key}
        renderItem={({ item: run }) => (
          <DriverRunSection
            run={run}
            departed={run.departed}
            onDepart={() => setDepartedKeys((prev) => new Set(prev).add(run.key))}
            sharingLocation={sharingLocation}
            trackingFresh={trackingFresh}
            onTurnOnLocation={() => toggleSharing(true)}
            sharingBusy={sharingBusy}
            confirmingIds={confirmingIds}
            busyId={busyId}
            runBusy={runBusyKey === run.key}
            onArrived={(b) => advance(b, STATUS.ARRIVED)}
            onBoard={board}
            onNoShow={setNoShowFor}
            onUndoNoShow={undoNoShow}
            onDropped={(b) => advance(b, STATUS.COMPLETED)}
            onRunAction={(ids, status) => runAction(run.key, ids, status)}
            onHelp={() => setHelpOpen(true)}
          />
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="car-clock" size={44} color={colors.muted} />
            <Text variant="bodyMedium" style={styles.emptyText}>
              No trips assigned for today.
            </Text>
            <Text variant="bodySmall" style={styles.emptyHint}>
              Trips appear here once the transport desk gives your cab a run.
            </Text>
          </View>
        }
      />

      <Portal>
        {/* Plain words. It was "Flag a no-show?" over two clauses about what the
            desk would see — the driver is standing at a gate deciding whether
            somebody is there. The rider's NAME stays in the question, because a
            carpool is four of these cards and confirming the wrong one is the
            mistake worth preventing. */}
        <Dialog visible={!!noShowFor} onDismiss={() => setNoShowFor(null)} style={styles.dialog}>
          <Dialog.Title>Employee not here?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyLarge">
              Is {noShowFor ? riderLabel(noShowFor) : 'this employee'} not present?
            </Text>
            <Text variant="bodySmall" style={styles.dialogNote}>
              This ends the trip and tells the transport desk.
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
              Confirm No-show
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* HELP — where the helpline went. Same number, same call, one tap deeper,
            and off every card. The note says why there is no rider number to call:
            drivers deliberately never see the employee's own mobile. */}
        <Dialog visible={helpOpen} onDismiss={() => setHelpOpen(false)} style={styles.dialog}>
          <Dialog.Title>Need help?</Dialog.Title>
          <Dialog.Content>
            <Button
              mode="contained"
              icon="phone"
              style={styles.helpBtn}
              contentStyle={styles.mainBtnContent}
              onPress={() => {
                setHelpOpen(false);
                callNumber(SUPPORT_HELPLINE);
              }}
            >
              Call Helpline
            </Button>
            <Text variant="titleMedium" style={styles.helpNumber}>
              {SUPPORT_HELPLINE}
            </Text>
            <Text variant="bodySmall" style={styles.dialogNote}>
              The transport desk can reach the employee for you.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setHelpOpen(false)}>Close</Button>
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
  container: {
    flex: 1,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  header: { marginBottom: spacing.lg },
  sub: { color: colors.muted, marginTop: 2 },
  setupCard: {
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.primarySofter,
  },
  setupRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  setupText: { flex: 1, minWidth: 0 },
  setupBody: { color: colors.textSecondary, marginTop: 2, lineHeight: 19 },

  // Location sharing as one quiet line: dot, words, one control.
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // The tappable half: pin, words, chevron. flex: 1 here instead of on the text, so
  // the whole label group takes the free space and the switch stays hard right.
  shareLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  shareText: { color: colors.muted },
  shareTextOn: { color: colors.success, fontFamily: font.semibold },
  shareTextWarn: { color: colors.warning, fontFamily: font.semibold },
  shareErrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
    paddingRight: spacing.sm,
  },
  shareErrText: { color: colors.warning, flex: 1, lineHeight: 18 },

  sectionTitle: { marginBottom: spacing.md, color: colors.text },
  listContent: { paddingBottom: spacing.xl },

  // One definition for both the header name and the card name — they were two
  // keys with the same name in this object, so the second silently won anyway.
  name: { fontFamily: font.bold, color: colors.text, flex: 1, minWidth: 0 },



  mainBtnContent: { paddingVertical: 10 },

  dialog: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  dialogNote: { color: colors.muted, marginTop: spacing.md, lineHeight: 19 },
  helpBtn: { borderRadius: radius.md },
  helpNumber: {
    textAlign: 'center',
    marginTop: spacing.md,
    color: colors.text,
    fontFamily: font.bold,
  },
  empty: { alignItems: 'center', marginTop: 48 },
  emptyText: { color: colors.text, marginTop: spacing.sm, fontFamily: font.semibold },
  emptyHint: {
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 20,
  },
});
