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
//
// LAYOUT. On a desktop the sidebar takes 264px and the rest of the window was
// left half empty: a 760px column of cards with three short lines each, and a
// gulf of page background to their right. The column is wider here, and the
// width is spent rather than stretched — the ride's facts sit in a labelled row
// across the card, and everything that DOES something (the cab, the start code,
// Cancel) is gathered into a rail on the right. A phone stacks the two back into
// one column, which is the layout the cards had all along.
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
import { STATUS, SOURCE } from '../../data/mockData';

// The statuses where a ride is over — nothing about it can change any more. Used
// to split the list and to decide whether a "why you can't cancel" line is worth
// showing: on a trip that finished last Tuesday it is just noise.
const FINISHED = [STATUS.COMPLETED, STATUS.CANCELLED, STATUS.NO_SHOW];

// The statuses where a start code still has a job to do. RideStartCode decides
// for itself and renders nothing when there is no code — but this screen has to
// know BEFORE it draws whether the right-hand rail will hold anything, or a
// cancelled ride gets an empty column with a divider down its side.
const AWAITING_BOARDING = [STATUS.ASSIGNED, STATUS.ON_THE_WAY, STATUS.ARRIVED];

// How wide the permanent sidebar is (AppDrawer, web/tablet at >= 900px). The
// window width on its own would have this screen laying itself out for space the
// sidebar is already using.
const SIDEBAR_WIDTH = 264;
const SIDEBAR_BREAKPOINT = 900;

// The filters across the top. `test` runs against a ride plus the flag saying
// which half of the list it landed in, so "Upcoming" means the same thing here
// as it does in the section heading below it.
const FILTERS = [
  { key: 'all', label: 'All rides', test: () => true },
  { key: 'upcoming', label: 'Upcoming', test: (r, over) => !over },
  { key: 'completed', label: 'Completed', test: (r) => r.status === STATUS.COMPLETED },
  { key: 'cancelled', label: 'Cancelled', test: (r) => r.status === STATUS.CANCELLED },
];

// The life of a ride, in order, for the progress tracker. Cancelled and No show
// are deliberately absent: they are not a further step along this line, they are
// the line stopping, and a rider looking at one needs the reason (which the card
// already gives them) rather than a diagram.
const RIDE_STEPS = [
  { status: STATUS.BOOKED, label: 'Booked' },
  { status: STATUS.ASSIGNED, label: 'Cab assigned' },
  { status: STATUS.ON_THE_WAY, label: 'On the way' },
  { status: STATUS.ARRIVED, label: 'Arrived' },
  { status: STATUS.ON_BOARD, label: 'On board' },
  { status: STATUS.COMPLETED, label: 'Completed' },
];

// One labelled fact about the ride. Three of these side by side is what fills
// the wider card: a label the eye can skip and a value it can't, rather than
// three sentences of body text all set at the same weight.
function RideFact({ icon, label, value }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factHead}>
        <MaterialCommunityIcons name={icon} size={13} color={colors.disabled} />
        <Text variant="labelSmall" style={styles.factLabel}>
          {label}
        </Text>
      </View>
      <Text variant="bodyMedium" style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

