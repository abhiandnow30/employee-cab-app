// ---------------------------------------------------------------------------
// BOOK A CAB SCREEN
// A simple form: date, shift, direction, pickup point.
// On submit it creates the booking (status "Booked") and returns to My Rides.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, HelperText } from 'react-native-paper';
import { useApp } from '../../context/AppContext';
import { SHIFT_OPTIONS, DIRECTION_OPTIONS } from '../../data/mockData';

export default function BookCabScreen({ navigation }) {
  const { addBooking } = useApp();

  const [date, setDate] = useState('2026-07-15'); // simple text date for now
  const [direction, setDirection] = useState(DIRECTION_OPTIONS[0]);
  const [shift, setShift] = useState(SHIFT_OPTIONS[0]);
  const [pickup, setPickup] = useState('');
  const [error, setError] = useState('');

  function handleSubmit() {
    setError('');
    if (!date.trim() || !pickup.trim()) {
      setError('Please fill in the date and pickup point.');
      return;
    }
    addBooking({ date: date.trim(), shift, direction, pickup: pickup.trim() });
    navigation.goBack(); // back to My Rides, where the new booking now appears
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TextInput
        label="Date (YYYY-MM-DD)"
        value={date}
        onChangeText={setDate}
        mode="outlined"
        left={<TextInput.Icon icon="calendar" />}
        style={styles.input}
      />

      <Text variant="labelLarge" style={styles.label}>
        Direction
      </Text>
      <SegmentedButtons
        value={direction}
        onValueChange={setDirection}
        buttons={DIRECTION_OPTIONS.map((d) => ({ value: d, label: d }))}
        style={styles.segment}
      />

      <Text variant="labelLarge" style={styles.label}>
        Shift
      </Text>
      <View style={styles.shiftWrap}>
        {SHIFT_OPTIONS.map((s) => (
          <Button
            key={s}
            mode={shift === s ? 'contained' : 'outlined'}
            onPress={() => setShift(s)}
            style={styles.shiftBtn}
            compact
          >
            {s}
          </Button>
        ))}
      </View>

      <TextInput
        label="Pickup point"
        value={pickup}
        onChangeText={setPickup}
        mode="outlined"
        placeholder="e.g. Gachibowli"
        left={<TextInput.Icon icon="map-marker" />}
        style={styles.input}
      />

      {error ? (
        <HelperText type="error" visible={true}>
          {error}
        </HelperText>
      ) : null}

      <Button mode="contained" onPress={handleSubmit} style={styles.submit}>
        Confirm booking
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  input: { marginBottom: 8 },
  label: { marginTop: 12, marginBottom: 8 },
  segment: { marginBottom: 4 },
  shiftWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  shiftBtn: { marginBottom: 4 },
  submit: { marginTop: 20, paddingVertical: 4 },
});
