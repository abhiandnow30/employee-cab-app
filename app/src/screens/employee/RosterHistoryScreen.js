// ---------------------------------------------------------------------------
// ROSTER HISTORY
// Shows ALL of the employee's bookings — both Self Roster and Adhoc — with
// their current status (including Cancelled). Read-only.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { statusColors } from '../../theme';
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
                  style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
                  textStyle={styles.statusChipText}
                >
                  {item.status}
                </Chip>
              </View>
              <Text variant="titleMedium" style={styles.direction}>
                {item.direction}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
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
  container: { flex: 1 },
  listContent: { padding: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sourceChip: { backgroundColor: '#E3F2FD' },
  sourceChipText: { color: '#1565C0', fontSize: 12 },
  statusChipText: { color: 'white', fontSize: 12 },
  direction: { marginBottom: 2 },
  detail: { opacity: 0.8, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
});
