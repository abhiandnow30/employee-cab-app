// ---------------------------------------------------------------------------
// NO-SHOWS  (admin)
// A read-only list of every ride a driver flagged as a "No show" — i.e. the
// driver reached the pickup but the employee wasn't there. Shows WHO, WHICH
// ride, and WHEN it was flagged. Data is the same live bookings list the admin
// already has — just filtered to status === 'No show', newest flag first.
// ---------------------------------------------------------------------------

import React, { useMemo } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { colors } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Firestore Timestamp → "24-Jul, 02:15 PM" (or '' if not set yet).
function formatWhen(ts) {
  const secs = ts?.seconds;
  if (!secs) return '';
  const d = new Date(secs * 1000);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}, ${String(h).padStart(2, '0')}:${m} ${ap}`;
}

export default function NoShowsScreen() {
  const { bookings, getCabById } = useApp();

  // Only no-show rides, newest flag first (fall back to booking date).
  const noShows = useMemo(() => {
    return bookings
      .filter((b) => b.status === 'No show')
      .sort((a, b) => {
        const ta = a.noShowAt?.seconds ?? 0;
        const tb = b.noShowAt?.seconds ?? 0;
        if (tb !== ta) return tb - ta;
        return String(b.date).localeCompare(String(a.date));
      });
  }, [bookings]);

  function renderRide({ item }) {
    const when = formatWhen(item.noShowAt);
    const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.employeeName || 'Employee'}</Text>
            <Chip compact icon="account-alert" style={styles.chip} textStyle={styles.chipText}>
              No show
            </Chip>
          </View>

          <Text variant="bodyMedium" style={styles.line}>
            {item.direction || '—'}
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            {item.date}
            {item.shift ? ` · ${item.shift}` : ''}
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            Pickup: {item.pickup || '—'}
            {cab ? ` · Cab ${cab.cabNumber || cab.id}` : ''}
          </Text>

          <View style={styles.reasonBox}>
            <MaterialCommunityIcons name="account-alert" size={15} color={colors.danger} />
            <Text variant="bodySmall" style={styles.reasonText}>
              Employee wasn't at the pickup
              {when ? `  ·  flagged ${when}` : ''}
            </Text>
          </View>
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <View style={styles.headerRow}>
          <Text variant="bodySmall" style={styles.hint}>
            Rides where the driver flagged that the employee didn't show up. Newest first.
          </Text>
          <Chip compact icon="account-alert" style={styles.countChip} textStyle={styles.countChipText}>
            {noShows.length}
          </Chip>
        </View>
        <FlatList
          data={noShows}
          keyExtractor={(item) => item.id}
          renderItem={renderRide}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-check-outline" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No no-shows. Everyone made it to their cab.
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  hint: { opacity: 0.7, flex: 1 },
  countChip: { backgroundColor: '#FDECEC' },
  countChipText: { color: colors.danger },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { backgroundColor: '#FDECEC' },
  chipText: { color: colors.danger, fontSize: 12 },
  line: { marginTop: 6, fontWeight: '600', color: colors.text },
  detail: { color: colors.muted, marginTop: 2 },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#FDECEC',
    borderRadius: 8,
    padding: 8,
  },
  reasonText: { flex: 1, color: colors.danger, lineHeight: 18 },
  empty: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
