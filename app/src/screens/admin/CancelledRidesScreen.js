// ---------------------------------------------------------------------------
// CANCELLED RIDES  (admin)
// A read-only list of every ride that ended up Cancelled, so the transport desk
// can see WHO cancelled, WHICH ride, and WHY. Two ways a ride gets here:
//   • the employee raised a cancellation request the admin approved
//     (has a reason + resolved time), or
//   • the employee removed the leg from their Weekly Schedule directly.
// Data is the same live bookings list the admin already has — just filtered.
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

export default function CancelledRidesScreen() {
  const { bookings } = useApp();

  // Only cancelled rides, newest cancellation first (fall back to booking order).
  const cancelled = useMemo(() => {
    return bookings
      .filter((b) => b.status === 'Cancelled')
      .sort((a, b) => {
        const ta = a.cancelResolvedAt?.seconds ?? a.cancelRequestedAt?.seconds ?? 0;
        const tb = b.cancelResolvedAt?.seconds ?? b.cancelRequestedAt?.seconds ?? 0;
        return tb - ta;
      });
  }, [bookings]);

  function renderRide({ item }) {
    const when = formatWhen(item.cancelResolvedAt || item.cancelRequestedAt);
    const viaRequest = !!item.cancelReason || item.cancelStatus === 'Approved';
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.employeeName || 'Employee'}</Text>
            <Chip compact style={styles.chip} textStyle={styles.chipText}>
              Cancelled
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
            Pickup: {item.pickup || '—'} · {item.source === 'adhoc' ? 'One-time ride' : 'Weekly roster'}
          </Text>

          <View style={styles.reasonBox}>
            <MaterialCommunityIcons
              name={viaRequest ? 'account-cancel-outline' : 'calendar-remove-outline'}
              size={15}
              color={colors.muted}
            />
            <Text variant="bodySmall" style={styles.reasonText}>
              {viaRequest
                ? `Reason: ${item.cancelReason || 'Not specified'}`
                : 'Removed from the weekly schedule by the employee'}
              {when ? `  ·  ${when}` : ''}
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
            Rides employees have cancelled. Newest first.
          </Text>
          <Chip compact icon="car-off" style={styles.countChip}>
            {cancelled.length}
          </Chip>
        </View>
        <FlatList
          data={cancelled}
          keyExtractor={(item) => item.id}
          renderItem={renderRide}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="car-off" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No cancelled rides yet.
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
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { backgroundColor: '#ECEFF1' },
  chipText: { color: '#546E7A', fontSize: 12 },
  line: { marginTop: 6, fontWeight: '600', color: colors.text },
  detail: { color: colors.muted, marginTop: 2 },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#F7F8FA',
    borderRadius: 8,
    padding: 8,
  },
  reasonText: { flex: 1, color: colors.muted, lineHeight: 18 },
  empty: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
