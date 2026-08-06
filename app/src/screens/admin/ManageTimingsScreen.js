// ---------------------------------------------------------------------------
// MANAGE ROUTES  (admin)
// Edit the Cab routes used in Shift Roster WITHOUT a code change: add a route
// (trimmed, deduped), remove any route, then Save. Saved to Firestore
// (config/timings.routes); every screen that offers a route picks it up live.
//
// This screen used to also edit Pickup/Drop time lists for the old ad-hoc
// Weekly Schedule. That flow is gone — ride times are now derived from Shift
// Policy (see data/shifts.js), so those lists were removed rather than kept
// as dead config nobody reads.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import {
  Text, Card, Chip, TextInput, Button, HelperText, Snackbar, Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import useSyncedDraft from '../../utils/useSyncedDraft';
import { colors } from '../../theme';

// A plain-text normaliser for the route list: just trim.
function normalizeText(input) {
  const v = (input || '').trim();
  return v || null;
}

// An editable list of routes: chips you can remove + an add field.
function RouteEditor({
  title,
  subtitle,
  icon,
  routes,
  onAdd,
  onRemove,
  normalize,
  label,
  placeholder,
  invalidMsg,
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function handleAdd() {
    setError('');
    const value = normalize(draft);
    if (!value) {
      setError(invalidMsg);
      return;
    }
    if (routes.includes(value)) {
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

        {routes.length === 0 ? (
          <Text variant="bodySmall" style={styles.emptyList}>
            No routes yet — add at least one below.
          </Text>
        ) : (
          <View style={styles.chips}>
            {routes.map((t) => (
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
            label={label}
            placeholder={placeholder}
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
  const { routes, saveTimings } = useApp();

  // Local draft over the LIVE config. useSyncedDraft re-seeds it if the config
  // arrives (or another admin changes it) while this form is untouched. A
  // plain useState initialiser captured whatever was loaded at mount — usually
  // the built-in defaults, since the subscription hadn't answered yet — then
  // counted itself as "edited", so pressing Save quietly replaced the real
  // routes with the defaults.
  const liveRoutes = useMemo(() => routes || [], [routes]);
  const [routeList, setRouteList, routeState] = useSyncedDraft(liveRoutes);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState('');
  const [error, setError] = useState('');

  const dirty = routeState.dirty;

  async function handleSave() {
    setError('');
    if (routeList.length === 0) {
      setError('Add at least one cab route.');
      return;
    }
    setSaving(true);
    const res = await saveTimings({ routes: routeList });
    setSaving(false);
    if (res?.ok) setSnack('Saved ✓');
    else setError(res?.message || 'Could not save.');
  }

  function resetDrafts() {
    routeState.reset();
    setError('');
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.centerCol}>
          <Text variant="bodySmall" style={styles.hint}>
            The Cab routes used in Shift Roster. Changes apply to everyone as
            soon as you Save.
          </Text>

          <RouteEditor
            title="Cab routes"
            subtitle="Pickup routes used in Shift Roster"
            icon="map-marker-path"
            routes={routeList}
            onAdd={(r) => setRouteList((list) => [...list, r])}
            onRemove={(r) => setRouteList((list) => list.filter((x) => x !== r))}
            normalize={normalizeText}
            label="Add route"
            placeholder="e.g. HITEC City Cab"
            invalidMsg="Enter a route name."
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
