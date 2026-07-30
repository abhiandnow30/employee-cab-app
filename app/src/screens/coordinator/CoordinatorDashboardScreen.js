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
  Snackbar, IconButton, Divider, TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { groupByRoute, groupByShift, rideStats } from '../../services/rides';
import { cabCapacity } from '../../services/cabs';
import { todayKey, shiftDateKey } from '../../utils/datetime';
import { SHIFT_COLORS } from '../../data/shifts';
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
    routeOptions, setEmployeeRoute,
  } = useApp();

  const [date, setDate] = useState(() => todayKey());
  const [groupMode, setGroupMode] = useState('route'); // route | shift
  const [selected, setSelected] = useState([]); // ride keys
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenCab, setChosenCab] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);
  // The rider whose route we're fixing, and the route picked for them. Routing is
  // HR's job, but the coordinator is the one who discovers at 9 PM that somebody
  // is on no route at all — and a ride nobody can group is a ride nobody drives.
  const [routeFor, setRouteFor] = useState(null);
  const [routeChoice, setRouteChoice] = useState(null);

  // The derived rides for the chosen day, and the sections to show them in.
  const rides = useMemo(() => ridesOn(date), [ridesOn, date]);
  const stats = useMemo(() => rideStats(rides), [rides]);
  const visible = useMemo(
    () => (onlyPending ? rides.filter((r) => !r.assignedCabId) : rides),
    [rides, onlyPending]
  );
  const sections = useMemo(
    () => (groupMode === 'route' ? groupByRoute(visible) : groupByShift(visible)),
    [visible, groupMode]
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

  // Put this rider on a route. Saved on their PROFILE, so it holds for every
  // remaining day of the roster instead of just today's board.
  async function confirmRoute() {
    if (!routeFor || !routeChoice) return;
    setBusy(true);
    const res = await setEmployeeRoute(routeFor.employeeId, routeChoice);
    setBusy(false);
    setRouteFor(null);
    if (res?.ok) {
      setSnack(`${routeFor.employeeName} added to ${routeChoice}.`);
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

        {/* Headline numbers */}
        <View style={styles.stats}>
          <Stat label="Rides" value={stats.total} />
          <Stat label="Waiting" value={stats.pending} tone={stats.pending ? 'warn' : 'muted'} />
          <Stat label="Assigned" value={stats.assigned} tone="good" />
          <Stat label="In / Out" value={`${stats.inbound}/${stats.outbound}`} tone="muted" />
        </View>

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
          <Button
            compact
            mode={onlyPending ? 'contained-tonal' : 'text'}
            icon={onlyPending ? 'filter' : 'filter-outline'}
            onPress={() => setOnlyPending((v) => !v)}
          >
            {onlyPending ? 'Waiting only' : 'All rides'}
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
                  : onlyPending
                  ? 'Every ride today has a cab.'
                  : 'No rides on this day.'}
              </Text>
              {noRoster ? (
                <Text variant="bodySmall" style={styles.emptyHint}>
                  Ask HR to upload the monthly shift roster — rides are generated
                  from it.
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

function Stat({ label, value, tone }) {
  const color =
    tone === 'good' ? colors.success
    : tone === 'warn' ? '#B26A00'
    : tone === 'muted' ? colors.muted
    : colors.text;
  return (
    <View style={styles.stat}>
      <Text variant="titleLarge" style={[styles.statValue, { color }]}>
        {value}
      </Text>
      <Text variant="bodySmall" style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  col: { flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center' },

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
});
