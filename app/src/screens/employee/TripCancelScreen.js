// ---------------------------------------------------------------------------
// TRIP CANCEL
// Lists the employee's current (non-cancelled) bookings, each with a Cancel
// button. Cancelling asks for confirmation, then updates the booking to
// "Cancelled" — which is reflected on the home page (My ORS / My Adhoc),
// Roster History, and the admin's list.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, Button, Dialog, Portal } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { statusColors } from '../../theme';
import { SOURCE } from '../../data/mockData';

function sourceLabel(source) {
  return source === SOURCE.ROSTER ? 'Self Roster' : 'Adhoc';
}

export default function TripCancelScreen({ navigation }) {
  const { myActiveBookings, cancelBooking } = useApp();
  const rides = myActiveBookings();

  const [toCancel, setToCancel] = useState(null); // booking pending confirmation

  function confirmCancel() {
    if (toCancel) cancelBooking(toCancel.id);
    setToCancel(null);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>No current bookings to cancel.</Text>
        }
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
              <Button
                mode="outlined"
                textColor="#C62828"
                icon="close-circle"
                style={styles.cancelBtn}
                onPress={() => setToCancel(item)}
              >
                Cancel this trip
              </Button>
            </Card.Content>
          </Card>
        )}
      />

      {/* Always-visible return to Home */}
      <Button
        mode="contained"
        icon="home"
        style={styles.homeBtn}
        onPress={() => navigation.navigate('EmployeeHome')}
      >
        Back to Home
      </Button>

      {/* Confirmation dialog */}
      <Portal>
        <Dialog visible={!!toCancel} onDismiss={() => setToCancel(null)}>
          <Dialog.Title>Cancel this trip?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {toCancel
                ? `${toCancel.direction} on ${toCancel.date} (${toCancel.shift}) will be cancelled.`
                : ''}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setToCancel(null)}>Keep</Button>
            <Button textColor="#C62828" onPress={confirmCancel}>
              Cancel trip
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
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
    marginBottom: 8,
  },
  sourceChip: { backgroundColor: '#E3F2FD' },
  sourceChipText: { color: '#1565C0', fontSize: 12 },
  statusChipText: { color: 'white', fontSize: 12 },
  direction: { marginBottom: 2 },
  detail: { opacity: 0.8, marginTop: 2 },
  cancelBtn: { marginTop: 12, borderColor: '#C62828', alignSelf: 'flex-start' },
  empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
  homeBtn: { margin: 12, paddingVertical: 4 },
});
