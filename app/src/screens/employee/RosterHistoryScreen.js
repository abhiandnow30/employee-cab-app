// ---------------------------------------------------------------------------
// ROSTER HISTORY
// Shows ALL of the employee's bookings — both Self Roster and Adhoc — with
// their current status (including Cancelled). Read-only.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { statusColors, colors, font, radius, shadow, spacing } from '../../theme';
import { SOURCE } from '../../data/mockData';

function sourceLabel(source) {
  return source === SOURCE.ROSTER ? 'Weekly Schedule' : 'One-time';
}

export default function RosterHistoryScreen() {
  const { myBookings } = useApp();
  const rides = myBookings(); // all statuses

  return (
    <View style={styles.container}>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No bookings yet.</Text>}
        renderItem={({ item }) => (
          <Card style={styles.card} mode="outlined">
            <Card.Content>
              <View style={styles.rowBetween}>
                <Chip compact style={styles.sourceChip} textStyle={styles.sourceChipText}>
                  {sourceLabel(item.source)}
                </Chip>
                <Chip
                  compact
                  style={{ backgroundColor: statusColors[item.status] || colors.disabled }}
                  textStyle={styles.statusChipText}
                >
                  {item.status}
                </Chip>
              </View>
              <Text variant="titleMedium" style={styles.direction}>
                {item.direction}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
                {/* The shift's own start/end — a deadline (pickup) or
                    earliest-bound (drop), never a promised cab instant. */}
                {item.date} · {item.shift}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
                Pickup: {item.pickup}
              </Text>
            </Card.Content>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sourceChip: { backgroundColor: colors.primarySoft },
  sourceChipText: { color: colors.primary, fontSize: 11.5, fontFamily: font.semibold },
  statusChipText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: font.semibold },
  direction: { marginBottom: 2, color: colors.text, fontFamily: font.medium },
  detail: { color: colors.textSecondary, marginTop: 3 },
  empty: { textAlign: 'center', marginTop: 48, color: colors.muted },
});
