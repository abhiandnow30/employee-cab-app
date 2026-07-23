// ---------------------------------------------------------------------------
// MY RIDES SCREEN  (employee home)
// Shows the logged-in employee's bookings and their status.
// The "+ Book a Cab" button (bottom right) opens the booking form.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, FAB, Divider, Button } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { statusColors } from '../../theme';

export default function MyRidesScreen({ navigation }) {
  const { myBookings, getCabById, currentUser } = useApp();
  const rides = myBookings();
  // The employee's home pickup route, set by the admin in Shift Roster
  // (employees/<uid>.roster.route, e.g. "ECIL Cab"). Shown in brackets after a
  // "Home" pickup so the employee sees which route their cab comes on.
  const homeRoute = currentUser?.roster?.route;

  function renderRide({ item }) {
    const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;
    // Only annotate a Home pickup, and only when a route has been assigned.
    // Show the route name without a trailing "Cab" (e.g. "ECIL Cab" -> "ECIL").
    const routeLabel = homeRoute ? homeRoute.replace(/\s*cab$/i, '').trim() : '';
    const pickupSuffix =
      item.pickup === 'Home' && routeLabel ? ` (${routeLabel})` : '';

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
            Pickup: {item.pickup}{pickupSuffix}
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
      <View style={styles.centerCol}>
      <Button
        icon="home"
        mode="contained-tonal"
        onPress={() => navigation.navigate('EmployeeHome')}
        style={styles.homeBtn}
      >
        Back to Home
      </Button>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  homeBtn: { margin: 12, marginBottom: 0, alignSelf: 'flex-start' },
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
