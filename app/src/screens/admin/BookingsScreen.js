// ---------------------------------------------------------------------------
// BOOKINGS SCREEN  (admin home)
// The transport desk sees ALL employee bookings here.
// Tapping a booking that still needs a cab opens the Assign Cab screen.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { statusColors } from '../../theme';

export default function BookingsScreen({ navigation }) {
  const { bookings, getCabById } = useApp();

  function renderBooking({ item }) {
    const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;
    const needsCab = item.status === 'Booked';

    return (
      <Card
        style={styles.card}
        mode="elevated"
        // Only bookings without a cab are tappable (to assign one).
        onPress={needsCab ? () => navigation.navigate('AssignCab', { bookingId: item.id }) : undefined}
      >
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.employeeName}</Text>
            <Chip
              compact
              style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
              textStyle={styles.chipText}
            >
              {item.status}
            </Chip>
          </View>

          <Text variant="bodyMedium" style={styles.detail}>
            {item.direction}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {item.date} · {item.shift}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Pickup: {item.pickup}
          </Text>

          {cab ? (
            <Text variant="bodyMedium" style={styles.assigned}>
              → {cab.cabNumber} · {cab.driverName}
            </Text>
          ) : (
            <Text variant="bodySmall" style={styles.tapHint}>
              Tap to assign a cab
            </Text>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        renderItem={renderBooking}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>No bookings yet.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chipText: { color: 'white', fontSize: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  assigned: { marginTop: 8, fontWeight: 'bold', color: '#2E7D32' },
  tapHint: { marginTop: 8, opacity: 0.6, fontStyle: 'italic' },
  empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
});
