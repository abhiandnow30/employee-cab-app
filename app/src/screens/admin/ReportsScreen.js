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
import TrendChart from '../../components/TrendChart';
import {
  PERIOD, PERIOD_LABEL, periodRange, rangeLabel, bookingsInRange,
  summarise, breakdown, downloadRideReport,
  dailySeries, seriesStats, SERIES_METRIC, SERIES_METRIC_LABEL,
} from '../../services/reports';

// Which figure the Overview line plots. Kept to the four worth a trend: the
// others (Pickups, Drops, Rows total) either mirror one of these or are a
// property of the shift policy rather than of how the month went.
const SERIES_CHOICES = [
  SERIES_METRIC.RAN,
  SERIES_METRIC.COMPLETED,
  SERIES_METRIC.NO_SHOW,
  SERIES_METRIC.CANCELLED,
];

// The line takes the colour of what it plots, so switching the metric re-tints
// the whole card and there is never a red no-show line drawn in brand blue.
const SERIES_TONE = {
  [SERIES_METRIC.RAN]: colors.primary,
  [SERIES_METRIC.COMPLETED]: colors.success,
  [SERIES_METRIC.NO_SHOW]: colors.danger,
  [SERIES_METRIC.CANCELLED]: colors.muted,
};

// The four the desk actually asks for. "Last 30 days" and a custom range live
// behind the date picker rather than adding two more segments to a control that
// has to stay readable on a laptop.
const QUICK = [PERIOD.THIS_WEEK, PERIOD.LAST_WEEK, PERIOD.THIS_MONTH, PERIOD.LAST_MONTH];

