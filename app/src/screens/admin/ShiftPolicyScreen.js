// ---------------------------------------------------------------------------
// SHIFT POLICY  (HR / Admin)
//
// The transport policy: what each shift code means, when it runs, and which
// legs a cab actually provides. Everything downstream reads this — which
// roster codes generate rides and what the employee's calendar shows.
// Retiming the Evening shift here retimes every Evening ride in the system.
//
// DELIBERATELY NO "cab time" field here. This screen sets the EMPLOYEE'S
// schedule (shift start/end) and whether a leg runs at all — never a specific
// instant the cab departs. Exactly when the cab leaves for a pickup or a drop
// is the driver's/transport desk's call on the day, not something this app
// predetermines or promises.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, ScrollView, useWindowDimensions } from 'react-native';
import { Text, Card, TextInput, Button, HelperText, Snackbar, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import useSyncedDraft from '../../utils/useSyncedDraft';
import { WORKING_CODES, NON_WORKING_CODES, legsForShift, hhmmToMinutes } from '../../data/shifts';
import { colors } from '../../theme';

// One glance-icon per shift code — purely a display touch, no meaning any
// other screen depends on. Neutral (one tint for all) rather than
// per-shift-colored, to keep the page reading as one system.
const SHIFT_ICONS = {
  A: 'weather-sunny',
  E: 'weather-sunset',
  N: 'weather-night',
  WO: 'calendar-weekend-outline',
  H: 'calendar-star',
  L: 'calendar-remove-outline',
};

const bigSwitch = { transform: [{ scale: 1.2 }] };

// One line in the status panel: an icon + a short fact, colored by tone.
function StatusLine({ icon, label, tone }) {
  const color =
    tone === 'on' ? colors.success : tone === 'info' ? colors.primary : colors.muted;
  return (
    <View style={styles.statusRow}>
      <MaterialCommunityIcons name={icon} size={16} color={color} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

// Three breakpoints, one column count each — phone stacks everything in one
// column, tablet fits two per row, laptop/desktop the full three-across grid.
function useResponsiveLayout() {
  const { width } = useWindowDimensions();
  const isMobile = width < 640;
  const isTablet = !isMobile && width < 1024;
  const columns = isMobile ? 1 : isTablet ? 2 : 3;
  return {
    columns,
    gap: isMobile ? 12 : isTablet ? 20 : 28,
    outerPadding: isMobile ? 16 : isTablet ? 22 : 28,
    cardPadding: isMobile ? 16 : isTablet ? 20 : 22,
    // Exact thirds only make sense once there's room for three; below that, let
    // the last (short) row of cards keep the same width as a full row instead
    // of stretching to fill the leftover space.
    cardBasis: columns === 1 ? '100%' : columns === 2 ? '47%' : 340,
    cardGrow: columns === 1 ? 1 : 0,
  };
}

export default function ShiftPolicyScreen() {
  const { shiftPolicy, saveShifts } = useApp();
  const layout = useResponsiveLayout();

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

  function renderCard(code, compact) {
    const s = draft[code] || {};
    const working = s.working === true;
    const legs = working ? legsForShift(draft, code) : null;
    const startBad = working && hhmmToMinutes(s.start) == null;
    const endBad = working && hhmmToMinutes(s.end) == null;

    return (
      <Card
        key={code}
        mode="elevated"
        style={[styles.card, { flexBasis: layout.cardBasis, flexGrow: layout.cardGrow }]}
      >
        <Card.Content style={[styles.cardContent, { padding: layout.cardPadding }]}>
          <View style={styles.headerRow}>
            <View style={styles.identity}>
              <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
                <MaterialCommunityIcons
                  name={SHIFT_ICONS[code] || 'clock-outline'}
                  size={compact ? 20 : 24}
                  color={colors.primary}
                />
              </View>
              <TextInput
                value={s.label || ''}
                onChangeText={setField(code, 'label')}
                mode="flat"
                dense
                underlineColor="transparent"
                activeUnderlineColor={colors.primary}
                style={styles.nameInput}
                contentStyle={styles.nameInputContent}
              />
            </View>
            <View style={styles.generatesCol}>
              <Text style={styles.generatesLabel}>Generates rides</Text>
              <Switch
                value={working}
                color={colors.primary}
                style={bigSwitch}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    [code]: v
                      ? {
                          label: d[code]?.label || code,
                          working: true,
                          start: d[code]?.start || '09:00',
                          end: d[code]?.end || '18:00',
                        }
                      : { label: d[code]?.label || code, working: false },
                  }))
                }
              />
            </View>
          </View>

          {!working ? (
            <StatusLine icon="calendar-blank-outline" label="No Rides" tone="off" />
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Shift Timing</Text>
                <View style={styles.box}>
                  <View style={styles.timingRow}>
                    <TextInput
                      label="Start"
                      value={s.start || ''}
                      onChangeText={setField(code, 'start')}
                      mode="outlined"
                      placeholder="16:00"
                      error={startBad}
                      style={styles.timeInput}
                    />
                    <MaterialCommunityIcons
                      name="arrow-right-thin"
                      size={26}
                      color={colors.muted}
                      style={styles.timingArrow}
                    />
                    <TextInput
                      label="End"
                      value={s.end || ''}
                      onChangeText={setField(code, 'end')}
                      mode="outlined"
                      placeholder="01:00"
                      error={endBad}
                      style={styles.timeInput}
                    />
                  </View>
                  {startBad || endBad ? (
                    <HelperText type="error" visible style={{ color: colors.warning }}>
                      Use 24h HH:MM, e.g. 16:00
                    </HelperText>
                  ) : null}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Cab Service</Text>
                <View style={styles.box}>
                  <View style={styles.cabRow}>
                    <Text style={styles.cabLabel}>Pickup</Text>
                    <Switch
                      value={s.providePickup === true}
                      color={colors.primary}
                      style={bigSwitch}
                      onValueChange={setField(code, 'providePickup')}
                    />
                  </View>
                  <View style={styles.cabDivider} />
                  <View style={styles.cabRow}>
                    <Text style={styles.cabLabel}>Drop</Text>
                    <Switch
                      value={s.provideDrop === true}
                      color={colors.primary}
                      style={bigSwitch}
                      onValueChange={setField(code, 'provideDrop')}
                    />
                  </View>
                </View>
              </View>

              {legs ? (
                <View style={styles.statusPanel}>
                  <StatusLine
                    icon={legs.providePickup ? 'check-circle' : 'close-circle-outline'}
                    label={`Pickup ${legs.providePickup ? 'Enabled' : 'Disabled'}`}
                    tone={legs.providePickup ? 'on' : 'off'}
                  />
                  <StatusLine
                    icon={legs.provideDrop ? 'check-circle' : 'close-circle-outline'}
                    label={`Drop ${legs.provideDrop ? 'Enabled' : 'Disabled'}`}
                    tone={legs.provideDrop ? 'on' : 'off'}
                  />
                  {legs.dropNextDay ? (
                    <StatusLine icon="weather-night" label="Overnight Shift" tone="info" />
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { padding: layout.outerPadding }]}
      >
        <View style={styles.col}>
          <View style={[styles.row, { gap: layout.gap }]}>
            {WORKING_CODES.map((code) => renderCard(code, false))}
          </View>
          <View style={[styles.rowCompact, { gap: layout.gap, marginTop: layout.gap }]}>
            {NON_WORKING_CODES.map((code) => renderCard(code, true))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footerBar}>
        <View style={[styles.footerInner, { paddingHorizontal: layout.outerPadding }]}>
          {error ? (
            <HelperText type="error" visible style={styles.footerError}>
              {error}
            </HelperText>
          ) : null}
          <View style={styles.footerButtons}>
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
      </View>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { alignItems: 'center' },
  col: { width: '100%', maxWidth: 1180 },

  row: { flexDirection: 'row', flexWrap: 'wrap' },
  rowCompact: { flexDirection: 'row', flexWrap: 'wrap' },

  card: {
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardContent: {},

  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EAF2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapCompact: { width: 36, height: 36, borderRadius: 10 },
  nameInput: { flex: 1, backgroundColor: 'transparent', height: 40 },
  nameInputContent: { fontSize: 18, fontWeight: '700', color: colors.text, paddingHorizontal: 0 },

  generatesCol: { alignItems: 'flex-end', gap: 2 },
  generatesLabel: { color: colors.muted, fontSize: 11, fontWeight: '500' },

  section: { marginTop: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  box: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
  },
  timingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timingArrow: { marginTop: 4 },
  timeInput: { flex: 1, backgroundColor: colors.surface },

  cabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  cabLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  cabDivider: { height: 1, backgroundColor: colors.border },

  statusPanel: {
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  statusText: { fontSize: 13, fontWeight: '600' },

  footerBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerInner: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    paddingVertical: 16,
  },
  footerError: { marginBottom: 4 },
  footerButtons: { flexDirection: 'row', gap: 12 },
  footerBtn: { flex: 1 },
});
