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
import { colors } from '../../theme';

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
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', padding: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  hint: { opacity: 0.7, flex: 1 },
  countChip: { backgroundColor: '#E3F0FF' },
  list: { paddingVertical: 12 },
  card: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 },
  when: { opacity: 0.55 },
  message: { marginTop: 2 },
  error: { color: colors.danger, marginBottom: 8 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { opacity: 0.7 },
});
