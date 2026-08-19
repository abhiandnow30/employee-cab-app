// ---------------------------------------------------------------------------
// CalendarFilter — pick a date, a range, or a whole month.
//
// Renders as a compact chip showing the current selection; tapping it opens a
// dialog with a month grid and a set of presets.
//
// API (unchanged — the Bookings screen depends on it):
//   <CalendarFilter value={range} onChange={setRange} />
//     value    — { start, end } as ISO "YYYY-MM-DD" keys, or null for "all dates"
//     onChange — called with a new { start, end }, or null when cleared
//   rangeLabel(range) — the same human-readable string the chip shows
//
// Picking works the way people expect from a booking site: the first tap sets the
// start and clears the end, the second tap closes the range. Tapping a day before
// the start restarts the selection from there rather than producing a backwards
// range.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Text, Portal, Dialog, Button, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { todayKey, shiftDateKey } from '../utils/datetime';
import { colors, font, radius, shadow, spacing } from '../theme';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CELL = 40;

const parse = (key) => {
  const [y, m, d] = String(key).split('-').map((n) => parseInt(n, 10));
  return { y, m: (m || 1) - 1, d: d || 1 };
};
const keyOf = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const pretty = (key) => {
  const { y, m, d } = parse(key);
  return `${String(d).padStart(2, '0')} ${SHORT[m]} ${y}`;
};

// The label shown on the chip, and reusable by callers for empty states.
export function rangeLabel(range) {
  if (!range?.start) return 'All dates';
  if (range.start === range.end) return pretty(range.start);
  // A whole calendar month reads better as the month's name.
  const s = parse(range.start);
  const e = parse(range.end);
  const lastOfMonth = new Date(s.y, s.m + 1, 0).getDate();
  if (s.y === e.y && s.m === e.m && s.d === 1 && e.d === lastOfMonth) {
    return `${MONTHS[s.m]} ${s.y}`;
  }
  return `${pretty(range.start)} – ${pretty(range.end)}`;
}

