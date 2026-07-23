// ---------------------------------------------------------------------------
// SELF ROSTER SCREEN
// Book cabs for a whole week at once.
//   • Top bar: ◀ previous week | FROM ... TO ... | next week ▶
//   • Table: 7 rows (Mon–Sun), columns = Date | Pickup | Drop
//     Pickup / Drop are dropdowns of shift times ("—" = no ride that leg).
//   • "Save roster" turns every chosen time into a booking (status "Booked").
// ---------------------------------------------------------------------------

import React, { useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import { Text, IconButton, Button, HelperText, Surface, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Dropdown from '../../components/Dropdown';
import { useApp } from '../../context/AppContext';
import { colors } from '../../theme';
import { NONE, WEEKDAYS, SOURCE, BOOKING_LEAD_HOURS } from '../../data/mockData';
import {
  isPastDateKey, isPastDateTime, canBook, bookableTimesForDate, todayKey, timeToMinutes,
} from '../../utils/datetime';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Group a time string into a time-of-day bucket for the dropdown sections.
const TIME_GROUP_ORDER = ['Morning', 'Afternoon', 'Evening', 'Night'];
function timeBucket(t) {
  const m = timeToMinutes(t);
  if (m == null) return null; // "No ride" / non-time stays ungrouped (top)
  if (m >= 300 && m < 720) return 'Morning'; // 5:00 AM – 11:59 AM
  if (m >= 720 && m < 1020) return 'Afternoon'; // 12:00 PM – 4:59 PM
  if (m >= 1020 && m < 1260) return 'Evening'; // 5:00 PM – 8:59 PM
  return 'Night'; // 9:00 PM – 4:59 AM
}

// Monday of the week that contains date `d`.
function startOfWeek(d) {
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(date, n) {
  const copy = new Date(date);
  copy.setDate(date.getDate() + n);
  return copy;
}

// "2026-07-13"  — stable key + what a booking stores.
function toKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${dd}`;
}

// "13-Jul"  — shown to the user.
function toDisplay(date) {
  return `${String(date.getDate()).padStart(2, '0')}-${MONTHS[date.getMonth()]}`;
}

const DIRECTION = { pickup: 'Home → Office', drop: 'Office → Home' };
const PICKUP_LOC = { pickup: 'Home', drop: 'Office' };

export default function SelfRosterScreen({ navigation }) {
  const { addBookings, cancelBooking, myBookings, currentUser, pickupTimes, dropTimes } = useApp();

  // The dropdown options: "NA" (no ride this leg) + the admin-configured times.
  const pickupOptions = useMemo(() => [NONE, ...pickupTimes], [pickupTimes]);
  const dropOptions = useMemo(() => [NONE, ...dropTimes], [dropTimes]);

  // The days this employee is rostered to work (admin-assigned). If they have
  // no roster yet, fall back to all 7 days so they aren't blocked. Only these
  // days can be booked — Sat/Sun are bookable only for weekend workers.
  const roster = currentUser?.roster || {};
  const workingDays = roster.workingDays || WEEKDAYS;

  // Which week we're viewing. 0 = this week, -1 = last week, +1 = next week.
  const [weekOffset, setWeekOffset] = useState(0);
  // User edits only. A cell not in here falls back to what's already booked.
  const [selections, setSelections] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [snack, setSnack] = useState('');

  // Have any edits been made? Drives the Raise Request button's enabled state.
  const dirty = Object.keys(selections).length > 0;
  const TODAY = todayKey();

  // The employee's active roster bookings, keyed by "date|direction".
  const rosterByKey = {};
  myBookings().forEach((b) => {
    if (b.source === SOURCE.ROSTER && b.status !== 'Cancelled') {
      rosterByKey[`${b.date}|${b.direction}`] = b;
    }
  });

  // Existing booking for a given day + leg (pickup/drop), or null.
  function existingFor(dateKey, leg) {
    return rosterByKey[`${dateKey}|${DIRECTION[leg]}`] || null;
  }

  // What the dropdown should show: the user's edit if any, else the already
  // booked time, else NA.
  function cellValue(dateKey, leg) {
    const edited = selections[dateKey]?.[leg];
    if (edited !== undefined) return edited;
    const ex = existingFor(dateKey, leg);
    return ex ? ex.shift : NONE;
  }

  // The 7 days of the currently viewed week.
  const days = useMemo(() => {
    const base = startOfWeek(addDays(new Date(), weekOffset * 7));
    return WEEKDAYS.map((label, i) => {
      const date = addDays(base, i);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      return {
        label,
        date,
        key: toKey(date),
        display: toDisplay(date),
        isWeekend: dow === 0 || dow === 6,
        isWorkDay: workingDays.includes(label), // rostered to work this day
      };
    });
  }, [weekOffset, workingDays]);

  const rangeFrom = days[0].display;
  const rangeTo = days[6].display;

  function setLeg(key, leg, value) {
    setSelections((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [leg]: value },
    }));
  }

  async function handleSave() {
    setError('');

    // One-way service: an employee may book EITHER a Pickup or a Drop on a given
    // day, not both. Block the save and point at the offending day(s).
    const bothLegs = days.filter(
      (d) =>
        d.isWorkDay &&
        cellValue(d.key, 'pickup') !== NONE &&
        cellValue(d.key, 'drop') !== NONE
    );
    if (bothLegs.length) {
      const which = bothLegs.map((d) => `${d.label} ${d.display}`).join(', ');
      setError(
        `One-way cab service: choose either a Pickup or a Drop per day, not both. Please clear one on ${which}.`
      );
      return;
    }

    const toCreate = [];
    const toCancel = [];

    days.forEach((d) => {
      if (!d.isWorkDay) return; // not rostered to work this day → no booking
      ['pickup', 'drop'].forEach((leg) => {
        const value = cellValue(d.key, leg); // NA or a time
        const ex = existingFor(d.key, leg);

        if (value !== NONE) {
          // Never create a booking in the past, or inside the booking lead time
          // (rides must be booked at least BOOKING_LEAD_HOURS ahead). If this
          // would only replace an unchanged existing booking, the check below
          // (ex.shift === value) makes it a no-op anyway.
          if (isPastDateTime(d.key, value)) return;
          if (!ex && !canBook(d.key, value, BOOKING_LEAD_HOURS)) {
            setError(
              `Rides must be booked at least ${BOOKING_LEAD_HOURS} hours in advance — some times were skipped.`
            );
            return;
          }
          // A time is chosen: create if new, or replace if the time changed.
          if (!ex) {
            toCreate.push({ source: SOURCE.ROSTER, date: d.key, shift: value, direction: DIRECTION[leg], pickup: PICKUP_LOC[leg] });
          } else if (ex.shift !== value) {
            toCancel.push(ex.id);
            toCreate.push({ source: SOURCE.ROSTER, date: d.key, shift: value, direction: DIRECTION[leg], pickup: PICKUP_LOC[leg] });
          }
        } else if (ex) {
          // Set back to NA: cancel the existing booking.
          toCancel.push(ex.id);
        }
      });
    });

    if (toCreate.length === 0 && toCancel.length === 0) {
      setError('No changes to save. Pick or change a Pickup/Drop time.');
      return;
    }

    setSaving(true);
    // Fire the writes. Firestore queues them locally and syncs when online, so
    // don't let a slow/offline backend hang the button — cap the wait. On
    // timeout the request is queued and will sync once the connection is back.
    const writes = (async () => {
      await Promise.all(toCancel.map((id) => cancelBooking(id)));
      if (toCreate.length) await addBookings(toCreate);
      return { done: true };
    })();
    const timed = new Promise((resolve) => setTimeout(() => resolve({ pending: true }), 8000));
    try {
      const res = await Promise.race([writes, timed]);
      setSelections({});
      setSnack(res.pending ? 'Request queued — will sync when you’re back online.' : 'Request raised ✓');
      setTimeout(() => navigation.navigate('EmployeeHome'), 900);
    } catch (e) {
      setError(e.message || 'Could not raise the request. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Surface style={styles.card} elevation={2}>
          {/* Header */}
          <View style={styles.headerBlock}>
            <Text variant="headlineSmall" style={styles.heading}>
              Weekly Schedule
            </Text>
            <Text variant="bodySmall" style={styles.subheading}>
              Plan your cab rides for the week
            </Text>
          </View>

          {/* Week navigator with a date-range pill */}
          <View style={styles.weekBar}>
            <IconButton
              icon="chevron-left"
              mode="contained-tonal"
              size={26}
              onPress={() => setWeekOffset((w) => w - 1)}
              accessibilityLabel="Previous week"
            />
            <View style={styles.rangePill}>
              <MaterialCommunityIcons name="calendar-range" size={18} color={colors.primary} />
              <Text style={styles.rangeText}>
                {rangeFrom} – {rangeTo}
              </Text>
            </View>
            <IconButton
              icon="chevron-right"
              mode="contained-tonal"
              size={26}
              onPress={() => setWeekOffset((w) => w + 1)}
              accessibilityLabel="Next week"
            />
          </View>

          {/* Collapsible one-way info banner */}
          <Pressable
            onPress={() => setBannerCollapsed((c) => !c)}
            style={styles.infoBanner}
            accessibilityRole="button"
            accessibilityLabel="One-way service information. Tap to collapse."
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={18}
              color={colors.primary}
              style={styles.infoIcon}
            />
            <Text variant="bodySmall" style={styles.infoText}>
              {bannerCollapsed
                ? 'Select either Pickup or Drop for each day.'
                : 'Select either Pickup or Drop for each day. Both cannot be selected.'}
            </Text>
            <MaterialCommunityIcons
              name={bannerCollapsed ? 'chevron-down' : 'chevron-up'}
              size={18}
              color={colors.primary}
            />
          </Pressable>

          {roster.shift || roster.route ? (
            <View style={styles.rosterBanner}>
              <Text variant="bodySmall" style={styles.rosterBannerText}>
                {[roster.route, roster.shift].filter(Boolean).join(' · ')}
              </Text>
              <Text variant="bodySmall" style={styles.rosterBannerSub}>
                Working days: {workingDays.join(', ')}
              </Text>
            </View>
          ) : null}

          {/* Column header */}
          <View style={styles.colHead}>
            <View style={styles.colDate}>
              <View style={styles.colHeadTitle}>
                <MaterialCommunityIcons name="calendar-blank-outline" size={13} color={colors.muted} />
                <Text style={styles.colHeadText}>Date</Text>
              </View>
            </View>
            <View style={styles.colLeg}>
              <View style={styles.colHeadTitle}>
                <MaterialCommunityIcons name="home-export-outline" size={13} color={colors.muted} />
                <Text style={styles.colHeadText}>Pickup</Text>
              </View>
              <Text style={styles.colHeadSub}>Home → Office</Text>
            </View>
            <View style={styles.colLeg}>
              <View style={styles.colHeadTitle}>
                <MaterialCommunityIcons name="home-import-outline" size={13} color={colors.muted} />
                <Text style={styles.colHeadText}>Drop</Text>
              </View>
              <Text style={styles.colHeadSub}>Office → Home</Text>
            </View>
          </View>

          {/* Day rows */}
          {days.map((d) => {
            const past = isPastDateKey(d.key); // whole day already gone
            const off = !d.isWorkDay; // not rostered to work this day
            const isToday = d.key === TODAY;
            const pickupVal = cellValue(d.key, 'pickup');
            const dropVal = cellValue(d.key, 'drop');
            const hasPickup = pickupVal !== NONE;
            const hasDrop = dropVal !== NONE;
            const valid = hasPickup !== hasDrop; // exactly one leg chosen
            return (
              <Pressable
                key={d.key}
                style={({ hovered }) => [
                  styles.dayCard,
                  d.isWeekend && styles.weekendCard,
                  isToday && styles.todayCard,
                  off && styles.offCard,
                  past && styles.pastCard,
                  hovered && !off && !past && styles.dayCardHover,
                ]}
              >
                <View style={styles.colDate}>
                  <View style={styles.dateTop}>
                    <Text variant="titleSmall" style={[styles.dayLabel, (past || off) && styles.pastText]}>
                      {d.label}
                    </Text>
                    {isToday ? (
                      <View style={styles.todayPill}>
                        <Text style={styles.todayPillText}>Today</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="bodySmall" style={[styles.dateSub, (past || off) && styles.pastText]}>
                    {d.display}
                  </Text>
                  {d.isWeekend && !off ? <Text style={styles.weekendTag}>Weekend</Text> : null}
                  {!off && valid ? (
                    <View style={styles.validRow}>
                      <MaterialCommunityIcons name="check-circle" size={13} color={colors.success} />
                      <Text style={styles.validText}>{hasPickup ? 'Pickup' : 'Drop'} set</Text>
                    </View>
                  ) : null}
                </View>
                {off ? (
                  <View style={styles.offCell}>
                    <MaterialCommunityIcons name="calendar-remove-outline" size={16} color={colors.muted} />
                    <Text variant="bodySmall" style={styles.offText}>
                      Not a working day
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.colLeg}>
                      <Dropdown
                        value={hasPickup ? pickupVal : null}
                        options={bookableTimesForDate(d.key, pickupOptions, BOOKING_LEAD_HOURS)}
                        onSelect={(v) => setLeg(d.key, 'pickup', v)}
                        disabled={past || (hasDrop && !hasPickup)}
                        leadingIcon="clock-outline"
                        placeholder="Select time"
                        format={(v) => (v === NONE ? 'No ride' : v)}
                        groupBy={timeBucket}
                        groupOrder={TIME_GROUP_ORDER}
                      />
                    </View>
                    <View style={styles.colLeg}>
                      <Dropdown
                        value={hasDrop ? dropVal : null}
                        options={bookableTimesForDate(d.key, dropOptions, BOOKING_LEAD_HOURS)}
                        onSelect={(v) => setLeg(d.key, 'drop', v)}
                        disabled={past || (hasPickup && !hasDrop)}
                        leadingIcon="clock-outline"
                        placeholder="Select time"
                        format={(v) => (v === NONE ? 'No ride' : v)}
                        groupBy={timeBucket}
                        groupOrder={TIME_GROUP_ORDER}
                      />
                    </View>
                  </>
                )}
              </Pressable>
            );
          })}
        </Surface>

        {error ? (
          <View style={styles.actionsWrap}>
            <HelperText type="error" visible style={styles.errorText}>
              {error}
            </HelperText>
          </View>
        ) : null}

        {/* Back + Raise Request */}
        <View style={[styles.actionsWrap, styles.buttonRow]}>
          <Button
            mode="outlined"
            icon="arrow-left"
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            contentStyle={styles.btnContent}
            disabled={saving}
          >
            Back
          </Button>
          <Button
            mode="contained"
            icon="send"
            onPress={handleSave}
            style={styles.primaryBtn}
            contentStyle={styles.btnContent}
            loading={saving}
            disabled={!dirty || saving}
          >
            Raise Request
          </Button>
        </View>
      </ScrollView>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={1500}>
        {snack}
      </Snackbar>
    </View>
  );
}

const CARD_MAX = 560;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 32, alignItems: 'center' },

  // The centered schedule card.
  card: {
    width: '100%',
    maxWidth: CARD_MAX,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
  },

  // Header
  headerBlock: { alignItems: 'center', marginBottom: 14 },
  heading: { fontWeight: '600', color: colors.text },
  subheading: { color: colors.muted, marginTop: 2 },

  // Week navigator + range pill
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  rangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF2FE',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rangeText: { fontWeight: '600', color: colors.primaryDark, fontSize: 15 },

  // Info banner (collapsible)
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAF2FE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  infoIcon: { marginRight: 8 },
  infoText: { color: colors.primaryDark, flex: 1, lineHeight: 18 },

  // Roster banner
  rosterBanner: {
    backgroundColor: '#F1F5FB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  rosterBannerText: { fontWeight: 'bold', color: colors.primaryDark },
  rosterBannerSub: { color: colors.primaryDark, opacity: 0.8, marginTop: 2 },

  // Column header strip
  colHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 8,
    marginBottom: 2,
  },
  colHeadTitle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  colHeadText: { fontWeight: '700', color: colors.muted, fontSize: 12, letterSpacing: 0.3 },
  colHeadSub: { fontSize: 11, color: colors.muted, opacity: 0.7, marginTop: 1 },

  // Day cards
  dayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  dayCardHover: { backgroundColor: '#F7FAFF' },
  weekendCard: { backgroundColor: '#F5F6F8' }, // light gray, not red
  todayCard: { backgroundColor: '#EAF2FE', borderRadius: 10, borderTopColor: 'transparent' },
  offCard: { backgroundColor: '#F7F8FA' },
  pastCard: { opacity: 0.5 },

  colDate: { flex: 1 },
  colLeg: { flex: 1.5, alignItems: 'flex-start', paddingHorizontal: 4 },
  dateTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayLabel: { fontWeight: '600', color: colors.text },
  dateSub: { color: colors.muted, marginTop: 1 },
  todayPill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  todayPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  weekendTag: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.5,
    marginTop: 3,
    textTransform: 'uppercase',
  },
  validRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  validText: { fontSize: 11, color: colors.success, fontWeight: '600' },
  offCell: { flex: 3, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4 },
  offText: { fontStyle: 'italic', color: colors.muted },
  pastText: { opacity: 0.45 },

  // Actions
  actionsWrap: { width: '100%', maxWidth: CARD_MAX },
  errorText: { paddingHorizontal: 0 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  backBtn: { flex: 1, borderRadius: 10 },
  primaryBtn: { flex: 2, borderRadius: 10 },
  btnContent: { paddingVertical: 6 },
});
