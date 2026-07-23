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
import { subscribeCabLocation } from '../../services/tracking';
import FleetMap from '../../components/FleetMap';
import { colors } from '../../theme';

// A fix older than this (ms) is treated as stale → "No signal".
const LIVE_WINDOW_MS = 60 * 1000;

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

  // Subscribe to every cab's live location. Re-subscribe if the fleet changes.
  const cabIdsKey = cabs.map((c) => c.id).join(',');
  useEffect(() => {
    const unsubs = cabs.map((c) =>
      subscribeCabLocation(c.id, (loc) => setLocs((prev) => ({ ...prev, [c.id]: loc })))
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

  const liveCount = located.filter(
    ({ loc }) => loc.updatedAt && now - loc.updatedAt < LIVE_WINDOW_MS
  ).length;

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
          const isLive = loc?.updatedAt && now - loc.updatedAt < LIVE_WINDOW_MS;
          const ago = timeAgo(loc?.updatedAt, now);
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
                  icon={isLive ? 'circle' : 'circle-outline'}
                  style={{ backgroundColor: isLive ? '#E8F5E9' : '#F1F3F5' }}
                  textStyle={{ color: isLive ? '#2E7D32' : colors.muted, fontSize: 12 }}
                >
                  {isLive ? 'LIVE' : loc ? `Idle · ${ago}` : 'No signal'}
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
  container: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center', padding: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  hint: { opacity: 0.7, flex: 1 },
  countChip: { backgroundColor: '#EAF2FE' },
  mapWrap: { height: 380, marginBottom: 12 },
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },
  card: { marginBottom: 8 },
  cardContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cabInfo: { flex: 1 },
  driver: { color: colors.muted, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 30 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
