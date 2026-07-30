// ---------------------------------------------------------------------------
// MY SHIFT CALENDAR  (employee)
//
// The employee's view of the roster HR uploaded. They don't book anything here —
// their shifts are given, and the cab follows automatically. What this screen
// answers is "when am I working, and when does my cab come?".
//
// Reads exactly ONE Firestore document per month (rosters/<month>_<uid>), so it
// stays cheap no matter how much history builds up.
//
// Each working day shows both legs derived from the shift policy:
//   • pickup  — home → office, an hour before the shift starts
//   • drop    — office → home, when it ends (which for an Evening or Night shift
//               is the NEXT morning, and the card says so)
//
// ONLY the legs the company actually provides are shown, per shift, from the
// Shift Policy: the Afternoon shift gets a drop home and no pickup, the Night
// shift a pickup and no drop. Listing a pickup nobody was going to make would
// have people waiting outside their homes for a cab that does not exist.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import { Text, Card, Chip, IconButton, Divider, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import {
  SHIFT_COLORS, legsForShift, isWorkingCode, shiftSummary,
} from '../../data/shifts';
import { todayKey, shiftDateKey } from '../../utils/datetime';
import { colors } from '../../theme';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "2026-07" → { year, monthIndex, label }
function parseMonth(month) {
  const [y, m] = String(month).split('-').map((n) => parseInt(n, 10));
  return { year: y, monthIndex: (m || 1) - 1, label: `${MONTHS[(m || 1) - 1]} ${y}` };
}

