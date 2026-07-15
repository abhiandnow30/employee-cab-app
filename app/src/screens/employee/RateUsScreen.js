// ---------------------------------------------------------------------------
// RATE US
// Employee taps 1–5 stars, optionally adds a comment, and submits.
// After submitting we show a short thank-you.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { theme } from '../../theme';

export default function RateUsScreen({ navigation }) {
  const { addRating } = useApp();

  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function handleSubmit() {
    setError('');
    if (stars === 0) {
      setError('Please tap a star to rate.');
      return;
    }
    addRating({ stars, comment: comment.trim() });
    setDone(true);
  }

  if (done) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons name="check-circle" size={64} color="#2E7D32" />
        <Text variant="headlineSmall" style={styles.thanksTitle}>
          Thank you!
        </Text>
        <Text variant="bodyMedium" style={styles.thanksText}>
          You rated us {stars} star{stars > 1 ? 's' : ''}.
        </Text>
        <Button mode="contained" style={styles.btn} onPress={() => navigation.navigate('EmployeeHome')}>
          Back to Home
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <Text variant="titleLarge" style={styles.title}>
        How was your experience?
      </Text>

      {/* Star row */}
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
            <MaterialCommunityIcons
              name={n <= stars ? 'star' : 'star-outline'}
              size={44}
              color={n <= stars ? '#F9A825' : '#BDBDBD'}
            />
          </Pressable>
        ))}
      </View>

      <TextInput
        label="Comment (optional)"
        value={comment}
        onChangeText={setComment}
        mode="outlined"
        multiline
        numberOfLines={3}
        style={styles.comment}
      />

      {error ? (
        <HelperText type="error" visible={true}>
          {error}
        </HelperText>
      ) : null}

      <View style={styles.buttonRow}>
        <Button mode="outlined" onPress={() => navigation.goBack()} style={styles.flexBtn}>
          Back
        </Button>
        <Button mode="contained" onPress={handleSubmit} style={styles.flexBtn}>
          Submit rating
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20 },
  title: { textAlign: 'center', marginTop: 12, marginBottom: 20 },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  comment: { marginBottom: 4 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  flexBtn: { flex: 1, paddingVertical: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  thanksTitle: { marginTop: 16, fontWeight: 'bold' },
  thanksText: { marginTop: 6, opacity: 0.7 },
  btn: { marginTop: 24 },
});
