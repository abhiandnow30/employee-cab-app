// ---------------------------------------------------------------------------
// DRIVER HOME  (My Trips)
// Shows the trips the admin assigned to THIS driver's cab. The driver advances
// each trip's status: Cab assigned → On the way → Arrived → Completed.
// A "Share Live Location" button broadcasts the driver's GPS for the cab.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, Button, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { statusColors, colors } from '../../theme';

// What the driver can do next, per current status.
const NEXT_ACTION = {
  'Cab assigned': { next: 'On the way', label: 'Start trip', icon: 'play' },
  'On the way': { next: 'Arrived', label: 'Mark arrived', icon: 'map-marker-check' },
  Arrived: { next: 'Completed', label: 'Complete trip', icon: 'flag-checkered' },
};

export default function DriverHomeScreen({ navigation }) {
  const { currentUser, bookings, updateBookingStatus, markNoShow, getCabById } = useApp();

  const cab = currentUser?.cabId ? getCabById(currentUser.cabId) : null;
  // Trips for this cab that aren't cancelled.
  const trips = bookings.filter((b) => b.status !== 'Cancelled');

  function renderTrip({ item }) {
    const action = NEXT_ACTION[item.status];
    return (
      <Card style={styles.card} mode="elevated">
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

          {action && (
            <>
              <Divider style={styles.divider} />
              <Button
                mode="contained"
                icon={action.icon}
                onPress={() => updateBookingStatus(item.id, action.next)}
              >
                {action.label}
              </Button>
              {/* At the pickup but the employee isn't here → flag a no-show,
                  which the admin sees in red on the Bookings screen. */}
              {item.status === 'Arrived' && (
                <Button
                  mode="outlined"
                  icon="account-alert"
                  textColor={colors.danger}
                  style={styles.noShowBtn}
                  onPress={() => markNoShow(item.id)}
                >
                  Employee not here (No-show)
                </Button>
              )}
            </>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      {/* Driver + cab header */}
      <View style={styles.header}>
        <Text variant="titleLarge" style={styles.name}>
          {currentUser?.name}
        </Text>
        <Text variant="bodyMedium" style={styles.sub}>
          {cab ? `Cab ${cab.cabNumber}` : 'No cab assigned'}
        </Text>
      </View>

      <Button
        icon="crosshairs-gps"
        mode="contained"
        style={styles.shareBtn}
        contentStyle={styles.shareBtnContent}
        onPress={() => navigation.navigate('DriverShareLocation')}
      >
        Share Live Location
      </Button>

      <Button
        icon="play-circle-outline"
        mode="outlined"
        style={styles.simBtn}
        onPress={() => navigation.navigate('DriverSim')}
      >
        Simulate movement (demo)
      </Button>

      <Text variant="titleMedium" style={styles.sectionTitle}>
        My Trips
      </Text>

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        renderItem={renderTrip}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="car-clock" size={44} color={colors.muted} />
            <Text variant="bodyMedium" style={styles.emptyText}>
              No trips assigned yet.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { marginBottom: 12 },
  name: { fontWeight: 'bold' },
  sub: { color: colors.muted, marginTop: 2 },
  shareBtn: { borderRadius: 10, marginBottom: 10 },
  shareBtnContent: { paddingVertical: 8 },
  simBtn: { borderRadius: 10, marginBottom: 20 },
  sectionTitle: { marginBottom: 10 },
  listContent: { paddingBottom: 24 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chipText: { color: 'white', fontSize: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  divider: { marginVertical: 12 },
  noShowBtn: { marginTop: 8, borderColor: colors.danger },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
