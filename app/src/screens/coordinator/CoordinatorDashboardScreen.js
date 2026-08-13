// ---------------------------------------------------------------------------
// COORDINATOR DASHBOARD  (today's rides)
//
// The operational centre of the app. The coordinator does NOT wait for employees
// to request rides and does NOT need admin approval to run the day — they take
// the rides the roster implies and put people in cabs.
//
// Rides shown here are DERIVED from the monthly roster (see services/rides.js),
// so a ride exists the moment HR imports the month. A booking document is only
// written when this screen assigns a cab, which is what keeps ~11,000 rides a
// month from becoming 11,000 documents.
//
// Two ways to work, because desks use both:
//   • by ROUTE  — everyone from one pickup area, to fill a cab
//   • by SHIFT  — everyone travelling at the same time in the same direction
//
// Selecting riders across a group and assigning one cab is the carpool action.
// Capacity and "that cab is already going the other way" are enforced before the
// write, not after.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, SectionList, Pressable } from 'react-native';
import {
  Text, Card, Chip, Button, SegmentedButtons, Portal, Dialog, RadioButton,
  Snackbar, IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import RideStartCode from '../../components/RideStartCode';
import { groupByRoute, groupByShift, rideStats } from '../../services/rides';
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
  const [groupMode, setGroupMode] = useState('route'); // route | shift
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
  const stats = useMemo(() => rideStats(rides), [rides]);
  const visible = useMemo(() => {
    if (rideFilter === 'waiting') return rides.filter((r) => !r.assignedCabId);
    if (rideFilter === 'assigned') return rides.filter((r) => r.assignedCabId);
    return rides;
  }, [rides, rideFilter]);
  const sections = useMemo(
    () => (groupMode === 'route' ? groupByRoute(visible) : groupByShift(visible)),
    [visible, groupMode]
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
          <MaterialCommunityIcons
            name={groupMode === 'route' ? 'map-marker' : 'clock-outline'}
            size={17}
            color={colors.primaryDark}
          />
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

              {/* Grouped by shift, the route is no longer the section header, so it
                  has to be on the card — it's how the desk knows who can share. */}
              {item.route && groupMode === 'shift' ? (
                <View style={styles.metaRow}>
                  <MaterialCommunityIcons name="map-marker-path" size={14} color={colors.muted} />
                  <Text variant="bodySmall" style={styles.meta} numberOfLines={1}>
                    {item.route}
                  </Text>
                </View>
              ) : null}
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
          <Stat label="In / Out" value={`${stats.inbound}/${stats.outbound}`} tone="muted" />
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
          <SegmentedButtons
            value={groupMode}
            onValueChange={setGroupMode}
            density="small"
            style={styles.segmented}
            buttons={[
              { value: 'route', label: 'By route', icon: 'map-marker' },
              { value: 'shift', label: 'By shift', icon: 'clock-outline' },
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
              working today. Without this the coordinator can see that and not
              fix it — the roster is HR's screen and they may well have gone
              home. One day only; a stretch of days is still HR's call. */}
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
                  ? 'No rides on this day.'
                  : rideFilter === 'waiting'
                  ? 'Every ride today has a cab.'
                  : /* The day HAS rides and none of them are assigned — an empty
                       board here means the work hasn't started, not that there is
                       none. Saying "no rides" would read as the opposite. */
                    rideFilter === 'assigned'
                  ? 'No ride today has a cab yet.'
                  : 'No rides on this day.'}
              </Text>
              {noRoster ? (
                <Text variant="bodySmall" style={styles.emptyHint}>
                  Ask HR to upload the monthly shift roster — rides are generated
                  from it.
                </Text>
              ) : stats.total === 0 ? (
                /* The roster IS loaded, so an empty day is a rostering answer,
                   not a missing one. Saying which answers are possible saves
                   the coordinator checking whether the upload went wrong. */
                <Text variant="bodySmall" style={styles.emptyHint}>
                  The roster is loaded — nobody is down to travel today. Week off,
                  holiday, leave, or a shift the company runs no cab for.
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
              {routeOptions.length === 0 ? (
                <Text variant="bodyMedium">
                  No routes defined yet. HR adds them on Routes & Timings.
                </Text>
              ) : (
                <RadioButton.Group onValueChange={setRouteChoice} value={routeChoice}>
                  {routeOptions.map((r) => (
                    <RadioButton.Item key={r} label={r} value={r} />
                  ))}
                </RadioButton.Group>
              )}
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
  segmented: { flex: 1, minWidth: 220 },

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
});
