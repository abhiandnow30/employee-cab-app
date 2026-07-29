// ---------------------------------------------------------------------------
// FLEET  (coordinator)
//
// The coordinator maintains the vehicles they assign every day: add a cab, keep
// its number/contact/seats current, link the driver account it follows, and
// retire it when it leaves service.
//
// Linking a driver here is what switches on that cab's LIVE TRACKING — the
// location feed is keyed by driver id, and the cab record is what tells the app
// (and the riders) which feed to follow. A cab with no driver linked can still be
// assigned trips, but nobody can watch it move.
//
// Removing a vehicle is refused while it still has upcoming rides, so no rider
// silently loses their cab.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Portal, Dialog, Snackbar, Chip, Divider, TextInput,
  HelperText, IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import { subscribeCabs, cabCapacity } from '../../services/cabs';
import { subscribeDrivers } from '../../services/profile';
import { DEFAULT_CAB_CAPACITY } from '../../data/mockData';
import { colors } from '../../theme';

const EMPTY = {
  cabNumber: '',
  driverName: '',
  driverPhone: '',
  capacity: String(DEFAULT_CAB_CAPACITY),
};

// The dropdown value meaning "no driver".
const NO_DRIVER = '__none__';

export default function ManageCabsScreen() {
  const { createCab, editCab, deleteCab, assignDriverToCab } = useApp();

  const [cabs, setCabs] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null);

  useEffect(() => {
    const unsub = subscribeCabs(
      (list) => {
        setCabs(list);
        setLoaded(true);
      },
      (e) => {
        setError(e.message);
        setLoaded(true);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeDrivers(setDrivers, (e) =>
      console.warn('[fleet] drivers error:', e?.message)
    );
    return unsub;
  }, []);

  const driverOptions = useMemo(
    () => [NO_DRIVER, ...drivers.map((d) => d.uid)],
    [drivers]
  );
  const driverLabel = (uid) => {
    if (uid === NO_DRIVER) return 'No driver';
    const d = drivers.find((x) => x.uid === uid);
    if (!d) return 'Select driver';
    // Flag a driver already on another cab — picking them moves them.
    const holding = cabs.find((c) => c.driverUid === uid);
    return `${d.name || d.email}${holding ? ` · on ${holding.cabNumber}` : ''}`;
  };

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setFormError('');
    setFormOpen(true);
  }
  function openEdit(cab) {
    setEditingId(cab.id);
    setForm({
      cabNumber: cab.cabNumber || '',
      driverName: cab.driverName || '',
      driverPhone: cab.driverPhone || '',
      capacity: String(cabCapacity(cab)),
    });
    setFormError('');
    setFormOpen(true);
  }

  async function saveForm() {
    setFormError('');
    setBusy(true);
    const res = editingId ? await editCab(editingId, form) : await createCab(form);
    setBusy(false);
    if (res?.ok) {
      setFormOpen(false);
      setSnack(editingId ? 'Cab updated.' : `${form.cabNumber} added to the fleet.`);
    } else {
      setFormError(res?.message || 'Could not save the cab.');
    }
  }

  async function handleLink(cabId, uid) {
    setError('');
    const res = await assignDriverToCab(cabId, uid === NO_DRIVER ? null : uid);
    if (res?.ok) setSnack(uid === NO_DRIVER ? 'Driver detached.' : 'Driver linked — live tracking on.');
    else setError(res?.message || 'Could not link that driver.');
  }

  async function confirmDelete() {
    const cab = deleteFor;
    if (!cab) return;
    setBusy(true);
    const res = await deleteCab(cab.id);
    setBusy(false);
    setDeleteFor(null);
    if (res?.ok) {
      setSnack(
        res.unlinkedDrivers
          ? `${cab.cabNumber} removed. ${res.unlinkedDrivers} driver link cleared.`
          : `${cab.cabNumber} removed.`
      );
    } else {
      setError(res?.message || 'Could not remove the cab.');
    }
  }

  function renderCab({ item }) {
    const linked = !!item.driverUid;
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <View style={styles.headText}>
              <Text variant="titleMedium">{item.cabNumber || 'Unnamed cab'}</Text>
              <Text variant="bodySmall" style={styles.detail}>
                {cabCapacity(item)} seats · {item.driverPhone || 'no phone'}
              </Text>
            </View>
            <Chip
              compact
              icon={linked ? 'access-point' : 'access-point-off'}
              style={{ backgroundColor: linked ? '#E7F4E8' : '#FFF3E0' }}
              textStyle={{ color: linked ? colors.success : '#E65100', fontSize: 12 }}
            >
              {linked ? 'Tracking on' : 'No driver'}
            </Chip>
            <IconButton icon="pencil" size={20} onPress={() => openEdit(item)} />
            <IconButton
              icon="delete"
              size={20}
              iconColor={colors.danger}
              onPress={() => setDeleteFor(item)}
            />
          </View>

          <Divider style={styles.divider} />

          <View style={styles.linkRow}>
            <Text variant="labelLarge" style={styles.linkLabel}>
              Driver
            </Text>
            <View style={styles.linkPicker}>
              <Dropdown
                compact
                value={item.driverUid || NO_DRIVER}
                options={driverOptions}
                onSelect={(uid) => handleLink(item.id, uid)}
                format={driverLabel}
                placeholder="Choose"
              />
            </View>
          </View>
          {!linked ? (
            <Text variant="bodySmall" style={styles.warn}>
              Link a driver so employees can follow this cab on the map.
            </Text>
          ) : null}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <View style={styles.topBar}>
          <Text variant="bodySmall" style={styles.hint}>
            The vehicles you assign each day. Linking a driver switches on that
            cab's live tracking.
          </Text>
          <Button mode="contained" icon="car-plus" onPress={openAdd}>
            Add cab
          </Button>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          data={cabs}
          keyExtractor={(item) => item.id}
          renderItem={renderCab}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            loaded ? (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="car-off" size={44} color={colors.muted} />
                <Text variant="bodyMedium" style={styles.emptyText}>
                  No cabs in the fleet yet.
                </Text>
                <Button mode="contained" icon="car-plus" onPress={openAdd}>
                  Add your first cab
                </Button>
              </View>
            ) : null
          }
        />
      </View>

      <Portal>
        {/* Add / edit */}
        <Dialog visible={formOpen} onDismiss={() => setFormOpen(false)} style={styles.dialog}>
          <Dialog.Title>{editingId ? 'Edit cab' : 'Add cab'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Cab number"
              value={form.cabNumber}
              onChangeText={(t) => setForm((f) => ({ ...f, cabNumber: t.toUpperCase() }))}
              mode="outlined"
              autoCapitalize="characters"
              placeholder="TS 09 AB 1234"
              maxLength={32}
              style={styles.input}
            />
            <TextInput
              label="Driver name"
              value={form.driverName}
              onChangeText={(t) => setForm((f) => ({ ...f, driverName: t }))}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="Contact number"
              value={form.driverPhone}
              onChangeText={(t) =>
                setForm((f) => ({ ...f, driverPhone: t.replace(/[^0-9]/g, '').slice(0, 10) }))
              }
              mode="outlined"
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.input}
            />
            <TextInput
              label="Seats"
              value={form.capacity}
              onChangeText={(t) =>
                setForm((f) => ({ ...f, capacity: t.replace(/[^0-9]/g, '').slice(0, 2) }))
              }
              mode="outlined"
              keyboardType="number-pad"
              style={styles.input}
            />
            <HelperText type="info" visible style={styles.seatHint}>
              Carpool assignments stop once a cab is full for a time slot.
            </HelperText>
            {formError ? <HelperText type="error" visible>{formError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button mode="contained" onPress={saveForm} loading={busy} disabled={busy}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Remove */}
        <Dialog visible={!!deleteFor} onDismiss={() => setDeleteFor(null)} style={styles.dialog}>
          <Dialog.Title>Remove {deleteFor?.cabNumber}?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              The vehicle leaves the fleet and its driver is unlinked. Completed
              rides keep their record. If it still has upcoming rides, re-assign
              those first.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={confirmDelete}
              loading={busy}
              disabled={busy}
            >
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    paddingBottom: 4,
    flexWrap: 'wrap',
  },
  hint: { opacity: 0.7, flex: 1, minWidth: 200, lineHeight: 18 },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { flex: 1 },
  detail: { opacity: 0.75, marginTop: 2 },
  divider: { marginVertical: 10 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkLabel: { opacity: 0.8 },
  linkPicker: { flex: 1, maxWidth: 260 },
  warn: { color: '#E65100', marginTop: 8 },
  error: { color: colors.danger, paddingHorizontal: 14, paddingBottom: 8 },
  empty: { alignItems: 'center', marginTop: 50, gap: 12, paddingHorizontal: 24 },
  emptyText: { color: colors.muted },
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  input: { marginBottom: 10 },
  seatHint: { marginTop: -6 },
});
