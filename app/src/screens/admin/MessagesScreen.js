// ---------------------------------------------------------------------------
// MESSAGES  (admin)
// A read-only inbox of messages/requests employees sent from their Contact Us
// screen. Live from Firestore (messages), newest first. Only an admin can read
// them (enforced by the security rules).
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { subscribeAllMessages } from '../../services/messages';
import { colors, font, radius, shadow, spacing } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWhen(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(h).padStart(2, '0')}:${min} ${ap}`;
}

export default function MessagesScreen() {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = subscribeAllMessages(setMessages, (e) => setError(e.message));
    return unsub;
  }, []);

  function renderItem({ item }) {
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleSmall">{item.employeeName || 'Employee'}</Text>
            {formatWhen(item.createdAt) ? (
              <Text variant="bodySmall" style={styles.when}>{formatWhen(item.createdAt)}</Text>
            ) : null}
          </View>
          <Text variant="bodyMedium" style={styles.message}>
            {item.message || '(no message)'}
          </Text>
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <View style={styles.headerRow}>
          <Text variant="bodySmall" style={styles.hint}>
            Messages and requests employees sent from Contact Us. Newest first.
          </Text>
          <Chip compact icon="email-outline" style={styles.countChip}>
            {messages.length}
          </Chip>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="email-outline" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No messages yet.
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
  centerCol: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: 2,
  },
  hint: { color: colors.muted, flex: 1, lineHeight: 19 },
  countChip: { backgroundColor: colors.primarySoft },
  list: { paddingVertical: spacing.lg },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  when: { color: colors.muted },
  message: { marginTop: 2, color: colors.textSecondary, lineHeight: 21 },
  error: { color: colors.danger, marginBottom: spacing.md },
  empty: { alignItems: 'center', paddingVertical: 56, gap: spacing.md },
  emptyText: { color: colors.muted },
});
