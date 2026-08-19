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

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, SectionList, useWindowDimensions } from 'react-native';
import {
  Text, Card, Chip, Divider, Button, Portal, Dialog, TextInput,
  HelperText, Snackbar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import RideStartCode from '../../components/RideStartCode';
import { statusColors, colors, font, radius, shadow, spacing } from '../../theme';
import { callNumber } from '../../utils/externalLinks';
import {
  formatDeadline, prettyDateKey, relativeDayLabel, isPastDateKey, timeToMinutes,
} from '../../utils/datetime';
import { STATUS } from '../../data/mockData';

// The statuses where a ride is over — nothing about it can change any more. Used
// to split the list and to decide whether a "why you can't cancel" line is worth
// showing: on a trip that finished last Tuesday it is just noise.
const FINISHED = [STATUS.COMPLETED, STATUS.CANCELLED, STATUS.NO_SHOW];

export default function MyRidesScreen({ navigation }) {
  const { myBookings, getCabById, currentUser, rideCancelState, cancelAssignedRide } = useApp();
  const rides = myBookings();
  // Same one breakpoint as the rest of the app (see ShiftPolicyScreen). A rider is
  // usually on their phone, so this is the layout that matters most here.
  const { width } = useWindowDimensions();
  const isMobile = width < 640;
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

  // WHAT'S NEXT, THEN WHAT HAPPENED. The list arrived in whatever order the
  // subscription held — newest first — which put a cab three days away above the
  // one arriving tonight, and buried tonight's under last week's cancellations.
  //
  // Upcoming is sorted NEAREST FIRST (the opposite of past), because the only
  // question this screen exists to answer is "when is my next cab, and is it
  // coming?" — that ride belongs at the top, not at the end of a scroll. Past is
  // most-recent first, which is how anybody reads back through history.
  const sections = useMemo(() => {
    const upcoming = [];
    const past = [];
    for (const r of rides) {
      const over = FINISHED.includes(r.status) || isPastDateKey(r.date);
      (over ? past : upcoming).push(r);
    }
    // ISO keys compare as text; the shift time breaks a tie within one day, so a
    // morning pickup sits above that evening's drop.
    upcoming.sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        (timeToMinutes(a.shift) ?? 0) - (timeToMinutes(b.shift) ?? 0)
    );
    past.sort(
      (a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        (timeToMinutes(b.shift) ?? 0) - (timeToMinutes(a.shift) ?? 0)
    );
    return [
      { title: 'Upcoming', data: upcoming },
      { title: 'Past rides', data: past },
      // An empty half is dropped rather than shown with a "nothing here" line —
      // a rider with no history doesn't need a heading telling them so.
    ].filter((s) => s.data.length);
  }, [rides]);

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
    const hasCab = !!item.assignedCabId;
    const over = FINISHED.includes(item.status);
    // THE BUTTON IS ONLY THERE WHEN IT WORKS. It used to render greyed out on
    // every ride that had a cab — including trips already under way and trips
    // finished weeks ago — each one paired with a sentence explaining why the
    // button beneath it does nothing. A disabled control is still a control: it
    // reads as "you can do this" until you try. Now the reason stands alone when
    // cancelling is closed, and a finished ride shows neither.
    const canCancel = hasCab && cancelState.canCancel;
    const showClosedReason = hasCab && !cancelState.canCancel && !over && !!cancelState.reason;

    const statusColor = statusColors[item.status] || colors.muted;
    const relative = relativeDayLabel(item.date);
    const isDrop = item.direction !== 'Home → Office';

    return (
      <Card style={[styles.card, isMobile && styles.cardMobile]} mode="elevated">
        {/* The status as a colour down the edge of the card, not only as a chip in
            the corner. Scrolling the list, this is what separates "a cab is coming"
            from "this one is done" before a single word has been read. */}
        <View style={[styles.accent, { backgroundColor: statusColor }]} />
        <Card.Content style={isMobile ? styles.bodyMobile : undefined}>
          {/* THE DATE IS THE HEADING. It used to be the direction, with a raw ISO
              key ("2026-08-19") on the line below — but every ride on this screen
              is one of the same two journeys, so the direction never told the rider
              which card they were looking at. The day does. */}
          <View style={styles.rowBetween}>
            <View style={styles.whenWrap}>
              <Text variant="titleMedium" style={styles.when}>
                {relative ? `${relative} · ` : ''}
                {prettyDateKey(item.date)}
              </Text>
            </View>
            <Chip
              compact
              style={{ backgroundColor: statusColor }}
              textStyle={styles.chipText}
            >
              {item.status}
            </Chip>
          </View>

          {/* Direction and time on one line with the leg's own icon — the same pair
              of icons the driver's and coordinator's screens use for in vs out. */}
          <View style={styles.metaRow}>
            <MaterialCommunityIcons
              name={isDrop ? 'home-import-outline' : 'home-export-outline'}
              size={15}
              color={colors.muted}
            />
            <Text variant="bodyMedium" style={styles.meta}>
              {/* Scheduled time, plainly — the "by / after" qualifier was dropped at
                  explicit request. See DeskCancelDialog for the full note. */}
              {item.direction} · {item.shift}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={15} color={colors.muted} />
            <Text variant="bodyMedium" style={styles.meta}>
              Pickup: {item.pickup}{pickupSuffix}
            </Text>
          </View>

          {/* Why this ride was cancelled, on the rider's own copy — so someone
              looking back at the list can see it was them and what they said. */}
          {/* WHO CANCELLED IT. Two very different sentences, and getting them the
              wrong way round matters: telling a rider "you cancelled this" about a
              ride the transport desk stood down after their own phone call is both
              wrong and confusing, and this is the rider's record of what happened.
              `cancellationSource === 'desk'` is written only by the desk path, so it
              is the thing to key on — not the presence of a reason, which both
              paths write. */}
          {item.status === STATUS.CANCELLED && item.cancellationSource === 'desk' ? (
            <View style={styles.deskCancelledBox}>
              <MaterialCommunityIcons name="headset" size={15} color={colors.danger} />
              <Text variant="bodySmall" style={styles.deskCancelledText}>
                Ride cancelled by Transport Desk
                {item.cancellationReason ? ` — ${item.cancellationReason}` : ''}
              </Text>
            </View>
          ) : item.status === STATUS.CANCELLED && item.cancellationReason ? (
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
              {/* ONE ROW, NOT FOUR LINES. This was a "Your cab" label above the
                  number, the driver on the next line and the phone on a third —
                  four stacked lines for three short facts. Cab and driver read as
                  one identity ("TS 08 TR 3456 · manmadha"), with Call as the only
                  thing here that does anything, so it sits apart on the right. */}
              <View style={[styles.cabRow, isMobile && styles.cabRowMobile]}>
                <MaterialCommunityIcons name="car-side" size={18} color={colors.primary} />
                <View style={styles.cabText}>
                  <Text variant="titleSmall" style={styles.cabNumber}>
                    {cab.cabNumber}
                  </Text>
                  {cab.driverName ? (
                    <Text variant="bodySmall" style={styles.cabDriver}>
                      {cab.driverName}
                    </Text>
                  ) : null}
                </View>
                {/* Tappable, not just printed. This was plain text, so a rider
                    standing on the road at 8 PM had to memorise the number and
                    retype it into the dialer. callNumber() opens the dialer
                    pre-filled — the person still presses call.
                    The number itself is no longer the label: at the kerb the rider
                    wants to reach the driver, not read out ten digits. */}
                {cab.driverPhone ? (
                  <Button
                    mode="contained-tonal"
                    icon="phone"
                    compact
                    onPress={() => callNumber(cab.driverPhone)}
                    style={styles.callBtn}
                    accessibilityLabel={`Call the driver on ${cab.driverPhone}`}
                  >
                    Call
                  </Button>
                ) : null}
              </View>
            </>
          )}

          {canCancel ? (
            <>
              <Divider style={styles.divider} />
              <Button
                mode="outlined"
                icon="calendar-remove"
                onPress={() => openCancel(item)}
                textColor={colors.danger}
                style={styles.cancelBtn}
              >
                Cancel this ride
              </Button>
              {cancelState.deadline ? (
                <Text variant="bodySmall" style={styles.deadlineHint}>
                  You can cancel until {formatDeadline(cancelState.deadline)}.
                </Text>
              ) : null}
            </>
          ) : showClosedReason ? (
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
      {/* Compact and quiet. It was a full-size filled button taking a row of its
          own above the rides — the loudest thing on a screen where the rides are
          the point, and redundant on desktop where Home is in the sidebar. Still
          here because on a phone the drawer is behind a tap, and this is the one
          screen an employee lands on from a notification. */}
      <Button
        icon="chevron-left"
        mode="text"
        compact
        onPress={() => navigation.navigate('EmployeeHome')}
        style={styles.homeBtn}
      >
        Home
      </Button>

      {rides.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="calendar-blank-outline" size={44} color={colors.muted} />
          <Text variant="titleMedium" style={styles.emptyTitle}>
            No rides yet
          </Text>
          <Text variant="bodyMedium" style={styles.emptyText}>
            Your cabs appear here once the transport desk assigns them to your
            rostered shifts.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderRide}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text variant="labelLarge" style={styles.sectionTitle}>
                {section.title}
              </Text>
              <Text variant="bodySmall" style={styles.sectionCount}>
                {section.data.length}
              </Text>
            </View>
          )}
          // Sticky headers would sit over the cards as you scroll; there are only
          // ever two of them, so they cost less floating away with the list.
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* No "Change request" button here any more. It floated over the list on a
          screen whose own actions live on the ride cards, and it was the third
          way into the same form — Home and Weekly Schedule both still offer it,
          which is where somebody is when they realise a shift is wrong. */}
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
                {/* Same wording as the card it was opened from — this is the last
                    screen before a cab is stood down, so "which ride was that?"
                    must not need a trip back to the list. */}
                <Text variant="bodySmall" style={styles.summaryMeta}>
                  {relativeDayLabel(cancelFor.date)
                    ? `${relativeDayLabel(cancelFor.date)} · `
                    : ''}
                  {prettyDateKey(cancelFor.date)} · {cancelFor.shift}
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
  container: { flex: 1, backgroundColor: colors.background },
  centerCol: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  homeBtn: { marginTop: spacing.md, marginLeft: spacing.md, alignSelf: 'flex-start' },
  listContent: { padding: spacing.lg, paddingBottom: 96 },

  // "Upcoming" / "Past rides". A quiet label with its count, not a filled banner —
  // it separates two groups, it isn't an action.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: colors.muted,
    fontFamily: font.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  sectionCount: { color: colors.disabled },

  // overflow: hidden is what makes the accent stripe follow the card's rounded
  // corners instead of squaring them off.
  card: {
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardMobile: { marginBottom: spacing.md },
  bodyMobile: { paddingHorizontal: spacing.lg },
  // The status colour down the left edge. Absolute so it spans the full height
  // whatever the card ends up containing — a card with a start code panel is much
  // taller than a cancelled one.
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },

  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  whenWrap: { flex: 1, minWidth: 0 },
  when: { fontFamily: font.semibold, color: colors.text },
  chipText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: font.semibold },

  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 3 },
  meta: { color: colors.textSecondary, flex: 1 },

  divider: { marginVertical: spacing.md, backgroundColor: colors.border },

  // Cab, driver and the call button on one line. Tinted so the block reads as
  // "your ride is this vehicle" rather than as more body text.
  cabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // A phone can't fit cab number, driver and a button across one line without the
  // number ellipsising — and the cab number is what the rider matches against the
  // vehicle in front of them.
  cabRowMobile: { flexWrap: 'wrap', rowGap: spacing.sm },
  cabText: { flex: 1, minWidth: 0 },
  cabNumber: { fontFamily: font.semibold, color: colors.text },
  cabDriver: { color: colors.muted },
  callBtn: { flexShrink: 0, borderRadius: radius.md },

  cancelBtn: { alignSelf: 'flex-start', borderRadius: radius.md },
  deadlineHint: { marginTop: spacing.sm, color: colors.muted },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  closedText: { color: colors.warning, flex: 1 },
  cancelledNote: { marginTop: spacing.sm, fontStyle: 'italic', color: colors.danger },
  deskCancelledBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  deskCancelledText: { color: colors.danger, flex: 1, lineHeight: 18 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { color: colors.text, fontFamily: font.semibold },
  emptyText: { textAlign: 'center', color: colors.muted, maxWidth: 340, lineHeight: 20 },
  dialog: { width: '100%', maxWidth: 470, alignSelf: 'center' },
  summary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryLine: { fontFamily: font.semibold, color: colors.text },
  summaryMeta: { color: colors.muted, marginTop: 2 },
  reasonInput: { marginTop: 2, backgroundColor: colors.surface },
  closedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
