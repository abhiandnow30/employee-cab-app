// ---------------------------------------------------------------------------
// CalendarFilter — a pop-up month calendar for filtering by date, with preset
// ranges (Today, This Week, This Month, …). Dependency-free (no date-picker
// library) so it works the same on web and mobile.
//
// Value model: null = "All dates", or { start, end } where both are
// "YYYY-MM-DD" keys (a single day has start === end). Because the keys are
// zero-padded ISO strings, plain string comparison gives correct ordering.
//
// Usage:
//   <CalendarFilter value={range} onChange={setRange} />
//   const shown = range ? rows.filter(r => r.date >= range.start && r.date <= range.end) : rows
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Text, Button, Portal, Dialog, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MON_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyToDate = (key) => {
  const [y, m, d] = String(key).split('-').map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
};
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const addMonths = (d, n) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const lastOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const fmt = (key) => {
  const d = keyToDate(key);
  return `${MON_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

// Human label for the trigger button.
export function rangeLabel(value) {
  if (!value) return 'All dates';
  if (value.start === value.end) return fmt(value.start);
  // Whole calendar month → show "Jul 2026".
  const s = keyToDate(value.start);
  const e = keyToDate(value.end);
  const isWholeMonth =
    s.getDate() === 1 &&
    e.getTime() === lastOfMonth(s).getTime() &&
    s.getMonth() === e.getMonth() &&
    s.getFullYear() === e.getFullYear();
  if (isWholeMonth) return `${MON_SHORT[s.getMonth()]} ${s.getFullYear()}`;
  return `${fmt(value.start)} – ${fmt(value.end)}`;
}

// Preset ranges, computed relative to `today`.
function presets(today) {
  const t = startOfDay(today);
  const mkThisWeek = () => {
    const start = addDays(t, -t.getDay()); // Sunday
    return { start: toKey(start), end: toKey(addDays(start, 6)) };
  };
  return [
    { label: 'Today', range: () => ({ start: toKey(t), end: toKey(t) }) },
    { label: 'Yesterday', range: () => ({ start: toKey(addDays(t, -1)), end: toKey(addDays(t, -1)) }) },
    { label: 'This Week', range: mkThisWeek },
    { label: 'Last 7 Days', range: () => ({ start: toKey(addDays(t, -6)), end: toKey(t) }) },
    { label: 'This Month', range: () => ({ start: toKey(firstOfMonth(t)), end: toKey(lastOfMonth(t)) }) },
    {
      label: 'Previous Month',
      range: () => {
        const p = addMonths(t, -1);
        return { start: toKey(firstOfMonth(p)), end: toKey(lastOfMonth(p)) };
      },
    },
    {
      label: 'Last 3 Months',
      range: () => ({ start: toKey(firstOfMonth(addMonths(t, -2))), end: toKey(lastOfMonth(t)) }),
    },
    {
      label: 'Last 6 Months',
      range: () => ({ start: toKey(firstOfMonth(addMonths(t, -5))), end: toKey(lastOfMonth(t)) }),
    },
  ];
}

export default function CalendarFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || null);
  const initial = value ? keyToDate(value.start) : new Date();
  const [viewY, setViewY] = useState(initial.getFullYear());
  const [viewM, setViewM] = useState(initial.getMonth()); // 0-based

  const today = new Date();
  const todayKey = toKey(today);

  function openDialog() {
    setDraft(value || null);
    const base = value ? keyToDate(value.start) : new Date();
    setViewY(base.getFullYear());
    setViewM(base.getMonth());
    setOpen(true);
  }

  function stepMonth(delta) {
    const d = addMonths(new Date(viewY, viewM, 1), delta);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
  }

  // Tap a day: first tap picks a single day; a second tap extends to a range.
  function pickDay(dayNum) {
    const key = toKey(new Date(viewY, viewM, dayNum));
    setDraft((cur) => {
      if (!cur || cur.start !== cur.end) return { start: key, end: key };
      return cur.start <= key ? { start: cur.start, end: key } : { start: key, end: cur.start };
    });
  }

  function choosePreset(p) {
    const r = p.range();
    setDraft(r);
    const s = keyToDate(r.start);
    setViewY(s.getFullYear());
    setViewM(s.getMonth());
  }

  function apply() {
    onChange(draft);
    setOpen(false);
  }
  function clearAll() {
    setDraft(null);
  }

  const inRange = (key) => draft && key >= draft.start && key <= draft.end;
  const isEnd = (key) => draft && (key === draft.start || key === draft.end);

  // Build the month grid: leading blanks + day numbers.
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <>
      <Pressable style={styles.trigger} onPress={openDialog}>
        <MaterialCommunityIcons name="calendar-month" size={18} color={colors.primary} />
        <Text style={styles.triggerText} numberOfLines={1}>{rangeLabel(value)}</Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color={colors.primary} />
      </Pressable>

      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.dialog}>
          <Dialog.Title style={styles.title}>Calendar</Dialog.Title>
          <Dialog.Content>
            <View style={styles.body}>
              {/* Calendar */}
              <View style={styles.calCol}>
                <View style={styles.monthBar}>
                  <Text variant="titleMedium" style={styles.monthLabel}>
                    {MON_FULL[viewM]} {viewY}
                  </Text>
                  <View style={styles.navBtns}>
                    <Pressable hitSlop={8} onPress={() => stepMonth(-1)} style={styles.navBtn}>
                      <MaterialCommunityIcons name="chevron-left" size={22} color={colors.text} />
                    </Pressable>
                    <Pressable hitSlop={8} onPress={() => stepMonth(1)} style={styles.navBtn}>
                      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.text} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.weekRow}>
                  {WEEK.map((w, i) => (
                    <Text key={i} style={styles.weekday}>{w}</Text>
                  ))}
                </View>

                <View style={styles.grid}>
                  {cells.map((d, i) => {
                    if (d == null) return <View key={`b${i}`} style={styles.cell} />;
                    const key = toKey(new Date(viewY, viewM, d));
                    const selected = isEnd(key);
                    const between = inRange(key) && !selected;
                    const isToday = key === todayKey;
                    return (
                      <Pressable key={key} style={styles.cell} onPress={() => pickDay(d)}>
                        <View
                          style={[
                            styles.day,
                            between && styles.dayBetween,
                            selected && styles.daySelected,
                            isToday && !selected && styles.dayToday,
                          ]}
                        >
                          <Text style={[styles.dayText, selected && styles.dayTextSelected]}>{d}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Presets */}
              <View style={styles.presetCol}>
                <Text variant="labelLarge" style={styles.presetHead}>Preset Filters</Text>
                <Pressable onPress={clearAll} style={styles.presetItem}>
                  <Text style={[styles.presetText, !draft && styles.presetTextActive]}>All dates</Text>
                </Pressable>
                {presets(today).map((p) => (
                  <Pressable key={p.label} onPress={() => choosePreset(p)} style={styles.presetItem}>
                    <Text style={styles.presetText}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Divider style={styles.footDivider} />
            <Text variant="bodySmall" style={styles.selection}>
              {rangeLabel(draft)}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button mode="outlined" onPress={() => setOpen(false)} style={styles.footBtn}>
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

const CELL = 40;

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#EFF3F9',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D6E0EE',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  triggerText: { color: colors.primaryDark, fontWeight: 'bold', maxWidth: 220 },
  dialog: { width: '100%', maxWidth: 620, alignSelf: 'center' },
  title: { paddingBottom: 0 },
  body: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  calCol: { flexGrow: 1, minWidth: 300 },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  monthLabel: { fontWeight: 'bold' },
  navBtns: { flexDirection: 'row', gap: 8 },
  navBtn: { padding: 4, borderRadius: 6 },
  weekRow: { flexDirection: 'row' },
  weekday: { width: CELL, textAlign: 'center', color: colors.muted, fontSize: 12, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: CELL * 7 },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayBetween: { backgroundColor: '#E3ECFB', borderRadius: 6, width: CELL },
  daySelected: { backgroundColor: colors.primary },
  dayToday: { borderWidth: 1, borderColor: colors.primary },
  dayText: { color: colors.text, fontSize: 14 },
  dayTextSelected: { color: '#FFFFFF', fontWeight: 'bold' },
  presetCol: { flexGrow: 1, minWidth: 150 },
  presetHead: { marginBottom: 6, color: colors.text },
  presetItem: { paddingVertical: 7 },
  presetText: { color: colors.muted, fontSize: 15 },
  presetTextActive: { color: colors.primary, fontWeight: 'bold' },
  footDivider: { marginTop: 14, marginBottom: 8 },
  selection: { color: colors.primaryDark, fontWeight: '600' },
  footBtn: { minWidth: 96 },
});
