// ---------------------------------------------------------------------------
// CHANGE REQUESTS  (employee) — Step 7
//
// The roster says when the employee travels. This is how they tell the desk that
// a particular day is different: they're not coming in, they don't need one of
// their two cabs, or they're working a different shift from the rostered one.
//
// It replaces self-booking. The employee no longer creates rides — they raise an
// exception against the ride the roster already implies, and the desk resolves it.
//
// Every request carries a date, a reason and comments (Step 7). Types that act on
// a specific ride ask which one; types that need a time ask for it.
//
// Where a request goes is decided by POLICY, not by the employee — the form just
// tells them, so a shift extension doesn't feel like it vanished.
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import {
  Text, Card, Button, Chip, TextInput, HelperText, Snackbar, Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import {
  OFFERED_REQUESTS, REASONS, STATUS_STYLE, REQUEST_STATUS, requestMeta,
} from '../../data/changeRequests';
import { WORKING_CODES, shiftSummary } from '../../data/shifts';
import { todayKey, shiftDateKey, isBookingPast } from '../../utils/datetime';
import { colors, font, radius, shadow, spacing } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(key) {
  const [y, m, d] = String(key).split('-').map((n) => parseInt(n, 10));
  return `${String(d).padStart(2, '0')} ${MONTHS[(m || 1) - 1]} ${y}`;
}

function formatWhen(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
}

export default function ChangeRequestScreen({ navigation, route }) {
  const {
    myChangeRequests, raiseChangeRequest, myBookings, shiftPolicy, currentUser,
  } = useApp();

  const [type, setType] = useState(null);
  const [date, setDate] = useState(() => todayKey());
  const [reason, setReason] = useState('');
  const [comments, setComments] = useState('');
  const [rideKey, setRideKey] = useState(null);
  const [requestedShiftCode, setRequestedShiftCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  // Whether the three-way type picker is expanded. Open by default — someone who
  // opened this screen cold still has to choose. It is only closed when Home has
  // ALREADY chosen (see the focus effect below), which is the case where showing
  // the choice again is just asking the same question twice.
  const [pickerOpen, setPickerOpen] = useState(true);

  // ARRIVING WITH A TYPE ALREADY CHOSEN.
  //
  // Home links straight at a type — its tiles ARE "Cancel one ride" and "Shift
  // changed" — so the form opens on the thing that was tapped instead of making
  // someone pick it a second time. Arriving with no type (MySchedule's link, or
  // the browser URL) still opens the picker cold, which is why this is guarded
  // rather than unconditional.
  //
  // The param is CONSUMED once applied. Without that, tapping the same Home tile
  // again would navigate with an identical `type`, the dependency wouldn't change,
  // and the tile would silently fail to reselect after the employee had switched
  // to a different type on this screen.
  useFocusEffect(
    useCallback(() => {
      const wanted = route.params?.type;
      if (!wanted || !OFFERED_REQUESTS.some((r) => r.type === wanted)) return;
      setType(wanted);
      setError('');
      setPickerOpen(false);
      navigation.setParams({ type: undefined });
    }, [route.params?.type, navigation])
  );

  const meta = type ? requestMeta(type) : null;
  const needs = (field) => !!meta?.form.includes(field);

  // YESTERDAY IS OFFERED WHEN A RIDE DATED YESTERDAY HAS STILL NOT LEFT.
  //
  // A ride is filed under the day of the SHIFT that earned it, and a late shift's
  // drop leaves after midnight — an E2 worked on the 26th is a 2:30 AM cab on the
  // 27th, but its booking is dated the 26th (see `departDate` in services/rides.js).
  // So at 11 PM on the 26th, and again at 1 AM on the 27th, the ride somebody
  // wants to cancel is dated a day that "today onwards" cannot reach: the picker
  // opened on the 27th and the ride was on the 26th, with no way to select it.
  //
  // Only ONE day back is ever needed — a drop can be at most one calendar day
  // after its shift.
  //
  // Gated on there actually being something to act on, and gated with
  // isBookingPast (which reads departDate) rather than a plain date compare, so
  // the extra row appears only while that cab has genuinely still not departed
  // and disappears by itself once it has. Without the gate, "yesterday" would sit
  // in the list every day of the year inviting people to cancel rides that
  // already happened.
  const yesterdayHasRide = useMemo(() => {
    const yesterday = shiftDateKey(todayKey(), -1);
    return myBookings().some(
      (b) =>
        b.date === yesterday &&
        b.status !== 'Cancelled' &&
        b.status !== 'Completed' &&
        !isBookingPast(b)
    );
  }, [myBookings]);

  // The next two weeks — a request is about a specific day, and there's no point
  // raising one about last month.
  const dateOptions = useMemo(() => {
    const out = [];
    if (yesterdayHasRide) out.push(shiftDateKey(todayKey(), -1));
    for (let i = 0; i <= 14; i++) out.push(shiftDateKey(todayKey(), i));
    return out;
  }, [yesterdayHasRide]);

  // The employee's own rides on the chosen date, for the types that act on one.
  // These are real bookings; a ride with no cab yet has nothing to change.
  const ridesThatDay = useMemo(
    () =>
      myBookings().filter(
        (b) => b.date === date && b.status !== 'Cancelled' && b.status !== 'Completed'
      ),
    [myBookings, date]
  );

  // WHAT'S STILL OUTSTANDING — not everything ever raised.
  //
  // This card is the ONLY place a PENDING request is visible anywhere in the app:
  // raising one sends no notification (see raiseChangeRequest), so between hitting
  // Send and the desk acting, this list is the sole evidence the request exists.
  // It also stops a dead end — raiseChangeRequest refuses a second request for the
  // same date + type, and seeing the first one here beats filling the whole form
  // and being bounced at submit.
  //
  // Settled rows are dropped because they earn nothing here: resolving a request
  // already sends a REQUEST_RESOLVED notification carrying the outcome AND the
  // desk's note, so the history was a second copy of something already delivered
  // — and it pushed the one row that matters off the bottom of the screen.
  //
  // Filtered by EXCLUDING the settled statuses rather than by `=== PENDING`: the
  // job of this card is to not lose track of something outstanding, so a status
  // this screen doesn't recognise should surface, not silently vanish.
  const openRequests = useMemo(
    () =>
      (myChangeRequests || []).filter(
        (r) =>
          r.status !== REQUEST_STATUS.RESOLVED && r.status !== REQUEST_STATUS.REJECTED
      ),
    [myChangeRequests]
  );

  function reset() {
    // Back to no type means back to the picker: a summary row for a type that is
    // no longer selected would be a header for nothing.
    setPickerOpen(true);
    setType(null);
    setReason('');
    setComments('');
    setRideKey(null);
    setRequestedShiftCode(null);
  }

  async function submit() {
    setError('');
    setBusy(true);
    const chosen = ridesThatDay.find((b) => (b.rideKey || b.id) === rideKey);
    const res = await raiseChangeRequest({
      type,
      date,
      reason,
      comments,
      rideKey: rideKey || null,
      bookingId: chosen?.id || null,
      requestedShiftCode,
    });
    setBusy(false);
    if (res?.ok) {
      setSnack("Sent to the transport desk — you'll be notified.");
      reset();
    } else {
      setError(res?.message || 'Could not send your request.');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.col}>
        {/* ---- Pick a type ---- */}
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            {/* ARRIVED WITH THE CHOICE ALREADY MADE?
                Home's tiles ARE "Cancel one ride" and "Shift changed", so laying
                the same three tiles out again asks a question that was answered
                one tap ago. Collapsed to a summary row naming what was picked,
                with a way back to the full picker — the other types stay reachable,
                they're just no longer in the way. Opening the screen cold (from My
                Shift Calendar, or the URL) still shows the picker, because then
                nothing has been chosen yet. */}
            {!pickerOpen && meta ? (
              <View style={styles.chosenRow}>
                <MaterialCommunityIcons name={meta.icon} size={22} color={colors.primary} />
                <Text variant="titleMedium" style={styles.chosenLabel}>
                  {meta.label}
                </Text>
                <Button
                  compact
                  mode="text"
                  onPress={() => setPickerOpen(true)}
                  accessibilityLabel="Change the request type"
                >
                  Change
                </Button>
              </View>
            ) : null}

            {pickerOpen ? (
              <>
                <Text variant="titleMedium">What's changed?</Text>
                <Text variant="bodySmall" style={styles.sub}>
                  Your shifts come from the roster HR uploads. Tell the desk when a
                  day is different.
                </Text>
              </>
            ) : null}

            {/* OFFERED_REQUESTS, not the whole catalogue — a retired type stays in
                the catalogue so "My requests" below can still label and explain a
                request of that type still sitting Pending, but it must not be
                offered as a new choice. */}
            <View style={[styles.typeGrid, !pickerOpen && styles.hidden]}>
              {OFFERED_REQUESTS.map((r) => {
                const active = type === r.type;
                return (
                  <Pressable
                    key={r.type}
                    // Picking here does NOT re-collapse. The picker is only open
                    // when nobody has chosen yet, or when someone asked for it
                    // back — in both cases they are choosing deliberately and
                    // having the tiles fold away under the tap is a surprise.
                    onPress={() => {
                      setType(r.type);
                      setError('');
                    }}
                    style={({ hovered }) => [
                      styles.typeTile,
                      active && styles.typeTileActive,
                      hovered && !active && styles.typeTileHover,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <MaterialCommunityIcons
                      name={r.icon}
                      size={22}
                      color={active ? '#FFFFFF' : colors.primary}
                    />
                    <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>
                      {r.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {meta ? (
              <>
                <View style={styles.blurbBox}>
                  <MaterialCommunityIcons name="information" size={16} color={colors.primaryDark} />
                  <Text variant="bodySmall" style={styles.blurbText}>
                    {meta.blurb}
                  </Text>
                </View>

                <Divider style={styles.divider} />

                <Text variant="labelLarge" style={styles.label}>
                  Date
                </Text>
                <Dropdown
                  value={date}
                  options={dateOptions}
                  onSelect={(d) => {
                    setDate(d);
                    setRideKey(null);
                  }}
                  // Yesterday is only ever in this list because a shift worked
                  // then has a cab that leaves after midnight, so the row says
                  // so — an unexplained past date reads as a bug.
                  format={(d) =>
                    d === shiftDateKey(todayKey(), -1)
                      ? `${prettyDate(d)} · last night's shift`
                      : prettyDate(d)
                  }
                  compact={false}
                  leadingIcon="calendar"
                />

                {/* Which ride — for cancel-one-ride and pickup-time change. */}
                {needs('ride') ? (
                  <>
                    <Text variant="labelLarge" style={styles.label}>
                      Which ride
                    </Text>
                    {ridesThatDay.length === 0 ? (
                      <HelperText type="info" visible>
                        You have no assigned ride on {prettyDate(date)} yet. Once the
                        desk assigns a cab you can ask to change it.
                      </HelperText>
                    ) : (
                      <Dropdown
                        value={rideKey}
                        options={ridesThatDay.map((b) => b.rideKey || b.id)}
                        onSelect={setRideKey}
                        format={(k) => {
                          const b = ridesThatDay.find((x) => (x.rideKey || x.id) === k);
                          return b ? `${b.direction} · ${b.shift}` : 'Select';
                        }}
                        placeholder="Select the ride"
                        compact={false}
                        leadingIcon="car"
                      />
                    )}
                  </>
                ) : null}

                {/* Which shift — for shift changed. */}
                {needs('shiftCode') ? (
                  <>
                    <Text variant="labelLarge" style={styles.label}>
                      Shift you're actually working
                    </Text>
                    <Dropdown
                      value={requestedShiftCode}
                      options={WORKING_CODES}
                      onSelect={setRequestedShiftCode}
                      format={(c) => `${c} — ${shiftSummary(shiftPolicy, c)}`}
                      placeholder="Select the shift"
                      compact={false}
                      leadingIcon="clock-outline"
                    />
                  </>
                ) : null}

                {/* No "time you need the cab" and no direction picker: every
                    request here concerns one of the two scheduled rides, so there
                    is no time to choose and no extra leg to ask for. */}

                <Text variant="labelLarge" style={styles.label}>
                  Reason
                </Text>
                <Dropdown
                  value={reason}
                  options={REASONS}
                  onSelect={setReason}
                  placeholder="Choose a reason"
                  compact={false}
                  leadingIcon="help-circle-outline"
                />

                <Text variant="labelLarge" style={styles.label}>
                  Comments
                </Text>
                <TextInput
                  value={comments}
                  onChangeText={(t) => t.length <= 500 && setComments(t)}
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  placeholder="Anything the desk should know"
                  maxLength={500}
                />

                {/* Say where it goes — silence reads as the request going nowhere. */}
                <View style={styles.routeNote}>
                  <MaterialCommunityIcons name="headset" size={16} color={colors.muted} />
                  <Text variant="bodySmall" style={styles.routeText}>
                    Goes straight to the transport desk — no approval needed.
                  </Text>
                </View>

                {error ? <HelperText type="error" visible>{error}</HelperText> : null}

                <View style={styles.actions}>
                  <Button mode="outlined" onPress={reset} disabled={busy} style={styles.actionBtn}>
                    Clear
                  </Button>
                  <Button
                    mode="contained"
                    icon="send"
                    onPress={submit}
                    loading={busy}
                    disabled={busy}
                    style={styles.submitBtn}
                  >
                    Send request
                  </Button>
                </View>
              </>
            ) : null}
          </Card.Content>
        </Card>

        {/* ---- My requests ---- */}
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">My requests</Text>
            {openRequests.length === 0 ? (
              <Text variant="bodySmall" style={styles.sub}>
                Nothing pending. You'll get a notification when the desk acts on a
                request.
              </Text>
            ) : (
              openRequests.map((r) => {
                const st = STATUS_STYLE[r.status] || STATUS_STYLE[REQUEST_STATUS.PENDING];
                return (
                  <View key={r.id} style={[styles.reqRow, { borderLeftColor: st.fg }]}>
                    <View style={styles.reqTop}>
                      <Text variant="bodyMedium" style={styles.reqType}>
                        {r.typeLabel || r.type}
                      </Text>
                      <Chip
                        compact
                        icon={st.icon}
                        style={{ backgroundColor: st.bg }}
                        textStyle={{ color: st.fg, fontSize: 11 }}
                      >
                        {r.status}
                      </Chip>
                    </View>
                    <Text variant="bodySmall" style={styles.reqMeta}>
                      For {prettyDate(r.date)} · raised {formatWhen(r.createdAt)}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </Text>
                    {r.resolutionNote ? (
                      <Text variant="bodySmall" style={styles.reqNote}>
                        Desk: {r.resolutionNote}
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}
          </Card.Content>
        </Card>
      </View>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={4000}>
        {snack}
      </Snackbar>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, alignItems: 'center' },
  col: { width: '100%', maxWidth: 680 },
  card: {
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  sub: { color: colors.muted, marginTop: spacing.xs, lineHeight: 19 },

  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  // Picking one of these is the whole decision on this screen, so the tiles are
  // generous and the chosen one goes solid brand — not merely tinted.
  typeTile: {
    flexGrow: 1,
    flexBasis: 140,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typeTileActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadow.brand,
  },
  typeTileHover: { backgroundColor: colors.primarySofter, borderColor: colors.primaryLight },
  typeLabel: {
    fontSize: 13,
    fontFamily: font.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  typeLabelActive: { color: '#FFFFFF' },

  // The collapsed stand-in for the picker: the chosen type, and the way back.
  chosenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chosenLabel: { flex: 1, minWidth: 0, color: colors.text, fontFamily: font.semibold },
  // display:none rather than unmounting the grid — React Native Web honours it,
  // and keeping the tiles mounted means expanding again doesn't re-run their
  // layout or lose the hover state mid-press.
  hidden: { display: 'none' },

  blurbBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySofter,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  blurbText: { color: colors.primaryDark, flex: 1, lineHeight: 19 },
  divider: { marginVertical: spacing.lg, backgroundColor: colors.border },
  label: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    color: colors.text,
    fontFamily: font.semibold,
  },

  routeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  routeText: { color: colors.muted, flex: 1, lineHeight: 19 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  actionBtn: { flex: 1, borderRadius: radius.md },
  submitBtn: { flex: 2, borderRadius: radius.md },

  reqRow: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  reqTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reqType: { fontFamily: font.semibold, flex: 1, color: colors.text },
  reqMeta: { color: colors.muted, marginTop: 3 },
  reqNote: { color: colors.textSecondary, marginTop: spacing.xs, fontStyle: 'italic' },
});
