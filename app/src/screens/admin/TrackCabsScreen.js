// ---------------------------------------------------------------------------
// TRACK CABS  (admin) — LIVE FLEET MAP
// One map showing every cab that is sharing its location, each as a labelled
// marker that moves in real time. A side list shows each cab's driver and
// whether it's currently LIVE (recently updated) or has no signal.
//
// It subscribes to cabs/<cabId>/location in the Realtime Database for every cab
// in the fleet — the same feed the employee Track screen uses, but for all cabs.
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeDriverLocation, isLiveFix } from '../../services/tracking';
import FleetMap from '../../components/FleetMap';
import { colors, font, radius, shadow, spacing } from '../../theme';

function timeAgo(updatedAt, now) {
  if (!updatedAt) return null;
  const secs = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function TrackCabsScreen() {
  const { cabs } = useApp();
  const [locs, setLocs] = useState({}); // cabId -> { latitude, longitude, updatedAt }
  const [now, setNow] = useState(() => new Date().getTime());

  // Subscribe to the live location of every cab that has a driver LINKED to it.
  // Positions are published per driver (the database rules only let a driver
  // write their own), so a cab with no linked driver simply has no feed — the
  // list below shows it as "No driver linked".
  const cabIdsKey = cabs.map((c) => `${c.id}:${c.driverUid || ''}`).join(',');
  useEffect(() => {
    const tracked = cabs.filter((c) => c.driverUid);

    // Drop cached positions for cabs we're no longer following — a cab whose
    // coordinator was detached, or that left the fleet. Without this its last
    // known position stays on the map as a marker that will never move again.
    const keep = new Set(tracked.map((c) => c.id));
    setLocs((prev) => {
      const next = {};
      Object.keys(prev).forEach((id) => {
        if (keep.has(id)) next[id] = prev[id];
      });
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });

    const unsubs = tracked.map((c) =>
      subscribeDriverLocation(
        c.driverUid,
        (loc) => setLocs((prev) => ({ ...prev, [c.id]: loc })),
        (e) => console.warn('[tracking] subscription error:', e?.message)
      )
    );
    return () => unsubs.forEach((u) => u && u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabIdsKey]);

  // Tick every 10s so the "LIVE / last seen" labels stay fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().getTime()), 10000);
    return () => clearInterval(t);
  }, []);

  // Cabs that currently have a position → markers for the map.
  const located = useMemo(
    () =>
      cabs
        .map((c) => ({ cab: c, loc: locs[c.id] }))
        .filter((x) => x.loc && typeof x.loc.latitude === 'number'),
    [cabs, locs]
  );

  const mapCabs = located.map(({ cab, loc }) => ({
    id: cab.id,
    latitude: loc.latitude,
    longitude: loc.longitude,
    label: cab.cabNumber,
    sub: cab.driverName || '',
  }));

  const liveCount = located.filter(({ loc }) => isLiveFix(loc, now)).length;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text variant="bodySmall" style={styles.hint}>
          Live location of every cab currently sharing. Markers move in real time.
        </Text>
        <Chip compact icon="car-multiple" style={styles.countChip}>
          {liveCount} live / {cabs.length}
        </Chip>
      </View>

      <View style={styles.mapWrap}>
        <FleetMap cabs={mapCabs} />
      </View>

      {/* Per-cab status list */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {cabs.map((c) => {
          const loc = locs[c.id];
          const isLive = isLiveFix(loc, now);
          const ago = timeAgo(loc?.updatedAt, now);
          const noDriver = !c.driverUid;
          return (
            <Card key={c.id} style={styles.card} mode="outlined">
              <Card.Content style={styles.cardContent}>
                <View style={styles.cabInfo}>
                  <Text variant="titleSmall">{c.cabNumber}</Text>
                  <Text variant="bodySmall" style={styles.driver}>
                    {c.driverName || 'No driver'} · {c.driverPhone || '—'}
                  </Text>
                </View>
                <Chip
                  compact
                  icon={isLive ? 'circle' : noDriver ? 'account-off-outline' : 'circle-outline'}
                  style={{ backgroundColor: isLive ? colors.successSoft : colors.surfaceAlt }}
                  textStyle={{ color: isLive ? colors.success : colors.muted, fontSize: 12 }}
                >
                  {isLive
                    ? 'LIVE'
                    : noDriver
                    ? 'No driver linked'
                    : loc
                    ? `Idle · ${ago}`
                    : 'No signal'}
                </Chip>
              </Card.Content>
            </Card>
          );
        })}
        {cabs.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="car-off" size={40} color={colors.muted} />
            <Text variant="bodyMedium" style={styles.emptyText}>
              No cabs in the fleet yet.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  hint: { color: colors.muted, flex: 1, lineHeight: 19 },
  countChip: { backgroundColor: colors.primarySoft },
  // The map is a panel on the page, so it carries the same rounding, border and
  // lift as every card below it.
  mapWrap: {
    height: 400,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow.sm,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.lg },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cabInfo: { flex: 1, minWidth: 0 },
  driver: { color: colors.muted, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: spacing.xxxl },
  emptyText: { color: colors.muted, marginTop: spacing.sm },
});
