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
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Text, Card, Button, Divider, Portal, Dialog, TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { colors, font, radius, shadow, spacing, statusColors } from '../../theme';
import { STATUS } from '../../data/mockData';
import { ADMIN_HISTORY_DAYS } from '../../services/bookings';
import { todayKey, shiftDateKey, prettyDateKey } from '../../utils/datetime';
import CalendarFilter from '../../components/CalendarFilter';
import {
  PERIOD, periodRange, rangeLabel, bookingsInRange, summarise, breakdown,
} from '../../services/reports';


// Hex → rgba string at a given alpha. Every status already has exactly ONE
// color, in statusColors (theme.js) — this is what turns that single hex into
// its own soft pill background, so a status never needs a second, hand-picked
// "soft" token kept in sync with the first by hand.
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// "Bhuvana Kruthi" → "BK". First letter of the first two words.
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Firestore Timestamp → "24-Jul, 02:15 PM" — the exact moment a no-show was
// flagged, distinct from the ride's own date (already shown next to it).
function formatFlaggedAt(ts) {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS_SHORT[d.getMonth()];
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}, ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

// One status pill, reused everywhere a booking status is shown in this screen's
// dialogs. Tone comes from statusColors — the SAME source the rest of the app
// uses for a status — so a status is never a different color here than it is
// on, say, the driver's own trip screen. The dot is the non-color reinforcement
// "status colors ship with icon + label" asks for; the word is the label.
function StatusPill({ status }) {
  const tone = statusColors[status] || colors.muted;
  return (
    <View style={[styles.statusPill, { backgroundColor: hexToRgba(tone, 0.12) }]}>
      <View style={[styles.statusDot, { backgroundColor: tone }]} />
      <Text style={[styles.statusPillText, { color: tone }]} numberOfLines={1}>
        {status || '—'}
      </Text>
    </View>
  );
}

