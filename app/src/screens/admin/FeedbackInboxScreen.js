// ---------------------------------------------------------------------------
// FEEDBACK INBOX  (admin)
// Read-only view of what employees submitted:
//   • Feedback — category + message
//   • Ratings  — 1–5 stars + optional comment (with an average at the top)
// Both are live from Firestore (feedback / ratings), newest first. Only an admin
// can read them (enforced by the Firestore security rules).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip, SegmentedButtons, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { subscribeFeedback, subscribeRatings } from '../../services/feedback';
import { colors } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Firestore Timestamp → "12 Jul 2026, 09:30 AM". Blank while a write is pending.
function formatWhen(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(h).padStart(2, '0')}:${min} ${ap}`;
}

function Stars({ value = 0 }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <MaterialCommunityIcons
          key={n}
          name={n <= value ? 'star' : 'star-outline'}
          size={18}
          color={n <= value ? '#F9A825' : colors.muted}
        />
      ))}
    </View>
  );
}

export default function FeedbackInboxScreen() {
  const [tab, setTab] = useState('feedback');
  const [feedback, setFeedback] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const onErr = (e) => setError(e.message);
    const unsubF = subscribeFeedback(setFeedback, onErr);
    const unsubR = subscribeRatings(setRatings, onErr);
    return () => {
      unsubF && unsubF();
      unsubR && unsubR();
    };
  }, []);

  const avg = useMemo(() => {
    if (!ratings.length) return 0;
    const sum = ratings.reduce((t, r) => t + (Number(r.stars) || 0), 0);
    return Math.round((sum / ratings.length) * 10) / 10;
  }, [ratings]);

  const data = tab === 'feedback' ? feedback : ratings;

  function renderFeedback({ item }) {
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleSmall">{item.employeeName || 'Employee'}</Text>
            {item.category ? (
              <Chip compact style={styles.catChip} textStyle={styles.catChipText}>
                {item.category}
              </Chip>
            ) : null}
          </View>
          <Text variant="bodyMedium" style={styles.message}>
            {item.message || '(no message)'}
          </Text>
          {formatWhen(item.createdAt) ? (
            <Text variant="bodySmall" style={styles.when}>{formatWhen(item.createdAt)}</Text>
          ) : null}
        </Card.Content>
      </Card>
    );
  }

  function renderRating({ item }) {
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleSmall">{item.employeeName || 'Employee'}</Text>
            <Stars value={Number(item.stars) || 0} />
          </View>
          {item.comment ? (
            <Text variant="bodyMedium" style={styles.message}>{item.comment}</Text>
          ) : null}
          {formatWhen(item.createdAt) ? (
            <Text variant="bodySmall" style={styles.when}>{formatWhen(item.createdAt)}</Text>
          ) : null}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <SegmentedButtons
          value={tab}
          onValueChange={setTab}
          style={styles.tabs}
          buttons={[
            { value: 'feedback', label: `Feedback (${feedback.length})`, icon: 'message-text' },
            { value: 'ratings', label: `Ratings (${ratings.length})`, icon: 'star' },
          ]}
        />

        {tab === 'ratings' && ratings.length ? (
          <View style={styles.avgRow}>
            <Text variant="titleLarge" style={styles.avgNum}>{avg}</Text>
            <Stars value={Math.round(avg)} />
            <Text variant="bodySmall" style={styles.avgLabel}>
              average · {ratings.length} rating{ratings.length === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={tab === 'feedback' ? renderFeedback : renderRating}
          ItemSeparatorComponent={() => <Divider style={styles.sep} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={tab === 'feedback' ? 'message-text-outline' : 'star-outline'}
                size={44}
                color={colors.muted}
              />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {tab === 'feedback' ? 'No feedback yet.' : 'No ratings yet.'}
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
  tabs: { marginBottom: 12 },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  avgNum: { fontWeight: 'bold', color: colors.primary },
  avgLabel: { opacity: 0.6 },
  stars: { flexDirection: 'row' },
  list: { paddingBottom: 24 },
  card: { marginBottom: 10 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  catChip: { backgroundColor: '#E3F0FF' },
  catChipText: { fontSize: 12 },
  message: { marginTop: 2 },
  when: { opacity: 0.55, marginTop: 6 },
  sep: { opacity: 0 },
  error: { color: colors.danger, marginBottom: 8 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { opacity: 0.7 },
});
