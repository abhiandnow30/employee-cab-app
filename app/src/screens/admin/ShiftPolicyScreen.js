// ---------------------------------------------------------------------------
// SHIFT POLICY  (HR / Admin)
//
// The transport policy: what each shift code means, when it runs, and how long
// before/after the cab collects and returns. Everything downstream reads this —
// which roster codes generate rides, what time each ride is, and what the
// employee's calendar shows. Retiming the Evening shift here retimes every
// Evening ride in the system.
//
// Pickup and drop are DERIVED (start − lead, end + delay) rather than typed as
// fixed times, so one edit covers every day of the month.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import {
  Text, Card, TextInput, Button, HelperText, Snackbar, Chip, Divider, Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import useSyncedDraft from '../../utils/useSyncedDraft';
import {
  ALL_SHIFT_CODES, SHIFT_COLORS, legsForShift, hhmmToMinutes, minutesToDisplay,
  SERVICE_WINDOW,
} from '../../data/shifts';
import { colors } from '../../theme';

export default function ShiftPolicyScreen() {
  const { shiftPolicy, saveShifts } = useApp();

  // The form sits over the live policy, so another admin's change is picked up
  // while this form is untouched instead of being silently overwritten.
  const live = useMemo(() => shiftPolicy, [shiftPolicy]);
  const [draft, setDraft, draftState] = useSyncedDraft(live);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const setField = (code, key) => (value) =>
    setDraft((d) => ({ ...d, [code]: { ...d[code], [key]: value } }));

  async function handleSave() {
    setError('');
    setSaving(true);
    const res = await saveShifts(draft);
    setSaving(false);
    if (res?.ok) setSnack('Shift policy saved ✓');
    else setError(res?.message || 'Could not save the policy.');
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.col}>
        <Text variant="bodySmall" style={styles.hint}>
          These codes are what HR types in the monthly roster. A working shift
          generates two rides a day — in before it starts, out after it ends. Week
          Off, Holiday and Leave generate none.
        </Text>

        {ALL_SHIFT_CODES.map((code) => {
          const s = draft[code] || {};
          const working = s.working === true;
          const c = SHIFT_COLORS[code] || { bg: '#EEE', fg: colors.text };
          const legs = working ? legsForShift(draft, code) : null;
          const startBad = working && hhmmToMinutes(s.start) == null;
          const endBad = working && hhmmToMinutes(s.end) == null;

          return (
            <Card key={code} mode="outlined" style={styles.card}>
              <Card.Content>
                <View style={styles.head}>
                  <Chip
                    compact
                    style={{ backgroundColor: c.bg }}
                    textStyle={{ color: c.fg, fontWeight: 'bold' }}
                  >
                    {code}
                  </Chip>
                  <TextInput
                    label="Name"
                    value={s.label || ''}
                    onChangeText={setField(code, 'label')}
                    mode="outlined"
                    dense
                    style={styles.labelInput}
                  />
                  <View style={styles.workingToggle}>
                    <Text variant="bodySmall" style={styles.toggleLabel}>
                      Generates rides
                    </Text>
                    <Switch
                      value={working}
                      onValueChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          [code]: v
                            ? {
                                label: d[code]?.label || code,
                                working: true,
                                start: d[code]?.start || '09:00',
                                end: d[code]?.end || '18:00',
                                pickupLeadMin: d[code]?.pickupLeadMin ?? 60,
                                dropDelayMin: d[code]?.dropDelayMin ?? 15,
                              }
                            : { label: d[code]?.label || code, working: false },
                        }))
                      }
                    />
                  </View>
                </View>

                {working ? (
                  <>
                    <Divider style={styles.divider} />
                    <View style={styles.grid}>
                      <TextInput
                        label="Starts (HH:MM)"
                        value={s.start || ''}
                        onChangeText={setField(code, 'start')}
                        mode="outlined"
                        dense
                        placeholder="16:00"
                        error={startBad}
                        style={styles.cell}
                      />
                      <TextInput
                        label="Ends (HH:MM)"
                        value={s.end || ''}
                        onChangeText={setField(code, 'end')}
                        mode="outlined"
                        dense
                        placeholder="01:30"
                        error={endBad}
                        style={styles.cell}
                      />
                      <TextInput
                        label="Pickup lead (min)"
                        value={String(s.pickupLeadMin ?? '')}
                        onChangeText={(t) => setField(code, 'pickupLeadMin')(t.replace(/[^0-9]/g, ''))}
                        mode="outlined"
                        dense
                        keyboardType="number-pad"
                        style={styles.cell}
                      />
                      <TextInput
                        label="Drop delay (min)"
                        value={String(s.dropDelayMin ?? '')}
                        onChangeText={(t) => setField(code, 'dropDelayMin')(t.replace(/[^0-9]/g, ''))}
                        mode="outlined"
                        dense
                        keyboardType="number-pad"
                        style={styles.cell}
                      />
                    </View>

                    {/* Show the derived result, so the effect of an edit is visible
                        before it's saved. */}
                    {legs ? (
                      <>
                        {/* Each leg is stated separately, because a shift very often
                            gets only one. An afternoon shift starts in daylight, so
                            no cab collects it — saying "collects at 12:00 PM" put ten
                            midday pickups on the coordinator's board that were never
                            going to happen. */}
                        <View style={styles.preview}>
                          <MaterialCommunityIcons
                            name={legs.providePickup ? 'arrow-right-bold' : 'close-circle-outline'}
                            size={15}
                            color={legs.providePickup ? colors.primary : colors.muted}
                          />
                          <Text variant="bodySmall" style={styles.previewText}>
                            {legs.providePickup ? (
                              <>
                                Cab collects from home at{' '}
                                <Text style={styles.strong}>{legs.pickup}</Text>
                              </>
                            ) : (
                              <>
                                No pickup — {legs.pickup} is outside cab hours (
                                {SERVICE_WINDOW.from}–{SERVICE_WINDOW.to}), so they
                                travel in themselves
                              </>
                            )}
                          </Text>
                        </View>
                        <View style={styles.preview}>
                          <MaterialCommunityIcons
                            name={legs.provideDrop ? 'arrow-left-bold' : 'close-circle-outline'}
                            size={15}
                            color={legs.provideDrop ? colors.primary : colors.muted}
                          />
                          <Text variant="bodySmall" style={styles.previewText}>
                            {legs.provideDrop ? (
                              <>
                                Cab drops home at{' '}
                                <Text style={styles.strong}>{legs.drop}</Text>
                                {legs.dropNextDay ? ' the next morning' : ''}
                              </>
                            ) : (
                              <>
                                No drop — {legs.drop} is outside cab hours (
                                {SERVICE_WINDOW.from}–{SERVICE_WINDOW.to})
                              </>
                            )}
                          </Text>
                        </View>
                        {!legs.providePickup && !legs.provideDrop ? (
                          <HelperText type="info" visible>
                            This shift generates no rides at all — both legs fall
                            outside cab hours.
                          </HelperText>
                        ) : null}
                      </>
                    ) : (
                      <HelperText type="error" visible>
                        Start and end must look like 16:00.
                      </HelperText>
                    )}
                    {legs?.dropNextDay ? (
                      <HelperText type="info" visible style={styles.overnightNote}>
                        Overnight shift — the return ride falls on the following
                        calendar day, and the coordinator's list shows it there.
                      </HelperText>
                    ) : null}
                  </>
                ) : (
                  <Text variant="bodySmall" style={styles.noRide}>
                    No cab runs on a {s.label || code} day.
                  </Text>
                )}
              </Card.Content>
            </Card>
          );
        })}

        {error ? <HelperText type="error" visible>{error}</HelperText> : null}

        <View style={styles.footer}>
          <Button
            mode="outlined"
            onPress={draftState.reset}
            disabled={!draftState.dirty || saving}
            style={styles.footerBtn}
          >
            Reset
          </Button>
          <Button
            mode="contained"
            onPress={handleSave}
            loading={saving}
            disabled={!draftState.dirty || saving}
            style={styles.footerBtn}
          >
            Save policy
          </Button>
        </View>
      </View>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>
        {snack}
      </Snackbar>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 12, alignItems: 'center' },
  col: { width: '100%', maxWidth: 700 },
  hint: { color: colors.muted, marginBottom: 12, lineHeight: 18 },
  card: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  labelInput: { flex: 1, minWidth: 140, backgroundColor: colors.surface },
  workingToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleLabel: { color: colors.muted },
  divider: { marginVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexGrow: 1, flexBasis: 140, backgroundColor: colors.surface },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EAF2FE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 12,
  },
  previewText: { color: colors.primaryDark, flex: 1, lineHeight: 18 },
  strong: { fontWeight: 'bold' },
  overnightNote: { marginTop: 2 },
  noRide: { color: colors.muted, marginTop: 10, fontStyle: 'italic' },
  footer: { flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 28 },
  footerBtn: { flex: 1 },
});
