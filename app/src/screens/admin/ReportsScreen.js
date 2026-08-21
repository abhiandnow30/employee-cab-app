// ---------------------------------------------------------------------------
// REPORTS (HR / Admin) — what actually ran, over a period.
//
// The desk could see today, and it could see one ride at a time. It could not
// see a week: "how many rides did we run last month, and how many did nobody
// turn up for" had no answer anywhere in the app.
//
// EVERY NUMBER HERE IS ARITHMETIC OVER DATA ALREADY ON THIS DEVICE. HR's session
// holds 180 days of bookings (ADMIN_HISTORY_DAYS, via subscribeAllBookings), so
// there is no query, no index and no rules change behind this screen — which is
// also its one real limit, stated on screen rather than hidden: ask for anything
// older than that window and the answer would be quietly wrong.
//
// The counting lives in services/reports.js, tested on its own. A report that
// miscounts is worse than no report — somebody plans headcount on it — so the
// arithmetic is deliberately not tangled up in the rendering.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, Card, Button, SegmentedButtons, Snackbar, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { ADMIN_HISTORY_DAYS } from '../../services/bookings';
import { todayKey, shiftDateKey, prettyDateKey } from '../../utils/datetime';
import CalendarFilter from '../../components/CalendarFilter';
import {
  PERIOD, PERIOD_LABEL, periodRange, rangeLabel, bookingsInRange,
  summarise, breakdown, downloadRideReport,
} from '../../services/reports';

// The four the desk actually asks for. "Last 30 days" and a custom range live
// behind the date picker rather than adding two more segments to a control that
// has to stay readable on a laptop.
const QUICK = [PERIOD.THIS_WEEK, PERIOD.LAST_WEEK, PERIOD.THIS_MONTH, PERIOD.LAST_MONTH];

