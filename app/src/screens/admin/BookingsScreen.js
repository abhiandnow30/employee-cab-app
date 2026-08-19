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
import { isBookingPast, isPastDateKey } from '../../utils/datetime';
import { SOURCE, STATUS } from '../../data/mockData';
import DeskCancelDialog from '../../components/DeskCancelDialog';
import { statusColors, colors, font, radius, shadow, spacing } from '../../theme';
import CalendarFilter, { rangeLabel } from '../../components/CalendarFilter';

const NO_ROUTE = 'No route set';

export default function BookingsScreen({ navigation }) {
  const {
    bookings, cabs, cabCapacity, getCabById, assignCabToGroup, approveCancel, rejectCancel,
    deskCancelRide, deskCancelState,
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
  // The booking the desk is standing down for a rider who asked off-app. Same dialog
  // the day board uses — see DeskCancelDialog.
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);

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
  // Assignable if it's still open and isn't awaiting a cancellation decision.
  //
  // "Its time has passed" is deliberately NOT a reason to refuse. That check used
  // to be here (and in AppContext, and in firestore.rules) and it closed the desk
  // out at 8:01 PM of an 8:00 PM pickup — the minute a missing cab becomes urgent.
  // The row is still marked overdue below so nobody mistakes a late assignment for
  // an on-time one.
  const canSelect = (b) => b.status === 'Booked' && !hasPendingCancel(b);
  const isNoShow = (b) => b.status === 'No show';
  // A ride whose slot has passed and that still has no cab. Assignment stays OPEN
  // on these — the chip is a "this one is late, deal with it first" flag, not a
  // closed door.
  const isOverdue = (b) => isPast(b) && b.status === 'Booked';

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
  // The cut-off for this screen is the DAY, not the minute. Earlier days are left
  // out — the desk acts on today and later here, and that data isn't deleted:
  // Ride History, No-Shows and Cancelled Rides still show it. But a ride whose
  // shift time passed an hour ago is still TODAY's work and stays on the board,
  // selectable, so a cab can still be sent (see canSelect). Filtering by the
  // minute instead was why an unassigned 8:00 PM ride vanished from the desk's
  // screen at 8:01 PM, leaving them nothing to assign a cab to.
  const unassigned = visibleBookings.filter((b) => !b.assignedCabId && !isPastDateKey(b.date));
  const assigned = visibleBookings.filter((b) => b.assignedCabId && !isPastDateKey(b.date));

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

  function openDeskCancel(booking) {
    setCancelFor(booking);
  }

  async function confirmDeskCancel() {
    if (!cancelFor) return;
    setCancelBusy(true);
    // No reason — see DeskCancelDialog's header.
    const res = await deskCancelRide(cancelFor);
    setCancelBusy(false);
    if (!res?.ok) {
      setError(res?.message || 'Could not cancel that ride.');
      return;
    }
    // Untick it if it was selected for grouping — a cancelled ride must never end up
    // in an assignment.
    setSelected((prev) => prev.filter((id) => id !== cancelFor.id));
    setCancelFor(null);
  }

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
        // Guard rejected (no seats left, or the cab is on another trip then).
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
        {/* `isPastSection` is never set any more — earlier days don't reach this
            screen at all, and today's overdue rides sit in their normal route
            section where they can still be selected and given a cab. */}
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

        {/* A ride the desk stood down. Says so plainly, with the reason, so this row
            cannot be mistaken for an approved employee request. */}
        {item.status === STATUS.CANCELLED && item.cancellationSource === 'desk' ? (
          <View style={styles.deskCancelledBox}>
            <MaterialCommunityIcons name="headset" size={16} color="#C62828" />
            <Text variant="bodySmall" style={styles.deskCancelledText}>
              Cancelled by Transport Desk
              {item.cancellationReason ? ` — ${item.cancellationReason}` : ''}
            </Text>
          </View>
        ) : null}

        {/* THE DESK CANCELS FOR A RIDER WHO ASKED OFF-APP. Offered only on an
            ACTIVE ride: a cancelled one would overwrite the record of who cancelled
            it first, and a completed or no-show trip has nothing left to stand down.
            A ride with a pending REQUEST is deliberately still cancellable — the
            approve button below is the tidier route, but if the rider then phones in
            an emergency the desk should not have to approve a request to act on it. */}
        {/* Gated on the DESK's own window — 30 minutes, against the rider's 4 hours.
            deskCancelState also covers the cancelled/completed/no-show cases, so the
            status tests this used to duplicate are gone. */}
        {deskCancelState(item).canCancel ? (
          <View style={styles.deskCancelRow}>
            <Button
              compact
              mode="text"
              icon="calendar-remove"
              textColor="#C62828"
              onPress={() => openDeskCancel(item)}
              disabled={cancelBusy}
            >
              Cancel ride
            </Button>
          </View>
        ) : null}

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
    const overdue = isOverdue(item); // time passed + still no cab (still assignable)

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
                {overdue ? (
                  <Chip
                    compact
                    icon="clock-alert-outline"
                    style={styles.overdueChip}
                    textStyle={styles.chipText}
                  >
                    Overdue
                  </Chip>
                ) : (
                  <Chip
                    compact
                    style={{ backgroundColor: statusColors[item.status] || colors.disabled }}
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
            style={{ backgroundColor: statusColors[item.status] || colors.disabled }}
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
      {/* Same dialog as the coordinator's day board — one place the desk's reason is
          captured, so the two screens can't drift apart on a field the employee reads. */}
      <DeskCancelDialog
        visible={!!cancelFor}
        ride={cancelFor}
        cab={cancelFor?.assignedCabId ? getCabById(cancelFor.assignedCabId) : null}
        busy={cancelBusy}
        onDismiss={() => setCancelFor(null)}
        onConfirm={confirmDeskCancel}
      />

      <Snackbar visible={!!error} onDismiss={() => setError('')} duration={4000}>
        {error}
      </Snackbar>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerCol: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  hint: { color: colors.muted, flex: 1, marginHorizontal: spacing.sm, lineHeight: 19 },
  hintHelpBtn: { marginLeft: spacing.xs },
  helpDialog: { maxWidth: 500, alignSelf: 'center', width: '100%' },
  helpItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  helpIcon: { marginTop: 2 },
  helpText: { flex: 1, lineHeight: 21, color: colors.textSecondary },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  listContent: { padding: spacing.lg, paddingBottom: 96 },
  // A date/cab heading: tinted band with a brand left rule, so the list reads
  // as groups rather than one continuous run of cards.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  sectionTitle: { color: colors.primaryDark, fontFamily: font.semibold },
  sectionCount: { color: colors.primaryDark, opacity: 0.75 },
  pastSectionHeader: { backgroundColor: colors.surfaceAlt, borderLeftColor: colors.disabled },
  pastSectionTitle: { color: colors.textSecondary },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primarySofter,
  },
  cardCancel: { borderColor: '#F3C2BD', backgroundColor: colors.dangerSoft },
  cardNoShow: { borderLeftWidth: 5, borderLeftColor: colors.danger },
  // Was `opacity: 0.6`. A dimmed card reads as disabled, and these rows are now
  // the most actionable ones on the screen — an amber edge flags them instead.
  cardPast: { borderLeftWidth: 5, borderLeftColor: colors.warning },
  // Amber, not grey: an overdue ride is a live piece of work, not a closed one.
  overdueChip: { backgroundColor: colors.warning },
  noShowBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  noShowBannerText: { color: colors.danger, flex: 1, fontFamily: font.semibold },
  noShowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  noShowText: { color: colors.danger, fontFamily: font.semibold },
  cancelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  cancelBannerText: { color: colors.warning, flex: 1 },
  cancelBox: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  cancelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancelTitle: { color: colors.danger, fontFamily: font.semibold },
  deskCancelRow: { alignSelf: 'flex-start', marginTop: spacing.xs, marginLeft: -8 },
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
  deskCancelledText: { color: '#7A1810', flex: 1, lineHeight: 18 },
  cancelReason: { marginTop: spacing.xs, fontStyle: 'italic', color: '#7A1810' },
  cancelReasonMuted: { marginTop: spacing.xs, color: colors.muted },
  cancelActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cancelActionBtn: { minWidth: 104, borderRadius: radius.md },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  check: { marginRight: spacing.md, marginTop: 2 },
  cardBody: { flex: 1, minWidth: 0 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: font.semibold },
  detail: { color: colors.textSecondary, marginTop: 2 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.xs,
  },
  locationIcon: { marginTop: 2, marginRight: spacing.xs },
  locationText: { flex: 1, color: colors.textSecondary, lineHeight: 20 },
  adhocBox: {
    marginTop: spacing.md,
    backgroundColor: colors.primarySofter,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  adhocHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  adhocTitle: { color: colors.primaryDark, fontFamily: font.semibold },
  adhocComment: { marginTop: spacing.xs, fontStyle: 'italic', color: colors.text },
  adhocMeta: { marginTop: 2, color: colors.muted },
  cabGroupCard: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cabGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cabGroupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    minWidth: 0,
    gap: spacing.md,
  },
  cabGroupIcon: { marginTop: 3 },
  cabGroupTitle: { fontFamily: font.semibold, color: colors.text },
  cabGroupBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  employeesHeader: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  cabEmployeeRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  empty: { textAlign: 'center', marginTop: 48, color: colors.muted },
  // Floats over the list, so it needs to read as a bar in front of the page and
  // not as the last row of it.
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadow.lg,
  },
  assignBtn: { flex: 1, marginLeft: spacing.md, borderRadius: radius.md },
  pickerHint: { color: colors.muted, marginTop: spacing.sm },
});
