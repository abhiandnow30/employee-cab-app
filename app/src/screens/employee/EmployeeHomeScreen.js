// ---------------------------------------------------------------------------
// EMPLOYEE HOME  (modelled on the SMART TRANSPORT reference)
//   Header:  My Services - [employee id]
//   Tiles:   SELF ROSTER | ADHOC | FEEDBACK  → open those pages
//   Sections: My ORS   → rides booked via Self Roster
//             My Adhoc → rides booked via Adhoc
//   Each section has a refresh + collapse (–/+) control, like the screenshot.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { Text, Card, Chip, Divider, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { SOURCE } from '../../data/mockData';
import { statusColors, colors } from '../../theme';

// One of the square action tiles at the top.
function Tile({ icon, label, onPress }) {
  return (
    <Card style={styles.tile} mode="elevated" onPress={onPress}>
      <Card.Content style={styles.tileContent}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name={icon} size={26} color={colors.primary} />
        </View>
        <Text variant="labelMedium" style={styles.tileLabel}>
          {label}
        </Text>
      </Card.Content>
    </Card>
  );
}

// A "My ORS" / "My Adhoc" section with refresh + collapse controls.
function RideSection({ title, rides, emptyText, onOpen }) {
  const [collapsed, setCollapsed] = useState(false);
  const [, setRefreshTick] = useState(0); // refresh just re-renders (data is live)

  return (
    <Card style={styles.section} mode="elevated">
      <Card.Content>
        <View style={styles.sectionHeader}>
          <Text variant="titleMedium">{title}</Text>
          <View style={styles.sectionIcons}>
            <IconButton
              icon="refresh"
              size={18}
              onPress={() => setRefreshTick((t) => t + 1)}
            />
            <IconButton
              icon={collapsed ? 'plus' : 'minus'}
              size={18}
              onPress={() => setCollapsed((c) => !c)}
            />
          </View>
        </View>

        {!collapsed && (
          <>
            <Divider style={styles.sectionDivider} />
            {rides.length === 0 ? (
              <Text variant="bodyMedium" style={styles.emptyText}>
                {emptyText}
              </Text>
            ) : (
              rides.map((r) => (
                <Pressable key={r.id} style={styles.rideRow} onPress={onOpen}>
                  <View style={styles.rideInfo}>
                    <Text variant="bodyMedium">
                      {r.date} · {r.direction}
                    </Text>
                    <Text variant="bodySmall" style={styles.rideSub}>
                      {r.shift}
                    </Text>
                  </View>
                  <Chip
                    compact
                    style={{ backgroundColor: statusColors[r.status] || '#9E9E9E' }}
                    textStyle={styles.chipText}
                  >
                    {r.status}
                  </Chip>
                </Pressable>
              ))
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
}

export default function EmployeeHomeScreen({ navigation }) {
  const { currentUser, myBookings } = useApp();

  const rides = myBookings();
  const rosterRides = rides.filter((r) => r.source === SOURCE.ROSTER);
  const adhocRides = rides.filter((r) => r.source === SOURCE.ADHOC);

  const openRides = () => navigation.navigate('MyRides');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.content}>
        <Text variant="titleLarge" style={styles.empName}>
          {currentUser?.name || 'Employee'}
        </Text>
        <Text variant="bodyMedium" style={styles.services}>
          Employee ID: {currentUser?.empId || '—'}
        </Text>

        {/* Top action tiles */}
        <View style={styles.tileRow}>
          <Tile
            icon="calendar-month"
            label="WEEKLY SCHEDULE"
            onPress={() => navigation.navigate('SelfRoster')}
          />
          <Tile
            icon="clipboard-check-outline"
            label="BOOK A RIDE"
            onPress={() => navigation.navigate('BookCab')}
          />
          <Tile
            icon="message-draw"
            label="FEEDBACK"
            onPress={() => navigation.navigate('Feedback')}
          />
        </View>

        <RideSection
          title="My Scheduled Rides"
          rides={rosterRides}
          emptyText="No scheduled rides yet."
          onOpen={openRides}
        />
        <RideSection
          title="My One-time Rides"
          rides={adhocRides}
          emptyText="No one-time rides yet."
          onOpen={openRides}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, alignItems: 'center' },
  content: { width: '100%', maxWidth: 720 },
  empName: { fontWeight: 'bold', color: colors.text },
  services: { color: colors.muted, marginBottom: 16, marginTop: 2 },
  tileRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  tile: { flex: 1, borderRadius: 16 },
  tileContent: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#E3F0FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { color: colors.text, textAlign: 'center', fontWeight: '600' },
  section: { marginBottom: 16, borderRadius: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionIcons: { flexDirection: 'row' },
  sectionDivider: { marginTop: 4, marginBottom: 10 },
  emptyText: { opacity: 0.6 },
  rideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  rideInfo: { flex: 1, paddingRight: 8 },
  rideSub: { opacity: 0.6, marginTop: 2 },
  chipText: { color: 'white', fontSize: 12 },
});
