// ---------------------------------------------------------------------------
// MY RIDES SCREEN  (employee home)
// Shows the logged-in employee's bookings and their status.
// The "+ Book a Cab" button (bottom right) opens the booking form.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, FAB, Divider } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { statusColors } from '../../theme';

export default function MyRidesScreen({ navigation }) {
  const { myBookings, getCabById } = useApp();
  const rides = myBookings();

  function renderRide({ item }) {
    const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;

    return (
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.direction}</Text>
            <Chip
              compact
              style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
              textStyle={styles.chipText}
            >
              {item.status}
            </Chip>
          </View>

          <Text variant="bodyMedium" style={styles.detail}>
            {item.date} · {item.shift}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            Pickup: {item.pickup}
          </Text>

          {cab && (
            <>
              <Divider style={styles.divider} />
              <Text variant="labelLarge">Your cab</Text>
              <Text variant="bodyMedium" style={styles.detail}>
                {cab.cabNumber}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
                Driver: {cab.driverName} · {cab.driverPhone}
              </Text>
            </>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      {rides.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="titleMedium" style={styles.emptyTitle}>
            No rides yet
          </Text>
          <Text variant="bodyMedium" style={styles.emptyText}>
            Tap “Book a Cab” to create your first booking.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(item) => item.id}
          renderItem={renderRide}
          contentContainerStyle={styles.listContent}
        />
      )}

      <FAB
        icon="plus"
        label="Book a Cab"
        style={styles.fab}
        onPress={() => navigation.navigate('BookCab')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 90 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chipText: { color: 'white', fontSize: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  divider: { marginVertical: 10 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { marginBottom: 6 },
  emptyText: { textAlign: 'center', opacity: 0.7 },
});
