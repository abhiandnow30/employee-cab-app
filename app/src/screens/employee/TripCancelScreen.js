// ---------------------------------------------------------------------------
// TRIP CANCELLATION  (employee) — redesigned
// A clean, status-driven view of the employee's rides. Each ride shows, at a
// glance: which ride is next, whether it can still be cancelled, how long the
// cancellation window stays open, and what action to take.
//
// Cancelling is a REQUEST (not instant): allowed up to CANCEL_CUTOFF_HOURS
// before pickup, then it goes to the transport desk to approve/reject. The ride
// stays active until they approve.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList, Pressable } from 'react-native';
import {
  Text, Card, Chip, Button, Portal, Dialog, Menu, TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import CalendarFilter from '../../components/CalendarFilter';
import { CANCEL_STATUS, CANCEL_CUTOFF_HOURS } from '../../data/mockData';
import { canRequestCancel, hoursUntil, isBookingPast, todayKey } from '../../utils/datetime';

// --- Palette (per the redesign spec) ---------------------------------------
const PAL = {
  primary: '#1565C0',
  success: '#2E7D32',
  warning: '#F9A825',
  error: '#D32F2F',
  bg: '#F5F7FA',
  card: '#FFFFFF',
  gray: '#607D8B',
  text: '#1A2233',
  muted: '#667085',
};

// --- Cancellation states (one primary state per ride, drives badge + sort) --
const STATE_META = {
  AVAILABLE: { label: 'Cancel available', color: PAL.success, bg: '#E7F4E8', icon: 'check-circle', rank: 1 },
  PENDING: { label: 'Pending approval', color: PAL.primary, bg: '#E3ECFB', icon: 'progress-clock', rank: 2 },
  CLOSED: { label: 'Cancellation closed', color: PAL.error, bg: '#FDECEC', icon: 'lock-clock', rank: 3 },
  COMPLETED: { label: 'Completed', color: PAL.gray, bg: '#ECEFF1', icon: 'flag-checkered', rank: 4 },
  CANCELLED: { label: 'Cancelled', color: PAL.error, bg: '#FFFFFF', icon: 'close-circle-outline', rank: 5, outline: true },
};

const REASONS = ['Personal', 'Work From Home', 'Leave', 'Emergency', 'Other'];

const keyToDate = (k) => {
  const [y, m, d] = String(k).split('-').map((n) => parseInt(n, 10));
  return new Date(y || 1970, (m || 1) - 1, d || 1);
};

// Decide a ride's single cancellation state.
function deriveState(b) {
  if (b.status === 'Cancelled') return 'CANCELLED';
  if (b.status === 'Completed' || b.status === 'No show') return 'COMPLETED';
  if (b.cancelStatus === CANCEL_STATUS.REQUESTED) return 'PENDING';
  if (isBookingPast(b)) return 'CLOSED'; // past but never completed → window gone
  return canRequestCancel(b.date, b.shift, CANCEL_CUTOFF_HOURS) ? 'AVAILABLE' : 'CLOSED';
}

// Hours left to cancel (window closes CANCEL_CUTOFF_HOURS before pickup).
function cancelRemainingHours(b) {
  const h = hoursUntil(b.date, b.shift);
  if (h == null) return null;
  return h - CANCEL_CUTOFF_HOURS;
}

// "6h 20m" / "45m" / "2 days" from a float number of hours.
function fmtDur(hoursFloat) {
  const totalMin = Math.max(0, Math.round(hoursFloat * 60));
  if (totalMin >= 1440) {
    const d = Math.round(totalMin / 1440);
    return `${d} day${d > 1 ? 's' : ''}`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// "Today • 9:00 AM" / "Tomorrow • 6:30 PM" / "In 3 days • …".
function relWhen(dateKey, shift) {
  const diff = Math.round((keyToDate(dateKey) - keyToDate(todayKey())) / 86400000);
  let day;
  if (diff === 0) day = 'Today';
  else if (diff === 1) day = 'Tomorrow';
  else if (diff === -1) day = 'Yesterday';
  else if (diff > 1) day = `In ${diff} days`;
  else day = `${Math.abs(diff)} days ago`;
  return shift ? `${day} • ${shift}` : day;
}

// A compact filter dropdown rendered as a chip that opens a Menu.
function DropdownChip({ icon, label, value, options, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <Pressable style={styles.filterChip} onPress={() => setOpen(true)}>
          <MaterialCommunityIcons name={icon} size={16} color={PAL.primary} />
          <Text style={styles.filterChipText} numberOfLines={1}>{label}</Text>
          <MaterialCommunityIcons name="chevron-down" size={16} color={PAL.primary} />
        </Pressable>
      }
    >
      {options.map((o) => (
        <Menu.Item
          key={o.value}
          title={o.label}
          onPress={() => {
            onSelect(o.value);
            setOpen(false);
          }}
          leadingIcon={value === o.value ? 'check' : undefined}
        />
      ))}
    </Menu>
  );
}

// One field row inside a card (icon + text).
function InfoRow({ icon, children }) {
  if (!children) return null;
  return (
    <View style={styles.infoRow}>
      <MaterialCommunityIcons name={icon} size={16} color={PAL.muted} style={styles.infoIcon} />
      <Text variant="bodyMedium" style={styles.infoText}>{children}</Text>
    </View>
  );
}

function TripCard({ item, onCancel, onContact, getCabById }) {
  const meta = STATE_META[item._state];
  const [origin, dest] = String(item.direction || '').split('→').map((s) => s.trim());
  const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;
  const showReason = item.cancelReason && (item._state === 'PENDING' || item._state === 'CANCELLED');

  // Countdown chip.
  let countdown = null;
  if (item._state === 'AVAILABLE') {
    countdown = { color: PAL.success, bg: '#E7F4E8', icon: 'timer-outline', text: `You can cancel for another ${fmtDur(item._remaining)}` };
  } else if (item._state === 'CLOSED') {
    countdown = { color: PAL.error, bg: '#FDECEC', icon: 'timer-off-outline', text: 'Cancellation window closed' };
  } else if (item._state === 'PENDING') {
    countdown = { color: PAL.primary, bg: '#E3ECFB', icon: 'progress-clock', text: 'Waiting for admin approval' };
  }

  return (
    <Card style={[styles.card, meta.outline && styles.cardCancelled]} mode="elevated">
      <Card.Content style={styles.cardContent}>
        {/* Header: route on the left, primary action on the top-right */}
        <View style={styles.cardHeader}>
          <Text variant="titleMedium" style={styles.route}>
            {origin || 'Ride'} <Text style={styles.arrow}>→</Text> {dest || ''}
          </Text>
          {item._state === 'AVAILABLE' && (
            <Button
              compact
              mode="contained"
              icon="close-circle"
              buttonColor={PAL.error}
              style={styles.headerBtn}
              onPress={() => onCancel(item)}
            >
              Cancel Ride
            </Button>
          )}
          {item._state === 'CLOSED' && (
            <Button
              compact
              mode="contained"
              icon="phone"
              buttonColor={PAL.primary}
              style={styles.headerBtn}
              onPress={onContact}
            >
              Contact desk
            </Button>
          )}
          {item._state === 'PENDING' && (
            <Button
              compact
              mode="contained"
              icon="progress-clock"
              buttonColor={PAL.warning}
              textColor="#3A2E00"
              style={styles.headerBtn}
              disabled
            >
              Pending
            </Button>
          )}
        </View>
        {/* Status + when on one compact row */}
        <View style={styles.metaRow}>
          <Chip
            compact
            icon={meta.icon}
            style={[styles.statusChip, { backgroundColor: meta.bg }, meta.outline && styles.statusChipOutline]}
            textStyle={{ color: meta.color, fontWeight: 'bold' }}
          >
            {meta.label}
          </Chip>
          <Text variant="bodyMedium" style={styles.when}>{relWhen(item.date, item.shift)}</Text>
        </View>

        {/* Trip info (compact) */}
        <InfoRow icon="map-marker">{item.pickup ? `Pickup: ${item.pickup}` : null}</InfoRow>
        <InfoRow icon="flag-checkered">{dest ? `Destination: ${dest}` : null}</InfoRow>
        {cab ? <InfoRow icon="car">{`Cab ${cab.cabNumber || cab.id}`}</InfoRow> : null}
        {cab?.driverName ? <InfoRow icon="account">{cab.driverName}</InfoRow> : null}
        {showReason ? <InfoRow icon="comment-text-outline">{`Reason: ${item.cancelReason}`}</InfoRow> : null}

        {/* Countdown */}
        {countdown ? (
          <View style={[styles.countdown, { backgroundColor: countdown.bg }]}>
            <MaterialCommunityIcons name={countdown.icon} size={16} color={countdown.color} />
            <Text variant="bodyMedium" style={[styles.countdownText, { color: countdown.color }]}>
              {countdown.text}
            </Text>
          </View>
        ) : null}

      </Card.Content>
    </Card>
  );
}

export default function TripCancelScreen({ navigation }) {
  const { myBookings, requestCancel, getCabById } = useApp();

  // Filters
  const [dateRange, setDateRange] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all'); // all | AVAILABLE | PENDING | CLOSED | COMPLETED | CANCELLED
  const [showDone, setShowDone] = useState(false); // completed/cancelled collapsed by default

  // Cancel dialog
  const [toCancel, setToCancel] = useState(null);
  const [reason, setReason] = useState('Personal');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [customReason, setCustomReason] = useState('');
  const [busy, setBusy] = useState(false);

  const anyFilter = !!dateRange || statusFilter !== 'all';

  const rides = useMemo(() => {
    return myBookings()
      .map((b) => ({ ...b, _state: deriveState(b), _remaining: cancelRemainingHours(b) }))
      .filter((b) => {
        if (dateRange && !(b.date >= dateRange.start && b.date <= dateRange.end)) return false;
        if (statusFilter !== 'all' && b._state !== statusFilter) return false;
        return true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myBookings, dateRange, statusFilter]);

  const isDone = (b) => b._state === 'COMPLETED' || b._state === 'CANCELLED';

  // Active rides (actionable), sorted by state rank then soonest pickup.
  const active = rides
    .filter((b) => !isDone(b))
    .sort((a, b) => {
      const r = STATE_META[a._state].rank - STATE_META[b._state].rank;
      if (r !== 0) return r;
      return String(a.date).localeCompare(String(b.date));
    });

  // Done rides (completed/cancelled), most recent first, collapsed by default.
  const done = rides
    .filter(isDone)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  function openCancel(b) {
    setReason('Personal');
    setCustomReason('');
    setToCancel(b);
  }

  async function confirmCancel() {
    if (!toCancel) return;
    const finalReason = reason === 'Other' ? customReason.trim() : reason;
    setBusy(true);
    try {
      await requestCancel(toCancel.id, finalReason);
      setToCancel(null);
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setDateRange(null);
    setStatusFilter('all');
  }

  const header = (
    <View>
      <Text variant="headlineSmall" style={styles.title}>Trip Cancellation</Text>

      {/* Info banner */}
      <View style={styles.banner}>
        <MaterialCommunityIcons name="information" size={20} color={PAL.primary} />
        <Text variant="bodySmall" style={styles.bannerText}>
          Needs admin approval — cancel request at least {CANCEL_CUTOFF_HOURS} hours before pickup.
        </Text>
      </View>

      {/* Filter bar */}
      <View style={styles.filterBar}>
        <CalendarFilter value={dateRange} onChange={setDateRange} />
        <DropdownChip
          icon="filter-variant"
          label={statusFilter === 'all' ? 'All statuses' : STATE_META[statusFilter].label}
          value={statusFilter}
          onSelect={setStatusFilter}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'AVAILABLE', label: 'Cancel available' },
            { value: 'PENDING', label: 'Pending approval' },
            { value: 'CLOSED', label: 'Cancellation closed' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
        {anyFilter ? (
          <Button compact mode="text" icon="filter-remove" onPress={clearFilters}>
            Clear Filters
          </Button>
        ) : null}
      </View>
    </View>
  );

  const footer =
    done.length > 0 ? (
      <View style={styles.doneSection}>
        <Pressable style={styles.doneHeader} onPress={() => setShowDone((s) => !s)}>
          <MaterialCommunityIcons name="history" size={18} color={PAL.muted} />
          <Text variant="titleSmall" style={styles.doneTitle}>
            Completed & cancelled ({done.length})
          </Text>
          <MaterialCommunityIcons
            name={showDone ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={PAL.muted}
          />
        </Pressable>
        {showDone
          ? done.map((b) => (
              <TripCard
                key={b.id}
                item={b}
                getCabById={getCabById}
                onCancel={openCancel}
                onContact={() => navigation.navigate('ContactUs')}
              />
            ))
          : null}
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <FlatList
          data={active}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          renderItem={({ item }) => (
            <TripCard
              item={item}
              getCabById={getCabById}
              onCancel={openCancel}
              onContact={() => navigation.navigate('ContactUs')}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="car-off" size={64} color="#C3CCDA" />
              <Text variant="titleMedium" style={styles.emptyTitle}>
                {anyFilter ? 'No rides match these filters.' : 'No upcoming rides available.'}
              </Text>
              {anyFilter ? (
                <Button mode="outlined" icon="filter-remove" onPress={clearFilters} style={styles.emptyBtn}>
                  Clear Filters
                </Button>
              ) : (
                <Button mode="contained" icon="plus" onPress={() => navigation.navigate('BookCab')} style={styles.emptyBtn}>
                  Book a Ride
                </Button>
              )}
            </View>
          }
        />
      </View>

      {/* Confirmation dialog */}
      <Portal>
        <Dialog visible={!!toCancel} onDismiss={() => !busy && setToCancel(null)} style={styles.dialog}>
          <Dialog.Title>Cancel Ride?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogText}>
              Are you sure you want to cancel this booking?
              {toCancel ? `\n${toCancel.direction} · ${relWhen(toCancel.date, toCancel.shift)}` : ''}
            </Text>
            <Menu
              visible={reasonOpen}
              onDismiss={() => setReasonOpen(false)}
              anchor={
                <Pressable style={styles.reasonField} onPress={() => setReasonOpen(true)}>
                  <Text style={styles.reasonValue}>{reason}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color={PAL.muted} />
                </Pressable>
              }
            >
              {REASONS.map((r) => (
                <Menu.Item
                  key={r}
                  title={r}
                  onPress={() => {
                    setReason(r);
                    setReasonOpen(false);
                  }}
                  leadingIcon={reason === r ? 'check' : undefined}
                />
              ))}
            </Menu>
            {reason === 'Other' ? (
              <TextInput
                label="Please specify"
                value={customReason}
                onChangeText={setCustomReason}
                mode="outlined"
                style={styles.customReason}
              />
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setToCancel(null)} disabled={busy}>Cancel</Button>
            <Button
              mode="contained"
              buttonColor={PAL.error}
              onPress={confirmCancel}
              loading={busy}
              disabled={busy || (reason === 'Other' && !customReason.trim())}
            >
              Confirm Cancellation
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAL.bg },
  centerCol: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  list: { padding: 16, paddingBottom: 32 },
  title: { fontWeight: 'bold', color: PAL.text, marginBottom: 12 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#E3ECFB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  bannerText: { color: '#0D47A1', flex: 1, lineHeight: 18 },
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF3F9',
    borderWidth: 1,
    borderColor: '#D6E0EE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipText: { color: PAL.primary, fontWeight: '600', maxWidth: 130 },

  card: { marginTop: 12, borderRadius: 16, backgroundColor: PAL.card },
  cardContent: { paddingVertical: 12 },
  cardCancelled: { borderWidth: 1, borderColor: '#F2C1C1' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  route: { fontWeight: 'bold', color: PAL.text, flex: 1 },
  headerBtn: { borderRadius: 8 },
  arrow: { color: PAL.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8, marginBottom: 8 },
  statusChip: { borderRadius: 8 },
  statusChipOutline: { borderWidth: 1, borderColor: '#F2C1C1' },
  when: { color: PAL.muted, fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  infoIcon: { marginRight: 8 },
  infoText: { flex: 1, color: PAL.text },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  countdownText: { flex: 1, fontWeight: '600' },

  doneSection: { marginTop: 20 },
  doneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECEFF1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  doneTitle: { flex: 1, color: PAL.muted, fontWeight: 'bold' },

  empty: { alignItems: 'center', paddingVertical: 56 },
  emptyTitle: { color: PAL.muted, marginTop: 14, textAlign: 'center' },
  emptyBtn: { marginTop: 16 },

  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center', borderRadius: 16 },
  dialogText: { marginBottom: 14, lineHeight: 20 },
  reasonField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#C7CBD1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  reasonValue: { color: PAL.text, fontSize: 15 },
  customReason: { marginTop: 10 },
});