// A rider's initials in a plain, consistent chip. Deliberately the SAME tint for
// every person — there's nothing here that needs comparing between riders by
// color, so this is decoration, not a categorical encoding, and stays out of the
// "assign hues in fixed order" rule that real identity color needs.
function Avatar({ name }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials(name)}</Text>
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
// `onRowPress(row)`, `extraColumn` and `hint` are all optional and all used only
// by "By cab" today: tapping opens the trip drill-down, `extraColumn` inserts
// one more numeric column (its own EMPLOYEES, currently) between the name and
// RIDES, and `hint` explains what RIDES counts for THIS table. That's needed
// because RIDES does not mean the same thing in every Table on the page: By
// cab and By route both count TRIPS (one per departure, however many people
// shared it), because both group people into shared cabs and a leg count would
// over-count exactly the same way in both — see the byRoute/byCab comments in
// ReportsScreen for the full reasoning.
// `countNoun` names one row for the header badge ("7 routes", "5 cabs") —
// purely cosmetic, so it's optional.
function Table({
  title, icon, rows, emptyText, nameHeader, limit, onRowPress, extraColumn, hint,
  countNoun, searchable, searchPlaceholder,
}) {
  const [expanded, setExpanded] = useState(false);
  const [term, setTerm] = useState('');
  const filtered = searchable && term.trim()
    ? rows.filter((r) => String(r.label || '').toLowerCase().includes(term.trim().toLowerCase()))
    : rows;
  const hidden = limit && !expanded ? Math.max(0, filtered.length - limit) : 0;
  const shown = hidden ? filtered.slice(0, limit) : filtered;

  // A nonzero NO-SHOW/CANCELLED count is a pill (soft tint + icon + number); a
  // zero stays a quiet, uncolored digit. Reserving color for "something actually
  // happened" is what stops seven columns of flat zeros reading as seven
  // problems — the eye should land on the pills, not scan every cell.
  function StatCell({ value, tone, soft, icon }) {
    if (!value) {
      return (
        <View style={styles.colNumCell}>
          <Text style={styles.colNumZero}>0</Text>
        </View>
      );
    }
    return (
      <View style={styles.colNumCell}>
        <View style={[styles.statPill, { backgroundColor: soft }]}>
          <MaterialCommunityIcons name={icon} size={11} color={tone} />
          <Text style={[styles.statPillText, { color: tone }]}>{value}</Text>
        </View>
      </View>
    );
  }

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <View style={styles.tableHead}>
          <View style={styles.tableIconChip}>
            <MaterialCommunityIcons name={icon} size={17} color={colors.primary} />
          </View>
          <Text variant="titleMedium" style={styles.tableTitle}>
            {title}
          </Text>
          {countNoun ? (
            <View style={styles.tableCountBadge}>
              <Text style={styles.tableCountBadgeText}>
                {rows.length} {countNoun}
                {rows.length === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
        </View>
        {hint ? (
          <Text variant="bodySmall" style={styles.tableHint}>
            {hint}
          </Text>
        ) : null}
        {searchable ? (
          <TextInput
            mode="outlined"
            dense
            placeholder={searchPlaceholder || 'Search'}
            value={term}
            onChangeText={setTerm}
            left={<TextInput.Icon icon="magnify" />}
            style={styles.searchInput}
          />
        ) : null}
        <View style={styles.headRow}>
          <Text variant="labelSmall" style={[styles.colName, styles.headCell]}>
            {nameHeader}
          </Text>
          {extraColumn ? (
            <Text variant="labelSmall" style={[styles.colNum, styles.headCell]}>
              {extraColumn.header}
            </Text>
          ) : null}
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
          {onRowPress ? <View style={styles.chevronSpacer} /> : null}
        </View>
        <Divider style={styles.divider} />
        {shown.length ? (
          shown.map((r) => {
            const cells = (
              <>
                <Text variant="bodyMedium" style={[styles.colName, styles.rowLabel]} numberOfLines={1}>
                  {r.label || '—'}
                </Text>
                {extraColumn ? (
                  <Text variant="bodyMedium" style={styles.colNum}>
                    {extraColumn.valueOf(r)}
                  </Text>
                ) : null}
                <Text variant="bodyMedium" style={[styles.colNum, styles.colNumStrong]}>
                  {r.ran}
                </Text>
                <Text variant="bodyMedium" style={styles.colNum}>
                  {r.completed}
                </Text>
                <StatCell
                  value={r.noShow}
                  tone={colors.danger}
                  soft={colors.dangerSoft}
                  icon="alert-circle"
                />
                <StatCell
                  value={r.cancelled}
                  tone={colors.textSecondary}
                  soft={colors.surfaceAlt}
                  icon="close-circle"
                />
                {onRowPress ? (
                  <View style={styles.chevronChip}>
                    <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
                  </View>
                ) : null}
              </>
            );
            // View can't take a function `style`, so the two cases stay separate
            // rather than sharing one element with a conditionally-functional style.
            return onRowPress ? (
              <Pressable
                key={r.key || '—'}
                onPress={() => onRowPress(r)}
                style={({ hovered, pressed }) => [
                  styles.row,
                  styles.rowPressable,
                  hovered && styles.rowHovered,
                  pressed && styles.rowPressed,
                ]}
              >
                {({ hovered, pressed }) => (
                  <>
                    <View style={[styles.rowAccent, (hovered || pressed) && styles.rowAccentActive]} />
                    {cells}
                  </>
                )}
              </Pressable>
            ) : (
              <View key={r.key || '—'} style={styles.row}>
                {cells}
              </View>
            );
          })
        ) : (
          <Text variant="bodySmall" style={styles.empty}>
            {searchable && term.trim() ? `No match for "${term.trim()}".` : emptyText}
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

  // Raw rides per route, for both the RIDES count below and the "By route"
  // drill-down — same reason ridesByCab exists: breakdown() only keeps
  // summarised counts, not the bookings themselves.
  //
  // ACTUAL ROUTES ONLY. A ride nobody has routed yet isn't a route to report
  // on — same call as excluding "No cab assigned" from By cab. Those rides are
  // still counted in By cab; this table's own total will be
  // smaller as a result, which is the correct trade for not showing a row
  // nobody can act on. An unrouted rider is a real defect worth fixing at the
  // source (Employee Management / roster upload), not something this report
  // should paper over with a permanent, growing "No route set" line.
  const rowsByRoute = useMemo(() => {
    const m = new Map();
    rows.forEach((b) => {
      const key = routeOf(b);
      if (!key) return;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(b);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, routeByEmployee]);

  // A TRIP here is the same idea as tripsOf() for a cab — one departure, everyone
  // on it together — but a ROUTE can be served by several different cabs (a big
  // route might need two on a given day), so the cab has to be PART of the key,
  // unlike tripsOf() which can leave it out because it's already scoped to one
  // vehicle. Riders with no cab yet, or whose cab has since been deleted, still
  // get their own trip entry here — a route isn't identified by a cab the way
  // "By cab" is, so there's no reason to hide them the way byCab does.
  function tripsOfRoute(routeKey) {
    const byRun = new Map();
    (rowsByRoute.get(routeKey) || []).forEach((b) => {
      const runKey = `${b.date}|${b.shift || ''}|${b.direction || ''}|${b.assignedCabId || 'none'}`;
      if (!byRun.has(runKey)) {
        byRun.set(runKey, {
          key: runKey,
          date: b.date,
          shift: b.shift || '',
          direction: b.direction || '',
          cabId: b.assignedCabId || null,
          riders: [],
        });
      }
      byRun.get(runKey).riders.push(b);
    });
    return [...byRun.values()].sort(
      (a, b) => String(b.date).localeCompare(String(a.date)) || a.direction.localeCompare(b.direction)
    );
  }

  // RIDES means the same thing here as in "By cab": TRIPS, not passenger-legs —
  // a route's whole point is grouping people into shared cabs, so a route
  // carpool of 4 sharing one departure is exactly the same case as a cab's
  // carpool, and counting it as 4 "rides" was the identical over-count. DONE /
  // NO-SHOW / CANCELLED stay per-employee, for the same reason they do in
  // byCab: an outcome only has a clean meaning per person, not per trip.
  const byRoute = useMemo(() => {
    return [...rowsByRoute.keys()]
      .map((key) => {
        const routeRows = rowsByRoute.get(key);
        const outcomes = summarise(routeRows, today);
        return {
          key,
          label: key, // never '' — rowsByRoute already excludes the unrouted
          ...outcomes,
          ran: tripsOfRoute(key).length,
        };
      })
      .sort((a, b) => b.ran - a.ran || String(a.label).localeCompare(String(b.label)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsByRoute, today]);

  const [selectedRoute, setSelectedRoute] = useState(null); // { routeKey, label } | null

  // Raw rides per employee, for the "Most no-shows" table and its drill-down —
  // same reason ridesByCab/rowsByRoute exist by hand rather than through
  // breakdown(): the table needs the bookings themselves, not just the counts.
  // Keyed the same way ridersOf() dedupes a rider on the cab dialog, so a
  // self-provisioned employee with no profile id still gets one row.
  const rowsByEmployee = useMemo(() => {
    const m = new Map();
    rows.forEach((b) => {
      const key = b.employeeId || `name:${(b.employeeName || '').toLowerCase()}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(b);
    });
    return m;
  }, [rows]);

  // NOT capped, unlike the tables above — this is the one place the desk goes
  // looking for a SPECIFIC name, and a hidden tail would defeat that. Worst
  // first, so a repeat offender is the first thing seen rather than something
  // found by scrolling.
  const byEmployee = useMemo(() => {
    return [...rowsByEmployee.keys()]
      .map((key) => {
        const empRows = rowsByEmployee.get(key);
        return {
          key,
          label: empRows[0]?.employeeName || '—',
          ...summarise(empRows, today),
        };
      })
      .filter((r) => r.noShow > 0)
      .sort((a, b) => b.noShow - a.noShow || String(a.label).localeCompare(String(b.label)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsByEmployee, today]);

  const [selectedEmployee, setSelectedEmployee] = useState(null); // { employeeId, label } | null

  // Every no-show THIS employee actually has in the period, newest flagged
  // first — the drill-down behind clicking their row.
  function noShowsOf(employeeKey) {
    return (rowsByEmployee.get(employeeKey) || [])
      .filter((b) => b.status === STATUS.NO_SHOW)
      .sort((a, b) => (b.noShowAt?.toMillis?.() || 0) - (a.noShowAt?.toMillis?.() || 0));
  }

  // CURRENT FLEET ONLY. Two kinds of row are excluded on purpose, and neither
  // exclusion hides the rides from the report as a whole — only from this one
  // table, which exists to answer "how is each of our cabs doing":
  //   • no assignedCabId at all — nobody has sent a cab yet, so there's no
  //     vehicle to report on;
  //   • assignedCabId pointing at a cab that has since been deleted — the
  //     booking keeps only the id, never the number or driver, so there is
  //     nothing left to show beyond a bare "Cab removed" placeholder. Several
  //     different deleted cabs would each render that identical label, reading
  //     as duplicate rows rather than distinct (gone) vehicles.
  // Those rides are still counted in the tables above (By route counts them;
  // this table's own total will be smaller than that as a result) — the
  // correct trade for not showing a row nobody can act on.
  // Raw rides per cab, for both the RIDES count below and the drill-down when a
  // row in "By cab" is tapped. breakdown() only keeps summarised counts, not the
  // bookings themselves, so this table is built by hand instead of through it.
  const ridesByCab = useMemo(() => {
    const m = new Map();
    rows.forEach((b) => {
      if (!b.assignedCabId || !getCabById(b.assignedCabId)) return; // current fleet only — see byCab below
      if (!m.has(b.assignedCabId)) m.set(b.assignedCabId, []);
      m.get(b.assignedCabId).push(b);
    });
    return m;
  }, [rows, getCabById]);

  // A TRIP is one cab's one departure — everyone travelling together on the same
  // date, shift and direction. Same grouping driverRun.js uses for "the current
  // run" on the driver's own screen, reused here because it's the same real-world
  // thing: a carpool of 4 sharing a cab is one trip, not four.
  //
  // Newest first, so investigating a specific cab starts with its most recent
  // activity rather than scrolling from whenever the range began.
  function tripsOf(cabId) {
    const byRun = new Map();
    (ridesByCab.get(cabId) || []).forEach((b) => {
      const runKey = `${b.date}|${b.shift || ''}|${b.direction || ''}`;
      if (!byRun.has(runKey)) {
        byRun.set(runKey, { key: runKey, date: b.date, shift: b.shift || '', direction: b.direction || '', riders: [] });
      }
      byRun.get(runKey).riders.push(b);
    });
    return [...byRun.values()].sort(
      (a, b) => String(b.date).localeCompare(String(a.date)) || a.direction.localeCompare(b.direction)
    );
  }

  // One row per employee who rode a given cab in this period, most-frequent
  // first — the question being asked is "who is this cab's regular carpool".
  function ridersOf(cabId) {
    const byEmployee = new Map();
    (ridesByCab.get(cabId) || []).forEach((b) => {
      const key = b.employeeId || `name:${(b.employeeName || '').toLowerCase()}`;
      if (!byEmployee.has(key)) {
        byEmployee.set(key, { key, name: b.employeeName || '—', empId: b.empId || '', rides: 0, noShows: 0 });
      }
      const r = byEmployee.get(key);
      r.rides += 1;
      if (b.status === 'No show') r.noShows += 1;
    });
    return [...byEmployee.values()].sort(
      (a, b) => b.rides - a.rides || a.name.localeCompare(b.name)
    );
  }

  // RIDES here means TRIPS — how many times this cab actually went out — not how
  // many people were on board. A carpool of 4 sharing one cab for one departure
  // is 1 toward this number, same as a cab carrying 1 person alone; a cab that
  // goes out twice in a day (a morning pickup and an evening drop) is 2.
  //
  // DONE / NO-SHOW / CANCELLED stay PER EMPLOYEE, unchanged from summarise() —
  // "2 no-shows" means two people didn't show, which stays true and unambiguous
  // even when a trip carried several people with different outcomes. Redefining
  // those to be per-trip would need an answer to "was a trip with 2 completed
  // riders and 1 no-show a no-show?", which has no single right answer — so
  // outcomes are left as headcounts and only the trip count changes meaning.
  const byCab = useMemo(() => {
    return [...ridesByCab.keys()]
      .map((cabId) => {
        const cabRows = ridesByCab.get(cabId);
        const outcomes = summarise(cabRows, today);
        return {
          key: cabId,
          label: getCabById(cabId)?.cabNumber || '',
          ...outcomes,
          ran: tripsOf(cabId).length, // overrides summarise()'s leg count with the trip count
        };
      })
      .sort((a, b) => b.ran - a.ran || String(a.label).localeCompare(String(b.label)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ridesByCab, today, getCabById]);

  const [selectedCab, setSelectedCab] = useState(null); // { cabId, label } | null

  // The window is real and worth saying out loud: HR's subscription fetches 180
  // days, so a range reaching past that would silently under-report rather than
  // fail. Better to name the edge than to hand someone a confident wrong total.
  const oldestLoaded = shiftDateKey(today, -ADMIN_HISTORY_DAYS);
  const beyondWindow = !!range && range.start < oldestLoaded;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.col}>
          <Text variant="bodySmall" style={styles.intro}>
            How the cabs ran, over a period — by route, by cab, and who kept
            getting missed.
          </Text>

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

          <Table
            title="By cab"
            icon="car-multiple"
            nameHeader="CAB"
            rows={byCab}
            countNoun="cab"
            emptyText="No rides in this period."
            hint="RIDES is how many separate trips each cab made — a carpool of several people sharing one trip counts as 1. Tap a cab to see each trip and who was on it."
            onRowPress={(r) => setSelectedCab({ cabId: r.key, label: r.label })}
            extraColumn={{ header: 'EMPLOYEES', valueOf: (r) => ridersOf(r.key).length }}
          />
          <Table
            title="Most no-shows"
            icon="account-alert"
            nameHeader="EMPLOYEE"
            rows={byEmployee}
            limit={10}
            searchable
            searchPlaceholder="Search employee name"
            countNoun="person"
            emptyText="Nobody was marked absent in this period."
            onRowPress={(r) => setSelectedEmployee({ employeeId: r.key, label: r.label })}
          />
          <Table
            title="By route"
            icon="map-marker-path"
            nameHeader="ROUTE"
            rows={byRoute}
            limit={7}
            countNoun="route"
            emptyText="No rides in this period."
            hint="RIDES is how many separate trips this route needed — same as By cab, a carpool of several people sharing one trip counts as 1. Tap a route to see each trip and who was on it."
            onRowPress={(r) => setSelectedRoute({ routeKey: r.key, label: r.label })}
          />
        </View>
      </ScrollView>

      {/* Every TRIP on this route in the period — grouped by cab as well as by
          date/shift/direction, because unlike "By cab" a route can be served by
          more than one vehicle. A rider with no cab yet, or a since-deleted one,
          still gets a trip entry — see tripsOfRoute(). */}
      <Portal>
        <Dialog
          visible={!!selectedRoute}
          onDismiss={() => setSelectedRoute(null)}
          style={styles.cabDialog}
        >
          <Dialog.Title>{selectedRoute?.label || 'Route'}</Dialog.Title>
          <Dialog.ScrollArea style={styles.cabDialogArea}>
            <ScrollView contentContainerStyle={styles.cabDialogBody}>
              {(() => {
                if (!selectedRoute) return null;
                const trips = tripsOfRoute(selectedRoute.routeKey);
                if (!trips.length) {
                  return (
                    <Text variant="bodySmall" style={styles.empty}>
                      No rides recorded for this route in the selected period.
                    </Text>
                  );
                }
                return trips.map((trip, i) => {
                  const cab = trip.cabId ? getCabById(trip.cabId) : null;
                  const cabLabel = trip.cabId
                    ? cab?.cabNumber || 'Cab removed'
                    : 'No cab assigned';
                  return (
                    <View
                      key={trip.key}
                      style={[styles.tripBlock, i > 0 && styles.tripBlockSpaced]}
                    >
                      <View style={styles.tripAccent} />
                      <View style={styles.tripHead}>
                        <View style={styles.tripHeadText}>
                          <Text style={styles.tripEyebrow}>TRIP</Text>
                          <Text variant="bodyMedium" style={styles.tripDate}>
                            {prettyDateKey(trip.date)}
                          </Text>
                          <Text variant="bodySmall" style={styles.tripDirection}>
                            {trip.shift ? `${trip.shift} · ` : ''}
                            {trip.direction || 'Direction not recorded'}
                          </Text>
                          <View style={styles.tripCabRow}>
                            <MaterialCommunityIcons name="car" size={12} color={colors.textSecondary} />
                            <Text variant="bodySmall" style={styles.tripDirection}>
                              {cabLabel}
                              {cab?.driverName ? ` · ${cab.driverName}` : ''}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.tripCountChip}>
                          <Text variant="bodySmall" style={styles.tripCountChipText}>
                            {trip.riders.length} rider{trip.riders.length === 1 ? '' : 's'}
                          </Text>
                        </View>
                      </View>
                      {trip.riders.map((b) => (
                        <View key={b.id} style={styles.tripRiderRow}>
                          <Avatar name={b.employeeName} />
                          <View style={styles.colName}>
                            <Text variant="bodyMedium" numberOfLines={1}>
                              {b.employeeName || '—'}
                            </Text>
                            {b.empId ? (
                              <Text variant="bodySmall" style={styles.riderEmpId}>
                                {b.empId}
                              </Text>
                            ) : null}
                          </View>
                          <StatusPill status={b.status} />
                        </View>
                      ))}
                    </View>
                  );
                });
              })()}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setSelectedRoute(null)}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Every TRIP this cab made in the period — one section per departure,
          each listing exactly who was on it — plus who drove it. Rebuilt from
          ridesByCab on every open rather than stored anywhere; it's a view over
          rows already on screen, not a new question to answer. */}
      <Portal>
        <Dialog
          visible={!!selectedCab}
          onDismiss={() => setSelectedCab(null)}
          style={styles.cabDialog}
        >
          <Dialog.Title>{selectedCab?.label || 'Cab'}</Dialog.Title>
          <Dialog.ScrollArea style={styles.cabDialogArea}>
            <ScrollView contentContainerStyle={styles.cabDialogBody}>
              {(() => {
                if (!selectedCab) return null;
                const cab = getCabById(selectedCab.cabId);
                const trips = tripsOf(selectedCab.cabId);
                // How many times THIS cab carried each person in the period —
                // keyed the same way ridersOf() dedupes, so a rider showing up
                // in more than one trip section below can be flagged as a
                // repeat rather than left to be noticed by comparing sections
                // by eye. > 1 here is exactly the gap between the EMPLOYEES
                // column (unique people) and the sum of every trip's rider list
                // (unique people × how many trips each was actually on).
                const rideCountByEmployee = new Map(
                  ridersOf(selectedCab.cabId).map((r) => [r.key, r.rides])
                );
                return (
                  <>
                    <View style={styles.driverCard}>
                      <View style={styles.driverAvatar}>
                        <MaterialCommunityIcons
                          name="account-tie-hat"
                          size={20}
                          color={colors.primary}
                        />
                      </View>
                      <View style={styles.driverText}>
                        <Text variant="bodyMedium" style={styles.driverName}>
                          {cab?.driverName || 'No driver linked'}
                        </Text>
                        {cab?.driverPhone ? (
                          <Text variant="bodySmall" style={styles.driverPhone}>
                            {cab.driverPhone}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.driverTripsBadge}>
                        <Text style={styles.driverTripsBadgeText}>
                          {trips.length} trip{trips.length === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>
                    {trips.length ? (
                      trips.map((trip, i) => (
                        <View
                          key={trip.key}
                          style={[styles.tripBlock, i > 0 && styles.tripBlockSpaced]}
                        >
                          <View style={styles.tripAccent} />
                          <View style={styles.tripHead}>
                            <View style={styles.tripHeadText}>
                              <Text style={styles.tripEyebrow}>TRIP</Text>
                              <Text variant="bodyMedium" style={styles.tripDate}>
                                {prettyDateKey(trip.date)}
                              </Text>
                              <Text variant="bodySmall" style={styles.tripDirection}>
                                {trip.shift ? `${trip.shift} · ` : ''}
                                {trip.direction || 'Direction not recorded'}
                              </Text>
                            </View>
                            <View style={styles.tripCountChip}>
                              <Text variant="bodySmall" style={styles.tripCountChipText}>
                                {trip.riders.length} rider{trip.riders.length === 1 ? '' : 's'}
                              </Text>
                            </View>
                          </View>
                          {trip.riders.map((b) => {
                            const employeeKey = b.employeeId || `name:${(b.employeeName || '').toLowerCase()}`;
                            const totalRides = rideCountByEmployee.get(employeeKey) || 1;
                            return (
                              <View key={b.id} style={styles.tripRiderRow}>
                                <Avatar name={b.employeeName} />
                                <View style={styles.colName}>
                                  <View style={styles.riderNameRow}>
                                    <Text variant="bodyMedium" numberOfLines={1} style={styles.riderNameText}>
                                      {b.employeeName || '—'}
                                    </Text>
                                    {totalRides > 1 ? (
                                      <View style={styles.repeatBadge}>
                                        <MaterialCommunityIcons name="repeat" size={11} color={colors.warning} />
                                        <Text style={styles.repeatBadgeText}>
                                          on {totalRides} of this cab's trips
                                        </Text>
                                      </View>
                                    ) : null}
                                  </View>
                                  {b.empId ? (
                                    <Text variant="bodySmall" style={styles.riderEmpId}>
                                      {b.empId}
                                    </Text>
                                  ) : null}
                                </View>
                                <StatusPill status={b.status} />
                              </View>
                            );
                          })}
                        </View>
                      ))
                    ) : (
                      <Text variant="bodySmall" style={styles.empty}>
                        No trips recorded for this cab in the selected period.
                      </Text>
                    )}
                  </>
                );
              })()}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setSelectedCab(null)}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Every NO-SHOW this employee has in the period — one status, listed as a
          timeline, so no per-rider Avatar/StatusPill chrome is needed here the
          way the cab/route dialogs need it for a whole carpool. */}
      <Portal>
        <Dialog
          visible={!!selectedEmployee}
          onDismiss={() => setSelectedEmployee(null)}
          style={styles.cabDialog}
        >
          <Dialog.Title>{selectedEmployee?.label || 'Employee'}</Dialog.Title>
          <Dialog.ScrollArea style={styles.cabDialogArea}>
            <ScrollView contentContainerStyle={styles.cabDialogBody}>
              {(() => {
                if (!selectedEmployee) return null;
                const incidents = noShowsOf(selectedEmployee.employeeId);
                if (!incidents.length) {
                  return (
                    <Text variant="bodySmall" style={styles.empty}>
                      No no-shows recorded for this person in the selected period.
                    </Text>
                  );
                }
                return (
                  <>
                    <View style={styles.noShowCountBadge}>
                      <MaterialCommunityIcons name="alert-circle" size={13} color={colors.danger} />
                      <Text style={styles.noShowCountBadgeText}>
                        {incidents.length} no-show{incidents.length === 1 ? '' : 's'} in this period
                      </Text>
                    </View>
                    {incidents.map((b, i) => {
                      const cab = b.assignedCabId ? getCabById(b.assignedCabId) : null;
                      const cabLabel = b.assignedCabId
                        ? cab?.cabNumber || 'Cab removed'
                        : 'No cab assigned';
                      return (
                        <View
                          key={b.id}
                          style={[styles.tripBlock, i > 0 && styles.tripBlockSpaced]}
                        >
                          <View style={[styles.tripAccent, styles.tripAccentDanger]} />
                          <View style={styles.noShowDetail}>
                            <Text style={[styles.tripEyebrow, styles.tripEyebrowDanger]}>NO-SHOW</Text>
                            <Text variant="bodyMedium" style={styles.tripDate}>
                              {prettyDateKey(b.date)}
                            </Text>
                            <Text variant="bodySmall" style={styles.tripDirection}>
                              {b.shift ? `${b.shift} · ` : ''}
                              {b.direction || 'Direction not recorded'}
                            </Text>
                            {b.employeeAddress ? (
                              <Text variant="bodySmall" style={styles.tripDirection}>
                                {b.employeeAddress}
                              </Text>
                            ) : null}
                            <View style={styles.tripCabRow}>
                              <MaterialCommunityIcons name="car" size={12} color={colors.textSecondary} />
                              <Text variant="bodySmall" style={styles.tripDirection}>
                                {cabLabel}
                                {cab?.driverName ? ` · ${cab.driverName}` : ''}
                              </Text>
                            </View>
                            <View style={styles.noShowReasonBox}>
                              <Text style={styles.noShowReasonText}>
                                Employee wasn&apos;t at the pickup
                                {b.noShowAt ? ` · flagged ${formatFlaggedAt(b.noShowAt)}` : ''}
                              </Text>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </>
                );
              })()}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setSelectedEmployee(null)}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, alignItems: 'center' },
  col: { width: '100%', maxWidth: 900 },
  intro: { color: colors.muted, lineHeight: 20, marginBottom: spacing.lg },
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
  moreBtn: { alignSelf: 'flex-start', marginTop: spacing.xs },
  moreContent: { paddingHorizontal: 0 },

  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  // Icon in its own soft-brand chip rather than bare on the card background —
  // the one-line change that makes a header read as a designed panel and not a
  // plain list title.
  tableIconChip: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableTitle: { color: colors.text, flex: 1, fontFamily: font.semibold },
  tableCountBadge: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  tableCountBadgeText: { color: colors.textSecondary, fontSize: 11.5, fontFamily: font.semibold },
  tableHint: { color: colors.muted, lineHeight: 17, marginBottom: spacing.sm },
  searchInput: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  // Only applied when a row is tappable — a negative horizontal margin/padding
  // pair so the wider hit target doesn't shift the text out of alignment with
  // the header above it. `overflow: hidden` clips the accent bar's corners to
  // match the row's own radius instead of poking past it on hover.
  rowPressable: {
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radius.md,
    position: 'relative',
    overflow: 'hidden',
  },
  rowHovered: { backgroundColor: colors.primarySofter },
  // A firmer tint than hover — the moment-of-click feedback the hover state
  // alone can't give, since hover already looks identical right up to the tap.
  rowPressed: { backgroundColor: colors.primarySoft },
  // A 3px "you are about to open something" bar, transparent at rest and
  // brand-colored on hover/press — cheaper and clearer than animating the whole
  // row, and it's the one element that reads as "clickable" even before the
  // cursor lands on the chevron.
  rowAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: 'transparent',
  },
  rowAccentActive: { backgroundColor: colors.primary },
  // The chevron in its own small circle, same idea as tableIconChip — an
  // "affordance chip" instead of a bare glyph, so the row visibly ends in a
  // button rather than just trailing off.
  chevronChip: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySofter,
    marginLeft: spacing.xs,
  },
  // Invisible twin of chevronChip's footprint, so the header's column widths
  // still line up with the body rows that have one.
  chevronSpacer: { width: 24 + spacing.xs },
  headCell: { color: colors.muted, letterSpacing: 0.6, fontFamily: font.semibold },
  colName: { flex: 1, minWidth: 0, color: colors.text },
  rowLabel: { color: colors.text, fontFamily: font.medium },
  colNum: { width: 76, textAlign: 'right', color: colors.textSecondary },
  // The one number worth reading first in a row of five.
  colNumStrong: { color: colors.text, fontFamily: font.semibold },
  colNumZero: { width: 76, textAlign: 'right', color: colors.disabled },
  colNumCell: { width: 76, alignItems: 'flex-end' },
  // A nonzero NO-SHOW/CANCELLED count as a pill: soft tint + icon + number. A
  // zero never gets one — see StatCell in Table — so the pills are the only
  // color a fully-clean row shows anywhere in these five columns.
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  statPillText: { fontSize: 12, fontFamily: font.semibold },
  divider: { backgroundColor: colors.border, marginVertical: spacing.sm },
  empty: { color: colors.muted, paddingVertical: spacing.md },
  // --- Cab / route / employee drill-down dialogs ---
  cabDialog: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  cabDialogArea: { paddingHorizontal: 0, maxHeight: 420 },
  cabDialogBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  // The driver "contact card" atop the cab dialog: avatar chip, name/phone, and
  // a trip-count badge so the header answers "who, and how much" in one glance
  // before scrolling into the trip list below.
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  driverAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverText: { flex: 1, minWidth: 0 },
  driverName: { color: colors.text, fontFamily: font.semibold },
  driverPhone: { color: colors.muted },
  driverTripsBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  driverTripsBadgeText: { color: colors.primary, fontFamily: font.semibold, fontSize: 11.5 },
  // A rider's initials, one consistent tint for everyone — decoration, not an
  // identity color (see Avatar's own comment).
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontFamily: font.semibold, fontSize: 11 },
  // A booking status as a pill: soft tint (derived from statusColors via
  // hexToRgba) + a solid dot + the status word, all in the same hue.
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    maxWidth: 130,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11.5, fontFamily: font.semibold },
  riderEmpId: { color: colors.muted },
  riderNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  riderNameText: { flexShrink: 1 },
  // Same shape as the repeat badge on the No-Shows screen — one visual language
  // for "this person keeps coming up" across the app, whatever the reason.
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  repeatBadgeText: { color: colors.warning, fontSize: 11, fontFamily: font.semibold },
  // The "N no-shows in this period" strip atop the employee dialog — same
  // pill-with-icon language as the table's own StatCell pills.
  // `position: relative` is what lets tripAccent (an absolutely-positioned
  // timeline bar) anchor to this block rather than the whole scroll view.
  tripBlock: { paddingBottom: spacing.sm, paddingLeft: spacing.md, position: 'relative' },
  tripBlockSpaced: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  // The timeline bar itself, a neutral brand tint.
  tripAccent: {
    position: 'absolute',
    left: 0,
    top: spacing.sm,
    bottom: spacing.sm,
    width: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  tripEyebrow: {
    color: colors.muted,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: font.semibold,
    marginBottom: 2,
  },
  // Red variants of tripAccent/tripEyebrow, for the no-shows dialog only — every
  // other timeline block on this screen is neutral, but a no-show is the one
  // outcome this screen singles out with color, matching the danger tint
  // StatCell already uses for the same status in the tables above.
  tripAccentDanger: { backgroundColor: colors.dangerSoft },
  tripEyebrowDanger: { color: colors.danger },
  tripCabRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  tripHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  tripHeadText: { flex: 1, minWidth: 0 },
  tripDate: { color: colors.text, fontFamily: font.semibold },
  tripDirection: { color: colors.muted, marginTop: 1 },
  tripCountChip: {
    backgroundColor: colors.primarySofter,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tripCountChipText: { color: colors.primary, fontFamily: font.semibold, fontSize: 11.5 },
  tripRiderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingLeft: spacing.md,
  },
  // The employee dialog has no rider list to indent past — its whole timeline
  // is one person's incidents — so its blocks sit slightly further from the
  // accent bar than tripHeadText does, with room to breathe under each line.
  noShowDetail: { paddingLeft: spacing.sm },
  // "N no-shows in this period", atop the employee dialog — same pill-with-icon
  // language as StatCell's own pills in the table above it.
  noShowCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  noShowCountBadgeText: { color: colors.danger, fontFamily: font.semibold, fontSize: 12 },
  noShowReasonBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: spacing.xs,
  },
  noShowReasonText: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
});
