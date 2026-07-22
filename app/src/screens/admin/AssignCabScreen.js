// ---------------------------------------------------------------------------
// ASSIGN CAB SCREEN
// Admin picks one of the company cabs for a specific booking.
// On assign, the booking becomes "Cab assigned" and we return to the list.
// The employee will then see the cab number + driver on their My Rides screen.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, RadioButton, Button } from 'react-native-paper';
import { useApp } from '../../context/AppContext';

export default function AssignCabScreen({ route, navigation }) {
  const { bookingId } = route.params;
  const { bookings, cabs, assignCab } = useApp();

  const booking = bookings.find((b) => b.id === bookingId);
  const [selectedCabId, setSelectedCabId] = useState(null);

  // Safety: if the booking somehow isn't found, don't crash.
  if (!booking) {
    return (
      <View style={styles.center}>
        <Text>Booking not found.</Text>
      </View>
    );
  }

  function handleAssign() {
    if (!selectedCabId) return;
    assignCab(booking.id, selectedCabId);
    navigation.goBack(); // back to the bookings list, now showing "Cab assigned"
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
      {/* Summary of the booking we're assigning to. */}
      <Card style={styles.summary} mode="contained">
        <Card.Content>
          <Text variant="titleMedium">{booking.employeeName}</Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {booking.direction} · {booking.shift}
          </Text>
          <Text variant="bodyMedium" style={styles.detail}>
            {booking.date} · Pickup: {booking.pickup}
          </Text>
        </Card.Content>
      </Card>

      <Text variant="labelLarge" style={styles.pickLabel}>
        Choose a cab
      </Text>

      <FlatList
        data={cabs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Card
            style={styles.cabCard}
            mode="outlined"
            onPress={() => setSelectedCabId(item.id)}
          >
            <Card.Content style={styles.cabRow}>
              <RadioButton
                value={item.id}
                status={selectedCabId === item.id ? 'checked' : 'unchecked'}
                onPress={() => setSelectedCabId(item.id)}
              />
              <View style={styles.cabInfo}>
                <Text variant="titleSmall">{item.cabNumber}</Text>
                <Text variant="bodySmall" style={styles.detail}>
                  {item.driverName} · {item.driverPhone}
                </Text>
              </View>
            </Card.Content>
          </Card>
        )}
      />

      <Button
        mode="contained"
        onPress={handleAssign}
        disabled={!selectedCabId}
        style={styles.assignBtn}
      >
        Assign cab
      </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  summary: { marginBottom: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  pickLabel: { marginBottom: 8, marginLeft: 4 },
  listContent: { paddingBottom: 12 },
  cabCard: { marginBottom: 10 },
  cabRow: { flexDirection: 'row', alignItems: 'center' },
  cabInfo: { marginLeft: 8 },
  assignBtn: { paddingVertical: 4 },
});
