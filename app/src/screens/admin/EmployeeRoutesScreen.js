// ---------------------------------------------------------------------------
// EMPLOYEE ROUTES  (HR / Admin)
//
// Every employee belongs to a PICKUP ROUTE — the area their cab collects from.
// It is the unit the coordinator works in: everyone on one route is a cabful of
// neighbours, so grouping the day by route turns ~200 individual rides into ~15
// assignment decisions. An employee with no route lands under "No route set" on
// the coordinator's board and has to be grouped by hand, every day of the month.
//
// So this screen exists to answer one question — WHO IS STILL UNROUTED — and to
// fix it in bulk. The screen it replaces asked HR to open a card per person and
// also edit shift and working days, which the monthly roster now owns; routing
// 200 people one card at a time is what stops it from happening at all.
//
// Route names themselves are maintained in Routes & Timings (config/timings.routes),
// so the list here is always the company's live one.
//
// Writes employees/<uid>.roster.route. HR owns this, and the coordinator may also
// set it from their dashboard — see firestore.rules > employees.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, SectionList, Pressable } from 'react-native';
import {
  Text, Card, Button, Chip, Searchbar, Portal, Dialog, RadioButton, Snackbar,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { colors, spacing } from '../../theme';

// Sorts and titles the "nobody has routed these people" group. Kept as a constant
// because it is matched by name in a couple of places below.
const UNROUTED = 'Not routed yet';

// One number in the coverage strip.
function Stat({ label, value, tone }) {
  const color =
    tone === 'warn' ? '#B26A00' : tone === 'good' ? colors.success : colors.muted;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function EmployeeRoutesScreen() {
  const {
    employees, routeOptions, unroutedEmployees, setRouteForEmployees, homeAddressOf,
  } = useApp();

  const [search, setSearch] = useState('');
  const [unroutedOnly, setUnroutedOnly] = useState(false);
  const [selected, setSelected] = useState([]); // uids
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenRoute, setChosenRoute] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const routeOf = (emp) => emp.roster?.route || null;

  // Search covers the things HR actually has in front of them: a name from the
  // sheet, an employee id, or the area in an address they're routing by.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (unroutedOnly && routeOf(e)) return false;
      if (!q) return true;
      const hay = [
        e.name, e.empId, e.email, routeOf(e), e.address || homeAddressOf(e),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [employees, search, unroutedOnly, homeAddressOf]);

  // Grouped by route, unrouted FIRST — that group is the whole job of this screen,
  // so it must never be buried below fifteen finished ones.
  const sections = useMemo(() => {
    const groups = {};
    visible.forEach((e) => {
      const key = routeOf(e) || UNROUTED;
      (groups[key] = groups[key] || []).push(e);
    });
    return Object.keys(groups)
      .sort((a, b) => {
        if (a === UNROUTED) return -1;
        if (b === UNROUTED) return 1;
        return a.localeCompare(b);
      })
      .map((title) => ({
        title,
        isUnrouted: title === UNROUTED,
        data: groups[title].sort((x, y) =>
          (x.name || x.email || '').localeCompare(y.name || y.email || '')
        ),
      }));
  }, [visible]);

  const isSelected = (uid) => selected.includes(uid);
  const toggle = (uid) =>
    setSelected((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  const selectGroup = (data) =>
    setSelected((prev) => Array.from(new Set([...prev, ...data.map((e) => e.uid)])));

  async function applyRoute(route) {
    setBusy(true);
    setError('');
    const res = await setRouteForEmployees(selected, route);
    setBusy(false);
    setPickerOpen(false);
    if (res?.ok) {
      const n = res.count || selected.length;
      setSelected([]);
      setSnack(
        route
          ? `${n} employee${n === 1 ? '' : 's'} moved to ${route}.`
          : `Route cleared for ${n} employee${n === 1 ? '' : 's'}.`
      );
    } else {
      setError(res?.message || 'Could not save those routes.');
    }
  }

  function renderSectionHeader({ section }) {
    const pending = section.data.length;
    return (
      <View style={[styles.sectionHeader, section.isUnrouted && styles.sectionHeaderWarn]}>
        <MaterialCommunityIcons
          name={section.isUnrouted ? 'alert-circle-outline' : 'map-marker'}
          size={17}
          color={section.isUnrouted ? '#B26A00' : colors.primaryDark}
        />
        <Text
          variant="titleSmall"
          numberOfLines={1}
          style={[styles.sectionTitle, section.isUnrouted && styles.sectionTitleWarn]}
        >
          {section.title}
        </Text>
        <Text variant="bodySmall" style={styles.sectionCount}>
          ({pending})
        </Text>
        <View style={styles.spacer} />
        <Button compact mode="text" onPress={() => selectGroup(section.data)}>
          Select {pending}
        </Button>
      </View>
    );
  }

  function renderEmployee({ item }) {
    const ticked = isSelected(item.uid);
    const route = routeOf(item);
    const address = item.address || homeAddressOf(item);
    return (
      <Pressable onPress={() => toggle(item.uid)}>
        <Card style={[styles.card, ticked && styles.cardSelected]} mode="outlined">
          <Card.Content style={styles.cardRow}>
            <MaterialCommunityIcons
              name={ticked ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={ticked ? colors.primary : colors.muted}
            />
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text variant="titleSmall" numberOfLines={1} style={styles.name}>
                  {item.name || item.email}
                </Text>
                <Chip
                  compact
                  style={route ? styles.routeChip : styles.noRouteChip}
                  textStyle={route ? styles.routeChipText : styles.noRouteChipText}
                >
                  {route || 'No route'}
                </Chip>
              </View>
              <Text variant="bodySmall" style={styles.meta}>
                {item.empId ? `ID ${item.empId}` : 'No employee ID'}
                {item.phone ? ` · ${item.phone}` : ''}
              </Text>
              {/* The address is what HR routes BY, so it belongs on the row rather
                  than one tap away. */}
              {address ? (
                <View style={styles.addressRow}>
                  <MaterialCommunityIcons
                    name="map-marker-outline"
                    size={14}
                    color={colors.muted}
                  />
                  <Text variant="bodySmall" style={styles.address} numberOfLines={2}>
                    {address}
                  </Text>
                </View>
              ) : (
                <Text variant="bodySmall" style={styles.noAddress}>
                  No home address on file — ask HR to add one before routing.
                </Text>
              )}
            </View>
          </Card.Content>
        </Card>
      </Pressable>
    );
  }

  const routed = employees.length - unroutedEmployees.length;

  return (
    <View style={styles.container}>
      <View style={styles.col}>
        {/* Coverage first: the only number that matters here is how many people
            the coordinator still can't group. */}
        <View style={styles.stats}>
          <Stat label="Employees" value={employees.length} />
          <Stat label="Routed" value={routed} tone={routed ? 'good' : 'muted'} />
          <Stat
            label="Unrouted"
            value={unroutedEmployees.length}
            tone={unroutedEmployees.length ? 'warn' : 'good'}
          />
          <Stat label="Routes in use" value={new Set(employees.map(routeOf).filter(Boolean)).size} />
        </View>

        <Text variant="bodySmall" style={styles.hint}>
          Tick everyone from one area and set their route in one go. The coordinator
          groups each day's cabs by route, so anybody left unrouted has to be
          grouped by hand.
        </Text>

        <Searchbar
          placeholder="Search name, ID, area…"
          value={search}
          onChangeText={setSearch}
          style={styles.search}
          inputStyle={styles.searchInput}
        />

        <View style={styles.filterRow}>
          <Chip
            selected={unroutedOnly}
            showSelectedCheck={false}
            icon={unroutedOnly ? 'filter' : 'filter-outline'}
            onPress={() => setUnroutedOnly((v) => !v)}
            style={unroutedOnly ? styles.filterOn : undefined}
          >
            {unroutedOnly ? 'Unrouted only' : 'All employees'}
          </Chip>
          {selected.length ? (
            <Button compact mode="text" onPress={() => setSelected([])}>
              Clear {selected.length}
            </Button>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.uid}
          renderItem={renderEmployee}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={employees.length ? 'magnify-close' : 'account-group'}
                size={44}
                color={colors.muted}
              />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {employees.length
                  ? unroutedOnly
                    ? 'Everyone is routed. Nothing left to do here.'
                    : 'No employee matches that search.'
                  : 'No employees yet. Add them in Employee Management, or upload a roster with a Route column.'}
              </Text>
            </View>
          }
        />

        {selected.length > 0 ? (
          <View style={styles.actionBar}>
            <Text variant="bodyMedium" style={styles.actionCount}>
              {selected.length} selected
            </Text>
            <Button
              mode="contained"
              icon="map-marker-check"
              onPress={() => {
                setChosenRoute(null);
                setPickerOpen(true);
              }}
            >
              Set route
            </Button>
          </View>
        ) : null}
      </View>

      {/* Route picker */}
      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)} style={styles.dialog}>
          <Dialog.Title>Set route for {selected.length} employee(s)</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              {routeOptions.length === 0 ? (
                <Text variant="bodyMedium">
                  No routes defined yet. Add them on Routes & Timings first.
                </Text>
              ) : (
                <RadioButton.Group onValueChange={setChosenRoute} value={chosenRoute}>
                  {routeOptions.map((r) => (
                    <RadioButton.Item key={r} label={r} value={r} />
                  ))}
                </RadioButton.Group>
              )}
              <Divider style={styles.dialogDivider} />
              {/* Clearing is a real action — someone routed to the wrong area is
                  better off unrouted and visible than quietly wrong. */}
              <Button
                mode="text"
                textColor={colors.danger}
                icon="map-marker-off"
                disabled={busy}
                onPress={() => applyRoute(null)}
              >
                Remove route instead
              </Button>
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={() => applyRoute(chosenRoute)}
              loading={busy}
              disabled={busy || !chosenRoute}
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  col: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  hint: { opacity: 0.7, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  search: { marginHorizontal: spacing.md, marginTop: spacing.sm, borderRadius: 12 },
  searchInput: { fontSize: 14 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  filterOn: { backgroundColor: '#E3F0FF' },
  list: { padding: spacing.md, paddingBottom: 90 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sectionHeaderWarn: {
    backgroundColor: '#FFF4E0',
    borderRadius: 8,
    paddingVertical: spacing.xs,
  },
  sectionTitle: { color: colors.primaryDark, maxWidth: '55%' },
  sectionTitleWarn: { color: '#B26A00' },
  sectionCount: { color: colors.muted },
  spacer: { flex: 1 },
  card: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  cardSelected: { borderColor: colors.primary, backgroundColor: '#F0F6FF' },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardBody: { flex: 1 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: { flex: 1 },
  routeChip: { backgroundColor: '#E8F5E9' },
  routeChipText: { color: colors.success, fontSize: 11 },
  noRouteChip: { backgroundColor: '#FFF4E0' },
  noRouteChipText: { color: '#B26A00', fontSize: 11 },
  meta: { color: colors.muted, marginTop: 2 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 2 },
  address: { flex: 1, color: colors.muted, lineHeight: 18 },
  noAddress: { color: '#B26A00', marginTop: 2 },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionCount: { color: colors.muted },
  error: { color: colors.danger, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  empty: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: colors.muted, marginTop: 8, textAlign: 'center' },
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  dialogBody: { paddingVertical: spacing.sm },
  dialogDivider: { marginVertical: spacing.sm },
});
