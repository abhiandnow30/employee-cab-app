// ---------------------------------------------------------------------------
// BOOKINGS SCREEN  (admin home)
// Two different jobs live on this one screen:
//
//   1. UNASSIGNED bookings have no cab yet, so they're grouped by ROUTE (the
//      cab location from each employee's shift roster) so people who ride
//      together are listed together. To arrange a carpool, tick several
//      employees on the same route — or "Select all" for a route — and
//      assign them ONE shared cab. Cancelled bookings can't be selected.
//   2. ASSIGNED bookings already have a cab, so route grouping no longer
//      matters — instead they're grouped by CAB as a collapsible list: one
//      row per cab (cab number, driver, rider count), tap to expand and see
//      every rider on it (route direction, shift time, pickup address).
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import { Text, Card, Chip, Button, Portal, Dialog, RadioButton, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeEmployees } from '../../services/profile';
import { isBookingPast } from '../../utils/datetime';
import { SOURCE } from '../../data/mockData';
import { statusColors, colors } from '../../theme';
import CalendarFilter, { rangeLabel } from '../../components/CalendarFilter';

const NO_ROUTE = 'No route set';

export default function BookingsScreen({ navigation }) {
  const {
    bookings, cabs, cabCapacity, getCabById, assignCabToGroup, approveCancel, rejectCancel,
  } = useApp();

  const [selected, setSelected] = useState([]); // booking ids ticked for grouping
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenCab, setChosenCab] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(null); // booking id being approved/rejected
  const [empByUid, setEmpByUid] = useState({}); // uid → employee profile (for route/address)
  const [error, setError] = useState(''); // assignment guard / failure message
  const [dateRange, setDateRange] = useState(null); // { start, end } (YYYY-MM-DD) or null = all dates
  const [expandedCabIds, setExpandedCabIds] = useState(() => new Set()); // which cab accordions are open
  const [helpOpen, setHelpOpen] = useState(false); // "How this works" explainer dialog

  // Live employee profiles, so each booking can show its owner's route + pickup
  // address (these live on the profile, not on the booking itself).
  useEffect(() => {
    const unsub = subscribeEmployees(
      (list) => {
        const map = {};
        list.forEach((e) => {
          map[e.uid] = e;
        });
        setEmpByUid(map);
      },
      (e) => console.warn('[bookings] employees subscription error:', e.message)
    );
    return unsub;
  }, []);

  const isSelected = (id) => selected.includes(id);
  // A ride awaiting cancellation shouldn't be handed a cab — resolve it first.
  const hasPendingCancel = (b) => b.cancelStatus === 'Requested';
  const isPast = (b) => isBookingPast(b); // scheduled date/time already passed
  // Assignable only if still open, not awaiting cancellation, AND not in the past.
  const canSelect = (b) => b.status === 'Booked' && !hasPendingCancel(b) && !isPast(b);
  const isNoShow = (b) => b.status === 'No show';
  // A past ride that never got a cab is "Expired" (assignment closed).
  const isExpired = (b) => isPast(b) && b.status === 'Booked';

  // Employee details for a booking (from the live profile map).
  const empOf = (b) => empByUid[b.employeeId] || {};
  const routeOf = (b) => empOf(b).roster?.route || NO_ROUTE;
  // The employee's home address: from sign-up (`address`) or their Profile map
  // pin (`home` — a readable displayName or the structured parts). This is what
  // the desk uses to group riders by location before assigning a shared cab.
  const addressOf = (b) => {
    const emp = empOf(b);
    if (emp.address) return emp.address;
    const h = emp.home;
    if (!h) return '';
    if (h.displayName) return h.displayName;
    return [h.line1, h.area, h.city, h.pincode].filter(Boolean).join(', ');
  };

  const pendingCount = bookings.filter(hasPendingCancel).length;
  const noShowCount = bookings.filter(isNoShow).length;

  // Apply the chosen date range (null = show every date). Keys are ISO
  // "YYYY-MM-DD", so string comparison gives correct chronological ordering.
  const visibleBookings = dateRange
    ? bookings.filter((b) => b.date >= dateRange.start && b.date <= dateRange.end)
    : bookings;

  // --- Split by assignment state, not by date ------------------------------
  // A booking with no cab yet needs the route-grouped, selectable workflow
  // below. Once it has a cab, it belongs under that cab — route no longer
  // matters, the cab is the unit the desk thinks in.
  //
  // Past-dated bookings are left out of this screen entirely (for now) — the
  // desk only needs to act on today's and future rides here. That data isn't
  // deleted: Ride History, No-Shows, and Cancelled Rides still show it.
  const unassigned = visibleBookings.filter((b) => !b.assignedCabId && !isPast(b));
  const assigned = visibleBookings.filter((b) => b.assignedCabId && !isPast(b));

  // --- UNASSIGNED: group by route -------------------------------------------
  const routeGroups = {};
  unassigned.forEach((b) => {
    const route = routeOf(b);
    (routeGroups[route] = routeGroups[route] || []).push(b);
  });
  const sections = Object.keys(routeGroups)
    .map((route) => ({ route, data: routeGroups[route] }))
    // Real routes A→Z; "No route set" last — an unrouted rider is a defect to notice.
    .sort((a, b) => {
      if (a.route === NO_ROUTE) return 1;
      if (b.route === NO_ROUTE) return -1;
      return a.route.localeCompare(b.route);
    });

  // --- ASSIGNED: group by cab, one row per cab ------------------------------
  const cabGroupMap = {};
  assigned.forEach((b) => {
    (cabGroupMap[b.assignedCabId] = cabGroupMap[b.assignedCabId] || []).push(b);
  });
  const cabGroups = Object.keys(cabGroupMap)
    .map((cabId) => {
      const data = [...cabGroupMap[cabId]].sort(
        (a, b) => String(a.date).localeCompare(String(b.date)) || a.employeeName.localeCompare(b.employeeName)
      );
      const cab = getCabById(cabId);
      const minDate = data.reduce((min, b) => (min === null || String(b.date) < min ? String(b.date) : min), null);
      return { cabId, cab, data, minDate };
    })
    // Soonest ride date first, cab number breaks ties.
    .sort((a, b) => {
      const byDate = String(a.minDate || '').localeCompare(String(b.minDate || ''));
      if (byDate !== 0) return byDate;
      return String(a.cab?.cabNumber || '').localeCompare(String(b.cab?.cabNumber || ''));
    });

  async function resolve(bookingId, approve) {
    setResolving(bookingId);
    const res = await (approve ? approveCancel(bookingId) : rejectCancel(bookingId));
    setResolving(null);
    if (!res?.ok) setError(res?.message || 'Could not update that request.');
  }

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Tick every selectable booking in one route (quick carpool grouping).
  function selectGroup(data) {
    const ids = data.filter(canSelect).map((b) => b.id);
    setSelected((prev) => Array.from(new Set([...prev, ...ids])));
  }

  function openPicker() {
    setChosenCab(null);
    setPickerOpen(true);
  }

  function toggleCabExpanded(cabId) {
    setExpandedCabIds((prev) => {
      const next = new Set(prev);
      if (next.has(cabId)) next.delete(cabId);
      else next.add(cabId);
      return next;
    });
  }

  async function confirmAssign() {
    if (!chosenCab || selected.length === 0) return;
    setSaving(true);
    try {
      const res = await assignCabToGroup(selected, chosenCab);
      if (!res?.ok) {
        // Guard rejected (e.g. a selected ride is now in the past).
        setError(res?.message || 'Could not assign the cab. Please try again.');
        setPickerOpen(false);
        setSelected([]);
        return;
      }
      setSelected([]);
      setPickerOpen(false);
    } catch (e) {
      setError(e.message || 'Could not assign the cab. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderSectionHeader(section) {
    const selectableCount = section.data.filter(canSelect).length;
    const pastHeader = section.isPastSection;
    return (
      <View style={[styles.sectionHeader, pastHeader && styles.pastSectionHeader]}>
        <View style={styles.sectionTitleWrap}>
          <MaterialCommunityIcons
            name={pastHeader ? 'history' : 'map-marker'}
            size={18}
            color={pastHeader ? colors.muted : colors.primary}
          />
          <Text variant="titleSmall" style={[styles.sectionTitle, pastHeader && styles.pastSectionTitle]}>
            {section.route}
          </Text>
          <Text variant="bodySmall" style={[styles.sectionCount, pastHeader && styles.pastSectionTitle]}>
            ({section.data.length})
          </Text>
        </View>
        {/* No "Select all" for past rides — they can't be assigned. */}
        {!pastHeader && selectableCount > 0 && (
          <Button compact mode="text" onPress={() => selectGroup(section.data)}>
            Select all
          </Button>
        )}
      </View>
    );
  }

  // Shared detail body for a single booking — direction, date/shift, pickup
  // address, and any of the ad-hoc / no-show / pending-cancel call-outs. Used
  // both by the unassigned route cards and by each rider row inside a cab's
  // expanded accordion, so the desk never loses these actions either way.
  function renderBookingBody(item) {
    const address = addressOf(item);
    const pendingCancel = hasPendingCancel(item);
    const busy = resolving === item.id;
    return (
      <>
        <Text variant="bodyMedium" style={styles.detail}>
          {item.direction}
        </Text>
        <Text variant="bodyMedium" style={styles.detail}>
          {/* The shift's own start/end — a deadline (pickup) or
              earliest-bound (drop), never a promised cab instant. */}
          {item.date} · {item.direction === 'Home → Office' ? 'by' : 'after'} {item.shift}
        </Text>
        {/* Where to pick them up: the real address from their roster if we
            have it, otherwise the generic pickup label on the booking. */}
        <View style={styles.locationRow}>
          <MaterialCommunityIcons
            name="map-marker-outline"
            size={15}
            color={colors.muted}
            style={styles.locationIcon}
          />
          <Text variant="bodySmall" style={styles.locationText}>
            {address || `Pickup: ${item.pickup}`}
          </Text>
        </View>
        {/* Why this one-off ride was raised. The employee fills in a
            reason and comment on the ad-hoc form, and it was being stored
            but never shown here — so the desk was approving blind. */}
        {item.source === SOURCE.ADHOC && (
          <View style={styles.adhocBox}>
            <View style={styles.adhocHeader}>
              <MaterialCommunityIcons name="car-clock" size={15} color={colors.primaryDark} />
              <Text variant="labelSmall" style={styles.adhocTitle}>
                One-time ride{item.reason ? ` · ${item.reason}` : ''}
              </Text>
            </View>
            {item.comment ? (
              <Text variant="bodySmall" style={styles.adhocComment}>
                “{item.comment}”
              </Text>
            ) : null}
            {item.officeLocation ? (
              <Text variant="bodySmall" style={styles.adhocMeta}>
                Office: {item.officeLocation}
              </Text>
            ) : null}
          </View>
        )}

        {/* --- No-show flag raised by the driver --- */}
        {isNoShow(item) && (
          <View style={styles.noShowRow}>
            <MaterialCommunityIcons name="account-alert" size={16} color={colors.danger} />
            <Text variant="bodySmall" style={styles.noShowText}>
              Employee was not at the pickup.
            </Text>
          </View>
        )}

        {/* --- Pending cancellation request: approve or reject --- */}
        {pendingCancel && (
          <View style={styles.cancelBox}>
            <View style={styles.cancelHeader}>
              <MaterialCommunityIcons name="close-circle-outline" size={18} color="#C62828" />
              <Text variant="labelLarge" style={styles.cancelTitle}>
                Cancellation requested
              </Text>
            </View>
            {item.cancelReason ? (
              <Text variant="bodySmall" style={styles.cancelReason}>
                “{item.cancelReason}”
              </Text>
            ) : (
              <Text variant="bodySmall" style={styles.cancelReasonMuted}>
                No reason given.
              </Text>
            )}
            <View style={styles.cancelActions}>
              <Button
                mode="outlined"
                compact
                onPress={() => resolve(item.id, false)}
                disabled={busy}
                style={styles.cancelActionBtn}
              >
                Reject
              </Button>
              <Button
                mode="contained"
                compact
                icon="check"
                buttonColor="#C62828"
                onPress={() => resolve(item.id, true)}
                loading={busy}
                disabled={busy}
                style={styles.cancelActionBtn}
              >
                Approve cancel
              </Button>
            </View>
          </View>
        )}
      </>
    );
  }

  function renderBooking(item) {
    const selectable = canSelect(item);
    const ticked = isSelected(item.id);
    const pendingCancel = hasPendingCancel(item);
    const past = isPast(item);
    const expired = isExpired(item); // past + never assigned

    return (
      <Pressable key={item.id} onPress={() => selectable && toggle(item.id)}>
        <Card
          style={[
            styles.card,
            ticked && styles.cardSelected,
            pendingCancel && styles.cardCancel,
            past && styles.cardPast,
          ]}
          mode="elevated"
        >
          <Card.Content style={styles.cardRow}>
            {selectable && (
              <MaterialCommunityIcons
                name={ticked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={24}
                color={ticked ? colors.primary : colors.muted}
                style={styles.check}
              />
            )}
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text variant="titleMedium">{item.employeeName}</Text>
                {expired ? (
                  <Chip
                    compact
                    icon="clock-alert-outline"
                    style={styles.expiredChip}
                    textStyle={styles.chipText}
                  >
                    Expired
                  </Chip>
                ) : (
                  <Chip
                    compact
                    style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
                    textStyle={styles.chipText}
                  >
                    {item.status}
                  </Chip>
                )}
              </View>
              {renderBookingBody(item)}
            </View>
          </Card.Content>
        </Card>
      </Pressable>
    );
  }

  // One rider row inside an expanded cab accordion — same detail body as an
  // unassigned card, minus the checkbox and its own Card chrome.
  function renderCabEmployeeRow(item) {
    const past = isPast(item);
    return (
      <View
        key={item.id}
        style={[styles.cabEmployeeRow, isNoShow(item) && styles.cardNoShow, past && styles.cardPast]}
      >
        <View style={styles.rowBetween}>
          <Text variant="titleSmall">{item.employeeName}</Text>
          <Chip
            compact
            style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
            textStyle={styles.chipText}
          >
            {item.status}
          </Chip>
        </View>
        {renderBookingBody(item)}
      </View>
    );
  }

  // One cab's accordion card — cab number, driver, rider count; expands to
  // driver phone + every rider currently in the active date filter.
  function renderCabGroup(group) {
    const { cabId, cab, data } = group;
    const expanded = expandedCabIds.has(cabId);
    const count = data.length;
    return (
      <Card key={cabId} style={styles.cabGroupCard} mode="elevated">
        <Pressable onPress={() => toggleCabExpanded(cabId)}>
          <Card.Content style={styles.cabGroupHeader}>
            <View style={styles.cabGroupHeaderLeft}>
              <MaterialCommunityIcons name="car" size={22} color={colors.primary} style={styles.cabGroupIcon} />
              <View>
                <Text variant="titleMedium" style={styles.cabGroupTitle}>
                  {cab?.cabNumber || 'Unknown cab'}
                </Text>
                <Text variant="bodySmall" style={styles.detail}>
                  Driver: {cab?.driverName || 'Unassigned'}
                </Text>
                <Text variant="bodySmall" style={styles.detail}>
                  {count} Employee{count === 1 ? '' : 's'} Assigned
                </Text>
              </View>
            </View>
            <MaterialCommunityIcons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={26}
              color={colors.muted}
            />
          </Card.Content>
        </Pressable>
        {expanded && (
          <Card.Content style={styles.cabGroupBody}>
            {cab?.driverPhone ? (
              <Text variant="bodySmall" style={styles.detail}>
                Phone: {cab.driverPhone}
              </Text>
            ) : null}
            <Text variant="labelLarge" style={styles.employeesHeader}>
              Employees Assigned
            </Text>
            {data.map(renderCabEmployeeRow)}
          </Card.Content>
        )}
      </Card>
    );
  }

  const nothingToShow = sections.length === 0 && cabGroups.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
      {noShowCount > 0 && (
        <View style={styles.noShowBanner}>
          <MaterialCommunityIcons name="account-alert" size={18} color={colors.danger} />
          <Text variant="bodySmall" style={styles.noShowBannerText}>
            {noShowCount} no-show{noShowCount > 1 ? 's' : ''}: employee wasn't at the pickup.
          </Text>
        </View>
      )}

      {pendingCount > 0 && (
        <View style={styles.cancelBanner}>
          <MaterialCommunityIcons name="bell-alert-outline" size={18} color="#B26A00" />
          <Text variant="bodySmall" style={styles.cancelBannerText}>
            {pendingCount} cancellation request{pendingCount > 1 ? 's' : ''} awaiting your approval.
          </Text>
        </View>
      )}

      <View style={styles.hintRow}>
        <Text variant="bodySmall" style={styles.hint}>
          Unassigned employees are grouped by route — tick people on the same route (or
          “Select all”) and assign them a shared cab. Rides that already have a cab are
          grouped by cab below.
        </Text>
        <Button
          mode="text"
          icon="help-circle-outline"
          compact
          onPress={() => setHelpOpen(true)}
          style={styles.hintHelpBtn}
        >
          How this works
        </Button>
      </View>

      {/* Date filter — pick a day, a range, or a whole month. */}
      <View style={styles.filterRow}>
        <CalendarFilter value={dateRange} onChange={setDateRange} />
        {dateRange ? (
          <Button compact mode="text" onPress={() => setDateRange(null)}>
            Clear
          </Button>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {nothingToShow ? (
          <Text style={styles.empty}>
            {dateRange ? `No bookings for ${rangeLabel(dateRange)}.` : 'No bookings yet.'}
          </Text>
        ) : (
          <>
            {sections.map((section) => (
              <View key={section.route}>
                {renderSectionHeader(section)}
                {section.data.map(renderBooking)}
              </View>
            ))}

            {cabGroups.length > 0 && (
              <View>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleWrap}>
                    <MaterialCommunityIcons name="car-multiple" size={18} color={colors.primary} />
                    <Text variant="titleSmall" style={styles.sectionTitle}>
                      Assigned cabs
                    </Text>
                    <Text variant="bodySmall" style={styles.sectionCount}>
                      ({cabGroups.length})
                    </Text>
                  </View>
                </View>
                {cabGroups.map(renderCabGroup)}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Action bar — appears when at least one booking is ticked */}
      {selected.length > 0 && (
        <View style={styles.actionBar}>
          <Button mode="text" onPress={() => setSelected([])}>
            Clear
          </Button>
          <Button mode="contained" icon="car" onPress={openPicker} style={styles.assignBtn}>
            Assign cab to {selected.length} selected
          </Button>
        </View>
      )}

      {/* Cab picker dialog */}
      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)}>
          <Dialog.Title>Assign cab to {selected.length} employee(s)</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group onValueChange={setChosenCab} value={chosenCab}>
              {cabs.map((c) => (
                // Unlinked cabs are disabled: the driver's trip list follows the
                // cab↔driver link, so assigning one hides the trip from everybody.
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
            <Text variant="bodySmall" style={styles.pickerHint}>
              A cab can't be given more riders than it has seats, or two trips in
              opposite directions at the same time.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)}>Cancel</Button>
            <Button onPress={confirmAssign} disabled={!chosenCab || saving} loading={saving}>
              Assign
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* "How this works" — the two-phase model this screen runs on */}
      <Portal>
        <Dialog visible={helpOpen} onDismiss={() => setHelpOpen(false)} style={styles.helpDialog}>
          <Dialog.Title>How Bookings works</Dialog.Title>
          <Dialog.Content>
            <View style={styles.helpItem}>
              <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                Employees with no cab yet are grouped by pickup route — tick people on
                the same route (or "Select all") and assign them one shared cab.
              </Text>
            </View>
            <View style={styles.helpItem}>
              <MaterialCommunityIcons name="car-outline" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                Once a cab is assigned, that booking moves into "Assigned cabs" below,
                grouped by cab instead of route — tap a cab to see everyone riding in it.
              </Text>
            </View>
            <View style={styles.helpItem}>
              <MaterialCommunityIcons name="account-plus-outline" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                Need a cab for someone not covered by this month's roster at all? Go to
                Roster Upload → "Add a single employee" first — bookings only exist for
                rides the roster generates.
              </Text>
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setHelpOpen(false)}>Got it</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Guard / error feedback (e.g. a selected ride slipped into the past) */}
      <Snackbar visible={!!error} onDismiss={() => setError('')} duration={4000}>
        {error}
      </Snackbar>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 8,
    marginBottom: 4,
  },
  hint: { opacity: 0.7, flex: 1, marginHorizontal: 6 },
  hintHelpBtn: { marginLeft: 4 },
  helpDialog: { maxWidth: 480, alignSelf: 'center', width: '100%' },
  helpItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  helpIcon: { marginTop: 2 },
  helpText: { flex: 1, lineHeight: 20 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    marginTop: 6,
    marginBottom: 2,
  },
  listContent: { padding: 12, paddingBottom: 90 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E3F0FF',
    borderRadius: 8,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  sectionTitle: { color: colors.primaryDark, fontWeight: 'bold' },
  sectionCount: { color: colors.primaryDark, opacity: 0.7 },
  pastSectionHeader: { backgroundColor: '#ECEFF1' },
  pastSectionTitle: { color: colors.muted },
  card: { marginBottom: 12 },
  cardSelected: { borderWidth: 2, borderColor: colors.primary },
  cardCancel: { borderWidth: 1, borderColor: '#F5B5B0' },
  cardNoShow: { borderLeftWidth: 5, borderLeftColor: colors.danger },
  cardPast: { opacity: 0.6 },
  expiredChip: { backgroundColor: '#757575' },
  noShowBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDECEA',
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 12,
    marginTop: 4,
  },
  noShowBannerText: { color: colors.danger, flex: 1, fontWeight: '600' },
  noShowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  noShowText: { color: colors.danger, fontWeight: '600' },
  cancelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF6E5',
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 12,
    marginTop: 4,
  },
  cancelBannerText: { color: '#B26A00', flex: 1 },
  cancelBox: {
    marginTop: 10,
    backgroundColor: '#FDECEA',
    borderRadius: 8,
    padding: 10,
  },
  cancelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelTitle: { color: '#C62828' },
  cancelReason: { marginTop: 4, fontStyle: 'italic', color: '#7A1F1A' },
  cancelReasonMuted: { marginTop: 4, opacity: 0.6 },
  cancelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
  cancelActionBtn: { minWidth: 96 },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  check: { marginRight: 10, marginTop: 2 },
  cardBody: { flex: 1 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chipText: { color: 'white', fontSize: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  locationIcon: { marginTop: 2, marginRight: 4 },
  locationText: { flex: 1, opacity: 0.8 },
  adhocBox: {
    marginTop: 8,
    backgroundColor: '#EAF2FE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  adhocHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  adhocTitle: { color: colors.primaryDark, fontWeight: 'bold' },
  adhocComment: { marginTop: 4, fontStyle: 'italic', color: colors.text },
  adhocMeta: { marginTop: 2, color: colors.muted },
  cabGroupCard: { marginBottom: 12 },
  cabGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cabGroupHeaderLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 10 },
  cabGroupIcon: { marginTop: 3 },
  cabGroupTitle: { fontWeight: 'bold' },
  cabGroupBody: {
    borderTopWidth: 1,
    borderTopColor: '#ECEFF1',
    marginTop: 4,
    paddingTop: 10,
  },
  employeesHeader: { marginTop: 8, marginBottom: 4, color: colors.primaryDark },
  cabEmployeeRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEFF1',
  },
  empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
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
    borderTopColor: '#E0E0E0',
  },
  assignBtn: { flex: 1, marginLeft: 10 },
  pickerHint: { color: colors.muted, marginTop: 8 },
});
