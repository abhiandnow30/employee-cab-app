// ---------------------------------------------------------------------------
// EMPLOYEE HOME
//   Header:  name + employee id
//   Tiles:   MY SHIFT CALENDAR | CHANGE REQUEST | FEEDBACK
// Employees don't create rides any more — HR uploads a monthly shift roster and
// the rides follow from it. This screen is view-and-flag, not book.
//
// NO RIDE LIST HERE. This used to carry a "My Scheduled Rides" card listing the
// roster rides, but My Rides already lists the same bookings — every status, not
// just the roster ones — off the same myBookings() call, split into Upcoming and
// Past. Printing a subset of that list on the landing screen made Home long
// without showing anything My Rides didn't, so Home is now the shortcut deck and
// the list lives on its own screen.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { REQUEST_TYPES } from '../../data/changeRequests';
import { colors, font, radius, shadow, spacing } from '../../theme';

// One of the square action tiles at the top.
function Tile({ icon, label, onPress }) {
  return (
    <Card style={styles.tile} mode="elevated" onPress={onPress}>
      <Card.Content style={styles.tileContent}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name={icon} size={24} color={colors.primary} />
        </View>
        <Text variant="labelMedium" style={styles.tileLabel} numberOfLines={2}>
          {label}
        </Text>
      </Card.Content>
    </Card>
  );
}

export default function EmployeeHomeScreen({ navigation }) {
  const { currentUser } = useApp();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.content}>
        <View style={styles.greeting}>
          <View style={styles.avatar}>
            <MaterialCommunityIcons name="account" size={26} color={colors.primary} />
          </View>
          <View style={styles.greetingText}>
            <Text variant="titleLarge" style={styles.empName} numberOfLines={1}>
              {currentUser?.name || 'Employee'}
            </Text>
            <Text variant="bodySmall" style={styles.services}>
              Employee ID: {currentUser?.empId || '—'}
            </Text>
          </View>
        </View>

        {/* Top action tiles. Employees no longer book rides — their shifts come
            from the roster HR uploads — so these are view + exception, not create.

            The two exception tiles name the ACTUAL exception rather than the form
            that holds it. A generic "Change request" tile opened a screen whose
            first job was to ask which kind, so the two people actually raise —
            dropping one leg, or working a different shift — cost two taps and a
            decision on a screen they hadn't seen yet. These land on the form with
            that type already selected; the other types are still on the screen, so
            nothing is cut off, it's just no longer the first thing asked. */}
        <View style={styles.tileRow}>
          <Tile
            icon="calendar-month"
            label="MY SHIFT CALENDAR"
            onPress={() => navigation.navigate('MySchedule')}
          />
          {/* Icons match the ones the form's own type tiles use, so the tile that
              was tapped is recognisable as the one that ends up selected. */}
          <Tile
            icon="car-off"
            label="CANCEL ONE RIDE"
            onPress={() =>
              navigation.navigate('ChangeRequest', { type: REQUEST_TYPES.CANCEL_RIDE })
            }
          />
          <Tile
            icon="swap-horizontal"
            label="SHIFT CHANGED"
            onPress={() =>
              navigation.navigate('ChangeRequest', { type: REQUEST_TYPES.SHIFT_CHANGED })
            }
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl, alignItems: 'center' },
  content: { width: '100%', maxWidth: 760 },
  // Who is signed in, as a single object: avatar + name + id, rather than two
  // loose lines of text at the top of the page.
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingText: { flex: 1, minWidth: 0 },
  empName: { fontFamily: font.bold, color: colors.text },
  services: { color: colors.muted, marginTop: 1 },
  tileRow: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  tileContent: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 11px with tight tracking: these labels are set in caps, which at the
  // default label size wrapped to three lines in the narrowest tile.
  tileLabel: {
    color: colors.text,
    textAlign: 'center',
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.3,
  },
});
