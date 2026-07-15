// ---------------------------------------------------------------------------
// FEEDBACK SCREEN
// A simple form: pick a category, write a message, submit. Returns home.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import Dropdown from '../../components/Dropdown';
import { useApp } from '../../context/AppContext';

const CATEGORIES = ['Driver', 'Cab condition', 'Timing / delay', 'App issue', 'Other'];

export default function FeedbackScreen({ navigation }) {
  const { addFeedback } = useApp();

  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function handleSubmit() {
    setError('');
    if (!category || !message.trim()) {
      setError('Please choose a category and write your feedback.');
      return;
    }
    addFeedback({ category, message: message.trim() });
    navigation.navigate('EmployeeHome');
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
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
        <Button mode="outlined" onPress={() => navigation.goBack()} style={styles.btn}>
          Back
        </Button>
        <Button mode="contained" onPress={handleSubmit} style={styles.btn}>
          Submit
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  pageTitle: { fontWeight: 'bold' },
  cancel: { color: '#D32F2F', fontWeight: 'bold' },
  label: { marginTop: 16, marginBottom: 6 },
  message: { marginTop: 2 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  btn: { flex: 1, paddingVertical: 4 },
});
