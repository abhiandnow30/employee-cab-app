// ---------------------------------------------------------------------------
// MANAGE TIMINGS  (admin)
// Edit the Weekly Schedule (Self Roster) time options WITHOUT a code change:
//   • Pickup times (Home → Office)
//   • Drop times   (Office → Home)
// Add a time (validated + normalised to "hh:mm AM/PM"), remove any time, then
// Save. Saved to Firestore (config/timings); every employee's Weekly Schedule
// picks up the change live. "NA" isn't listed here — it's added automatically
// as the "no ride this leg" option.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import {
  Text, Card, Chip, TextInput, Button, HelperText, Snackbar, Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { timeToMinutes } from '../../utils/datetime';
import { colors } from '../../theme';

// "9:00 pm" / "09:00 PM" → canonical "09:00 PM" (2-digit hour). null if invalid.
function normalizeTime(input) {
  const mins = timeToMinutes(input);
  if (mins == null) return null;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ap}`;
}

// One editable list (Pickup or Drop): chips you can remove + an add field.
function TimingEditor({ title, subtitle, icon, times, onAdd, onRemove }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function handleAdd() {
    setError('');
    const value = normalizeTime(draft);
    if (!value) {
      setError('Enter a valid time like 09:00 PM.');
      return;
    }
    if (times.includes(value)) {
      setError(`${value} is already in the list.`);
      return;
    }
    onAdd(value);
    setDraft('');
  }

  return (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <View style={styles.cardHead}>
          <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
          <View style={styles.cardHeadText}>
            <Text variant="titleMedium">{title}</Text>
            <Text variant="bodySmall" style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <Divider style={styles.divider} />

        {times.length === 0 ? (
          <Text variant="bodySmall" style={styles.emptyList}>
            No times yet — add at least one below.
          </Text>
        ) : (
          <View style={styles.chips}>
            {times.map((t) => (
              <Chip key={t} onClose={() => onRemove(t)} style={styles.chip}>
                {t}
              </Chip>
            ))}
          </View>
        )}

        <View style={styles.addRow}>
          <TextInput
            mode="outlined"
            dense
            label="Add time (hh:mm AM/PM)"
            placeholder="e.g. 09:00 PM"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleAdd}
            style={styles.addInput}
          />
          <Button mode="contained-tonal" icon="plus" onPress={handleAdd} style={styles.addBtn}>
            Add
          </Button>
        </View>
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      </Card.Content>
    </Card>
  );
}

export default function ManageTimingsScreen() {
  const { pickupTimes, dropTimes, saveTimings } = useApp();

  // Local drafts, seeded from the live config. Editing doesn't persist until Save.
  const [pickup, setPickup] = useState(pickupTimes);
  const [drop, setDrop] = useState(dropTimes);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState('');
  const [error, setError] = useState('');

  const dirty = useMemo(
    () =>
      JSON.stringify(pickup) !== JSON.stringify(pickupTimes) ||
      JSON.stringify(drop) !== JSON.stringify(dropTimes),
    [pickup, drop, pickupTimes, dropTimes]
  );

  async function handleSave() {
    setError('');
    if (pickup.length === 0 || drop.length === 0) {
      setError('Both Pickup and Drop need at least one time.');
      return;
    }
    setSaving(true);
    const res = await saveTimings({ pickupTimes: pickup, dropTimes: drop });
    setSaving(false);
    if (res?.ok) setSnack('Timings saved ✓');
    else setError(res?.message || 'Could not save timings.');
  }

  function resetDrafts() {
    setPickup(pickupTimes);
    setDrop(dropTimes);
    setError('');
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.centerCol}>
          <Text variant="bodySmall" style={styles.hint}>
            These are the Pickup and Drop times employees choose from on the Weekly
            Schedule. Changes apply to everyone as soon as you Save.
          </Text>

          <TimingEditor
            title="Pickup times"
            subtitle="Home → Office"
            icon="home-export-outline"
            times={pickup}
            onAdd={(t) => setPickup((list) => [...list, t])}
            onRemove={(t) => setPickup((list) => list.filter((x) => x !== t))}
          />

          <TimingEditor
            title="Drop times"
            subtitle="Office → Home"
            icon="home-import-outline"
            times={drop}
            onAdd={(t) => setDrop((list) => [...list, t])}
            onRemove={(t) => setDrop((list) => list.filter((x) => x !== t))}
          />

          {error ? <HelperText type="error" visible>{error}</HelperText> : null}

          <View style={styles.footer}>
            <Button
              mode="outlined"
              onPress={resetDrafts}
              disabled={!dirty || saving}
              style={styles.footerBtn}
            >
              Reset
            </Button>
            <Button
              mode="contained"
              onPress={handleSave}
              loading={saving}
              disabled={!dirty || saving}
              style={styles.footerBtn}
            >
              Save
            </Button>
          </View>
        </View>
      </ScrollView>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2000}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 12 },
  centerCol: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  hint: { opacity: 0.7, marginBottom: 12 },
  card: { marginBottom: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardHeadText: { flex: 1 },
  subtitle: { opacity: 0.6 },
  divider: { marginVertical: 10 },
  emptyList: { fontStyle: 'italic', opacity: 0.55, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { backgroundColor: '#E3F0FF' },
  addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  addInput: { flex: 1 },
  addBtn: { marginTop: 4 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 24 },
  footerBtn: { flex: 1 },
});
