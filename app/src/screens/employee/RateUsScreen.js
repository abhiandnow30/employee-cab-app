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
import { colors, theme, font, radius, shadow, spacing } from '../../theme';

export default function RateUsScreen({ navigation }) {
  const { addRating } = useApp();

  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Wait for the write before thanking them: this used to say "Thank you!"
  // whether or not the rating actually reached Firestore.
  async function handleSubmit() {
    setError('');
    if (stars === 0) {
      setError('Please tap a star to rate.');
      return;
    }
    setBusy(true);
    const res = await addRating({ stars, comment: comment.trim() });
    setBusy(false);
    if (res?.ok) setDone(true);
    else setError(res?.message || 'Could not send your rating. Please try again.');
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
    <View style={styles.screen}>
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
              color={n <= stars ? '#F9A825' : colors.disabled}
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
        <Button
          mode="outlined"
          onPress={() => navigation.goBack()}
          style={styles.flexBtn}
          contentStyle={styles.btnContent}
          disabled={busy}
        >
          Back
        </Button>
        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.flexBtn}
          contentStyle={styles.btnContent}
          loading={busy}
          disabled={busy}
        >
          Submit rating
        </Button>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', padding: spacing.xl },
  content: { width: '100%', maxWidth: 520 },
  title: {
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
    color: colors.text,
    fontFamily: font.semibold,
  },
  // The stars are the control, so they get room: a wide gap makes each one its
  // own tap target rather than one strip of gold to poke at.
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  comment: { marginBottom: spacing.xs, backgroundColor: colors.surface },
  buttonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  flexBtn: { flex: 1, borderRadius: radius.md },
  btnContent: { paddingVertical: 6 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  thanksTitle: { marginTop: spacing.lg, fontFamily: font.bold, color: colors.text },
  thanksText: { marginTop: spacing.sm, color: colors.muted, textAlign: 'center' },
  btn: { marginTop: spacing.xxl, borderRadius: radius.md },
});
