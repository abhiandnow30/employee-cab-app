// ---------------------------------------------------------------------------
// ADHOC REQUEST PAGE  ("Book a Ride")
// Raise a single one-off cab request with a reason.
// Fields: Office location, Reason, Trip (Pick/Drop), Date (no past dates),
// Shift, Comment. Buttons: Back and Raise Request.
//
// Business logic (lead-time rules, direction/pickup derivation, addBooking) is
// unchanged — this file only restyles the form and adds inline validation.
// ---------------------------------------------------------------------------

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { StyleSheet, View, ScrollView, Animated, useWindowDimensions } from 'react-native';
import { Text, TextInput, Button, Surface, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Dropdown from '../../components/Dropdown';
import { useApp } from '../../context/AppContext';
import { colors } from '../../theme';
import {
  OFFICE_LOCATIONS,
  REASONS,
  REQUEST_TYPES,
  SHIFT_TIMES,
  SOURCE,
  BOOKING_LEAD_HOURS,
} from '../../data/mockData';
import { bookableTimesForDate, canBook, isPastDateTime, timeToMinutes } from '../../utils/datetime';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMMENT_MAX = 250;

// Group a shift time into a time-of-day bucket for the dropdown sections.
const TIME_GROUP_ORDER = ['Morning', 'Afternoon', 'Evening', 'Night'];
function timeBucket(t) {
  const m = timeToMinutes(t);
  if (m == null) return null;
  if (m >= 300 && m < 720) return 'Morning'; // 5:00 AM – 11:59 AM
  if (m >= 720 && m < 1020) return 'Afternoon'; // 12:00 PM – 4:59 PM
  if (m >= 1020 && m < 1260) return 'Evening'; // 5:00 PM – 8:59 PM
  return 'Night'; // 9:00 PM – 4:59 AM
}

function toKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${dd}`;
}

// "Tue, 15-Jul" — with "(Today)" for today and a "· Weekend" hint for Sat/Sun.
function formatDate(iso, todayIso) {
  const d = new Date(iso + 'T00:00:00');
  const dow = d.getDay();
  let label = `${WEEKDAY_SHORT[dow]}, ${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}`;
  if (iso === todayIso) label += ' (Today)';
  else if (dow === 0 || dow === 6) label += ' · Weekend';
  return label;
}

// A field label with an optional required asterisk.
function FieldLabel({ children, required }) {
  return (
    <Text variant="labelLarge" style={styles.label}>
      {children}
      {required ? <Text style={styles.req}> *</Text> : null}
    </Text>
  );
}

export default function BookCabScreen({ navigation }) {
  const { addBooking } = useApp();
  const { width } = useWindowDimensions();
  const stackButtons = width < 520; // full-width stacked buttons on small screens

  // Fade-in on mount.
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fade]);

  // Build the list of selectable dates: today + next 13 days (no past dates).
  const { dateOptions, todayIso } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const opts = [];
    for (let i = 0; i <= 13; i++) {
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
  const [attempted, setAttempted] = useState(false); // show field errors only after a submit try
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState('');

  // Rides must be booked at least BOOKING_LEAD_HOURS ahead, so only show shift
  // times that are still far enough away for the chosen date.
  const shiftOptions = date
    ? bookableTimesForDate(date, SHIFT_TIMES, BOOKING_LEAD_HOURS)
    : SHIFT_TIMES;

  const formValid = !!(officeLocation && reason && requestType && date && shift);

  // Validation status for a required field: green once filled, red only after a
  // failed submit attempt.
  function statusFor(value) {
    if (value) return 'success';
    return attempted ? 'error' : undefined;
  }

  // Changing the date may make the chosen shift invalid (past, or now inside the
  // lead-time window).
  function handleDateChange(newDate) {
    setDate(newDate);
    if (shift && !canBook(newDate, shift, BOOKING_LEAD_HOURS)) setShift('');
  }

  async function handleRaise() {
    setAttempted(true);
    setError('');
    if (!formValid) {
      setError('Please complete all required fields.');
      return;
    }
    if (isPastDateTime(date, shift)) {
      setError('That date/time has already passed. Please pick a future time.');
      return;
    }
    if (!canBook(date, shift, BOOKING_LEAD_HOURS)) {
      setError(
        `Rides must be booked at least ${BOOKING_LEAD_HOURS} hours in advance. Please pick a later time.`
      );
      return;
    }

    // Pick = come to office; Drop = go home.
    const direction = requestType === 'Pick' ? 'Home → Office' : 'Office → Home';
    const pickup = requestType === 'Pick' ? 'Home' : officeLocation;

    setSaving(true);
    try {
      await addBooking({
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
      setSnack('Request raised ✓');
      setTimeout(() => navigation.navigate('EmployeeHome'), 900);
    } catch (e) {
      setError(e.message || 'Could not raise the request. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Animated.View style={[styles.animWrap, { opacity: fade }]}>
          <Surface style={styles.card} elevation={2}>
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIcon}>
                  <MaterialCommunityIcons name="car" size={22} color={colors.primary} />
                </View>
                <View>
                  <Text variant="headlineSmall" style={styles.title}>
                    Book a Ride
                  </Text>
                  <Text variant="bodySmall" style={styles.subtitle}>
                    Complete the form below to request a cab.
                  </Text>
                </View>
              </View>
              <Button
                mode="outlined"
                icon="close"
                compact
                textColor={colors.danger}
                style={styles.cancelBtn}
                onPress={() => navigation.navigate('EmployeeHome')}
              >
                Cancel
              </Button>
            </View>

            {/* Office location */}
            <FieldLabel required>Office location</FieldLabel>
            <Dropdown
              value={officeLocation}
              options={OFFICE_LOCATIONS}
              onSelect={setOfficeLocation}
              compact={false}
              leadingIcon="office-building-outline"
              status={statusFor(officeLocation)}
            />

            {/* Reason */}
            <FieldLabel required>Reason</FieldLabel>
            <Dropdown
              value={reason}
              placeholder="Select a reason"
              options={REASONS}
              onSelect={setReason}
              compact={false}
              leadingIcon="information-outline"
              status={statusFor(reason)}
            />
            {attempted && !reason ? (
              <Text style={styles.fieldError}>Please select a reason.</Text>
            ) : null}

            {/* Trip */}
            <FieldLabel required>Trip</FieldLabel>
            <Dropdown
              value={requestType}
              placeholder="Choose your trip"
              options={REQUEST_TYPES}
              onSelect={setRequestType}
              compact={false}
              leadingIcon="car"
              status={statusFor(requestType)}
              format={(t) => (t === 'Pick' ? 'Pickup  ·  Home → Office' : 'Drop  ·  Office → Home')}
            />
            {requestType ? (
              <View style={styles.tripInfo}>
                <MaterialCommunityIcons name="information" size={16} color={colors.primary} />
                <Text variant="bodySmall" style={styles.tripInfoText}>
                  {requestType === 'Pick'
                    ? 'Cab picks you up from your Home and drops you at the Office.'
                    : 'Cab picks you up from the Office and drops you Home.'}
                </Text>
              </View>
            ) : attempted && !requestType ? (
              <Text style={styles.fieldError}>Please choose a trip type.</Text>
            ) : null}

            {/* Date */}
            <FieldLabel required>Date</FieldLabel>
            <Dropdown
              value={date}
              placeholder="Select a date"
              options={dateOptions}
              onSelect={handleDateChange}
              format={(iso) => formatDate(iso, todayIso)}
              compact={false}
              leadingIcon="calendar"
              status={statusFor(date)}
            />
            {attempted && !date ? (
              <Text style={styles.fieldError}>Please select a date.</Text>
            ) : null}

            {/* Shift */}
            <FieldLabel required>Shift</FieldLabel>
            <Dropdown
              value={shift}
              placeholder="Select shift time"
              options={shiftOptions}
              onSelect={setShift}
              compact={false}
              leadingIcon="clock-outline"
              status={statusFor(shift)}
              groupBy={timeBucket}
              groupOrder={TIME_GROUP_ORDER}
            />
            <Text style={styles.helper}>
              Rides must be booked at least {BOOKING_LEAD_HOURS} hours in advance.
              {date && shiftOptions.length === 0
                ? ' No times left for this date — pick a later date.'
                : ''}
            </Text>

            {/* Comment */}
            <FieldLabel>Comment</FieldLabel>
            <TextInput
              value={comment}
              onChangeText={(t) => t.length <= COMMENT_MAX && setComment(t)}
              mode="outlined"
              placeholder="Any details for the transport desk"
              left={<TextInput.Icon icon="message-outline" />}
              multiline
              numberOfLines={4}
              maxLength={COMMENT_MAX}
              style={styles.comment}
              outlineStyle={styles.commentOutline}
            />
            <View style={styles.counterRow}>
              <Text style={styles.helper}>Maximum {COMMENT_MAX} characters</Text>
              <Text style={styles.counter}>
                {comment.length}/{COMMENT_MAX}
              </Text>
            </View>

            {error ? (
              <View style={styles.errorBanner}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}
          </Surface>

          {/* Back + Raise Request */}
          <View style={[styles.buttonRow, stackButtons && styles.buttonCol]}>
            <Button
              mode="outlined"
              icon="arrow-left"
              onPress={() => navigation.goBack()}
              style={stackButtons ? styles.btnFull : styles.backBtn}
              contentStyle={styles.btnContent}
              disabled={saving}
            >
              Back
            </Button>
            <Button
              mode="contained"
              icon="send"
              onPress={handleRaise}
              style={stackButtons ? styles.btnFull : styles.primaryBtn}
              contentStyle={styles.btnContent}
              loading={saving}
              disabled={!formValid || saving}
            >
              Raise Request
            </Button>
          </View>
        </Animated.View>
      </ScrollView>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={1500}>
        {snack}
      </Snackbar>
    </View>
  );
}

const CARD_MAX = 760;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 32, alignItems: 'center' },
  animWrap: { width: '100%', maxWidth: CARD_MAX },

  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 22,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EAF2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontWeight: '600', color: colors.text },
  subtitle: { color: colors.muted, marginTop: 1 },
  cancelBtn: { borderColor: '#F3C0C0', borderRadius: 10 },

  // Fields
  label: { marginTop: 18, marginBottom: 6, color: colors.text, fontWeight: '600' },
  req: { color: colors.danger },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: 4 },
  helper: { color: colors.muted, fontSize: 12, marginTop: 6 },

  // Trip info card
  tripInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF2FE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  tripInfoText: { color: colors.primaryDark, flex: 1, lineHeight: 18 },

  // Comment
  comment: { marginTop: 2, backgroundColor: colors.surface, minHeight: 104 },
  commentOutline: { borderRadius: 12 },
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  counter: { color: colors.muted, fontSize: 12, marginTop: 6 },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3F3',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  errorBannerText: { color: colors.danger, flex: 1 },

  // Buttons
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  buttonCol: { flexDirection: 'column' },
  backBtn: { flex: 1, borderRadius: 10 },
  primaryBtn: { flex: 2, borderRadius: 10 },
  btnFull: { width: '100%', borderRadius: 10 },
  btnContent: { paddingVertical: 6 },
});