// WHERE THE RIDE HAS GOT TO. The status chip in the corner says "Arrived" but
// not what that is on the way to, or what has already happened — and on a card
// whose right-hand rail is three or four elements tall, the left column had the
// three facts at the top and a hand's width of nothing underneath. This is the
// thing worth putting there: the same status, as a position on a line.
//
// The colour is the ride's own status colour, so the dots, the chip and the
// stripe down the edge of the card are never three different greens.
function RideProgress({ status, accent, showLabels }) {
  const index = RIDE_STEPS.findIndex((s) => s.status === status);
  if (index < 0) return null;
  const last = RIDE_STEPS.length - 1;

  return (
    <View style={styles.progress}>
      <Text variant="labelSmall" style={styles.factLabel}>
        Ride progress
      </Text>
      <View style={styles.progressTrack}>
        {RIDE_STEPS.map((step, i) => {
          const done = i <= index;
          const current = i === index;
          return (
            <View key={step.status} style={styles.step}>
              {/* The track is drawn as two half-segments per dot rather than one
                  line behind the row: it is the only way each half can be
                  coloured by whether the step on ITS side has been reached, so
                  the line stops exactly at the dot the ride is on. */}
              <View style={styles.dotRow}>
                {i > 0 ? (
                  <View style={[styles.segLeft, done && { backgroundColor: accent }]} />
                ) : null}
                {i < last ? (
                  <View
                    style={[styles.segRight, i < index && { backgroundColor: accent }]}
                  />
                ) : null}
                <View
                  style={[
                    styles.dot,
                    done && { backgroundColor: accent, borderColor: accent },
                    current && [styles.dotCurrent, { borderColor: accent }],
                  ]}
                />
              </View>
              {/* Six labels need about 70px each. There is room for them beside a
                  rail on a desktop and nowhere near it on a phone, which gets the
                  one label that matters instead — see the caption below. */}
              {showLabels ? (
                <Text
                  variant="labelSmall"
                  numberOfLines={2}
                  style={[styles.stepLabel, current && styles.stepLabelOn]}
                >
                  {step.label}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {!showLabels ? (
        <Text variant="bodySmall" style={styles.progressCaption}>
          {RIDE_STEPS[index].label} · step {index + 1} of {RIDE_STEPS.length}
        </Text>
      ) : null}
    </View>
  );
}

export default function MyRidesScreen({ navigation }) {
  const { myBookings, getCabById, currentUser, rideCancelState, cancelAssignedRide } = useApp();
  const rides = myBookings();
  // Two breakpoints, both measured against the space this screen actually gets
  // rather than the whole window: 640 is the app's one phone breakpoint (see
  // ShiftPolicyScreen), and above 820 of usable width a card can carry the facts
  // and the rail side by side without either being squeezed.
  const { width } = useWindowDimensions();
  const contentWidth = width >= SIDEBAR_BREAKPOINT ? width - SIDEBAR_WIDTH : width;
  const isMobile = width < 640;
  const isSplit = contentWidth >= 820;
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
  const [filter, setFilter] = useState('all');

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
  const split = useMemo(() => {
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
    return { upcoming, past };
  }, [rides]);

  // The count beside each filter, so "Cancelled 2" is answered without tapping
  // it — and a filter that would match nothing reads as empty before it's used.
  const filterCounts = useMemo(() => {
    const counts = {};
    for (const f of FILTERS) {
      counts[f.key] =
        split.upcoming.filter((r) => f.test(r, false)).length +
        split.past.filter((r) => f.test(r, true)).length;
    }
    return counts;
  }, [split]);

  const sections = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
    return [
      { title: 'Upcoming', data: split.upcoming.filter((r) => active.test(r, false)) },
      { title: 'Past rides', data: split.past.filter((r) => active.test(r, true)) },
      // An empty half is dropped rather than shown with a "nothing here" line —
      // a rider with no history doesn't need a heading telling them so.
    ].filter((s) => s.data.length);
  }, [split, filter]);

  // The one thing most riders open this screen for. Answered at the top, so it
  // doesn't have to be read back off a card.
  const nextRide = split.upcoming[0] || null;

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
    // Everything actionable goes in the rail. When a ride has none of it — a
    // completed trip, a cancelled one — the facts take the whole card rather
    // than leaving a column of nothing beside them.
    //
    // The "you can no longer cancel this" line is NOT rail material even though
    // it is about cancelling: it is a fact about the ride, it sits with the other
    // facts, and it was the tallest thing in a rail that had nothing to balance
    // it against.
    const hasRail =
      !!cab || canCancel || (hasCab && AWAITING_BOARDING.includes(item.status));
    // The tracker earns its space on a ride that is still going. On a finished
    // one it would be a diagram of something the rider already read in the chip.
    const showProgress = !over;

    return (
      <Card style={styles.card} mode="elevated">
        {/* The status as a colour down the edge of the card, not only as a chip in
            the corner. Scrolling the list, this is what separates "a cab is coming"
            from "this one is done" before a single word has been read. */}
        <View style={[styles.accent, { backgroundColor: statusColor }]} />
        <Card.Content style={styles.body}>
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
            {/* "One-time" ONLY, never "Weekly Schedule". This is the one thing
                the old Ride History screen showed that this one didn't, carried
                over when the two were merged — but it is worth showing only when
                it distinguishes something. Nothing creates ad-hoc rides any more
                (every ride comes from the roster HR uploads), so a source chip on
                every card would read "Weekly Schedule" forever and say nothing.
                Legacy one-time rides still exist in Firestore, and on those the
                label is real information. */}
            {item.source === SOURCE.ADHOC ? (
              <Chip compact style={styles.sourceChip} textStyle={styles.sourceChipText}>
                One-time
              </Chip>
            ) : null}
            <Chip
              compact
              style={{ backgroundColor: statusColor }}
              textStyle={styles.chipText}
            >
              {item.status}
            </Chip>
          </View>

          <View style={[styles.split, isSplit && hasRail && styles.splitRow]}>
            <View style={styles.mainCol}>
              {/* The ride's three facts, labelled and side by side. They were
                  three icon-and-sentence lines stacked down a narrow column —
                  fine at 760px, but at this width the same information reads
                  faster across than down. */}
              <View style={styles.factRow}>
                <RideFact
                  icon={isDrop ? 'home-import-outline' : 'home-export-outline'}
                  label="Journey"
                  value={item.direction}
                />
                {/* Scheduled time, plainly — the "by / after" qualifier was dropped
                    at explicit request. See DeskCancelDialog for the full note. */}
                <RideFact icon="clock-outline" label="Shift time" value={item.shift} />
                <RideFact
                  icon="map-marker-outline"
                  label="Pickup"
                  value={`${item.pickup}${pickupSuffix}`}
                />
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

              {showProgress ? (
                <RideProgress
                  status={item.status}
                  accent={statusColor}
                  showLabels={isSplit}
                />
              ) : null}

              {showClosedReason ? (
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
            </View>

            {/* THE RAIL — the cab, the start code and the one button, together on
                the right. Everything a rider has to DO with a ride is in one
                place instead of trailing down the bottom of the card. */}
            {hasRail ? (
              <View style={[styles.rail, isSplit && styles.railSplit]}>
                {/* Stacked layout keeps the line that used to separate the cab
                    block from the facts above it; the split layout has the rail's
                    own left border doing that job. */}
                {!isSplit ? <Divider style={styles.divider} /> : null}
                {cab ? (
                  /* ONE ROW, NOT FOUR LINES. This was a "Your cab" label above the
                     number, the driver on the next line and the phone on a third —
                     four stacked lines for three short facts. Cab and driver read as
                     one identity ("TS 08 TR 3456 · manmadha"), with Call as the only
                     thing here that does anything, so it sits apart on the right. */
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
                ) : null}

                {/* Shown from the moment a cab is assigned rather than only on arrival:
                    a rider who already has the code in front of them doesn't have to
                    find it while a driver waits. It disappears once they're on board. */}
                <RideStartCode booking={item} />

                {canCancel ? (
                  <View style={styles.cancelBlock}>
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
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </Card.Content>
      </Card>
    );
  }

  // Recomputed as the dialog renders, so a dialog left open past the deadline
  // shows the closure instead of an armed Cancel button.
  const dialogState = cancelFor ? rideCancelState(cancelFor) : null;

  return (
    <View style={styles.container}>
      <View style={[styles.centerCol, isSplit && styles.centerColWide]}>
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
          // THE ANSWER BEFORE THE LIST. A rider opening this screen wants one
          // fact — when the next cab is — and used to have to find it on a card.
          // The filters underneath are here because the list is mostly history:
          // six past rides already push tonight's cab off a phone screen.
          ListHeaderComponent={
            <View style={styles.pageHead}>
              <Text variant="headlineSmall" style={styles.pageTitle}>
                My rides
              </Text>
              {nextRide ? (
                <View style={styles.nextLine}>
                  <MaterialCommunityIcons name="car-clock" size={16} color={colors.primary} />
                  <Text variant="bodyMedium" style={styles.nextText}>
                    Next cab{' '}
                    <Text style={styles.nextStrong}>
                      {relativeDayLabel(nextRide.date) || prettyDateKey(nextRide.date)}
                    </Text>
                    {' at '}
                    <Text style={styles.nextStrong}>{nextRide.shift}</Text>
                    {` · ${nextRide.direction}`}
                  </Text>
                </View>
              ) : (
                <Text variant="bodyMedium" style={styles.pageSub}>
                  No cab scheduled right now. Rides appear here as the transport
                  desk assigns them to your rostered shifts.
                </Text>
              )}
              <View style={styles.filterRow}>
                {FILTERS.map((f) => (
                  <Chip
                    key={f.key}
                    compact
                    selected={filter === f.key}
                    showSelectedOverlay
                    onPress={() => setFilter(f.key)}
                    // A filter that can only ever show an empty list isn't worth
                    // offering — except "All rides", which is the way back.
                    disabled={f.key !== 'all' && filterCounts[f.key] === 0}
                    style={[styles.filterChip, filter === f.key && styles.filterChipOn]}
                    textStyle={[
                      styles.filterChipText,
                      filter === f.key && styles.filterChipTextOn,
                    ]}
                  >
                    {`${f.label} · ${filterCounts[f.key]}`}
                  </Chip>
                ))}
              </View>
            </View>
          }
          // A filter that matches nothing still has to say so — otherwise
          // choosing one on a rider who has none of that status looks broken.
          ListEmptyComponent={
            <View style={styles.noMatch}>
              <MaterialCommunityIcons
                name="filter-off-outline"
                size={32}
                color={colors.disabled}
              />
              <Text variant="bodyMedium" style={styles.noMatchText}>
                No rides match this filter.
              </Text>
            </View>
          }
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
  // 760 was the app-wide column width for a list screen, and on this one it left
  // most of a desktop empty. 1180 is what the cards can fill now that they lay
  // out across; below the split breakpoint the max never binds and the old
  // width is exactly what you get.
  centerCol: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  centerColWide: { maxWidth: 1180 },
  homeBtn: { marginTop: spacing.md, marginLeft: spacing.md, alignSelf: 'flex-start' },
  listContent: { padding: spacing.lg, paddingBottom: 96 },

  // The heading, the one fact worth reading first, and the filters.
  pageHead: { marginBottom: spacing.lg, gap: spacing.sm },
  pageTitle: { color: colors.text, fontFamily: font.semibold },
  pageSub: { color: colors.muted, lineHeight: 20 },
  nextLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySofter,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  nextText: { color: colors.textSecondary, flex: 1, lineHeight: 20 },
  nextStrong: { color: colors.primaryDark, fontFamily: font.semibold },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  filterChip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primaryLight },
  filterChipText: { color: colors.textSecondary, fontFamily: font.medium, fontSize: 12.5 },
  filterChipTextOn: { color: colors.primary, fontFamily: font.semibold },
  noMatch: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  noMatchText: { color: colors.muted },

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
  body: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  // The status colour down the left edge. Absolute so it spans the full height
  // whatever the card ends up containing — a card with a start code panel is much
  // taller than a cancelled one.
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },

  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  whenWrap: { flex: 1, minWidth: 0 },
  when: { fontFamily: font.semibold, color: colors.text },
  sourceChip: { backgroundColor: colors.primarySoft, marginRight: spacing.sm },
  sourceChipText: { color: colors.primary, fontSize: 11.5, fontFamily: font.semibold },
  chipText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: font.semibold },

  // Facts on the left, the rail on the right — one column on a phone.
  split: { width: '100%' },
  // `stretch`, not `flex-start`: the rail's left border is the divider between
  // the two halves, and on flex-start it stopped wherever the rail's content
  // happened to end — a line three-quarters down the card, which reads as a
  // rendering fault rather than a division.
  splitRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xl },
  mainCol: { flex: 1, minWidth: 0 },
  rail: { width: '100%' },
  // Wide enough for the start code at its full size, and fixed rather than
  // proportional so every card's Call button lines up with the one above it.
  railSplit: {
    width: 340,
    flexShrink: 0,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingLeft: spacing.xl,
  },

  // A labelled fact. flexBasis with a minWidth keeps three across on a wide card
  // and drops them to two, then one, as the space goes — without a breakpoint
  // for each step.
  factRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.xl },
  fact: { flexGrow: 1, flexBasis: 150, minWidth: 130 },
  factHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factLabel: {
    color: colors.disabled,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontFamily: font.semibold,
  },
  factValue: { color: colors.text, fontFamily: font.medium, marginTop: 2 },

  // The progress tracker. It sits under the facts and takes the full width of
  // the left column — which is the point: it is what turns the empty half of a
  // tall card into the part of it a rider actually looks at.
  progress: { marginTop: spacing.lg },
  progressTrack: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  step: { flex: 1, alignItems: 'center' },
  // 16 tall so the current step's 14px ring has room without nudging the row.
  dotRow: { width: '100%', height: 16, alignItems: 'center', justifyContent: 'center' },
  segLeft: {
    position: 'absolute',
    left: 0,
    right: '50%',
    top: 7,
    height: 2,
    backgroundColor: colors.border,
  },
  segRight: {
    position: 'absolute',
    left: '50%',
    right: 0,
    top: 7,
    height: 2,
    backgroundColor: colors.border,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  // The step the ride is ON: a ring rather than another filled dot, so "here"
  // is distinguishable from "done" at a glance and not only by being the last
  // coloured one in the row.
  dotCurrent: { width: 16, height: 16, borderRadius: 8, borderWidth: 4, backgroundColor: colors.surface },
  stepLabel: {
    color: colors.disabled,
    textAlign: 'center',
    marginTop: 5,
    fontSize: 10.5,
    lineHeight: 14,
    paddingHorizontal: 2,
  },
  stepLabelOn: { color: colors.text, fontFamily: font.semibold },
  progressCaption: { color: colors.textSecondary, marginTop: spacing.sm },

  divider: { marginBottom: spacing.md, backgroundColor: colors.border },

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

  cancelBlock: { marginTop: spacing.md },
  cancelBtn: { alignSelf: 'flex-start', borderRadius: radius.md },
  deadlineHint: { marginTop: spacing.sm, color: colors.muted },
  // Now that this sits with the facts rather than under a button, it gets the
  // same tinted-box treatment as the desk-cancellation note — a bare amber
  // sentence floating in the left column read like an error the card had run
  // into, rather than a note about the ride.
  closedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  closedText: { color: colors.warning, flex: 1 },
  cancelledNote: { marginTop: spacing.md, fontStyle: 'italic', color: colors.danger },
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
