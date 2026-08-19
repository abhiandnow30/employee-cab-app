// ---------------------------------------------------------------------------
// THE DAY BOARD  (today's rides) — the coordinator's home, and HR's too
//
// The operational centre of the app. The coordinator does NOT wait for employees
// to request rides and does NOT need admin approval to run the day — they take
// the rides the roster implies and put people in cabs.
//
// HR/ADMIN OPENS THE SAME SCREEN (registered for both desk roles in App.js). Not
// so they can run the day, but because "Add a rider" is here: the monthly sheet
// always misses somebody, and HR is usually who hears about it. They add the rider,
// the ride appears on this board for the coordinator to give a cab to. Nothing on
// this screen is role-gated — an admin could assign a cab from here too, which they
// could already do from All Bookings, so no new power is being handed out.
//
// Rides shown here are DERIVED from the monthly roster (see services/rides.js),
// so a ride exists the moment HR imports the month. A booking document is only
// written when this screen assigns a cab, which is what keeps ~11,000 rides a
// month from becoming 11,000 documents.
//
// HOW THE BOARD IS ARRANGED — one way, not a choice:
//   • sections are ROUTES — everyone from one pickup area, which is a cabful
//   • an IN / OUT segment picks the direction, so only one of the day's two runs
//     is on screen at a time
// The old "By route / By shift" toggle was removed at explicit request. By-shift was
// the browsing view; with direction now its own control there was little left in it,
// and route is the grouping a cab is actually filled from.
//
// Selecting riders across a group and assigning one cab is the carpool action.
// Capacity and "that cab is already going the other way" are enforced before the
// write, not after.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, SectionList, Pressable, useWindowDimensions } from 'react-native';
import {
  Text, Card, Chip, Button, SegmentedButtons, Portal, Dialog, RadioButton,
  TextInput, Snackbar, IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import RideStartCode from '../../components/RideStartCode';
import DeskCancelDialog from '../../components/DeskCancelDialog';
// groupByShift is no longer imported — the board groups by route only. It is still
// exported from services/rides.js, so restoring the removed toggle means adding it
// back here and nothing more.
import { groupByRoute, rideStats } from '../../services/rides';
import { routeKey } from '../../services/roster';
import { cabCapacity } from '../../services/cabs';
import { todayKey, shiftDateKey } from '../../utils/datetime';
import { SHIFT_COLORS, legsForShift, shiftSummary } from '../../data/shifts';
import { statusColors, colors } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-07-05" → "Sun 05 Jul"
function prettyDate(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((n) => parseInt(n, 10));
  const date = new Date(y, (m || 1) - 1, d || 1);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  return `${dow} ${String(d).padStart(2, '0')} ${MONTHS[(m || 1) - 1]}`;
}

export default function CoordinatorDashboardScreen({ navigation }) {
  const {
    ridesOn, assignCabToRides, cabs, rosterMonth, setRosterMonth, monthRosters,
    routeOptions, setEmployeeRoute, employeeCancellationsOn, getCabById,
    employees, shiftPolicy, addRiderToDay, deskCancelRide, deskCancellationsOn,
    deskCancelState,
  } = useApp();

  // PHONE OR NOT. One breakpoint, matching ShiftPolicyScreen's — this board is
  // either being read on a desk monitor or on the coordinator's phone in a car
  // park, and there is nothing in between worth a third layout.
  //
  // What it changes is only ARRANGEMENT, never what is on screen: the four
  // headline numbers wrap into a 2×2 grid instead of squeezing onto one row, the
  // rider's name and its badges stack instead of competing for the same line, and
  // the taps grow to the 44px a thumb needs. Nothing is hidden on a small screen —
  // a coordinator working from their phone is working the same day, and a ride
  // they cannot see is a ride nobody drives.
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const [date, setDate] = useState(() => todayKey());
  // Grouping is FIXED to route — the "By route / By shift" toggle was removed from
  // the UI at explicit request. Route is the unit a cab is filled in (one route ≈ one
  // cabful of neighbours), so it is the grouping that turns ~200 rides into ~15
  // decisions; by-shift was the browsing view, and with the IN / OUT segments now
  // splitting the day by direction it had little left to show. `groupByShift` is
  // still exported by services/rides.js if it is ever wanted back.
  const [selected, setSelected] = useState([]); // ride keys
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenCab, setChosenCab] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  // Which slice of the day's rides the board is showing. The headline numbers
  // above it are the control: tapping "Waiting" or "Assigned" filters to exactly
  // the rides that number counts, so a coordinator can check what a figure is
  // made of instead of reading it and then hunting for the rows by eye.
  //   all      — every ride
  //   waiting  — no cab yet (the default: this is the work still to do)
  //   assigned — already in a cab (who is covered, and by which vehicle)
  const [rideFilter, setRideFilter] = useState('waiting');
  // Which DIRECTION the board is showing: 'in' | 'out'. One or the other, always —
  // there is deliberately no "both" any more (it was removed at explicit request).
  //
  // The company's two rides go opposite ways at different times — an 8 PM pickup
  // from home and a 10 PM drop home — so they are two separate runs of the fleet
  // that happen to share one screen. Showing exactly one keeps the board to the run
  // the coordinator is actually working, with no other-leg riders between the rows.
  //
  // THE COST, stated so nobody is surprised by it: half the day is always off
  // screen, so an unassigned ride can only be found by pressing the other segment.
  // Two things carry that weight — the "In / Out" tile above stays a whole-day
  // count (never the current leg's), and the empty state names the other direction
  // rather than claiming the day has nothing. Keep both if this is ever reworked.
  //
  // Starts on 'in': the pickup run is the earlier of the two, so it is what a
  // coordinator opening the board during the day is working on first.
  const [legFilter, setLegFilter] = useState('in');
  // The rider whose route we're fixing, and the route picked for them. Routing is
  // HR's job, but the coordinator is the one who discovers at 9 PM that somebody
  // is on no route at all — and a ride nobody can group is a ride nobody drives.
  const [routeFor, setRouteFor] = useState(null);
  const [routeChoice, setRouteChoice] = useState(null);
  // "Add a rider" — the employee picked and the shift chosen for them, for the
  // day currently on screen.
  // The ride the desk is standing down. Only ever one at a time — this is a
  // per-rider decision taken while someone is on the phone.
  const [cancelFor, setCancelFor] = useState(null);
  const [addRiderOpen, setAddRiderOpen] = useState(false);
  const [addRiderUid, setAddRiderUid] = useState(null);
  const [addRiderCode, setAddRiderCode] = useState(null);

  // The derived rides for the chosen day, and the sections to show them in.
  const rides = useMemo(() => ridesOn(date), [ridesOn, date]);

  // The day narrowed to one direction — everything below this line works off it, so
  // the counts, the groups and the list can never disagree about which run they are
  // describing. `leg` is 'in' | 'out' on every derived ride (see makeRide in
  // services/rides.js); matching on that rather than on the `direction` label keeps
  // this from breaking if the display wording is ever reworded.
  const legRides = useMemo(
    () => rides.filter((r) => r.leg === legFilter),
    [rides, legFilter]
  );

  // Counted off the DIRECTION-filtered day, so "7 Waiting" is always 7 rides the
  // coordinator can actually see and tick. Counting the whole day here would leave
  // the headline promising rides the list isn't showing. The one exception is the
  // In / Out ratio in that row, which is deliberately read off the full day — it is
  // the whole point of this control, and a ratio of the slice you already chose
  // ("1/0") tells you nothing.
  const stats = useMemo(() => rideStats(legRides), [legRides]);
  const dayStats = useMemo(() => rideStats(rides), [rides]);
  const visible = useMemo(() => {
    if (rideFilter === 'waiting') return legRides.filter((r) => !r.assignedCabId);
    if (rideFilter === 'assigned') return legRides.filter((r) => r.assignedCabId);
    return legRides;
  }, [legRides, rideFilter]);
  const sections = useMemo(
    () => groupByRoute(visible),
    [visible]
  );

  // Rides the riders themselves called off for this day. They are deliberately
  // NOT in `rides` above — ridesOn() drops cancelled rides so the board shows
  // only what still has to be driven, which is what frees the seat. But a seat
  // silently vanishing from a cab is exactly the kind of change the coordinator
  // has to know about: it may empty a carpool, or leave room for someone who was
  // waiting. So they are listed separately, with the reason the rider gave.
  const riderCancellations = useMemo(
    () => employeeCancellationsOn(date),
    [employeeCancellationsOn, date]
  );

  // Rides the DESK stood down — usually HR, acting on a message the rider sent them.
  // The coordinator has to see these: they are the person assigning cabs, and a row
  // disappearing off the board with nothing said is indistinguishable from having
  // mis-read it. Separate from the rider's own cancellations above because they are
  // different news: one is a rider dropping out, the other is a decision already
  // taken at the desk.
  const deskCancellations = useMemo(
    () => deskCancellationsOn(date),
    [deskCancellationsOn, date]
  );

  // Switching direction drops the current selection, the same way moving to another
  // day does. A cab cannot run both legs at once — cabAssignmentProblem() refuses it
  // as "already doing a Office → Home trip at that time" — so a selection carried
  // from IN into OUT can only end in a rejected assignment, and worse, some of the
  // ticks causing it would be on rows no longer on screen.
  function changeLegFilter(next) {
    setSelected([]);
    setLegFilter(next);
  }

  // Moving off the loaded month has to move the subscription too, or the day
  // would come back empty for a month that hasn't been fetched.
  function goToDate(next) {
    setSelected([]);
    setDate(next);
    const month = next.slice(0, 7);
    if (month !== rosterMonth) setRosterMonth(month);
  }

  const selectedRides = rides.filter((r) => selected.includes(r.key));
  const isSelected = (key) => selected.includes(key);
  const toggle = (key) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // Tick every still-unassigned ride in a group — the fast path to a carpool.
  function selectGroup(data) {
    const keys = data.filter((r) => !r.assignedCabId).map((r) => r.key);
    setSelected((prev) => Array.from(new Set([...prev, ...keys])));
  }

  // --- "Add a rider" ---------------------------------------------------------

  // Anyone with a ride already on this day is not a candidate — offering them
  // again would just overwrite the shift code they already have, which is a
  // different action (a shift change) belonging to the request queue.
  const ridersToday = useMemo(
    () => new Set(rides.map((r) => r.employeeId)),
    [rides]
  );
  const addRiderOptions = useMemo(
    () =>
      (employees || [])
        .filter((e) => e.role === 'employee' && !ridersToday.has(e.uid))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((e) => e.uid),
    [employees, ridersToday]
  );
  // Only codes that put a cab on the road ON THE DAY BEING VIEWED. Three things
  // get filtered out, and all three would otherwise look like the button did
  // nothing: a Week Off (writes a day, generates no ride), an Evening shift
  // ("working" but outside the 20:00–06:00 service window, so no leg), and — if
  // HR ever configures one — a shift whose only cab is a drop the NEXT morning,
  // which would correctly appear on tomorrow's board rather than this one.
  // Mirrors the leg/date logic in ridesForDate(); keep them in step.
  const addRiderCodes = useMemo(() => {
    const policy = shiftPolicy || {};
    return Object.keys(policy).filter((code) => {
      const legs = legsForShift(policy, code);
      if (!legs) return false;
      return legs.providePickup || (legs.provideDrop && !legs.dropNextDay);
    });
  }, [shiftPolicy]);

  const addRiderEmployee = useMemo(
    () => (employees || []).find((e) => e.uid === addRiderUid) || null,
    [employees, addRiderUid]
  );

  function openAddRider() {
    setAddRiderUid(null);
    setAddRiderCode(null);
    setAddRiderOpen(true);
  }

  // Writes the one day's shift code. The board is derived from the roster and the
  // month is already subscribed (see the effect above), so the ride appears by
  // itself — there is nothing to refresh.
  async function confirmAddRider() {
    if (!addRiderUid || !addRiderCode) return;
    setBusy(true);
    const res = await addRiderToDay(addRiderUid, date, addRiderCode);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.message || 'Could not add that rider.');
      return;
    }
    const name = addRiderEmployee?.name || 'Rider';
    const label = shiftPolicy?.[addRiderCode]?.label || addRiderCode;
    setAddRiderOpen(false);
    setAddRiderUid(null);
    setAddRiderCode(null);
    setSnack(
      `${name} added to ${prettyDate(date)} on ${label}.` +
        (addRiderEmployee?.roster?.route ? '' : ' No route set — group them by hand.')
    );
  }

  // Put this rider on a route. Saved on their PROFILE, so it holds for every
  // remaining day of the roster instead of just today's board.
  async function confirmRoute() {
    if (!routeFor || !routeChoice) return;
    setBusy(true);
    const rider = routeFor;
    const res = await setEmployeeRoute(rider.employeeId, routeChoice);
    setBusy(false);
    setRouteFor(null);
    if (res?.ok) {
      // Tick their still-unassigned rides straight away. Routing someone was
      // only ever step one of "get this person into a cab" — without this they
      // silently drop out of "No route set" into a group further down the
      // board, and the coordinator has to go hunting for the person they were
      // just looking at. Only unassigned rides, matching selectGroup().
      const theirs = rides
        .filter((r) => r.employeeId === rider.employeeId && !r.assignedCabId)
        .map((r) => r.key);
      if (theirs.length) {
        setSelected((prev) => Array.from(new Set([...prev, ...theirs])));
      }
      setSnack(`${rider.employeeName} added to ${routeChoice} — selected, ready to assign.`);
    } else {
      setError(res?.message || 'Could not save that route.');
    }
  }

  function openDeskCancel(ride) {
    setCancelFor(ride);
  }

  async function confirmDeskCancel() {
    if (!cancelFor) return;
    setBusy(true);
    // No reason is passed — see DeskCancelDialog's header for what that costs and
    // why it was chosen. deskCancelRide still accepts one, so re-adding a reason is
    // a UI change and nothing more.
    const res = await deskCancelRide(cancelFor);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.message || 'Could not cancel that ride.');
      return;
    }
    const name = cancelFor.employeeName || 'Rider';
    setCancelFor(null);
    // Untick it if it was selected — a cancelled ride must not be sitting in a
    // selection the coordinator then assigns a cab to.
    setSelected((prev) => prev.filter((k) => k !== cancelFor.key));
    setSnack(`${name}'s ride cancelled. The seat is free.`);
  }

  async function confirmAssign() {
    if (!chosenCab || !selectedRides.length) return;
    setBusy(true);
    const res = await assignCabToRides(selectedRides, chosenCab);
    setBusy(false);
    if (res?.ok) {
      setPickerOpen(false);
      setSelected([]);
      setSnack(
        `Cab assigned to ${selectedRides.length} rider${selectedRides.length === 1 ? '' : 's'}.`
      );
    } else {
      setError(res?.message || 'Could not assign the cab.');
      setPickerOpen(false);
    }
  }

  function renderSectionHeader({ section }) {
    return (
      <View style={[styles.sectionHeader, isMobile && styles.sectionHeaderMobile]}>
        <View style={styles.sectionTitleWrap}>
          {/* Always a route pin now — sections are always routes. */}
          <MaterialCommunityIcons
            name="map-marker"
            size={isMobile ? 15 : 17}
            color={colors.primaryDark}
          />
          {/* One line, always. A route name that wraps pushes "Select N" off the
              row and the group's heading stops looking like a heading — so on a
              phone the type shrinks and the name ellipsises instead. */}
          <Text
            variant="titleSmall"
            style={[styles.sectionTitle, isMobile && styles.sectionTitleMobile]}
            numberOfLines={1}
          >
            {section.title}
          </Text>
          <Text variant="bodySmall" style={styles.sectionCount}>
            ({section.data.length})
          </Text>
        </View>
        {section.unassigned > 0 ? (
          <Button
            compact
            mode="text"
            onPress={() => selectGroup(section.data)}
            // The whole group in one tap — worth a thumb-sized target even
            // though the label is small. hitSlop rather than padding, so the
            // header row's height doesn't grow to accommodate it.
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            labelStyle={isMobile ? styles.selectLabelMobile : undefined}
          >
            Select {section.unassigned}
          </Button>
        ) : null}
      </View>
    );
  }

  function renderRide({ item }) {
    const assigned = !!item.assignedCabId;
    const cab = assigned ? cabs.find((c) => c.id === item.assignedCabId) : null;
    const ticked = isSelected(item.key);
    const code = SHIFT_COLORS[item.shiftCode] || { bg: '#EEE', fg: colors.text };
    // The DESK's window (30 minutes), not the rider's (4 hours) — same helper, its own
    // cutoff. Reads the booking when there is one and the derived ride when there
    // isn't; both carry date, shift and status.
    const deskCancel = deskCancelState(item.booking || item);
    return (
      <Pressable onPress={() => toggle(item.key)}>
        <Card style={[styles.card, ticked && styles.cardSelected]} mode="elevated">
          <Card.Content style={styles.cardRow}>
            {/* The tick is a picture of the card's state, not a target of its own —
                the whole card is the Pressable, which is already far past 44px in
                both directions. Bigger on a phone simply so it reads at arm's
                length. */}
            <MaterialCommunityIcons
              name={ticked ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={isMobile ? 26 : 22}
              color={ticked ? colors.primary : colors.muted}
              style={[styles.check, isMobile && styles.checkMobile]}
            />
            <View style={styles.cardBody}>
              {/* NAME AND BADGES: side by side with room, stacked without. On a
                  phone the two badges take most of a narrow row, squeezing the
                  name to a few ellipsised characters — and the name is the one
                  thing on the card the coordinator is looking for. Given its own
                  line it stays whole and the badges sit under it. */}
              <View style={[styles.rowBetween, isMobile && styles.rowStacked]}>
                <Text
                  variant="titleSmall"
                  numberOfLines={isMobile ? 2 : 1}
                  style={[styles.name, isMobile && styles.nameStacked]}
                >
                  {item.employeeName}
                </Text>
                <View style={[styles.chips, isMobile && styles.chipsStacked]}>
                  <Chip
                    compact
                    style={{ backgroundColor: code.bg }}
                    textStyle={{ color: code.fg, fontSize: 11 }}
                  >
                    {item.shiftCode}
                  </Chip>
                  <Chip
                    compact
                    style={{
                      backgroundColor: assigned
                        ? statusColors[item.status] || colors.success
                        : '#FFF4E0',
                    }}
                    textStyle={{
                      color: assigned ? '#FFFFFF' : '#B26A00',
                      fontSize: 11,
                    }}
                  >
                    {assigned ? item.status : 'Pending'}
                  </Chip>
                </View>
              </View>

              <View style={styles.metaRow}>
                <MaterialCommunityIcons
                  name={item.leg === 'in' ? 'home-export-outline' : 'home-import-outline'}
                  size={14}
                  color={colors.muted}
                />
                <Text variant="bodySmall" style={styles.meta}>
                  {/* The scheduled time, shown plainly. It used to read "by 09:00 PM" for a
                  pickup and "after 10:00 PM" for a drop — the shift's own start/end
                  rather than a promised cab instant. Dropped at explicit request: the
                  ride IS scheduled at that time, and "after 10:00 PM" read as vague
                  where the desk wanted a time. The underlying field is unchanged, so
                  restoring the qualifier is a wording change only. */}
                  {item.direction} · {item.shift}
                </Text>
              </View>
              {item.employeeAddress ? (
                <View style={styles.metaRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.muted} />
                  <Text variant="bodySmall" style={styles.meta} numberOfLines={2}>
                    {item.employeeAddress}
                  </Text>
                </View>
              ) : null}
              {/* The rider's start code, on the desk's board too — this is the
                  escape hatch for a rider whose phone is dead or who can't open
                  the app at the kerb. The coordinator reads it down the phone to
                  the driver. Without it, the OTP would strand a real employee,
                  which is a worse failure than the one it prevents. */}
              <RideStartCode booking={item.booking} variant="inline" />

              {/* The route used to be repeated on the card when the board was grouped
                  by shift, because the section header wasn't showing it then. Sections
                  are always routes now, so the header always says it and repeating it
                  on every card underneath would only be noise. */}
              {/* No route means this rider can't be grouped with their neighbours.
                  Fixable here rather than by a message to HR that lands tomorrow —
                  and because it saves to their profile, it stays fixed. */}
              {!item.route ? (
                <View style={styles.noRouteRow}>
                  <MaterialCommunityIcons name="map-marker-alert" size={14} color="#B26A00" />
                  <Text variant="bodySmall" style={styles.noRouteText}>
                    No route set
                  </Text>
                  <Button
                    compact
                    mode="text"
                    onPress={() => {
                      setRouteChoice(null);
                      setRouteFor(item);
                    }}
                  >
                    Set route
                  </Button>
                </View>
              ) : null}
              {/* STAND THIS CAB DOWN. The employee messaged the desk on Teams,
                  WhatsApp or the phone — an emergency, they aren't travelling — and
                  will never open the app to cancel it themselves. Nothing else on
                  this board could act on that: approving a cancellation needs a
                  request the rider never made, and the rider's own button is shut
                  inside the 4-hour cutoff, which is exactly when this happens.
                  Text button, not a filled one: it is the exception, and assigning
                  cabs is what this screen is for.
                  The responder is claimed so cancelling can't also tick the rider
                  for assignment — the whole card is a Pressable. Same trick as
                  RideStartCode above. */}
              <View onStartShouldSetResponder={() => true} style={styles.deskCancelRow}>
                {deskCancel.canCancel ? (
                  <Button
                    compact
                    mode="text"
                    icon="calendar-remove"
                    textColor={colors.danger}
                    onPress={() => openDeskCancel(item)}
                    disabled={busy}
                  >
                    Cancel ride
                  </Button>
                ) : (
                  /* THE REASON, NOT A DEAD BUTTON. Only shows in the last 30 minutes
                     before a pickup, or once the trip is under way — rare, unlike the
                     4-hour version this replaced, which closed the whole evening board
                     by 6 PM. A greyed button repeated down every card would read as
                     "you can do this" fifteen times over. */
                  <Text variant="bodySmall" style={styles.cancelClosed}>
                    {deskCancel.reason}
                  </Text>
                )}
              </View>

              {/* Every ride on this board comes from the roster. There is no
                  "approved extra ride" badge because there are no extra rides —
                  the company runs the 8 PM pickup and the 10 PM drop, full stop. */}

              {/* An overnight shift's drop runs the morning after the shift date —
                  say so, or the desk reads it as the wrong day. */}
              {item.leg === 'out' && item.shiftDate !== item.date ? (
                <Text variant="bodySmall" style={styles.overnight}>
                  Overnight — {item.shiftCode} shift of {prettyDate(item.shiftDate)}
                </Text>
              ) : null}
              {cab ? (
                <Text variant="bodySmall" style={styles.assignedText}>
                  → {cab.cabNumber} · {cab.driverName || 'no driver'}
                </Text>
              ) : null}
            </View>
          </Card.Content>
        </Card>
      </Pressable>
    );
  }

  const noRoster = monthRosters.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.col}>
        {/* Day navigator */}
        <View style={styles.dateBar}>
          <IconButton
            icon="chevron-left"
            mode="contained-tonal"
            onPress={() => goToDate(shiftDateKey(date, -1))}
            accessibilityLabel="Previous day"
          />
          <Pressable
            style={[styles.datePill, isMobile && styles.datePillMobile]}
            onPress={() => goToDate(todayKey())}
          >
            <MaterialCommunityIcons name="calendar-today" size={17} color={colors.primary} />
            <Text style={styles.dateText}>{prettyDate(date)}</Text>
            {date !== todayKey() ? <Text style={styles.dateReset}>· today</Text> : null}
          </Pressable>
          <IconButton
            icon="chevron-right"
            mode="contained-tonal"
            onPress={() => goToDate(shiftDateKey(date, 1))}
            accessibilityLabel="Next day"
          />
        </View>

        {/* Headline numbers — and the board's filter. Each of the first three is
            a count of a slice of the day, so tapping one shows exactly the rides
            it counted. "In / Out" is a ratio across both slices rather than a
            subset of them, so it stays a read-only figure.

            On a phone the four wrap into a 2×2 grid. Four across a 360px screen
            leaves each about 80px, which is where "In / Out" starts ellipsising
            and a two-digit count sits directly against its neighbour — and these
            are the figures the whole board is read from. Two rows of two keeps
            every number at full size and every tap a comfortable one. */}
        <View style={[styles.stats, isMobile && styles.statsGrid]}>
          <Stat
            label="Rides"
            value={stats.total}
            active={rideFilter === 'all'}
            onPress={() => setRideFilter('all')}
            showsLabel="every ride"
            half={isMobile}
          />
          <Stat
            label="Waiting"
            value={stats.pending}
            tone={stats.pending ? 'warn' : 'muted'}
            active={rideFilter === 'waiting'}
            onPress={() => setRideFilter('waiting')}
            showsLabel="only rides with no cab yet"
            half={isMobile}
          />
          <Stat
            label="Assigned"
            value={stats.assigned}
            tone="good"
            active={rideFilter === 'assigned'}
            onPress={() => setRideFilter('assigned')}
            showsLabel="only rides that already have a cab"
            half={isMobile}
          />
          {/* Off the WHOLE day (dayStats), not the current direction — this is the
              figure that says how the day splits, and it stays the same as you flip
              between IN and OUT so it can be read as a total. */}
          <Stat
            label="In / Out"
            value={`${dayStats.inbound}/${dayStats.outbound}`}
            tone="muted"
            half={isMobile}
          />
        </View>

        {/* Riders who stood their own cab down today. Above the board rather
            than inside it: this is news, and it changes what the cabs below
            should be carrying. */}
        {riderCancellations.length ? (
          <Card mode="outlined" style={styles.cancelCard}>
            <Card.Content>
              <View style={styles.cancelHead}>
                <MaterialCommunityIcons name="account-cancel" size={18} color={colors.danger} />
                <Text variant="titleSmall" style={styles.cancelTitle}>
                  {riderCancellations.length} rider
                  {riderCancellations.length === 1 ? '' : 's'} cancelled
                </Text>
              </View>
              <Text variant="bodySmall" style={styles.cancelIntro}>
                These rides are already off the board below — the seats are free.
              </Text>
              {riderCancellations.map((b) => {
                const cab = b.assignedCabId ? getCabById(b.assignedCabId) : null;
                return (
                  <View key={b.id} style={styles.cancelRow}>
                    <Text variant="bodyMedium" style={styles.cancelName}>
                      {b.employeeName || 'Employee'}
                      {b.empId ? ` · ${b.empId}` : ''}
                    </Text>
                    <Text variant="bodySmall" style={styles.cancelMeta}>
                      {b.direction} · {b.shift}
                      {/* Which cab has the seat back. Cancelled rides keep their
                          assignedCabId precisely so this can be said. */}
                      {cab ? ` · seat free on ${cab.cabNumber}` : ''}
                    </Text>
                    <Text variant="bodySmall" style={styles.cancelWhy}>
                      “{b.cancellationReason || b.cancelReason || 'No reason given'}”
                    </Text>
                  </View>
                );
              })}
            </Card.Content>
          </Card>
        ) : null}

        {/* WHAT THE DESK CANCELLED. Amber, not red: this is not a problem, it is a
            decision someone already made and the coordinator needs to know about —
            these riders are off the board and their seats are free. Who cancelled it
            is named, because "why has this rider gone?" is answered by a person. */}
        {deskCancellations.length ? (
          <Card mode="outlined" style={styles.deskCancelCard}>
            <Card.Content>
              <View style={styles.cancelHead}>
                <MaterialCommunityIcons name="headset" size={18} color={colors.warning} />
                <Text variant="titleSmall" style={styles.deskCancelTitle}>
                  {deskCancellations.length} ride
                  {deskCancellations.length === 1 ? '' : 's'} cancelled by the desk
                </Text>
              </View>
              <Text variant="bodySmall" style={styles.cancelIntro}>
                Already off the board below — do not assign a cab for these.
              </Text>
              {deskCancellations.map((b) => {
                const cab = b.assignedCabId ? getCabById(b.assignedCabId) : null;
                return (
                  <View key={b.id} style={styles.cancelRow}>
                    <Text variant="bodyMedium" style={styles.cancelName}>
                      {b.employeeName || 'Employee'}
                      {b.empId ? ` · ${b.empId}` : ''}
                    </Text>
                    <Text variant="bodySmall" style={styles.cancelMeta}>
                      {b.direction} · {b.shift}
                      {cab ? ` · seat free on ${cab.cabNumber}` : ''}
                    </Text>
                    <Text variant="bodySmall" style={styles.deskCancelWho}>
                      Cancelled by the transport desk
                      {b.cancelledByRole ? ` (${b.cancelledByRole})` : ''}
                      {b.cancellationReason ? ` — ${b.cancellationReason}` : ''}
                    </Text>
                  </View>
                );
              })}
            </Card.Content>
          </Card>
        ) : null}

        <View style={[styles.controls, isMobile && styles.controlsMobile]}>
          {/* DIRECTION — one of the two, never both. The "By route / By shift" control
              used to sit to the left of this; grouping is fixed to route now, so this
              is the board's only view control.
              The icons are the same pair each ride card carries on its direction
              line, so the segment and the rows underneath it read as the same thing.
              Labels are IN / OUT rather than the full "Home → Office", which will not
              fit a segment — the accessibility labels spell it out.

              THE SELECTED HALF IS FILLED, not tinted. Paper's own checked state is a
              pale lavender wash that reads as "slightly different from its neighbour",
              and on this board the two halves are two different runs of the fleet —
              mistaking one for the other means working the wrong list of riders. So
              the active segment takes the brand blue with a white icon and label; the
              inactive one stays on the surface in muted grey.
              Three cues, not just colour: the fill, a heavier label, and the screen
              reader's own selected state (Paper emits accessibilityState.checked). */}
          <SegmentedButtons
            value={legFilter}
            onValueChange={changeLegFilter}
            density="small"
            style={[styles.segmentedLeg, isMobile && styles.segmentedLegMobile]}
            buttons={[
              {
                value: 'in',
                label: 'IN',
                icon: 'home-export-outline',
                accessibilityLabel: 'IN — Home to Office pickups only',
                // Colours the ICON as well as the text; the weight comes from
                // labelStyle below.
                checkedColor: '#FFFFFF',
                uncheckedColor: colors.muted,
                style: legFilter === 'in' ? styles.legSegOn : styles.legSegOff,
                labelStyle: legFilter === 'in' ? styles.legLabelOn : styles.legLabelOff,
                // Grows the touch target without growing the row — the control keeps
                // its small density, so the header's height is unchanged.
                hitSlop: { top: 8, bottom: 8 },
              },
              {
                value: 'out',
                label: 'OUT',
                icon: 'home-import-outline',
                accessibilityLabel: 'OUT — Office to Home drops only',
                checkedColor: '#FFFFFF',
                uncheckedColor: colors.muted,
                style: legFilter === 'out' ? styles.legSegOn : styles.legSegOff,
                labelStyle: legFilter === 'out' ? styles.legLabelOn : styles.legLabelOff,
                hitSlop: { top: 8, bottom: 8 },
              },
            ]}
          />
          {/* Someone needs a cab tonight who the month's roster doesn't have
              working today. Without this the coordinator could see that and not
              fix it — Roster Upload is HR's screen and they may well have gone
              home. HR reaches this same button from their own drawer, which is the
              other half of the problem: they are often the one told about a new
              joiner. One day only; a stretch of days is still Roster Upload. */}
          <Button
            compact
            mode="text"
            icon="account-plus"
            onPress={openAddRider}
            style={styles.addRider}
          >
            Add a rider
          </Button>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={renderRide}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={noRoster ? 'calendar-alert' : 'check-circle-outline'}
                size={44}
                color={colors.muted}
              />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {noRoster
                  ? `No roster imported for ${date.slice(0, 7)}.`
                  : /* "Every ride has a cab" is only true when there ARE rides.
                       This branch used to ignore the count, so a day that
                       generated nothing — a weekend, or a month imported wrong —
                       reported itself as fully assigned and the coordinator
                       moved on. Zero rides is its own state, not a success. */
                  stats.total === 0
                  ? /* Every count on this screen is direction-aware, so an empty
                       board can mean "nothing today" OR "nothing THIS WAY". Those
                       need different words: telling someone "no rides on this day"
                       while the other leg has ten of them sends them off to check
                       the roster for a problem that isn't there. The hint below
                       names the other direction and its count. */
                    legFilter === 'in'
                    ? 'No Home → Office pickups on this day.'
                    : 'No Office → Home drops on this day.'
                  : rideFilter === 'waiting'
                  ? `Every ${legFilter === 'in' ? 'pickup' : 'drop'} today has a cab.`
                  : /* The day HAS rides and none of them are assigned — an empty
                       board here means the work hasn't started, not that there is
                       none. Saying "no rides" would read as the opposite. */
                    rideFilter === 'assigned'
                  ? `No ${legFilter === 'in' ? 'pickup' : 'drop'} today has a cab yet.`
                  : 'No rides on this day.'}
              </Text>
              {noRoster ? (
                <Text variant="bodySmall" style={styles.emptyHint}>
                  Ask HR to upload the monthly shift roster — rides are generated
                  from it.
                </Text>
              ) : dayStats.total === 0 ? (
                /* The roster IS loaded, so an empty day is a rostering answer,
                   not a missing one. Saying which answers are possible saves
                   the coordinator checking whether the upload went wrong.
                   dayStats, not stats: this speaks about the ROSTER, so it must
                   only appear when the whole day is empty. Keyed on the
                   direction-filtered count it would tell someone nobody is
                   travelling while ten riders sat one segment away. */
                <Text variant="bodySmall" style={styles.emptyHint}>
                  The roster is loaded — nobody is down to travel today. Week off,
                  holiday, leave, or a shift the company runs no cab for.
                </Text>
              ) : stats.total === 0 ? (
                /* The day has rides, just none going this way. With no "both" option
                   the other leg is entirely off screen, so this line is the only
                   thing telling the coordinator it exists — it names the segment to
                   press and how many rides are waiting behind it. */
                <Text variant="bodySmall" style={styles.emptyHint}>
                  {legFilter === 'in'
                    ? `${dayStats.outbound} drop${dayStats.outbound === 1 ? '' : 's'} today — press OUT to see ${dayStats.outbound === 1 ? 'it' : 'them'}.`
                    : `${dayStats.inbound} pickup${dayStats.inbound === 1 ? '' : 's'} today — press IN to see ${dayStats.inbound === 1 ? 'it' : 'them'}.`}
                </Text>
              ) : null}
            </View>
          }
        />

        {/* Assign bar */}
        {selected.length > 0 ? (
          <View style={styles.actionBar}>
            <Button mode="text" onPress={() => setSelected([])}>
              Clear
            </Button>
            <Button
              mode="contained"
              icon="car"
              style={styles.assignBtn}
              onPress={() => {
                setChosenCab(null);
                setPickerOpen(true);
              }}
            >
              {/* selectedRides, not selected.length. A ride cancelled by HR while the
                  coordinator had it ticked leaves a stale key behind: the write
                  (confirmAssign) works off selectedRides and would have given the cab
                  to two riders while this button promised three. */}
              Assign cab to {selectedRides.length}
            </Button>
          </View>
        ) : null}
      </View>

      {/* Cab picker */}
      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)} style={styles.dialog}>
          <Dialog.Title>Assign a cab to {selectedRides.length} rider(s)</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              {cabs.length === 0 ? (
                <Text variant="bodyMedium">
                  No cabs in the fleet yet. Add one on the Fleet screen first.
                </Text>
              ) : (
                <RadioButton.Group onValueChange={setChosenCab} value={chosenCab}>
                  {cabs.map((c) => (
                    // A cab with no driver ACCOUNT linked can't be assigned: the
                    // driver's trip list is scoped by that link, so the ride would
                    // be invisible to everyone while the rider was told a cab was
                    // coming. Greyed out here rather than rejected after the tap.
                    <RadioButton.Item
                      key={c.id}
                      label={
                        c.driverUid
                          ? `${c.cabNumber} · ${c.driverName || 'driver'} · ${cabCapacity(c)} seats`
                          : `${c.cabNumber} · no driver linked`
                      }
                      value={c.id}
                      disabled={!c.driverUid}
                    />
                  ))}
                </RadioButton.Group>
              )}
              <Text variant="bodySmall" style={styles.dialogHint}>
                A cab can't take more riders than it has seats, or run two trips in
                opposite directions at the same time. A cab with no driver linked
                can't be assigned at all — link one on the Fleet screen.
              </Text>
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={confirmAssign}
              loading={busy}
              disabled={busy || !chosenCab}
            >
              Assign
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Add a rider to THIS day only. HR owns the month; this is the one-off. */}
      <Portal>
        <Dialog
          visible={addRiderOpen}
          onDismiss={() => setAddRiderOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Title>Add a rider — {prettyDate(date)}</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              <Text variant="bodySmall" style={styles.dialogHint}>
                Puts this person on today&apos;s board only. For a run of days, HR adds
                them on Roster Upload.
              </Text>

              {addRiderOptions.length === 0 ? (
                <Text variant="bodyMedium">
                  Everyone with an account already has a ride today.
                </Text>
              ) : (
                <>
                  <Text variant="labelLarge" style={styles.dialogLabel}>
                    Employee
                  </Text>
                  <Dropdown
                    compact={false}
                    value={addRiderUid}
                    options={addRiderOptions}
                    onSelect={setAddRiderUid}
                    placeholder="Select employee"
                    format={(uid) => {
                      const e = (employees || []).find((x) => x.uid === uid);
                      if (!e) return 'Select employee';
                      return e.empId ? `${e.name} · ${e.empId}` : e.name || 'Unnamed';
                    }}
                  />

                  {addRiderEmployee ? (
                    <Text variant="bodySmall" style={styles.dialogHint}>
                      {addRiderEmployee.roster?.route
                        ? `Route: ${addRiderEmployee.roster.route}`
                        : 'No route set — they land under “No route set”.'}
                      {addRiderEmployee.address ? `\nHome: ${addRiderEmployee.address}` : ''}
                    </Text>
                  ) : null}

                  <Text variant="labelLarge" style={styles.dialogLabel}>
                    Shift
                  </Text>
                  {addRiderCodes.length === 0 ? (
                    <Text variant="bodyMedium">
                      No shift currently runs a cab. HR sets that on Shift Policy.
                    </Text>
                  ) : (
                    <RadioButton.Group onValueChange={setAddRiderCode} value={addRiderCode}>
                      {addRiderCodes.map((code) => (
                        <RadioButton.Item
                          key={code}
                          label={shiftSummary(shiftPolicy, code)}
                          value={code}
                        />
                      ))}
                    </RadioButton.Group>
                  )}
                </>
              )}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setAddRiderOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={confirmAddRider}
              loading={busy}
              disabled={busy || !addRiderUid || !addRiderCode}
            >
              Add to today
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* The desk standing a ride down for a rider who asked off-app. */}
      <DeskCancelDialog
        visible={!!cancelFor}
        ride={cancelFor}
        cab={cancelFor?.assignedCabId ? getCabById(cancelFor.assignedCabId) : null}
        busy={busy}
        onDismiss={() => setCancelFor(null)}
        onConfirm={confirmDeskCancel}
      />

      {/* Route picker — the one employee field the rules let a coordinator write.
          It saves to the profile, so it also fixes every other day this month. */}
      <Portal>
        <Dialog visible={!!routeFor} onDismiss={() => setRouteFor(null)} style={styles.dialog}>
          <Dialog.Title>Route for {routeFor?.employeeName}</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              <Text variant="bodySmall" style={styles.dialogHint}>
                {routeFor?.employeeAddress
                  ? `Home: ${routeFor.employeeAddress}`
                  : 'No home address on file — ask HR to add one.'}
              </Text>
              {/* Free text, not a radio list. There is no maintained route list
                  any more — routes arrive with the monthly sheet — so this can't
                  offer a closed set. Capitalisation and spacing are snapped to
                  the spelling already in use on save (snapRoute in AppContext),
                  so typing "jntu cab" at 9 PM still puts them in the JNTU group
                  rather than a second one of their own. */}
              <TextInput
                label="Pickup route"
                value={routeChoice || ''}
                onChangeText={setRouteChoice}
                mode="outlined"
                placeholder="e.g. JNTU Cab"
                autoFocus
                left={<TextInput.Icon icon="map-marker-outline" />}
              />
              {routeOptions.length ? (
                <>
                  <Text variant="bodySmall" style={styles.dialogHint}>
                    Tap a route already in use:
                  </Text>
                  <View style={styles.routeChips}>
                    {routeOptions.map((r) => (
                      <Chip
                        key={r}
                        compact
                        selected={routeKey(routeChoice) === routeKey(r)}
                        onPress={() => setRouteChoice(r)}
                        style={styles.routeChip}
                      >
                        {r}
                      </Chip>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setRouteFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={confirmRoute}
              loading={busy}
              disabled={busy || !routeChoice}
            >
              Save route
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!error} onDismiss={() => setError('')} duration={5000}>
        {error}
      </Snackbar>
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
        {snack}
      </Snackbar>
    </View>
  );
}

// One headline number. With `onPress` it doubles as the board's filter — the
// active one is underlined in its own colour, so which slice is on screen is
// answered by the same thing that changes it. Without `onPress` it renders as a
// plain figure (see "In / Out"), which is why the wrapper is chosen per call
// rather than always being pressable: a Pressable that does nothing still
// invites a tap.
// `half` is the phone layout: the stat takes half the row so four of them wrap
// into a 2×2 grid, and grows its own height to the 44px a thumb needs.
function Stat({ label, value, tone, active = false, onPress, showsLabel = '', half = false }) {
  const color =
    tone === 'good' ? colors.success
    : tone === 'warn' ? '#B26A00'
    : tone === 'muted' ? colors.muted
    : colors.text;
  const body = (
    <>
      <Text variant="titleLarge" style={[styles.statValue, { color }]}>
        {value}
      </Text>
      <Text variant="bodySmall" style={[styles.statLabel, active && { color }]}>
        {label}
      </Text>
    </>
  );
  if (!onPress) return <View style={[styles.stat, half && styles.statHalf]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.stat,
        styles.statTappable,
        half && styles.statHalf,
        half && styles.statTappableMobile,
        active && { borderBottomColor: color },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}: ${value}.${showsLabel ? ` Show ${showsLabel}.` : ''}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  col: { flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center' },

  cancelCard: { marginHorizontal: 8, marginBottom: 8, borderColor: colors.danger },
  deskCancelCard: { marginHorizontal: 8, marginBottom: 8, borderColor: colors.warning },
  deskCancelTitle: { color: colors.warning },
  deskCancelWho: { color: colors.warning, marginTop: 2 },
  cancelHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelTitle: { color: colors.danger },
  cancelIntro: { opacity: 0.7, marginTop: 2 },
  cancelRow: { marginTop: 8 },
  cancelName: { fontWeight: 'bold' },
  cancelMeta: { opacity: 0.75, marginTop: 1 },
  cancelWhy: { fontStyle: 'italic', marginTop: 2, color: colors.text },

  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF2FE',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  // "Today" is a one-tap trip back from wherever the arrows took you, so it gets
  // the full 44px on a phone — 8px of padding around a 15px line lands at ~37.
  datePillMobile: { paddingVertical: 11, paddingHorizontal: 14 },
  dateText: { fontWeight: '600', color: colors.primaryDark, fontSize: 15 },
  dateReset: { color: colors.primary, fontSize: 12 },

  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  // 2×2 on a phone. `stats` is already a row, so wrapping plus a half-width
  // basis on each child is the whole grid — no second container.
  statsGrid: { flexWrap: 'wrap', rowGap: 6 },
  stat: { alignItems: 'center', minWidth: 64 },
  // Just under half, so two sit per row with the row-gap between them and the
  // third and fourth drop to the second line.
  statHalf: { flexBasis: '46%', flexGrow: 1 },
  // A transparent border on every tappable stat, coloured in only when it's the
  // active one — so selecting a filter can't shift the row's height.
  statTappable: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingBottom: 2,
    paddingHorizontal: 6,
  },
  // The number and its label come to ~40px; this takes the filter past 44.
  statTappableMobile: { paddingTop: 4, paddingBottom: 6 },
  statValue: { fontWeight: 'bold' },
  statLabel: { color: colors.muted },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingBottom: 6,
    flexWrap: 'wrap',
  },
  // Tighter gutters so IN/OUT and "Add a rider" still share one row on a 360px
  // screen. flexWrap above is the safety net for anything narrower.
  controlsMobile: { gap: 6, paddingHorizontal: 6 },
  // Two short segments. It no longer shares the row with a grouping control, so it
  // takes only the width it needs and the filter/Add-a-rider buttons keep the rest.
  // 200, not 170: at 170 each half was ~85px and a bold "OUT" beside its icon
  // ellipsised to "O…", which is the one word on the control that has to be legible.
  segmentedLeg: { flexGrow: 0, flexShrink: 0, minWidth: 200 },
  // 176 is the floor that still fits a bold "OUT" beside its icon — the reason
  // the desktop minimum is 200 in the first place. Any narrower and the label
  // ellipsises, so below this the row wraps rather than the words breaking.
  segmentedLegMobile: { minWidth: 176 },
  // Pushed to the far right of the row, away from IN/OUT. Those two decide which
  // list is on screen; this one opens a dialog and changes the day's roster — sat
  // directly beside them it read as a third segment of the same control. The gap
  // between is the separation.
  //
  // marginLeft:auto rather than justifyContent on the row, because the row wraps
  // on a very narrow screen: 'space-between' would drop the button to a second
  // line and then align it LEFT again, whereas auto margin keeps it right
  // wherever it lands.
  addRider: { marginLeft: 'auto' },
  // THE ACTIVE HALF. Filled with the brand blue — the same colour the sidebar and
  // primary buttons use, so this reads as part of the app rather than a new idea.
  // Paper applies a segment's own `style` last ([buttonStyle, styles.button, style]
  // in SegmentedButtonItem), so this background wins over its computed one without
  // having to fight the component or restyle the theme globally.
  legSegOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  // THE INACTIVE HALF. Still a segment — outlined, on the card surface — but plainly
  // the one that isn't chosen.
  legSegOff: { backgroundColor: colors.surface, borderColor: colors.border },
  // White on #0129AC is ~10:1, well past AA; the heavier weight is the non-colour
  // half of the signal, so the state survives a greyscale screen or colour blindness.
  legLabelOn: { color: '#FFFFFF', fontWeight: '800' },
  legLabelOff: { color: colors.muted, fontWeight: '600' },

  list: { padding: 10, paddingBottom: 90 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E3F0FF',
    borderRadius: 8,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 3,
    marginTop: 8,
    marginBottom: 8,
  },
  sectionHeaderMobile: { paddingLeft: 8, paddingRight: 2, marginTop: 6, marginBottom: 6 },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  sectionTitle: { color: colors.primaryDark, fontWeight: 'bold', flexShrink: 1 },
  sectionTitleMobile: { fontSize: 13 },
  sectionCount: { color: colors.primaryDark, opacity: 0.7 },
  selectLabelMobile: { fontSize: 12, marginHorizontal: 4 },

  card: { marginBottom: 10 },
  cardSelected: { borderWidth: 2, borderColor: colors.primary },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  check: { marginRight: 10, marginTop: 2 },
  // Clear air between the tick and the name it belongs to, so a thumb aiming at
  // one doesn't obscure the other.
  checkMobile: { marginRight: 14, marginTop: 1 },
  // EVERYTHING RIGHT OF THE TICK, and it must fill the card. Without flex: 1 this
  // View sizes to its own widest line — the address — so the card looks full width
  // while its contents end early, and the badges pinned "right" land against the
  // address instead of the card's edge. minWidth: 0 lets it shrink below that
  // content width too, so a long address wraps rather than widening the card.
  cardBody: { flex: 1, minWidth: 0 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    // Takes the card's full width, so "the right" means the card's right edge and
    // not wherever this row's own content happens to end. Without it the row can
    // be sized to its content inside the column, and the badges drift inward by a
    // different amount on every card — which is exactly how they were landing.
    alignSelf: 'stretch',
  },
  // The phone version of the same row: name on its own line, badges beneath it,
  // both left-aligned with everything else on the card.
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  // minWidth: 0 lets a long name ellipsise instead of pushing the badges off the
  // right edge — a flex item's default floor is its content, which a name can
  // easily exceed.
  name: { flex: 1, minWidth: 0 },
  // flex: 1 is what shares a ROW; stacked, it would fight the column's height
  // instead. Full width and no flex is the same instruction in one direction.
  nameStacked: { flex: 0, width: '100%' },
  // HARD RIGHT. The auto margin eats all the free space to the badges' left, so
  // the shift code and the status sit against the card's right edge on every row
  // and read as a column down the board — the coordinator scans "who is still
  // Pending" vertically, which only works if they all start at the same x.
  // Belt and braces with the row's space-between, deliberately: it is the badges'
  // OWN style, so it survives the row being restyled or stacked.
  // flexShrink: 0 keeps the two chips full-size and on one line; they are short
  // and squeezing "Pending" is never the right sacrifice.
  chips: { flexDirection: 'row', gap: 6, marginLeft: 'auto', flexShrink: 0 },
  // Stacked, the row above is a COLUMN — and an auto left margin in a column
  // pushes across the cross axis, which would fling the badges to the far right
  // on their own line, adrift from the name they describe. Back to zero so they
  // line up under the name with the route and address lines below.
  chipsStacked: { marginLeft: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4 },
  meta: { color: colors.muted, flex: 1 },
  overnight: { color: '#4527A0', marginTop: 4, fontStyle: 'italic' },
  // Wraps, because "No route set" plus a Set route button is close to a narrow
  // card's full width.
  // Sits under the meta lines, pulled left so the text button lines up with them
  // rather than floating in the middle of the card.
  deskCancelRow: { alignSelf: 'flex-start', marginTop: 2, marginLeft: -8 },
  cancelClosed: { color: colors.muted, marginLeft: 8, marginTop: 4 },
  noRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  noRouteText: { color: '#B26A00' },
  assignedText: { color: colors.success, fontWeight: 'bold', marginTop: 6 },

  empty: { alignItems: 'center', marginTop: 50, gap: 8, paddingHorizontal: 24 },
  emptyText: { color: colors.muted, textAlign: 'center' },
  emptyHint: { color: colors.muted, textAlign: 'center', lineHeight: 18 },

  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  assignBtn: { flex: 1, marginLeft: 10 },

  dialog: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dialogBody: { paddingVertical: 8 },
  dialogHint: { color: colors.muted, marginTop: 10, lineHeight: 18 },
  dialogLabel: { marginTop: 14, marginBottom: 4, color: colors.text },
  // The routes already in use, offered as one-tap chips under the free-text
  // field — typing a route in full at 9 PM is exactly when a typo happens.
  routeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  routeChip: { marginBottom: 2 },
});
