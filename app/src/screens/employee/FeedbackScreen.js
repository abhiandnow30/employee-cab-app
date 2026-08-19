// ---------------------------------------------------------------------------
// FEEDBACK SCREEN
// A simple form: pick a category, write a message, submit. Returns home.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import Dropdown from '../../components/Dropdown';
import ScreenContainer from '../../components/ScreenContainer';
import { useApp } from '../../context/AppContext';
import { colors, font, radius, spacing } from '../../theme';

const CATEGORIES = ['Driver', 'Cab condition', 'Timing / delay', 'App issue', 'Other'];

export default function FeedbackScreen({ navigation }) {
  const { addFeedback } = useApp();

  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Wait for the write before leaving the screen: this used to navigate away
  // whether or not the feedback actually reached Firestore.
  async function handleSubmit() {
    setError('');
    if (!category || !message.trim()) {
      setError('Please choose a category and write your feedback.');
      return;
    }
    setBusy(true);
    const res = await addFeedback({ category, message: message.trim() });
    setBusy(false);
    if (res?.ok) navigation.navigate('EmployeeHome');
    else setError(res?.message || 'Could not send your feedback. Please try again.');
  }

  return (
    <ScreenContainer scroll style={styles.content}>
      <View style={styles.titleRow}>
        <Text variant="titleLarge" style={styles.pageTitle}>
          Feedback
        </Text>
        <Text
          variant="titleMedium"
          style={styles.cancel}
          onPress={() => navigation.navigate('EmployeeHome')}
        >
          CANCEL
        </Text>
      </View>

      <Text variant="labelLarge" style={styles.label}>
        Category
      </Text>
      <Dropdown
        value={category}
        placeholder="Select a category"
        options={CATEGORIES}
        onSelect={setCategory}
        compact={false}
      />

      <Text variant="labelLarge" style={styles.label}>
        Your feedback
      </Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        mode="outlined"
        placeholder="Tell us what went well or what to improve"
        multiline
        numberOfLines={4}
        style={styles.message}
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
          style={styles.btn}
          contentStyle={styles.btnContent}
          disabled={busy}
        >
          Back
        </Button>
        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.btn}
          contentStyle={styles.btnContent}
          loading={busy}
          disabled={busy}
        >
          Submit
        </Button>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.lg },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  pageTitle: { fontFamily: font.bold, color: colors.text },
  cancel: { color: colors.danger, fontFamily: font.semibold },
  label: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    color: colors.text,
    fontFamily: font.semibold,
  },
  message: { marginTop: spacing.xs, backgroundColor: colors.surface },
  buttonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl },
  btn: { flex: 1, borderRadius: radius.md },
  btnContent: { paddingVertical: 6 },
});