// One headline number, as its own card. `tone` carries the meaning — a no-show
// count is not good news at 12 the way a completed count is — and the icon
// repeats it in a second channel, so the card is still readable to someone who
// cannot separate the reds from the greens.
//
// `hint` is a plain-English gloss under the label rather than a tooltip. Every
// number on this page has been misread at least once (see the Rides run note in
// services/reports.js); a caption that is always visible is worth more than one
// that has to be hunted for, and it costs a line of text.
function Stat({ label, value, tone = colors.text, hint, icon, soft }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        {icon ? (
          <View style={[styles.statIcon, { backgroundColor: soft || colors.primarySofter }]}>
            <MaterialCommunityIcons name={icon} size={19} color={tone} />
          </View>
        ) : null}
        <View style={styles.statText}>
          <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
          <Text variant="bodySmall" style={styles.statLabel} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
      {hint ? (
        <Text variant="bodySmall" style={styles.statHint} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// The three numbers under the chart: the busiest day, the quietest, and what a
// normal one looks like. They are what turn a line into a decision — a peak of
// 46 against an average of 28 is the case for another cab; the same 43 rides
// spread evenly is not.
function Peak({ label, value, sub, tone }) {
  return (
    <View style={[styles.peak, { borderColor: tone }]}>
      <Text variant="labelSmall" style={[styles.peakLabel, { color: tone }]}>
        {label}
      </Text>
      <Text style={styles.peakValue}>{value}</Text>
      <Text variant="bodySmall" style={styles.peakSub} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

// A breakdown table. Same shape whichever way the rides are split, so the eye
// learns it once.
//
// `limit` collapses a long list to its busiest few with a link to the rest.
// Routes are the case that needs it: a dozen of them push the chart beside this
// card off the fold, and the tail is a row of zeroes nobody scrolls for. The
// count in the link is the number HIDDEN, not the total — "+5 more routes"
// answers "is it worth expanding" where "11 routes" does not.
function Table({ title, icon, rows, emptyText, nameHeader, limit }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = limit && !expanded ? Math.max(0, rows.length - limit) : 0;
  const shown = hidden ? rows.slice(0, limit) : rows;

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
          {/* Cancelled per row, which the tiles only give as one total. It is
              how a route with a standing problem shows itself — one route
              carrying most of the month's cancellations is a conversation, the
              same number spread evenly is not. */}
          <Text variant="labelSmall" style={[styles.colNum, styles.headCell]}>
            CANCELLED
          </Text>
        </View>
        <Divider style={styles.divider} />
        {shown.length ? (
          shown.map((r) => (
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
              <Text
                variant="bodyMedium"
                style={[styles.colNum, r.cancelled ? styles.colNumMuted : null]}
              >
                {r.cancelled}
              </Text>
            </View>
          ))
        ) : (
          <Text variant="bodySmall" style={styles.empty}>
            {emptyText}
          </Text>
        )}
        {hidden || expanded ? (
          <Button
            mode="text"
            compact
            style={styles.moreBtn}
            contentStyle={styles.moreContent}
            onPress={() => setExpanded((v) => !v)}
          >
            {hidden ? `+ ${hidden} more` : 'Show fewer'}
          </Button>
        ) : null}
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
  // `today` is threaded in rather than left to the default so every figure on
  // the page splits "no outcome yet" from "no outcome and the day has gone"
  // against one clock — see summarise().
  const stats = useMemo(() => summarise(rows, today), [rows, today]);

  const byRoute = useMemo(
    () => breakdown(rows, routeOf, (k) => k || 'No route set', today),
    [rows, routeByEmployee, today]
  );
  const byCab = useMemo(
    () =>
      breakdown(
        rows,
        (b) => b.assignedCabId || '',
        (k) => (k ? getCabById(k)?.cabNumber || 'Cab removed' : 'No cab assigned'),
        today
      ),
    [rows, getCabById, today]
  );
  // People, worst first — the point of this table is spotting the handful of
  // riders a cab keeps being sent to for nothing.
  // The Overview line. `metric` is local to the card — changing it re-plots and
  // touches nothing else on the page, which is what makes it safe to flip
  // between while reading.
  const [metric, setMetric] = useState(SERIES_METRIC.RAN);
  const series = useMemo(
    () => dailySeries(rows, range, metric, today),
    [rows, range, metric, today]
  );
  const peaks = useMemo(() => seriesStats(series), [series]);

  const byEmployee = useMemo(() => {
    const all = breakdown(rows, (b) => b.employeeId || '', (k) => k, today);
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
            What the cabs were scheduled to run, over a period. &ldquo;Rides
            run&rdquo; is every ride that wasn&rsquo;t cancelled — the figure to plan
            capacity on. It is not the same as rides anyone confirmed: only
            Completed and No-shows have a recorded outcome, and
            &ldquo;Unconfirmed&rdquo; counts the ones whose day has passed with no
            outcome at all, usually a driver who never closed the trip out.
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
              {/* Rides run, then the three things it is made of. The hint under
                  the headline is load-bearing: "Rides run" on its own reads as
                  "rides that happened", and it means "not cancelled" — see
                  summarise(). Unconfirmed is the one to act on, so it is amber
                  and sits beside the outcomes it is missing from. */}
              <View style={styles.stats}>
                <Stat
                  label="Rides run"
                  value={stats.ran}
                  tone={colors.primary}
                  soft={colors.primarySofter}
                  icon="car-multiple"
                  hint="Scheduled and not cancelled"
                />
                <Stat
                  label="Completed"
                  value={stats.completed}
                  tone={colors.success}
                  soft={colors.successSoft}
                  icon="check-circle-outline"
                  hint="Driver confirmed the trip"
                />
                <Stat
                  label="No-shows"
                  value={stats.noShow}
                  tone={stats.noShow ? colors.danger : colors.text}
                  soft={colors.dangerSoft}
                  icon="account-alert-outline"
                  hint="Cab went, nobody there"
                />
                <Stat
                  label="Unconfirmed"
                  value={stats.unconfirmed}
                  tone={stats.unconfirmed ? colors.warning : colors.text}
                  soft={colors.warningSoft}
                  icon="progress-question"
                  hint="Day passed, no outcome recorded"
                />
              </View>
              <Divider style={styles.divider} />
              <View style={styles.stats}>
                <Stat
                  label="Cancelled"
                  value={stats.cancelled}
                  tone={colors.muted}
                  soft={colors.surfaceAlt}
                  icon="close-circle-outline"
                  hint="Nobody travelled"
                />
                <Stat
                  label="Pickups"
                  value={stats.inbound}
                  tone={colors.info}
                  soft={colors.infoSoft}
                  icon="home-export-outline"
                  hint="Home to office"
                />
                <Stat
                  label="Drops"
                  value={stats.outbound}
                  tone={colors.info}
                  soft={colors.infoSoft}
                  icon="office-building-outline"
                  hint="Office to home"
                />
                <Stat
                  label="No cab given"
                  value={stats.unassigned}
                  tone={stats.unassigned ? colors.warning : colors.text}
                  soft={colors.warningSoft}
                  icon="car-off"
                  hint="Never assigned a vehicle"
                />
                {/* Only when there is something in it. On a finished period this
                    is always zero, and a permanent zero is a figure to explain
                    rather than one to read. */}
                {stats.upcoming ? (
                  <Stat
                    label="Still to come"
                    value={stats.upcoming}
                    tone={colors.text}
                    soft={colors.primarySofter}
                    icon="clock-outline"
                    hint="Not due yet"
                  />
                ) : null}
                <Stat
                  label="Rows total"
                  value={stats.total}
                  tone={colors.text}
                  soft={colors.primarySofter}
                  icon="table"
                  hint="Including cancelled"
                />
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

          {/* OVERVIEW AND BY ROUTE SHARE A ROW ON A WIDE SCREEN. They answer the
              same question from two directions — "when was it busy" and "where"
              — and reading one usually prompts the other. `chartRow` wraps, so on
              a narrow window they stack and each takes the full width rather
              than squeezing into two unreadable halves. */}
          <View style={styles.chartRow}>
            <Card style={[styles.card, styles.chartCard]} mode="elevated">
              <Card.Content>
                <View style={styles.chartHead}>
                  <View style={styles.tableHead}>
                    <MaterialCommunityIcons
                      name="chart-line"
                      size={18}
                      color={colors.primary}
                    />
                    <Text variant="titleMedium" style={styles.tableTitle}>
                      Overview
                    </Text>
                  </View>
                  {/* Plain segmented text rather than a dropdown: four options
                      that fit, and one tap to compare instead of two. */}
                  <View style={styles.metricRow}>
                    {SERIES_CHOICES.map((m) => (
                      <Button
                        key={m}
                        mode="text"
                        compact
                        onPress={() => setMetric(m)}
                        labelStyle={[
                          styles.metricLabel,
                          metric === m ? { color: SERIES_TONE[m] } : styles.metricIdle,
                        ]}
                      >
                        {SERIES_METRIC_LABEL[m]}
                      </Button>
                    ))}
                  </View>
                </View>

                <TrendChart
                  series={series}
                  label={SERIES_METRIC_LABEL[metric]}
                  tone={SERIES_TONE[metric] || colors.primary}
                />

                {/* Only with a real spread to describe. On a single day, or a
                    period with nothing in it, "highest 0 on 27 Aug" is noise. */}
                {series.length > 1 ? (
                  <View style={styles.peaks}>
                    <Peak
                      label="Highest"
                      tone={colors.success}
                      value={peaks.peak?.value ?? 0}
                      sub={peaks.peak ? `on ${prettyDateKey(peaks.peak.date)}` : '—'}
                    />
                    <Peak
                      label="Lowest"
                      tone={colors.danger}
                      value={peaks.low?.value ?? 0}
                      sub={peaks.low ? `on ${prettyDateKey(peaks.low.date)}` : '—'}
                    />
                    <Peak
                      label="Daily avg."
                      tone={colors.primary}
                      value={peaks.average}
                      sub={`over ${series.length} day${series.length === 1 ? '' : 's'}`}
                    />
                  </View>
                ) : null}
              </Card.Content>
            </Card>

            <View style={styles.routeCard}>
              <Table
                title="By route"
                icon="map-marker-path"
                nameHeader="ROUTE"
                rows={byRoute}
                limit={7}
                emptyText="No rides in this period."
              />
            </View>
          </View>
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
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, gap: spacing.md },
  // flexBasis 190 rather than 120: each tile now carries an icon, a number, a
  // label and a caption, and below about 180 the caption wraps to three lines and
  // the row loses its rhythm. Four per row on a laptop, two on a tablet, one on a
  // phone — all from flexWrap, no breakpoints.
  stat: {
    flexGrow: 1,
    flexBasis: 190,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statText: { flex: 1, minWidth: 0 },
  statValue: { fontFamily: font.bold, fontSize: 26, lineHeight: 32 },
  statLabel: { color: colors.muted, letterSpacing: 0.3 },
  statHint: { color: colors.disabled, fontSize: 11, marginTop: spacing.xs, lineHeight: 15 },

  // --- Overview chart -------------------------------------------------------
  chartRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  // flexBasis 420 is the narrowest the chart stays readable at; below that the
  // two cards stack instead of splitting the row.
  chartCard: { flexGrow: 3, flexBasis: 420, marginBottom: 0 },
  routeCard: { flexGrow: 2, flexBasis: 340 },
  chartHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap' },
  metricLabel: { fontSize: 12, marginHorizontal: spacing.xs },
  metricIdle: { color: colors.muted },
  peaks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg },
  peak: {
    flexGrow: 1,
    flexBasis: 110,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  peakLabel: { fontFamily: font.semibold, letterSpacing: 0.3 },
  peakValue: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, color: colors.text },
  peakSub: { color: colors.muted, fontSize: 11 },
  moreBtn: { alignSelf: 'flex-start', marginTop: spacing.xs },
  moreContent: { paddingHorizontal: 0 },
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
  // Cancellations are grey, not red. A route with cancellations is information;
  // a route with no-shows is a problem. Colouring both alike would flatten the
  // difference the two columns exist to show.
  colNumMuted: { color: colors.muted, fontFamily: font.semibold },
  divider: { backgroundColor: colors.border, marginVertical: spacing.sm },
  empty: { color: colors.muted, paddingVertical: spacing.md },
});
