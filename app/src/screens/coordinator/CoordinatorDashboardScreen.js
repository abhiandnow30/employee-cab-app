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
import { StyleSheet, View, SectionList, Pressable } from 'react-native';
import {
  Text, Card, Chip, Button, SegmentedButtons, Portal, Dialog, RadioButton,
  TextInput, Snackbar, IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import RideStartCode from '../../components/RideStartCode';
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
    employees, shiftPolicy, addRiderToDay,
  } = useApp();

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
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleWrap}>
          {/* Always a route pin now — sections are always routes. */}
          <MaterialCommunityIcons name="map-marker" size={17} color={colors.primaryDark} />
          <Text variant="titleSmall" style={styles.sectionTitle} numberOfLines={1}>
            {section.title}
          </Text>
          <Text variant="bodySmall" style={styles.sectionCount}>
            ({section.data.length})
          </Text>
        </View>
        {section.unassigned > 0 ? (
          <Button compact mode="text" onPress={() => selectGroup(section.data)}>
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
    return (
      <Pressable onPress={() => toggle(item.key)}>
        <Card style={[styles.card, ticked && styles.cardSelected]} mode="elevated">
          <Card.Content style={styles.cardRow}>
            <MaterialCommunityIcons
              name={ticked ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={ticked ? colors.primary : colors.muted}
              style={styles.check}
            />
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text variant="titleSmall" numberOfLines={1} style={styles.name}>
                  {item.employeeName}
                </Text>
                <View style={styles.chips}>
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
                  {/* The shift's own start/end — a deadline (pickup) or
                      earliest-bound (drop) on the employee's schedule, never a
                      promised cab instant. The driver/desk decide the actual
                      timing on the day. */}
                  {item.direction} · {item.direction === 'Home → Office' ? 'by' : 'after'}{' '}
                  {item.shift}
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
          <Pressable style={styles.datePill} onPress={() => goToDate(todayKey())}>
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
            subset of them, so it stays a read-only figure. */}
        <View style={styles.stats}>
          <Stat
            label="Rides"
            value={stats.total}
            active={rideFilter === 'all'}
            onPress={() => setRideFilter('all')}
            showsLabel="every ride"
          />
          <Stat
            label="Waiting"
            value={stats.pending}
            tone={stats.pending ? 'warn' : 'muted'}
            active={rideFilter === 'waiting'}
            onPress={() => setRideFilter('waiting')}
            showsLabel="only rides with no cab yet"
          />
          <Stat
            label="Assigned"
            value={stats.assigned}
            tone="good"
            active={rideFilter === 'assigned'}
            onPress={() => setRideFilter('assigned')}
            showsLabel="only rides that already have a cab"
          />
          {/* Off the WHOLE day (dayStats), not the current direction — this is the
              figure that says how the day splits, and it stays the same as you flip
              between IN and OUT so it can be read as a total. */}
          <Stat
            label="In / Out"
            value={`${dayStats.inbound}/${dayStats.outbound}`}
            tone="muted"
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

        <View style={styles.controls}>
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
            style={styles.segmentedLeg}
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
          {/* The same filter as the numbers above, named rather than counted —
              it says which slice is on screen without the coordinator having to
              read the underline, and clears back to everything in one tap. */}
          <Button
            compact
            mode={rideFilter === 'all' ? 'text' : 'contained-tonal'}
            icon={rideFilter === 'all' ? 'filter-outline' : 'filter'}
            onPress={() => setRideFilter(rideFilter === 'all' ? 'waiting' : 'all')}
          >
            {rideFilter === 'waiting'
              ? 'Waiting only'
              : rideFilter === 'assigned'
              ? 'Assigned only'
              : 'All rides'}
          </Button>
          {/* Someone needs a cab tonight who the month's roster doesn't have
              working today. Without this the coordinator could see that and not
              fix it — Roster Upload is HR's screen and they may well have gone
              home. HR reaches this same button from their own drawer, which is the
              other half of the problem: they are often the one told about a new
              joiner. One day only; a stretch of days is still Roster Upload. */}
          <Button compact mode="text" icon="account-plus" onPress={openAddRider}>
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
              Assign cab to {selected.length}
            </Button>
          </View>
        ) : null}
      </View>

      {/* Cab picker */}
      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)} style={styles.dialog}>
          <Dialog.Title>Assign a cab to {selected.length} rider(s)</Dialog.Title>
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
function Stat({ label, value, tone, active = false, onPress, showsLabel = '' }) {
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
  if (!onPress) return <View style={styles.stat}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.stat, styles.statTappable, active && { borderBottomColor: color }]}
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
  dateText: { fontWeight: '600', color: colors.primaryDark, fontSize: 15 },
  dateReset: { color: colors.primary, fontSize: 12 },

  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  stat: { alignItems: 'center', minWidth: 64 },
  // A transparent border on every tappable stat, coloured in only when it's the
  // active one — so selecting a filter can't shift the row's height.
  statTappable: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingBottom: 2,
    paddingHorizontal: 6,
  },
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
  // Two short segments. It no longer shares the row with a grouping control, so it
  // takes only the width it needs and the filter/Add-a-rider buttons keep the rest.
  // 200, not 170: at 170 each half was ~85px and a bold "OUT" beside its icon
  // ellipsised to "O…", which is the one word on the control that has to be legible.
  segmentedLeg: { flexGrow: 0, flexShrink: 0, minWidth: 200 },
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
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  sectionTitle: { color: colors.primaryDark, fontWeight: 'bold', flexShrink: 1 },
  sectionCount: { color: colors.primaryDark, opacity: 0.7 },

  card: { marginBottom: 10 },
  cardSelected: { borderWidth: 2, borderColor: colors.primary },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  check: { marginRight: 10, marginTop: 2 },
  cardBody: { flex: 1 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: { flex: 1 },
  chips: { flexDirection: 'row', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4 },
  meta: { color: colors.muted, flex: 1 },
  overnight: { color: '#4527A0', marginTop: 4, fontStyle: 'italic' },
  noRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
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
