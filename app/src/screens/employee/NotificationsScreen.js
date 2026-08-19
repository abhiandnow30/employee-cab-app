// ---------------------------------------------------------------------------
// NOTIFICATIONS  (employee) — Step 6
//
// What the employee is told, and when. Written by the desk: a cab assigned
// (with driver, phone, cab number and place — never a promised pickup instant,
// the driver coordinates that directly), a ride cancelled, a change request
// resolved.
//
// These are IN-APP notices with an unread badge in the header. A banner on a
// locked phone needs push infrastructure the project doesn't have yet — see the
// header of services/notifications.js.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, FlatList, Pressable } from 'react-native';
import { Text, Card, Button, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { NOTIFY } from '../../services/notifications';
import { colors, font, radius, shadow, spacing } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "3m ago" / "2h ago" / "05 Jul"
function when(ts) {
  if (!ts?.seconds) return 'just now';
  const then = ts.seconds * 1000;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const d = new Date(then);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
}

const ICON = {
  [NOTIFY.CAB_ASSIGNED]: { icon: 'car-check', color: colors.success },
  [NOTIFY.RIDE_CANCELLED]: { icon: 'car-off', color: colors.danger },
  [NOTIFY.PICKUP_CHANGED]: { icon: 'clock-edit-outline', color: '#B26A00' },
  [NOTIFY.REQUEST_RESOLVED]: { icon: 'clipboard-check-outline', color: colors.primary },
  [NOTIFY.ADDRESS_RESOLVED]: { icon: 'home-edit', color: colors.primary },
  [NOTIFY.ROSTER_PUBLISHED]: { icon: 'calendar-month', color: colors.primary },
  // Same icon as the "Cab Service" drawer item (AppDrawer.js), so the notice
  // and the screen it's about read as the same thing.
  [NOTIFY.CAB_SERVICE_RESOLVED]: { icon: 'car-clock', color: colors.primary },
};

export default function NotificationsScreen({ navigation }) {
  const { notifications, unreadCount, openNotification, clearNotifications } = useApp();

  function renderItem({ item }) {
    const style = ICON[item.type] || { icon: 'bell-outline', color: colors.muted };
    const unread = !item.readAt;
    // A cab-assignment notice is worth acting on, so tapping it opens the ride.
    const target = item.type === NOTIFY.CAB_ASSIGNED ? 'MyRides' : null;

    return (
      <Pressable
        onPress={() => {
          if (unread) openNotification(item.id);
          if (target) navigation.navigate(target);
        }}
      >
        <Card style={[styles.card, unread && styles.cardUnread]} mode="elevated">
          <Card.Content style={styles.row}>
            <MaterialCommunityIcons name={style.icon} size={24} color={style.color} />
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text variant="titleSmall" style={[styles.title, unread && styles.titleUnread]}>
                  {item.title}
                </Text>
                {unread ? <View style={styles.dot} /> : null}
              </View>
              <Text variant="bodySmall" style={styles.text}>
                {item.body}
              </Text>
              <Text variant="bodySmall" style={styles.when}>
                {when(item.createdAt)}
                {target ? ' · tap to view your ride' : ''}
              </Text>
            </View>
          </Card.Content>
        </Card>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.col}>
        {notifications.length > 0 ? (
          <View style={styles.topBar}>
            <Chip compact icon="bell" style={styles.countChip}>
              {unreadCount ? `${unreadCount} unread` : 'All read'}
            </Chip>
            {unreadCount > 0 ? (
              <Button compact mode="text" icon="check-all" onPress={clearNotifications}>
                Mark all read
              </Button>
            ) : null}
          </View>
        ) : null}

        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="bell-sleep-outline" size={48} color={colors.muted} />
              <Text variant="titleMedium" style={styles.emptyTitle}>
                Nothing yet
              </Text>
              <Text variant="bodyMedium" style={styles.emptyBody}>
                You'll be told here when a cab is assigned to one of your shifts, or
                when the desk acts on a request.
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  col: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  countChip: { backgroundColor: colors.primarySoft },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  // An unread item carries a brand edge AND a faint brand wash, so the two
  // states stay distinguishable at a glance down a long list.
  cardUnread: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: colors.primarySofter,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.text },
  titleUnread: { fontFamily: font.semibold },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  text: { color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 20 },
  when: { color: colors.muted, marginTop: spacing.sm },
  empty: {
    alignItems: 'center',
    marginTop: 64,
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: { marginTop: spacing.sm, color: colors.text, fontFamily: font.semibold },
  emptyBody: { textAlign: 'center', color: colors.muted, lineHeight: 21 },
});