// Shift a "YYYY-MM" key by whole months.
function shiftMonth(month, by) {
  const { year, monthIndex } = parseMonth(month);
  const d = new Date(year, monthIndex + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MyScheduleScreen({ navigation }) {
  const { myRosters, shiftPolicy, currentUser } = useApp();

  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(null); // "01".."31"

  const roster = useMemo(
    () => myRosters.find((r) => r.month === month) || null,
    [myRosters, month]
  );
  const { year, monthIndex, label } = parseMonth(month);

  // The month laid out as calendar weeks, Monday first, with leading blanks.
  const weeks = useMemo(() => {
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const firstDow = (new Date(year, monthIndex, 1).getDay() + 6) % 7; // Mon = 0
    const cells = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(String(d).padStart(2, '0'));
    while (cells.length % 7) cells.push(null);
    const out = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [year, monthIndex]);

  const today = todayKey();
  const codeFor = (day) => roster?.days?.[day] || null;

  // Counts for the header strip: how many of each code this month.
  const tally = useMemo(() => {
    const t = {};
    Object.values(roster?.days || {}).forEach((c) => {
      if (c) t[c] = (t[c] || 0) + 1;
    });
    return t;
  }, [roster]);

  const selectedCode = selectedDay ? codeFor(selectedDay) : null;
  const selectedLegs = selectedCode ? legsForShift(shiftPolicy, selectedCode) : null;
  const selectedDate = selectedDay ? `${month}-${selectedDay}` : null;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.col}>
        {/* Month navigator */}
        <View style={styles.monthBar}>
          <IconButton
            icon="chevron-left"
            mode="contained-tonal"
            onPress={() => {
              setSelectedDay(null);
              setMonth((m) => shiftMonth(m, -1));
            }}
            accessibilityLabel="Previous month"
          />
          <View style={styles.monthPill}>
            <MaterialCommunityIcons name="calendar-month" size={18} color={colors.primary} />
            <Text style={styles.monthText}>{label}</Text>
          </View>
          <IconButton
            icon="chevron-right"
            mode="contained-tonal"
            onPress={() => {
              setSelectedDay(null);
              setMonth((m) => shiftMonth(m, 1));
            }}
            accessibilityLabel="Next month"
          />
        </View>

        {!roster ? (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.emptyCard}>
              <MaterialCommunityIcons name="calendar-alert" size={44} color={colors.muted} />
              <Text variant="titleMedium" style={styles.emptyTitle}>
                No roster for {label}
              </Text>
              <Text variant="bodyMedium" style={styles.emptyBody}>
                HR hasn't published this month's shift roster yet. Once they do,
                your shifts and cabs appear here automatically — there's nothing
                for you to submit.
              </Text>
            </Card.Content>
          </Card>
        ) : (
          <>
            {/* This month at a glance */}
            <View style={styles.tally}>
              {Object.keys(tally)
                .sort()
                .map((code) => {
                  const c = SHIFT_COLORS[code] || { bg: '#EEE', fg: colors.text };
                  return (
                    <Chip
                      key={code}
                      compact
                      style={{ backgroundColor: c.bg }}
                      textStyle={{ color: c.fg, fontSize: 12 }}
                    >
                      {shiftPolicy?.[code]?.label || code} · {tally[code]}
                    </Chip>
                  );
                })}
            </View>

            {/* The grid */}
            <Card mode="outlined" style={styles.card}>
              <Card.Content>
                <View style={styles.dowRow}>
                  {DOW.map((d) => (
                    <Text key={d} style={styles.dowText}>
                      {d}
                    </Text>
                  ))}
                </View>
                {weeks.map((week, wi) => (
                  <View key={wi} style={styles.week}>
                    {week.map((day, di) => {
                      if (!day) return <View key={`b${di}`} style={styles.cell} />;
                      const code = codeFor(day);
                      const c = code ? SHIFT_COLORS[code] : null;
                      const dateKey = `${month}-${day}`;
                      const isToday = dateKey === today;
                      const isSel = day === selectedDay;
                      return (
                        <Pressable
                          key={day}
                          style={({ hovered }) => [
                            styles.cell,
                            styles.dayCell,
                            c && { backgroundColor: c.bg },
                            isToday && styles.todayCell,
                            isSel && styles.selectedCell,
                            hovered && styles.hoverCell,
                          ]}
                          onPress={() => setSelectedDay(isSel ? null : day)}
                          accessibilityRole="button"
                          accessibilityLabel={`${day} ${MONTHS[monthIndex]}: ${
                            code ? shiftPolicy?.[code]?.label || code : 'no shift'
                          }`}
                        >
                          <Text style={[styles.dayNum, isToday && styles.todayNum]}>
                            {parseInt(day, 10)}
                          </Text>
                          <Text
                            style={[styles.dayCode, c && { color: c.fg }]}
                            numberOfLines={1}
                          >
                            {code || '—'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </Card.Content>
            </Card>

            {/* The selected day's detail */}
            {selectedDay ? (
              <Card mode="elevated" style={styles.card}>
                <Card.Content>
                  <Text variant="titleMedium">
                    {parseInt(selectedDay, 10)} {MONTHS[monthIndex]} {year}
                  </Text>
                  <Text variant="bodyMedium" style={styles.detailShift}>
                    {selectedCode
                      ? shiftSummary(shiftPolicy, selectedCode)
                      : 'No shift recorded for this day.'}
                  </Text>

                  {selectedLegs ? (
                    <>
                      <Divider style={styles.divider} />
                      {/* Only the legs a cab actually runs. Showing a pickup the
                          company doesn't provide would have people waiting outside
                          their homes for a cab that was never dispatched. */}
                      {selectedLegs.providePickup ? (
                        <Leg
                          icon="home-export-outline"
                          title="Pickup — Home to Office"
                          time={selectedLegs.pickup}
                          note={`${parseInt(selectedDay, 10)} ${MONTHS[monthIndex]}`}
                        />
                      ) : null}
                      {selectedLegs.provideDrop ? (
                        <Leg
                          icon="home-import-outline"
                          title="Drop — Office to Home"
                          time={selectedLegs.drop}
                          note={
                            selectedLegs.dropNextDay
                              ? `next morning, ${nextDayLabel(selectedDate)}`
                              : `${parseInt(selectedDay, 10)} ${MONTHS[monthIndex]}`
                          }
                        />
                      ) : null}
                      {/* Say plainly which legs the company runs for this shift.
                          It used to blame the service window for every missing leg,
                          which reads as wrong the moment a leg inside cab hours
                          isn't provided — the night shift ends at 6:00 AM and still
                          has no drop. Which legs run is policy, and the employee
                          only needs to know what to expect. */}
                      {!selectedLegs.providePickup || !selectedLegs.provideDrop ? (
                        <Text variant="bodySmall" style={styles.oneWayNote}>
                          {!selectedLegs.providePickup && !selectedLegs.provideDrop
                            ? 'No company cab runs for this shift — please make your own way both ways.'
                            : !selectedLegs.providePickup
                            ? 'Only the drop home is provided for this shift — please make your own way in.'
                            : 'Only the pickup from home is provided for this shift — please make your own way back.'}
                        </Text>
                      ) : null}
                      <Text variant="bodySmall" style={styles.detailHint}>
                        Your cab is assigned by the transport desk closer to the day.
                        You'll see the driver and cab number under My Rides once it is.
                      </Text>
                      <View style={styles.detailActions}>
                        <Button
                          mode="contained-tonal"
                          icon="car-search"
                          onPress={() => navigation.navigate('MyRides')}
                        >
                          My rides
                        </Button>
                        <Button
                          mode="text"
                          icon="calendar-edit"
                          onPress={() => navigation.navigate('ChangeRequest')}
                        >
                          Request a change
                        </Button>
                      </View>
                    </>
                  ) : selectedCode ? (
                    <Text variant="bodySmall" style={styles.detailHint}>
                      No cab runs on a {shiftPolicy?.[selectedCode]?.label || selectedCode} day.
                    </Text>
                  ) : null}
                </Card.Content>
              </Card>
            ) : (
              <Text variant="bodySmall" style={styles.tapHint}>
                Tap a day to see its pickup and drop times.
              </Text>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

// "next morning, 06 Jul"
function nextDayLabel(dateKey) {
  const next = shiftDateKey(dateKey, 1);
  const { monthIndex } = parseMonth(next.slice(0, 7));
  return `${parseInt(next.slice(8, 10), 10)} ${MONTHS[monthIndex].slice(0, 3)}`;
}

function Leg({ icon, title, time, note }) {
  return (
    <View style={styles.leg}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      <View style={styles.legText}>
        <Text variant="bodyMedium" style={styles.legTitle}>
          {title}
        </Text>
        <Text variant="bodySmall" style={styles.legNote}>
          {note}
        </Text>
      </View>
      <Text variant="titleMedium" style={styles.legTime}>
        {time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 12, alignItems: 'center' },
  col: { width: '100%', maxWidth: 620 },
  card: { marginBottom: 12 },

  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  monthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF2FE',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  monthText: { fontWeight: '600', color: colors.primaryDark, fontSize: 15 },

  tally: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },

  dowRow: { flexDirection: 'row', marginBottom: 6 },
  dowText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.4,
  },
  week: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1, margin: 2 },
  dayCell: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F8FA',
  },
  hoverCell: { opacity: 0.85 },
  todayCell: { borderWidth: 2, borderColor: colors.primary },
  selectedCell: { borderWidth: 2, borderColor: colors.primaryDark },
  dayNum: { fontSize: 12, color: colors.text, fontWeight: '600' },
  todayNum: { color: colors.primary },
  dayCode: { fontSize: 11, fontWeight: '700', color: colors.muted, marginTop: 1 },

  detailShift: { color: colors.muted, marginTop: 4 },
  divider: { marginVertical: 12 },
  oneWayNote: { color: colors.muted, lineHeight: 18, marginTop: 10 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  legText: { flex: 1 },
  legTitle: { fontWeight: '600' },
  legNote: { color: colors.muted, marginTop: 1 },
  legTime: { color: colors.primary, fontWeight: 'bold' },
  detailHint: { color: colors.muted, marginTop: 10, lineHeight: 18 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  tapHint: { color: colors.muted, textAlign: 'center', marginTop: 4 },

  emptyCard: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  emptyTitle: { marginTop: 6 },
  emptyBody: { textAlign: 'center', color: colors.muted, lineHeight: 20 },
});
