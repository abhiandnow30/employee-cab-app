// ---------------------------------------------------------------------------
// MANAGE CABS  (admin)
// The transport desk manages the company fleet here: add, edit, or remove cabs.
// The list is live from Firestore and feeds the assign dialog + Manage Drivers.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, IconButton, Portal, Dialog, TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeCabs } from '../../services/cabs';
import { colors } from '../../theme';

const EMPTY = { cabNumber: '', driverName: '', driverPhone: '' };

export default function ManageCabsScreen() {
  const { createCab, editCab, deleteCab, loadDefaultCabs } = useApp();
  const [cabs, setCabs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding new
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

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
    setForm({ cabNumber: cab.cabNumber || '', driverName: cab.driverName || '', driverPhone: cab.driverPhone || '' });
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
    setSaving(true);
    setError('');
    try {
      if (editingId) await editCab(editingId, form);
      else await createCab(form);
      setDialogOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setError('');
    try {
      await deleteCab(id);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSeed() {
    setError('');
    try {
      await loadDefaultCabs();
    } catch (e) {
      setError(e.message);
    }
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
          </View>
          <IconButton icon="pencil" size={20} onPress={() => openEdit(item)} />
          <IconButton icon="delete" size={20} iconColor="#C62828" onPress={() => handleDelete(item.id)} />
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
            {error ? <Text style={styles.dialogError}>{error}</Text> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogOpen(false)}>Cancel</Button>
            <Button onPress={save} loading={saving} disabled={saving}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
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
  error: { color: '#C62828', paddingHorizontal: 14, paddingBottom: 8 },
  dialogError: { color: '#C62828', marginTop: 8 },
  input: { marginBottom: 10 },
  empty: { alignItems: 'center', marginTop: 50, gap: 12 },
  emptyText: { color: colors.muted },
});
