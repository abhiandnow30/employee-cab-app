// ---------------------------------------------------------------------------
// EMPLOYEE HOME
//   Header:  name + employee id
//   Tiles:   MY SHIFT CALENDAR | CHANGE REQUEST | FEEDBACK
//   Section: the rides the roster has generated for them
// Employees don't create rides any more — HR uploads a monthly shift roster and
// the rides follow from it. This screen is view-and-flag, not book.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { Text, Card, Chip, Divider, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { SOURCE } from '../../data/mockData';
import { statusColors, colors, font, radius, shadow, spacing } from '../../theme';

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

// A "My ORS" / "My Adhoc" section with refresh + collapse controls.
function RideSection({ title, rides, emptyText, onOpen }) {
  const [collapsed, setCollapsed] = useState(false);
  const [, setRefreshTick] = useState(0); // refresh just re-renders (data is live)

  return (
    <Card style={styles.section} mode="elevated">
      <Card.Content>
        <View style={styles.sectionHeader}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            {title}
          </Text>
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
              rides.map((r, i) => (
                <Pressable
                  key={r.id}
                  style={[styles.rideRow, i > 0 && styles.rideRowDivided]}
                  onPress={onOpen}
                >
                  <View style={styles.rideInfo}>
                    <Text variant="bodyMedium" style={styles.rideTitle}>
                      {r.date} · {r.direction}
                    </Text>
                    <Text variant="bodySmall" style={styles.rideSub}>
                      {r.shift}
                    </Text>
                  </View>
                  <Chip
                    compact
                    style={{ backgroundColor: statusColors[r.status] || colors.disabled }}
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

  const openRides = () => navigation.navigate('MyRides');

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
            from the roster HR uploads — so these are view + exception, not create. */}
        <View style={styles.tileRow}>
          <Tile
            icon="calendar-month"
            label="MY SHIFT CALENDAR"
            onPress={() => navigation.navigate('MySchedule')}
          />
          <Tile
            icon="calendar-edit"
            label="CHANGE REQUEST"
            onPress={() => navigation.navigate('ChangeRequest')}
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
  tileRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
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
  section: {
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { color: colors.text, flex: 1, minWidth: 0 },
  sectionIcons: { flexDirection: 'row' },
  sectionDivider: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    backgroundColor: colors.border,
  },
  emptyText: { color: colors.muted, paddingVertical: spacing.sm },
  rideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  // Hairline between rows only — never above the first one, which would read
  // as a second divider directly under the section rule.
  rideRowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  rideInfo: { flex: 1, paddingRight: spacing.md },
  rideTitle: { color: colors.text, fontFamily: font.medium },
  rideSub: { color: colors.muted, marginTop: 2 },
  chipText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: font.semibold },
});