// One headline number. `tone` carries the meaning — a no-show count is not good
// news at 12 the way a completed count is.
function Stat({ label, value, tone = colors.text, hint }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text variant="bodySmall" style={styles.statLabel}>
        {label}
      </Text>
      {hint ? (
        <Text variant="bodySmall" style={styles.statHint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// A breakdown table. Same shape whichever way the rides are split, so the eye
// learns it once.
function Table({ title, icon, rows, emptyText, nameHeader }) {
  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <View style={styles.tableHead}>
          <MaterialCommunityIcons name={icon} size={18} color={colors.primary} />
          <Text variant="titleMedium" style={styles.tableTitle}>
            {title}
          </Text>
        </View>
        <View style={styles.row}>
          <Text variant="labelSmall" style={[styles.colName, styles.headCell]}>
            {nameHeader}
          </Text>
          <Text variant="labelSmall" style={[styles.colNum, styles.headCell]}>
            RIDES
          </Text>
          <Text variant="labelSmall" style={[styles.colNum, styles.headCell]}>
            DONE
          </Text>
          <Text variant="labelSmall" style={[styles.colNum, styles.headCell]}>
            NO-SHOW
          </Text>
        </View>
        <Divider style={styles.divider} />
        {rows.length ? (
          rows.map((r) => (
            <View key={r.key || '—'} style={styles.row}>
              <Text variant="bodyMedium" style={styles.colName} numberOfLines={1}>
                {r.label || '—'}
              </Text>
              <Text variant="bodyMedium" style={styles.colNum}>
                {r.ran}
              </Text>
              <Text variant="bodyMedium" style={styles.colNum}>
                {r.completed}
              </Text>
              <Text
                variant="bodyMedium"
                style={[styles.colNum, r.noShow ? styles.colNumBad : null]}
              >
                {r.noShow}
              </Text>
            </View>
          ))
        ) : (
          <Text variant="bodySmall" style={styles.empty}>
            {emptyText}
          </Text>
        )}
      </Card.Content>
    </Card>
  );
}

export default function ReportsScreen() {
  const { bookings, employees, getCabById } = useApp();
  const [period, setPeriod] = useState(PERIOD.THIS_MONTH);
  const [custom, setCustom] = useState(null);
  const [note, setNote] = useState('');

  const today = todayKey();
  const range = useMemo(() => periodRange(period, today, custom), [period, today, custom]);

  // THE ROUTE IS NOT ON THE BOOKING. bookingFromRide copies the rider's name and
  // id across (the driver's screen needs them and the rules won't let a driver
  // read profiles) but not their route, so it is joined from the live profile
  // here — which is also the more truthful source: re-routing somebody mid-month
  // should move their history with them, and the roster snapshot would not.
  const routeByEmployee = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => m.set(e.uid, e.roster?.route || ''));
    return m;
  }, [employees]);
  const routeOf = (b) => routeByEmployee.get(b.employeeId) || b.route || '';

  const rows = useMemo(() => bookingsInRange(bookings, range), [bookings, range]);
  const stats = useMemo(() => summarise(rows), [rows]);

  const byRoute = useMemo(
    () => breakdown(rows, routeOf, (k) => k || 'No route set'),
    [rows, routeByEmployee]
  );
  const byCab = useMemo(
    () =>
      breakdown(
        rows,
        (b) => b.assignedCabId || '',
        (k) => (k ? getCabById(k)?.cabNumber || 'Cab removed' : 'No cab assigned')
      ),
    [rows, getCabById]
  );
  // People, worst first — the point of this table is spotting the handful of
  // riders a cab keeps being sent to for nothing.
  const byEmployee = useMemo(() => {
    const all = breakdown(rows, (b) => b.employeeId || '', (k) => k);
    const named = new Map();
    rows.forEach((b) => {
      if (b.employeeId && !named.has(b.employeeId)) named.set(b.employeeId, b.employeeName || b.empId || '—');
    });
    return all
      .map((r) => ({ ...r, label: named.get(r.key) || '—' }))
      .filter((r) => r.noShow > 0)
      .sort((a, b) => b.noShow - a.noShow)
      .slice(0, 10);
  }, [rows]);

  // The window is real and worth saying out loud: HR's subscription fetches 180
  // days, so a range reaching past that would silently under-report rather than
  // fail. Better to name the edge than to hand someone a confident wrong total.
  const oldestLoaded = shiftDateKey(today, -ADMIN_HISTORY_DAYS);
  const beyondWindow = !!range && range.start < oldestLoaded;

  function onExport() {
    try {
      const name = downloadRideReport(rows, range, {
        cabOf: (id) => (id ? getCabById(id) : null),
        routeOf,
      });
      setNote(`Downloaded ${name}`);
    } catch (e) {
      setNote(e?.message || 'Could not build the spreadsheet.');
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.col}>
          <Text variant="bodySmall" style={styles.intro}>
            Everything the cabs actually ran, over a period. Cancelled rides are
            counted separately — nobody travelled — so "Rides run" is the figure to
            plan on.
          </Text>

          <SegmentedButtons
            value={QUICK.includes(period) ? period : ''}
            onValueChange={(v) => {
              setCustom(null);
              setPeriod(v);
            }}
            style={styles.periods}
            buttons={QUICK.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
          />

          <View style={styles.rangeRow}>
            <CalendarFilter
              value={custom}
              onChange={(v) => {
                setCustom(v);
                setPeriod(v?.start ? PERIOD.CUSTOM : PERIOD.THIS_MONTH);
              }}
            />
            <Text variant="bodySmall" style={styles.rangeText} numberOfLines={1}>
              {rangeLabel(range) || 'Pick a period'}
            </Text>
          </View>

          {beyondWindow ? (
            <View style={styles.warn}>
              <MaterialCommunityIcons name="alert-outline" size={16} color={colors.warning} />
              <Text variant="bodySmall" style={styles.warnText}>
                Only the last {ADMIN_HISTORY_DAYS} days are loaded (back to{' '}
                {prettyDateKey(oldestLoaded)}). Anything before that is not counted here.
              </Text>
            </View>
          ) : null}

          <Card style={styles.card} mode="elevated">
            <Card.Content>
              <View style={styles.stats}>
                <Stat label="Rides run" value={stats.ran} tone={colors.primary} />
                <Stat label="Completed" value={stats.completed} tone={colors.success} />
                <Stat
                  label="No-shows"
                  value={stats.noShow}
                  tone={stats.noShow ? colors.danger : colors.text}
                />
                <Stat label="Cancelled" value={stats.cancelled} tone={colors.muted} />
              </View>
              <Divider style={styles.divider} />
              <View style={styles.stats}>
                <Stat label="Pickups" value={stats.inbound} />
                <Stat label="Drops" value={stats.outbound} />
                <Stat
                  label="No cab given"
                  value={stats.unassigned}
                  tone={stats.unassigned ? colors.warning : colors.text}
                />
                <Stat label="Rows total" value={stats.total} hint="incl. cancelled" />
              </View>

              {Platform.OS === 'web' ? (
                <Button
                  mode="contained"
                  icon="file-excel"
                  style={styles.exportBtn}
                  contentStyle={styles.exportContent}
                  disabled={!rows.length}
                  onPress={onExport}
                >
                  Download {rows.length} row{rows.length === 1 ? '' : 's'} as Excel
                </Button>
              ) : (
                // Same limit the roster template download already has: the
                // spreadsheet is written by triggering a browser download, which
                // a phone has nowhere to put. HR works from a desk.
                <Text variant="bodySmall" style={styles.exportNote}>
                  Open this on a computer to download the spreadsheet.
                </Text>
              )}
            </Card.Content>
          </Card>

          <Table
            title="By route"
            icon="map-marker-path"
            nameHeader="ROUTE"
            rows={byRoute}
            emptyText="No rides in this period."
          />
          <Table
            title="By cab"
            icon="car-multiple"
            nameHeader="CAB"
            rows={byCab}
            emptyText="No rides in this period."
          />
          <Table
            title="Most no-shows"
            icon="account-alert"
            nameHeader="EMPLOYEE"
            rows={byEmployee}
            emptyText="Nobody was marked absent in this period."
          />
        </View>
      </ScrollView>

      <Snackbar visible={!!note} onDismiss={() => setNote('')} duration={4000}>
        {note}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, alignItems: 'center' },
  col: { width: '100%', maxWidth: 900 },
  intro: { color: colors.muted, lineHeight: 20, marginBottom: spacing.lg },
  periods: { marginBottom: spacing.md },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    flexWrap: 'wrap',
  },
  rangeText: { color: colors.textSecondary, flexShrink: 1 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  warnText: { color: colors.warning, flex: 1, lineHeight: 18 },

  card: {
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  stat: { flexGrow: 1, flexBasis: 120, alignItems: 'center' },
  statValue: { fontFamily: font.bold, fontSize: 30, lineHeight: 38 },
  statLabel: { color: colors.muted, letterSpacing: 0.3 },
  statHint: { color: colors.disabled, fontSize: 11 },
  exportBtn: { marginTop: spacing.lg, borderRadius: radius.md, ...shadow.brand },
  exportContent: { paddingVertical: 6 },
  exportNote: { color: colors.muted, marginTop: spacing.lg, textAlign: 'center' },

  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tableTitle: { color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  headCell: { color: colors.muted, letterSpacing: 0.6 },
  colName: { flex: 1, minWidth: 0, color: colors.text },
  colNum: { width: 76, textAlign: 'right', color: colors.textSecondary },
  colNumBad: { color: colors.danger, fontFamily: font.semibold },
  divider: { backgroundColor: colors.border, marginVertical: spacing.sm },
  empty: { color: colors.muted, paddingVertical: spacing.md },
});
