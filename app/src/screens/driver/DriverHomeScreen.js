// ---------------------------------------------------------------------------
// DRIVER HOME  (My Trips) — Step 9
// The trips the coordinator assigned to THIS driver's cab, in PICKUP SEQUENCE:
// sorted by date then pickup time, and numbered within each run so a carpool
// reads as "Stop 2 of 4" rather than an unordered list. The driver advances
// each trip's status: Cab assigned → On the way → Arrived → On board → Completed,
// where the step into "On board" needs the rider's own 6-digit code.
// A one-line "Location sharing ON / OFF" row broadcasts the driver's GPS for the
// cab (the control panel for it is DriverShareLocation).
//
// LOCATION SHARING IS REQUIRED BEFORE A RIDE STARTS. Tapping "Enter OTP" with
// sharing off opens a prompt that turns it on and then goes straight to the code,
// so the driver never has to go and find the switch. It is a client-side gate —
// firestore.rules cannot see the Realtime Database, so nothing server-side knows
// whether GPS is streaming; the OTP is still what protects boarding, and this is
// what stops a trip running dark.
//
// THE CARD ANSWERS THREE QUESTIONS IN ORDER — who am I collecting, where do I go,
// what do I press now — and carries nothing else. The current step is the only
// filled button on it; Navigate and Help are deliberately smaller, and the
// helpline moved off the card into Help rather than being printed on every one.
//
// RIDERS ARE IDENTIFIED BY NAME HERE. (Reversed Aug 2026, at explicit request —
// this screen used to show only `empId`, on the reasoning that a name adds nothing
// operationally and is more of the rider's identity than the job requires. The
// counter-argument won: a driver calling out "Employee 1415?" at a gate is not how
// anyone finds the person they are collecting.)
//
// The name comes from `employeeName` on the BOOKING, denormalised there when the
// ride was created — the security rules deliberately don't let a driver read
// employee profiles, so there is nothing to look up. The ID stays as the fallback
// for older bookings written before the name was carried across.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList, Pressable } from 'react-native';
import {
  Text, Card, Button, Snackbar, Portal, Dialog, TextInput, Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { RIDE_OTP_LENGTH, STATUS } from '../../data/mockData';
import { statusColors, colors } from '../../theme';
import { SUPPORT_HELPLINE } from '../../branding';
import { tripPickupPoint, tripPlaceLabels } from '../../services/directions';
import {
  timeToMinutes, prettyDateKey, relativeDayLabel, todayKey, shiftDateKey,
} from '../../utils/datetime';
import { openDirections, callNumber } from '../../utils/externalLinks';

// Open maps directions to where the driver collects this employee. Platform
// details (Google/Apple Maps app vs. web tab) live in utils/externalLinks.
function navigateToPickup(booking) {
  openDirections(tripPickupPoint(booking));
}

// How a rider appears on the driver's screen: their name, falling back to their
// employee ID and then to a plain label. Both fallbacks matter — a card with no
// heading at all reads as a rendering fault, and the driver still has to collect
// whoever this is.
function riderLabel(booking) {
  const name = String(booking?.employeeName || '').trim();
  if (name) return name;
  const id = String(booking?.empId || '').trim();
  return id ? `Employee ID ${id}` : 'Employee (name not on record)';
}

// What the driver can do next, per current status. The statuses and the order are
// unchanged — only the wording is shorter, because this is the one thing on the
// card the driver reads while a car is idling behind them.
//
// "Arrived" is the one step that is not simply a tap: the rider reads out the
// six digits on their own screen and the driver types them in. That check happens
// in firestore.rules against a document this app cannot read, so there is nothing
// here to work around — the button opens the dialog, and the write is what's
// judged. See services/rideOtp.js.
const NEXT_ACTION = {
  'Cab assigned': { next: 'On the way', label: 'Start Trip', icon: 'play' },
  'On the way': { next: 'Arrived', label: 'Arrived', icon: 'map-marker-check' },
  Arrived: { otp: true, label: 'Enter OTP', icon: 'shield-key' },
  'On board': { next: 'Completed', label: 'Complete Trip', icon: 'flag-checkered' },
};

export default function DriverHomeScreen({ navigation }) {
  const {
    currentUser,
    bookings,
    myCab,
    updateBookingStatus,
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
  const [noShowFor, setNoShowFor] = useState(null); // trip pending no-show confirmation
  const [otpFor, setOtpFor] = useState(null); // trip whose rider code is being entered
  const [otpEntry, setOtpEntry] = useState('');
  const [otpError, setOtpError] = useState('');
  // The helpline, moved off the cards and behind one small button. Shared by every
  // card because it dials the same desk whichever trip you were looking at.
  const [helpOpen, setHelpOpen] = useState(false);
  // Turning sharing on asks the OS for location permission, which is a round trip —
  // the switch is held disabled meanwhile so it can't be flipped twice.
  const [sharingBusy, setSharingBusy] = useState(false);
  // The trip whose OTP was tapped while location sharing was off. Holding it here
  // is what lets the prompt turn sharing on and then carry straight on to the code
  // entry, instead of dropping the driver back on the card to tap again.
  const [locationGateFor, setLocationGateFor] = useState(null);

  // Both driver actions used to be fire-and-forget: if the write was rejected
  // the button just did nothing. Now they wait, and say so when they fail.
  async function advance(booking, nextStatus) {
    setError('');
    setBusyId(booking.id);
    const res = await updateBookingStatus(booking.id, nextStatus);
    setBusyId(null);
    if (!res?.ok) setError(res?.message || 'Could not update the trip. Please try again.');
  }

  // Open the code prompt for a trip. State is reset here rather than on close, so
  // a mistyped code from the previous rider can't be sitting in the box when the
  // next dialog opens.
  function openOtpDialog(booking) {
    setError('');
    setOtpError('');
    setOtpEntry('');
    setOtpFor(booking);
  }

  // THE GATE. The rider is about to get in, which is the moment their people start
  // watching the cab move — so sharing has to be on before the ride can start, the
  // way it works on the apps drivers already use.
  //
  // A CLIENT-SIDE GATE, and worth being clear about: firestore.rules cannot see the
  // Realtime Database, so nothing server-side knows whether GPS is streaming. The
  // OTP is still what actually protects boarding; this is what stops a trip running
  // dark, and the desk can always move a ride on by hand if a phone's GPS refuses.
  function askForOtp(booking) {
    if (!sharingLocation) {
      setError('');
      setLocationGateFor(booking);
      return;
    }
    // SHARING ON IS NOT PROOF GPS IS FLOWING. The switch can be on with a revoked
    // permission, a dead GPS chip or no network, and the rider's people would see a
    // frozen cab. So a stale feed is called out — but it does NOT block boarding:
    // refusing to start a ride because a phone can't see satellites would strand a
    // real employee at the kerb, which is the worse failure. Warn, and let them on.
    if (trackingFresh === false) {
      setError(
        'Location is on but no signal is reaching the server. Check GPS and network — ' +
          'employees may not see this cab move.'
      );
    }
    openOtpDialog(booking);
  }

  // The rider's code, typed in. A wrong one is refused by the rules, not by this
  // screen — the failure is shown inside the dialog so the driver can simply try
  // again with the trip still in front of them.
  async function submitOtp() {
    const booking = otpFor;
    if (!booking) return;
    setOtpError('');
    setBusyId(booking.id);
    const res = await startRideWithOtp(booking.id, otpEntry);
    setBusyId(null);
    if (res?.ok) {
      setOtpFor(null);
      setOtpEntry('');
      return;
    }
    setOtpError(res?.message || 'Could not start the ride. Please try again.');
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

  // LOCATION BEFORE BOARDING. Tapping "Enter OTP" with sharing off opens this
  // instead of the code pad; turning it on from here carries straight on to the
  // code, so the driver taps twice and never goes looking for the switch.
  async function turnOnLocationThenOtp() {
    const booking = locationGateFor;
    if (!booking) return;
    setSharingBusy(true);
    const res = await startSharingLocation();
    setSharingBusy(false);
    if (!res?.ok) {
      reportSharingFailure(res);
      return;
    }
    setLocationGateFor(null);
    openOtpDialog(booking);
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
  // Step 9 — PICKUP SEQUENCE. A carpool is several riders at the same time going
  // the same way, and the driver needs them in the order they'll be collected,
  // not in whatever order the desk happened to assign them. Trips are sorted by
  // date, then pickup time, then rider name, and each gets a stop number within
  // its run so "Stop 2 of 4" is meaningful.
  //
  // THIS DAY'S RUN, NOT THE CAB'S HISTORY. The subscription used to be unbounded
  // and this list had no date filter either, so a driver opening My Trips saw last
  // week's completed and no-show trips above tonight's, each still offering its
  // action buttons — "Enter OTP" on a six-day-old trip was one tap away.
  //
  // subscribeCabBookings now fetches only today and yesterday (DRIVER_WINDOW_DAYS),
  // and this is the second, narrower gate on top of it:
  //
  //   • TODAY — everything, finished or not. A driver should be able to see the
  //     stops they have already completed on tonight's run, not just the ones left.
  //   • YESTERDAY — only trips still UNFINISHED. This is the midnight case and
  //     nothing else: the 10 PM drop is still being driven at 00:10, and a strict
  //     "today only" rule would empty the screen mid-run. Yesterday's Completed and
  //     No-show rows are history, so they go.
  //
  // Cancelled is excluded at every date — a stood-down ride is not a stop.
  const today = todayKey();
  const yesterday = shiftDateKey(today, -1);
  const trips = useMemo(() => {
    const mine = bookings.filter((b) => {
      if (b.status === STATUS.CANCELLED) return false;
      if (b.assignedCabId !== currentUser?.cabId) return false;
      const date = String(b.date || '');
      if (date === today) return true;
      if (date !== yesterday) return false;
      return b.status !== STATUS.COMPLETED && b.status !== STATUS.NO_SHOW;
    });
    const sorted = [...mine].sort((a, b) => {
      const byDate = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDate) return byDate;
      const byTime = (timeToMinutes(a.shift) ?? 0) - (timeToMinutes(b.shift) ?? 0);
      if (byTime) return byTime;
      // Same date and time (a carpool) — order by the SAME label the cards show, so
      // the sequence on screen is one the driver can scan. Sorting by empId while
      // displaying names put the list in an order nothing visible explained.
      return riderLabel(a).localeCompare(riderLabel(b));
    });
    // Number the stops within each run (same date + time + direction).
    // How many stops each run has, so a card can say "of 4".
    const runs = {};
    sorted.forEach((b) => {
      const run = `${b.date}|${b.shift}|${b.direction}`;
      runs[run] = (runs[run] || 0) + 1;
    });
    const seen = {};
    return sorted.map((b) => {
      const run = `${b.date}|${b.shift}|${b.direction}`;
      seen[run] = (seen[run] || 0) + 1;
      return { ...b, stopNumber: seen[run], stopCount: runs[run], runKey: run };
    });
  }, [bookings, currentUser?.cabId, today, yesterday]);

  // ONE CARD ANSWERS THREE QUESTIONS, TOP TO BOTTOM: who am I collecting, where do
  // I go, what do I press now. Everything that isn't one of those three is either
  // gone from the card or shrunk to a secondary button.
  //
  // What was removed, and why none of it is a loss:
  //   • "Helpline: 040-…" printed on every card — the number is now behind Help,
  //     which dials it. A number you can't tap is worse than a button that calls.
  //   • The direction spelled out as "Office → Home" — replaced by the IN/OUT badge
  //     beside the name, which says the same thing in one glance-sized word.
  //   • The status chip in the corner AND a separate status idea — one plain
  //     "Status: …" line with a coloured dot does both jobs.
  function renderTrip({ item }) {
    const action = NEXT_ACTION[item.status];
    const places = tripPlaceLabels(item); // real pickup/drop addresses
    const busy = busyId === item.id;
    const isIn = item.direction === 'Home → Office';
    const statusColor = statusColors[item.status] || colors.muted;
    // "Today · after 10:00 PM". Kept — and kept SHORT — because a driver can hold
    // more than one day's trips at once, and two cards with the same rider and no
    // date are indistinguishable. The raw ISO key ("2026-08-19") was the unreadable
    // half; the shift bound is the useful half.
    const day = relativeDayLabel(item.date) || prettyDateKey(item.date);

    return (
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          {/* Only when the cab is actually sharing a run — "STOP 1 OF 1" is noise. */}
          {item.stopCount > 1 ? (
            <Text style={styles.stopLabel}>
              STOP {item.stopNumber} OF {item.stopCount}
            </Text>
          ) : null}

          {/* WHO. The largest text on the card: it is what the driver calls out at
              a gate, so it outranks everything else here. */}
          <View style={styles.nameRow}>
            <Text variant="headlineSmall" style={styles.name} numberOfLines={2}>
              {riderLabel(item)}
            </Text>
            {/* IN or OUT in one word. Two colours as well as two words, so the run's
                direction registers before anything is read. */}
            <View style={[styles.legBadge, { backgroundColor: isIn ? colors.primary : '#00695C' }]}>
              <Text style={styles.legBadgeText}>{isIn ? 'IN' : 'OUT'}</Text>
            </View>
          </View>
          <Text variant="bodySmall" style={styles.when}>
            {/* The shift's own start/end — a deadline (pickup) or earliest-bound
                (drop). Exact departure timing is the driver's call. */}
            {day} · {item.shift}
          </Text>

          {/* WHERE. Label above value, not "Pickup: <address>" on one wrapping line —
              a long address then reads as its own block instead of trailing off the
              end of a sentence. */}
          <View style={styles.place}>
            <Text variant="labelSmall" style={styles.placeLabel}>
              PICKUP
            </Text>
            <Text variant="bodyLarge" style={styles.placeValue}>
              {places.pickup}
            </Text>
          </View>
          <View style={styles.place}>
            <Text variant="labelSmall" style={styles.placeLabel}>
              DROP
            </Text>
            <Text variant="bodyLarge" style={styles.placeValue}>
              {places.drop}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text variant="bodyMedium" style={styles.statusText}>
              Status: <Text style={{ color: statusColor, fontWeight: 'bold' }}>{item.status}</Text>
            </Text>
          </View>

          {/* WHAT NOW. Full width, tall, and the only filled button on the card, so
              there is never a question about which control is the next step. */}
          {action ? (
            <Button
              mode="contained"
              icon={action.icon}
              style={styles.mainBtn}
              contentStyle={styles.mainBtnContent}
              labelStyle={styles.mainBtnLabel}
              onPress={() => (action.otp ? askForOtp(item) : advance(item, action.next))}
              loading={busy && !action.otp}
              disabled={busy}
            >
              {action.label}
            </Button>
          ) : null}

          {/* Said before the tap, not only after it. A driver at the kerb should know
              location is off while they are reading the card, rather than finding out
              when the code pad doesn't open. Only on the boarding step — this is the
              one action it blocks. */}
          {action?.otp && !sharingLocation ? (
            <View style={styles.gateRow}>
              <MaterialCommunityIcons
                name="map-marker-off-outline"
                size={15}
                color={colors.warning}
              />
              <Text variant="bodySmall" style={styles.gateText}>
                Turn on location sharing to start the ride.
              </Text>
            </View>
          ) : null}

          {/* At the pickup but the employee isn't here. Outlined and red — clearly a
              real action, clearly not the normal one. */}
          {item.status === 'Arrived' ? (
            <Button
              mode="outlined"
              icon="account-alert"
              textColor={colors.danger}
              style={styles.noShowBtn}
              contentStyle={styles.noShowBtnContent}
              onPress={() => setNoShowFor(item)}
              disabled={busy}
            >
              Employee Not Here
            </Button>
          ) : null}

          {/* Both kept, both demoted. Navigate is the one a driver reaches for often
              enough to stay visible as a button; Help holds the helpline, which is
              needed rarely and used to take half a row on every card. */}
          <View style={styles.secondaryRow}>
            <Button
              mode="outlined"
              icon="navigation-variant"
              compact
              style={styles.navBtn}
              onPress={() => navigateToPickup(item)}
            >
              Navigate
            </Button>
            <Button
              mode="text"
              icon="help-circle-outline"
              compact
              textColor={colors.muted}
              onPress={() => setHelpOpen(true)}
            >
              Help
            </Button>
          </View>
        </Card.Content>
      </Card>
    );
  }

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
            ● Location sharing ON   [on]
            ○ Location sharing OFF  [off]
          The dot and the word are still there because the switch alone is a small
          target to read at a glance in a moving car — three cues for one state.
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
          <View
            style={[
              styles.shareDot,
              sharingLocation && trackingFresh !== false ? styles.shareDotOn : styles.shareDotOff,
              sharingLocation && trackingFresh === false ? styles.shareDotWarn : null,
            ]}
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

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        renderItem={renderTrip}
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
        {/* The rider's code. Asked for at the kerb, so: one big numeric field,
            no keyboard hunting, and Enter submits. */}
        <Dialog visible={!!otpFor} onDismiss={() => setOtpFor(null)} style={styles.dialog}>
          <Dialog.Title>Start the ride</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.otpIntro}>
              Ask {otpFor ? riderLabel(otpFor) : 'the employee'} for the {RIDE_OTP_LENGTH}-digit
              code shown in their app, and type it in below.
            </Text>
            <TextInput
              mode="outlined"
              label={`${RIDE_OTP_LENGTH}-digit code`}
              value={otpEntry}
              onChangeText={(t) =>
                setOtpEntry(t.replace(/[^0-9]/g, '').slice(0, RIDE_OTP_LENGTH))
              }
              keyboardType="number-pad"
              autoFocus
              maxLength={RIDE_OTP_LENGTH}
              style={styles.otpInput}
              contentStyle={styles.otpInputText}
              onSubmitEditing={submitOtp}
              error={!!otpError}
              disabled={!!busyId}
            />
            {otpError ? (
              <Text variant="bodySmall" style={styles.otpError}>
                {otpError}
              </Text>
            ) : (
              <Text variant="bodySmall" style={styles.otpHint}>
                If the employee isn't here, close this and flag a no-show instead.
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setOtpFor(null)} disabled={!!busyId}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={submitOtp}
              loading={!!busyId}
              disabled={!!busyId || otpEntry.length !== RIDE_OTP_LENGTH}
            >
              Start ride
            </Button>
          </Dialog.Actions>
        </Dialog>

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

        {/* THE LOCATION PROMPT. One obvious button, and it continues to the code on
            its own — "Not now" exists because a driver whose GPS is failing still has
            to be able to reach the desk rather than being stuck on this dialog. */}
        <Dialog
          visible={!!locationGateFor}
          onDismiss={() => setLocationGateFor(null)}
          style={styles.dialog}
        >
          <Dialog.Title>Turn on location?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyLarge">
              Location sharing must be on before the ride starts.
            </Text>
            <Text variant="bodySmall" style={styles.dialogNote}>
              The employee and the transport desk can then see the cab moving.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLocationGateFor(null)} disabled={sharingBusy}>
              Not now
            </Button>
            <Button
              mode="contained"
              icon="crosshairs-gps"
              onPress={turnOnLocationThenOtp}
              loading={sharingBusy}
              disabled={sharingBusy}
            >
              Turn On Location
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
  container: { flex: 1, padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { marginBottom: 12 },
  name: { fontWeight: 'bold' },
  sub: { color: colors.muted, marginTop: 2 },
  setupCard: { marginBottom: 12, borderColor: colors.primary },
  setupRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  setupText: { flex: 1 },
  setupBody: { color: colors.muted, marginTop: 2, lineHeight: 18 },

  // Location sharing as one quiet line: dot, words, one control.
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingLeft: 2,
  },
  shareDot: { width: 11, height: 11, borderRadius: 6 },
  // Filled when on, a hollow ring when off — readable without the colour, which
  // matters in sunlight on a phone at arm's length.
  shareDotOn: { backgroundColor: colors.success },
  shareDotOff: { borderWidth: 2, borderColor: colors.muted },
  // The tappable half: dot, words, chevron. flex: 1 here instead of on the text, so
  // the whole label group takes the free space and the switch stays hard right.
  shareLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingVertical: 6 },
  shareText: { color: colors.muted },
  shareTextOn: { color: colors.success, fontWeight: '700' },
  shareDotWarn: { backgroundColor: colors.warning, borderWidth: 0 },
  shareTextWarn: { color: colors.warning, fontWeight: '700' },
  shareErrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: -8,
    marginBottom: 14,
    paddingRight: 8,
  },
  shareErrText: { color: colors.warning, flex: 1, lineHeight: 17 },

  sectionTitle: { marginBottom: 10 },
  listContent: { paddingBottom: 24 },
  card: { marginBottom: 14 },

  // "STOP 1 OF 2" — small, spaced, and above the name, so a carpool reads as a
  // sequence. It replaced a numbered circle plus a repeat of the same words.
  stopLabel: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontWeight: 'bold', color: colors.text, flex: 1, minWidth: 0 },
  legBadge: { borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, flexShrink: 0 },
  legBadgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  when: { color: colors.muted, marginTop: 2 },

  place: { marginTop: 12 },
  placeLabel: { color: colors.muted, letterSpacing: 0.8 },
  placeValue: { color: colors.text, marginTop: 1, lineHeight: 22 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: colors.muted },

  // THE ONE BIG BUTTON. Tall and full width — pressed one-handed, often in the
  // dark, sometimes through gloves.
  mainBtn: { marginTop: 12, borderRadius: 10 },
  mainBtnContent: { paddingVertical: 8 },
  mainBtnLabel: { fontSize: 16, fontWeight: 'bold' },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  gateText: { color: colors.warning, flex: 1 },
  noShowBtn: { marginTop: 10, borderColor: colors.danger, borderRadius: 10 },
  noShowBtnContent: { paddingVertical: 4 },
  // Navigate and Help, below the actions and plainly smaller than them.
  secondaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  navBtn: { borderColor: colors.border, borderRadius: 8 },

  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  dialogNote: { color: colors.muted, marginTop: 10, lineHeight: 18 },
  helpBtn: { borderRadius: 10 },
  helpNumber: { textAlign: 'center', marginTop: 12, color: colors.text, fontWeight: 'bold' },
  otpIntro: { marginBottom: 14 },
  otpInput: { backgroundColor: colors.surface },
  // Wide-spaced and large: this is read aloud across a car window and typed in
  // the dark, often by someone still holding the wheel.
  otpInputText: { fontSize: 26, letterSpacing: 8, textAlign: 'center' },
  otpError: { color: colors.danger, marginTop: 8 },
  otpHint: { color: colors.muted, marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: colors.muted, marginTop: 8 },
  emptyHint: { color: colors.muted, marginTop: 4, textAlign: 'center', maxWidth: 280 },
});
