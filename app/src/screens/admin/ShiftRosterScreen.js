// ---------------------------------------------------------------------------
// SHIFT ROSTER  (admin)
// The transport desk sets each employee's roster:
//   • Route  — which cab / pickup location they belong to
//   • Shift  — the timing they work (1 PM–10 PM day, or 9 PM–6 AM night)
//   • Working days — any of Mon–Sun. Sat/Sun are just normal toggles, so
//     "some employees work weekends" is handled by ticking Sat and/or Sun.
// Saved on the employee's profile (employees/<uid>.roster); the employee's
// Weekly Schedule then only lets them book cabs on their rostered days.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList, Pressable } from 'react-native';
import { Text, Card, Button, Divider, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Dropdown from '../../components/Dropdown';
import { subscribeEmployees, updateEmployeeRoster } from '../../services/profile';
import {
  CAB_ROUTES, SHIFT_TIMINGS, WEEKDAYS, DEFAULT_WORKING_DAYS,
} from '../../data/mockData';
import { colors } from '../../theme';

// The employee's address for the transport desk. Prefer the address captured at
// sign-up; otherwise fall back to whatever they saved on their Profile screen
// (the `home` object: a readable displayName, or the structured fields).
function addressOf(emp) {
  if (emp.address) return emp.address;
  const h = emp.home;
  if (!h) return '';
  if (h.displayName) return h.displayName;
  return [h.line1, h.area, h.city, h.pincode].filter(Boolean).join(', ');
}

// The roster an employee starts from before the admin has saved one.
function rosterOf(emp) {
  const r = emp.roster || {};
  return {
    route: r.route || null,
    shift: r.shift || null,
    workingDays: r.workingDays || DEFAULT_WORKING_DAYS,
  };
}

// One toggleable day pill. Weekend days get a distinct colour so it's obvious
// which employees are rostered for Sat/Sun.
function DayPill({ day, isWeekend, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.day,
        selected && (isWeekend ? styles.dayWeekendOn : styles.dayOn),
        !selected && isWeekend && styles.dayWeekendOff,
      ]}
    >
      <Text style={[styles.dayText, selected && styles.dayTextOn]}>{day}</Text>
    </Pressable>
  );
}

function EmployeeRosterCard({ emp, onSave }) {
  const [draft, setDraft] = useState(() => rosterOf(emp));
  const [saving, setSaving] = useState(false);
  const address = addressOf(emp);

  const toggleDay = (day) =>
    setDraft((d) => ({
      ...d,
      workingDays: d.workingDays.includes(day)
        ? d.workingDays.filter((x) => x !== day)
        : [...d.workingDays, day],
    }));

  async function handleSave() {
    setSaving(true);
    try {
      // Save days in Mon→Sun order regardless of the tap order.
      const ordered = WEEKDAYS.filter((d) => draft.workingDays.includes(d));
      await onSave(emp.uid, { ...draft, workingDays: ordered });
    } finally {
      setSaving(false);
    }
  }

  const worksWeekend =
    draft.workingDays.includes('Sat') || draft.workingDays.includes('Sun');

  return (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <View style={styles.rowBetween}>
          <Text variant="titleMedium">{emp.name || emp.email}</Text>
          {worksWeekend ? (
            <View style={styles.weekendTag}>
              <MaterialCommunityIcons name="calendar-weekend" size={14} color="#B71C1C" />
              <Text style={styles.weekendTagText}>Weekend</Text>
            </View>
          ) : null}
        </View>
        <Text variant="bodySmall" style={styles.detail}>
          {emp.empId ? `ID ${emp.empId} · ` : ''}
          {emp.phone || 'No phone'}
        </Text>
        {address ? (
          <View style={styles.addressRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.muted} />
            <Text variant="bodySmall" style={styles.addressText}>
              {address}
            </Text>
          </View>
        ) : null}

        <Divider style={styles.divider} />

        <View style={styles.field}>
          <Text variant="labelLarge" style={styles.fieldLabel}>Route</Text>
          <Dropdown
            value={draft.route}
            options={CAB_ROUTES}
            onSelect={(route) => setDraft((d) => ({ ...d, route }))}
            placeholder="Choose route"
          />
        </View>

        <View style={styles.field}>
          <Text variant="labelLarge" style={styles.fieldLabel}>Shift</Text>
          <Dropdown
            value={draft.shift}
            options={SHIFT_TIMINGS}
            onSelect={(shift) => setDraft((d) => ({ ...d, shift }))}
            placeholder="Choose shift"
          />
        </View>

        <Text variant="labelLarge" style={styles.fieldLabel}>Working days</Text>
        <View style={styles.dayRow}>
          {WEEKDAYS.map((day) => (
            <DayPill
              key={day}
              day={day}
              isWeekend={day === 'Sat' || day === 'Sun'}
              selected={draft.workingDays.includes(day)}
              onPress={() => toggleDay(day)}
            />
          ))}
        </View>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          style={styles.saveBtn}
        >
          Save roster
        </Button>
      </Card.Content>
    </Card>
  );
}

export default function ShiftRosterScreen() {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState('');
  const [savedFor, setSavedFor] = useState('');

  useEffect(() => {
    const unsub = subscribeEmployees(setEmployees, (e) => setError(e.message));
    return unsub;
  }, []);

  async function handleSave(uid, roster) {
    setError('');
    try {
      await updateEmployeeRoster(uid, roster);
      const emp = employees.find((e) => e.uid === uid);
      setSavedFor(emp?.name || 'employee');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <Text variant="bodySmall" style={styles.hint}>
          Set each employee's route, shift and working days. Tick Sat / Sun for
          those who work weekends.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={employees}
          keyExtractor={(item) => item.uid}
          renderItem={({ item }) => (
            <EmployeeRosterCard emp={item} onSave={handleSave} />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-group" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No employees have signed up yet.
              </Text>
            </View>
          }
        />
      </View>
      <Snackbar
        visible={!!savedFor}
        onDismiss={() => setSavedFor('')}
        duration={2000}
      >
        Roster saved for {savedFor}.
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  hint: { opacity: 0.7, margin: 12, marginBottom: 4 },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detail: { opacity: 0.7, marginTop: 2 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 4 },
  addressText: { flex: 1, color: colors.muted, lineHeight: 18 },
  divider: { marginVertical: 10 },
  field: { marginBottom: 12 },
  fieldLabel: { opacity: 0.8, marginBottom: 6 },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  day: {
    minWidth: 42,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#B7C2D0',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayWeekendOff: { backgroundColor: '#FDECEC', borderColor: '#F1C4C4' },
  dayWeekendOn: { backgroundColor: '#C62828', borderColor: '#C62828' },
  dayText: { fontSize: 13, color: colors.text },
  dayTextOn: { color: '#FFFFFF', fontWeight: 'bold' },
  weekendTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FDECEC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  weekendTagText: { color: '#B71C1C', fontSize: 11, fontWeight: 'bold' },
  saveBtn: { marginTop: 4 },
  error: { color: '#C62828', paddingHorizontal: 12 },
  empty: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
