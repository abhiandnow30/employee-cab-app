// ---------------------------------------------------------------------------
// TrendChart — one metric plotted across the days of a report period.
//
// Drawn with react-native-svg rather than a charting library. A chart library
// would bring a layout engine, a theme system and an animation runtime to draw
// one line; this is a path, an area under it, and some dots, and all three are
// arithmetic over the points the caller already has.
//
// RESPONSIVE WITHOUT MEASURING. The svg is given a fixed viewBox and stretched
// to 100% width, so the browser scales it — no onLayout, no re-render on resize,
// and the same code draws correctly on a phone. The cost is that stroke widths
// and font sizes are in viewBox units and scale with it, which is why they look
// slightly large in the numbers below.
//
// EMPTY DAYS ARE REAL DATA. dailySeries() emits a zero for a day with no rides
// (see services/reports.js), and this draws them as zeros. A chart that skipped
// them would run the line straight over a closed Sunday and call it steady.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, font, radius, spacing } from '../theme';

// viewBox units. Nothing here is pixels — see the header.
const W = 720;
const H = 260;
const PAD = { top: 18, right: 16, bottom: 30, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-08-16' → '16 Aug'. Deliberately not via Date: these keys are compared
// and formatted as strings everywhere in this app, and parsing them into a Date
// is how a timezone shifts a label by a day.
function shortDate(key) {
  const [, m, d] = String(key || '').split('-');
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${d} ${MONTHS[mi]}` : String(key || '');
}

// A "nice" top for the axis — the next 5, 10, 25 or so above the real maximum,
// so the gridlines land on numbers a person would choose. A plain max would put
// the top gridline at 43 and label the axis with 43, 32, 21, 11.
function niceCeiling(max) {
  if (max <= 5) return 5;
  const step = max <= 20 ? 5 : max <= 60 ? 10 : max <= 150 ? 25 : 50;
  return Math.ceil(max / step) * step;
}

export default function TrendChart({ series, label = 'Rides', tone = colors.primary }) {
  // Which point the pointer is over. Null when not hovering, which is also the
  // touch default — a tap sets it and it stays, which is the only sensible
  // "hover" on a phone.
  const [active, setActive] = useState(null);

  const points = series || [];
  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text variant="bodySmall" style={styles.emptyText}>
          {points.length ? 'One day in this period — pick a wider range to see a trend.' : 'No rides in this period.'}
        </Text>
      </View>
    );
  }

  const top = niceCeiling(Math.max(...points.map((p) => p.value), 0));
  const stepX = PLOT_W / (points.length - 1);
  const xOf = (i) => PAD.left + i * stepX;
  const yOf = (v) => PAD.top + PLOT_H - (top ? (v / top) * PLOT_H : 0);

  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(i)},${yOf(p.value)}`).join(' ');
  // The area is the same line, dropped to the baseline at both ends and closed.
  const areaPath = `${linePath} L${xOf(points.length - 1)},${PAD.top + PLOT_H} L${xOf(0)},${PAD.top + PLOT_H} Z`;

  // Four gridlines including the baseline — enough to read a value off, few
  // enough not to become the loudest thing on the card.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));

  // At a month's width every label fits; at 90 days they would overlap into a
  // grey smear, so only every Nth is drawn. 6 labels is what the axis has room
  // for at this viewBox width.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  // Dots are drawn only when there are few enough to be distinguishable. Past
  // that the line alone is the shape, and the hover target stays the full column.
  const showDots = points.length <= 40;

  const activePoint = active != null ? points[active] : null;

  return (
    <View>
      <View style={styles.plot}>
        <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tone} stopOpacity="0.22" />
              <Stop offset="1" stopColor={tone} stopOpacity="0.02" />
            </LinearGradient>
          </Defs>

          {ticks.map((t) => (
            <Line
              key={`g${t}`}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke={colors.border}
              strokeWidth="1"
            />
          ))}

          <Path d={areaPath} fill="url(#trendFill)" />
          <Path
            d={linePath}
            fill="none"
            stroke={tone}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* The hovered column, drawn under the dots so the marker stays on top. */}
          {activePoint ? (
            <Line
              x1={xOf(active)}
              x2={xOf(active)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke={tone}
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.5"
            />
          ) : null}

          {showDots
            ? points.map((p, i) => (
                <Circle
                  key={p.date}
                  cx={xOf(i)}
                  cy={yOf(p.value)}
                  r={active === i ? 5 : 3}
                  fill={active === i ? tone : colors.surface}
                  stroke={tone}
                  strokeWidth="2"
                />
              ))
            : null}
        </Svg>

        {/* HOVER TARGETS ARE VIEWS, NOT SVG. An invisible column per point, laid
            over the plot: react-native-svg's pointer events are inconsistent
            across web and native, whereas a Pressable/onHover View behaves the
            same on both. Each column is the full height so the pointer does not
            have to find a 3px dot. */}
        <View style={styles.hitRow} pointerEvents="box-none">
          {points.map((p, i) => (
            <Pressable
              key={p.date}
              style={styles.hit}
              onHoverIn={() => setActive(i)}
              onHoverOut={() => setActive(null)}
              onPress={() => setActive((prev) => (prev === i ? null : i))}
              accessibilityLabel={`${shortDate(p.date)}: ${p.value} ${label}`}
            />
          ))}
        </View>

        {activePoint ? (
          <View
            style={[
              styles.tip,
              // Flip to the left of the pointer past the halfway mark so the
              // tooltip never runs off the right edge of the card.
              active > points.length / 2 ? styles.tipRight : styles.tipLeft,
              { left: `${(active / (points.length - 1)) * 100}%` },
            ]}
            pointerEvents="none"
          >
            <Text variant="bodySmall" style={styles.tipDate}>
              {shortDate(activePoint.date)}
            </Text>
            <Text variant="bodySmall" style={styles.tipValue}>
              {label}: {activePoint.value}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.axis}>
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <Text key={p.date} variant="bodySmall" style={styles.axisLabel}>
              {shortDate(p.date)}
            </Text>
          ) : null
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { height: 220, width: '100%', position: 'relative' },
  hitRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  hit: { flex: 1, height: '100%' },
  tip: {
    position: 'absolute',
    top: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 96,
  },
  // translateX rather than margin so the flip is symmetrical about the point.
  tipLeft: { transform: [{ translateX: 8 }] },
  tipRight: { transform: [{ translateX: -110 }] },
  tipDate: { color: colors.muted, fontSize: 11 },
  tipValue: { color: colors.text, fontFamily: font.semibold },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  axisLabel: { color: colors.muted, fontSize: 11 },
  empty: { height: 220, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.muted },
});
