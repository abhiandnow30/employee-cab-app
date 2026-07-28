// ---------------------------------------------------------------------------
// MANAGE CABS  (admin)
// The transport desk manages the company fleet here: add, edit, or remove cabs.
// The list is live from Firestore and feeds the assign dialog + Manage Drivers.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, IconButton, Portal, Dialog, TextInput, Snackbar, HelperText,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeCabs, cabCapacity } from '../../services/cabs';
import { DEFAULT_CAB_CAPACITY } from '../../data/mockData';
import { colors } from '../../theme';

const EMPTY = {
  cabNumber: '',
  driverName: '',
  driverPhone: '',
  capacity: String(DEFAULT_CAB_CAPACITY),
};

export default function ManageCabsScreen() {
  const { createCab, editCab, deleteCab, loadDefaultCabs } = useApp();
  const [cabs, setCabs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding new
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null); // cab pending deletion
  const [deleting, setDeleting] = useState(false);
  const [snack, setSnack] = useState('');

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

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setError('');
    setDialogOpen(true);
  }
  function openEdit(cab) {
    setEditingId(cab.id);
    setForm({
      cabNumber: cab.cabNumber || '',
      driverName: cab.driverName || '',
      driverPhone: cab.driverPhone || '',
      capacity: String(cabCapacity(cab)),
    });
    setError('');
    setDialogOpen(true);
  }

  async function save() {
    if (!form.cabNumber.trim()) {
      setError('Cab number is required.');
      return;
    }
    if (!form.driverName.trim()) {
      setError('Driver name is required.');
      return;
    }
    if (form.driverPhone.length !== 10) {
      setError('Driver phone must be a 10-digit number.');
      return;
    }
    const seats = Number(form.capacity);
    if (!Number.isInteger(seats) || seats < 1 || seats > 30) {
      setError('Seats must be a whole number between 1 and 30.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = { ...form, capacity: seats };
    const res = editingId ? await editCab(editingId, payload) : await createCab(payload);
    setSaving(false);
    if (res?.ok) setDialogOpen(false);
    else setError(res?.message || 'Could not save the cab.');
  }

  // Deleting a cab is destructive and used to happen on a single tap. It now
  // asks first, and the service refuses while the cab still has upcoming rides
  // (and unlinks its driver when it does go).
  async function confirmDelete() {
    const cab = deleteFor;
    if (!cab) return;
    setError('');
    setDeleting(true);
    const res = await deleteCab(cab.id);
    setDeleting(false);
    if (res?.ok) {
      setDeleteFor(null);
      setSnack(
        res.unlinkedDrivers
          ? `${cab.cabNumber} removed. ${res.unlinkedDrivers} driver link cleared.`
          : `${cab.cabNumber} removed.`
      );
    } else {
      setError(res?.message || 'Could not remove the cab.');
      setDeleteFor(null);
    }
  }

  async function handleSeed() {
    setError('');
    const res = await loadDefaultCabs();
    if (!res?.ok) setError(res?.message || 'Could not load the starter fleet.');
  }

  function renderCab({ item }) {
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content style={styles.row}>
          <View style={styles.info}>
            <Text variant="titleMedium">{item.cabNumber}</Text>
            <Text variant="bodySmall" style={styles.detail}>
              {item.driverName || 'No driver name'} · {item.driverPhone || 'No phone'}
            </Text>
            <Text variant="bodySmall" style={styles.detail}>
              {cabCapacity(item)} seats
              {item.driverUid ? ' · driver account linked' : ' · no driver account linked'}
            </Text>
          </View>
          <IconButton icon="pencil" size={20} onPress={() => openEdit(item)} />
          <IconButton
            icon="delete"
            size={20}
            iconColor={colors.danger}
            onPress={() => setDeleteFor(item)}
          />
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
      <View style={styles.topBar}>
        <Button mode="contained" icon="plus" onPress={openAdd}>
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
              <Button mode="outlined" icon="tray-arrow-down" onPress={handleSeed}>
                Load starter fleet (3 cabs)
              </Button>
            </View>
          ) : null
        }
      />

      <Portal>
        <Dialog visible={dialogOpen} onDismiss={() => setDialogOpen(false)}>
          <Dialog.Title>{editingId ? 'Edit cab' : 'Add cab'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Cab number"
              value={form.cabNumber}
              onChangeText={(t) => setForm((f) => ({ ...f, cabNumber: t }))}
              mode="outlined"
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
              label="Driver phone"
              value={form.driverPhone}
              onChangeText={(t) => setForm((f) => ({ ...f, driverPhone: t.replace(/[^0-9]/g, '').slice(0, 10) }))}
              mode="outlined"
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.input}
            />
            <TextInput
              label="Seats"
              value={form.capacity}
              onChangeText={(t) => setForm((f) => ({ ...f, capacity: t.replace(/[^0-9]/g, '').slice(0, 2) }))}
              mode="outlined"
              keyboardType="number-pad"
              style={styles.input}
            />
            <HelperText type="info" visible style={styles.seatHint}>
              How many riders fit. Carpool assignments are blocked once a cab is
              full for a given time slot.
            </HelperText>
            {error ? <Text style={styles.dialogError}>{error}</Text> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogOpen(false)}>Cancel</Button>
            <Button onPress={save} loading={saving} disabled={saving}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={!!deleteFor} onDismiss={() => setDeleteFor(null)} style={styles.confirm}>
          <Dialog.Title>Remove {deleteFor?.cabNumber}?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              The cab is taken out of the fleet and any driver linked to it is
              unlinked. Rides already completed keep their record. If the cab still
              has upcoming rides, re-assign those first.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteFor(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={confirmDelete}
              loading={deleting}
              disabled={deleting}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  topBar: { padding: 12 },
  list: { padding: 12, paddingTop: 0 },
  card: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center' },
  info: { flex: 1 },
  detail: { opacity: 0.7, marginTop: 2 },
  error: { color: colors.danger, paddingHorizontal: 14, paddingBottom: 8 },
  dialogError: { color: colors.danger, marginTop: 8 },
  seatHint: { marginTop: -6 },
  confirm: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  input: { marginBottom: 10 },
  empty: { alignItems: 'center', marginTop: 50, gap: 12 },
  emptyText: { color: colors.muted },
});