export default function CalendarFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value?.start || todayKey()).slice(0, 7));
  // In-dialog draft, so cancelling leaves the caller's value untouched.
  const [start, setStart] = useState(value?.start || null);
  const [end, setEnd] = useState(value?.end || null);

  const { y, m } = useMemo(() => {
    const [yy, mm] = month.split('-').map((n) => parseInt(n, 10));
    return { y: yy, m: (mm || 1) - 1 };
  }, [month]);

  const weeks = useMemo(() => {
    const days = new Date(y, m + 1, 0).getDate();
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
    const cells = Array(firstDow).fill(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const out = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [y, m]);

  function openDialog() {
    setStart(value?.start || null);
    setEnd(value?.end || null);
    setMonth((value?.start || todayKey()).slice(0, 7));
    setOpen(true);
  }

  function tapDay(d) {
    const key = keyOf(y, m, d);
    // No start yet, or a completed range, or a tap before the start → begin again.
    if (!start || (start && end) || key < start) {
      setStart(key);
      setEnd(null);
      return;
    }
    setEnd(key);
  }

  function shiftMonth(by) {
    const next = new Date(y, m + by, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  }

  const presets = [
    { label: 'Today', get: () => ({ start: todayKey(), end: todayKey() }) },
    {
      label: 'Tomorrow',
      get: () => {
        const t = shiftDateKey(todayKey(), 1);
        return { start: t, end: t };
      },
    },
    { label: 'Next 7 days', get: () => ({ start: todayKey(), end: shiftDateKey(todayKey(), 6) }) },
    {
      label: 'This month',
      get: () => {
        const t = parse(todayKey());
        return {
          start: keyOf(t.y, t.m, 1),
          end: keyOf(t.y, t.m, new Date(t.y, t.m + 1, 0).getDate()),
        };
      },
    },
    {
      label: 'Last 30 days',
      get: () => ({ start: shiftDateKey(todayKey(), -29), end: todayKey() }),
    },
  ];

  function apply() {
    if (!start) {
      onChange(null);
    } else {
      // A single tap means that one day.
      onChange({ start, end: end || start });
    }
    setOpen(false);
  }

  const inRange = (d) => {
    const key = keyOf(y, m, d);
    if (!start) return false;
    const hi = end || start;
    return key >= start && key <= hi;
  };
  const isEdge = (d) => {
    const key = keyOf(y, m, d);
    return key === start || key === end;
  };

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={openDialog}
        accessibilityRole="button"
        accessibilityLabel={`Date filter: ${rangeLabel(value)}`}
      >
        <MaterialCommunityIcons name="calendar-range" size={16} color={colors.primary} />
        <Text style={styles.triggerText} numberOfLines={1}>
          {rangeLabel(value)}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={colors.primary} />
      </Pressable>

      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.dialog}>
          <Dialog.Title>Filter by date</Dialog.Title>
          <Dialog.Content>
            <View style={styles.body}>
              {/* Month grid */}
              <View style={styles.calCol}>
                <View style={styles.monthBar}>
                  <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={styles.arrow}>
                    <MaterialCommunityIcons name="chevron-left" size={22} color={colors.primary} />
                  </Pressable>
                  <Text variant="titleSmall">{`${MONTHS[m]} ${y}`}</Text>
                  <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={styles.arrow}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={colors.primary} />
                  </Pressable>
                </View>
                <View style={styles.dowRow}>
                  {DOW.map((d) => (
                    <Text key={d} style={styles.dowText}>
                      {d}
                    </Text>
                  ))}
                </View>
                <View style={styles.grid}>
                  {weeks.flat().map((d, i) =>
                    d == null ? (
                      <View key={`b${i}`} style={styles.cell} />
                    ) : (
                      <Pressable
                        key={d}
                        onPress={() => tapDay(d)}
                        style={[
                          styles.cell,
                          styles.dayCell,
                          inRange(d) && styles.inRange,
                          isEdge(d) && styles.edge,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            inRange(d) && styles.inRangeText,
                            isEdge(d) && styles.edgeText,
                          ]}
                        >
                          {d}
                        </Text>
                      </Pressable>
                    )
                  )}
                </View>
                <Text variant="bodySmall" style={styles.help}>
                  {!start
                    ? 'Tap a day to start.'
                    : !end
                    ? 'Tap a second day for a range, or apply for just this one.'
                    : `${pretty(start)} – ${pretty(end)}`}
                </Text>
              </View>

              {/* Presets */}
              <View style={styles.presetCol}>
                <Text variant="labelLarge" style={styles.presetLabel}>
                  Quick picks
                </Text>
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    mode="text"
                    compact
                    style={styles.presetBtn}
                    contentStyle={styles.presetContent}
                    onPress={() => {
                      const r = p.get();
                      setStart(r.start);
                      setEnd(r.end);
                      setMonth(r.start.slice(0, 7));
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
                <Divider style={styles.presetDivider} />
                <Button
                  mode="text"
                  compact
                  icon="filter-remove"
                  style={styles.presetBtn}
                  contentStyle={styles.presetContent}
                  onPress={() => {
                    setStart(null);
                    setEnd(null);
                  }}
                >
                  All dates
                </Button>
              </View>
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setOpen(false)} style={styles.footBtn}>
              Cancel
            </Button>
            <Button mode="contained" onPress={apply} style={styles.footBtn}>
              Apply
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  // Reads as a filter chip: tinted, bordered, brand-coloured label.
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySofter,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  triggerText: {
    color: colors.primaryDark,
    fontFamily: font.semibold,
    fontSize: 13.5,
    maxWidth: 220,
  },
  dialog: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  body: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  calCol: { flexGrow: 1, minWidth: 300 },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  dowRow: { flexDirection: 'row', width: CELL * 7, marginBottom: spacing.xs },
  dowText: {
    width: CELL,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: font.semibold,
    letterSpacing: 0.4,
    color: colors.muted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: CELL * 7 },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  dayCell: { borderRadius: radius.sm },
  inRange: { backgroundColor: colors.primarySoft },
  edge: { backgroundColor: colors.primary },
  dayText: { fontSize: 13, color: colors.text },
  inRangeText: { color: colors.primaryDark, fontFamily: font.semibold },
  edgeText: { color: '#FFFFFF', fontFamily: font.semibold },
  help: { color: colors.muted, marginTop: spacing.md },
  presetCol: { flexGrow: 1, minWidth: 150 },
  presetLabel: {
    color: colors.muted,
    marginBottom: spacing.sm,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  presetBtn: { alignSelf: 'stretch', borderRadius: radius.sm },
  presetContent: { justifyContent: 'flex-start' },
  presetDivider: { marginVertical: spacing.md, backgroundColor: colors.border },
  footBtn: { minWidth: 104, borderRadius: radius.md },
});
