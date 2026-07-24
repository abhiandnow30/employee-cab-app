// ---------------------------------------------------------------------------
// BOOKINGS SCREEN  (admin home)
// The transport desk sees ALL employee bookings, GROUPED BY ROUTE (the cab
// location from each employee's shift roster) so people who ride together are
// listed together. To arrange a carpool, tick several employees on the same
// route — or "Select all" for a route — and assign them ONE shared cab.
// Each card shows the employee's route + pickup address so the desk can see
// where everyone is before grouping. Cancelled bookings can't be selected.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, SectionList, Pressable } from 'react-native';
import { Text, Card, Chip, Button, Portal, Dialog, RadioButton, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeEmployees } from '../../services/profile';
import { isBookingPast } from '../../utils/datetime';
import { statusColors, colors } from '../../theme';
import CalendarFilter, { rangeLabel } from '../../components/CalendarFilter';

const NO_ROUTE = 'No route set';
const PAST_SECTION = 'Past rides · assignment closed';

export default function BookingsScreen({ navigation }) {
  const { bookings, cabs, getCabById, assignCabToGroup, approveCancel, rejectCancel } = useApp();

  const [selected, setSelected] = useState([]); // booking ids ticked for grouping
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenCab, setChosenCab] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(null); // booking id being approved/rejected
  const [empByUid, setEmpByUid] = useState({}); // uid → employee profile (for route/address)
  const [error, setError] = useState(''); // assignment guard / failure message
  const [dateRange, setDateRange] = useState(null); // { start, end } (YYYY-MM-DD) or null = all dates

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

  // --- Split upcoming (assignable) from past (read-only) -------------------
  // Only today's and future rides can be assigned; anything whose scheduled
  // time has passed drops into a separate, read-only "Past rides" section.
  const upcoming = visibleBookings.filter((b) => !isPast(b));
  const past = visibleBookings.filter(isPast);

  // Group the UPCOMING bookings by route so carpool candidates sit together.
  const groups = {};
  upcoming.forEach((b) => {
    const route = routeOf(b);
    (groups[route] = groups[route] || []).push(b);
  });
  const upcomingSections = Object.keys(groups)
    .map((route) => {
      const data = [...groups[route]].sort(
        (a, b) => (isNoShow(a) ? 0 : 1) - (isNoShow(b) ? 0 : 1) // no-shows first
      );
      return { route, data, hasNoShow: data.some(isNoShow) };
    })
    // Routes with a no-show first; then real routes A→Z; "No route set" last.
    .sort((a, b) => {
      if (a.hasNoShow !== b.hasNoShow) return a.hasNoShow ? -1 : 1;
      if (a.route === NO_ROUTE) return 1;
      if (b.route === NO_ROUTE) return -1;
      return a.route.localeCompare(b.route);
    });

  // Past rides go last, most-recent first, in one read-only section.
  const pastSection =
    past.length > 0
      ? [
          {
            route: PAST_SECTION,
            isPastSection: true,
            hasNoShow: false,
            data: [...past].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
          },
        ]
      : [];

  const sections = [...upcomingSections, ...pastSection];

  async function resolve(bookingId, approve) {
    setResolving(bookingId);
    try {
      await (approve ? approveCancel(bookingId) : rejectCancel(bookingId));
    } finally {
      setResolving(null);
    }
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

  function renderSectionHeader({ section }) {
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

  function renderBooking({ item }) {
    const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;
    const selectable = canSelect(item);
    const ticked = isSelected(item.id);
    const pendingCancel = hasPendingCancel(item);
    const busy = resolving === item.id;
    const address = addressOf(item);
    const past = isPast(item);
    const expired = isExpired(item); // past + never assigned

    return (
      <Pressable onPress={() => selectable && toggle(item.id)}>
        <Card
          style={[
            styles.card,
            ticked && styles.cardSelected,
            pendingCancel && styles.cardCancel,
            isNoShow(item) && styles.cardNoShow,
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
              <Text variant="bodyMedium" style={styles.detail}>
                {item.direction}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
                {item.date} · {item.shift}
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
              {cab && (
                <Text variant="bodyMedium" style={styles.assigned}>
                  → {cab.cabNumber} · {cab.driverName}
                </Text>
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
            </View>
          </Card.Content>
        </Card>
      </Pressable>
    );
  }

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

      <Text variant="bodySmall" style={styles.hint}>
        Employees are grouped by route. Tick people on the same route (or “Select
        all”) and assign them a shared cab.
      </Text>

      {/* Date filter — pick a day, a range, or a whole month. */}
      <View style={styles.filterRow}>
        <CalendarFilter value={dateRange} onChange={setDateRange} />
        {dateRange ? (
          <Button compact mode="text" onPress={() => setDateRange(null)}>
            Clear
          </Button>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderBooking}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {dateRange ? `No bookings for ${rangeLabel(dateRange)}.` : 'No bookings yet.'}
          </Text>
        }
      />

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
                <RadioButton.Item
                  key={c.id}
                  label={`${c.cabNumber} · ${c.driverName}`}
                  value={c.id}
                />
              ))}
            </RadioButton.Group>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)}>Cancel</Button>
            <Button onPress={confirmAssign} disabled={!chosenCab || saving} loading={saving}>
              Assign
            </Button>
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
  hint: { opacity: 0.7, marginHorizontal: 14, marginBottom: 4 },
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
  assigned: { marginTop: 8, fontWeight: 'bold', color: '#2E7D32' },
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
});
