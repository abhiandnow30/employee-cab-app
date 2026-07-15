// ---------------------------------------------------------------------------
// ADHOC REQUEST PAGE
// Raise a single one-off cab request with a reason.
// Fields: Office location, Reason, Request Type (Pick/Drop), Date (no past
// dates), Shift, Comment. Buttons: Back and Raise Request.
// ---------------------------------------------------------------------------

import React, { useState, useMemo } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import Dropdown from '../../components/Dropdown';
import { useApp } from '../../context/AppContext';
import {
  OFFICE_LOCATIONS,
  REASONS,
  REQUEST_TYPES,
  SHIFT_TIMES,
  SOURCE,
} from '../../data/mockData';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${dd}`;
}

// "Tue, 15-Jul" (with "(Today)" for the first day).
function formatDate(iso, todayIso) {
  const d = new Date(iso + 'T00:00:00');
  const label = `${WEEKDAY_SHORT[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}`;
  return iso === todayIso ? `${label} (Today)` : label;
}

export default function BookCabScreen({ navigation }) {
  const { addBooking } = useApp();

  // Build the list of selectable dates: today + next 30 days (no past dates).
  const { dateOptions, todayIso } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const opts = [];
    for (let i = 0; i <= 13; i++) {
      // today + next 13 days (2 weeks). Guarantees no past dates.
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      opts.push(toKey(d));
    }
    return { dateOptions: opts, todayIso: toKey(today) };
  }, []);

  const [officeLocation, setOfficeLocation] = useState(OFFICE_LOCATIONS[0]);
  const [reason, setReason] = useState('');
  const [requestType, setRequestType] = useState('');
  const [date, setDate] = useState('');
  const [shift, setShift] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  function handleRaise() {
    setError('');
    if (!officeLocation || !reason || !requestType || !date || !shift) {
      setError('Please fill Office location, Reason, Request Type, Date and Shift.');
      return;
    }

    // Pick = come to office; Drop = go home.
    const direction = requestType === 'Pick' ? 'Home → Office' : 'Office → Home';
    const pickup = requestType === 'Pick' ? 'Home' : officeLocation;

    addBooking({
      source: SOURCE.ADHOC,
      officeLocation,
      reason,
      requestType,
      direction,
      date,
      shift,
      pickup,
      comment: comment.trim(),
    });

    // Back to the home page — the new request shows under "My Adhoc".
    navigation.navigate('EmployeeHome');
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Page title + CANCEL (discards the form and returns home) */}
        <View style={styles.titleRow}>
          <Text variant="titleLarge" style={styles.pageTitle}>
            Adhoc
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
          Office location
        </Text>
        <Dropdown
          value={officeLocation}
          options={OFFICE_LOCATIONS}
          onSelect={setOfficeLocation}
          compact={false}
        />

        <Text variant="labelLarge" style={styles.label}>
          Reason
        </Text>
        <Dropdown
          value={reason}
          placeholder="Select a reason"
          options={REASONS}
          onSelect={setReason}
          compact={false}
        />

        <Text variant="labelLarge" style={styles.label}>
          Request Type
        </Text>
        <Dropdown
          value={requestType}
          placeholder="Pick or Drop"
          options={REQUEST_TYPES}
          onSelect={setRequestType}
          compact={false}
        />

        <Text variant="labelLarge" style={styles.label}>
          Date
        </Text>
        <Dropdown
          value={date}
          placeholder="Select a date"
          options={dateOptions}
          onSelect={setDate}
          format={(iso) => formatDate(iso, todayIso)}
          compact={false}
        />

        <Text variant="labelLarge" style={styles.label}>
          Shift
        </Text>
        <Dropdown
          value={shift}
          placeholder="Select shift time"
          options={SHIFT_TIMES}
          onSelect={setShift}
          compact={false}
        />

        <Text variant="labelLarge" style={styles.label}>
          Comment
        </Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          mode="outlined"
          placeholder="Any details for the transport desk"
          multiline
          numberOfLines={3}
          style={styles.comment}
        />

        {error ? (
          <HelperText type="error" visible={true}>
            {error}
          </HelperText>
        ) : null}

        {/* Back + Raise Request */}
        <View style={styles.buttonRow}>
          <Button mode="outlined" onPress={() => navigation.goBack()} style={styles.btn}>
            Back
          </Button>
          <Button mode="contained" onPress={handleRaise} style={styles.btn}>
            Raise Request
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  comment: { marginTop: 2 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  btn: { flex: 1, paddingVertical: 4 },
});
