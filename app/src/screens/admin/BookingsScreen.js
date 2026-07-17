// ---------------------------------------------------------------------------
// BOOKINGS SCREEN  (admin home)
// The transport desk sees ALL employee bookings. To arrange a carpool, tick
// several bookings (employees) and assign them ONE shared cab — they'll all
// ride together and track the same cab. Cancelled bookings can't be selected.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, FlatList, Pressable } from 'react-native';
import { Text, Card, Chip, Button, Portal, Dialog, RadioButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { statusColors, colors } from '../../theme';

export default function BookingsScreen({ navigation }) {
  const { bookings, cabs, getCabById, assignCabToGroup } = useApp();

  const [selected, setSelected] = useState([]); // booking ids ticked for grouping
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenCab, setChosenCab] = useState(null);
  const [saving, setSaving] = useState(false);

  const isSelected = (id) => selected.includes(id);
  const canSelect = (b) => b.status !== 'Cancelled';

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function openPicker() {
    setChosenCab(null);
    setPickerOpen(true);
  }

  async function confirmAssign() {
    if (!chosenCab || selected.length === 0) return;
    setSaving(true);
    try {
      await assignCabToGroup(selected, chosenCab);
      setSelected([]);
      setPickerOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function renderBooking({ item }) {
    const cab = item.assignedCabId ? getCabById(item.assignedCabId) : null;
    const selectable = canSelect(item);
    const ticked = isSelected(item.id);

    return (
      <Pressable onPress={() => selectable && toggle(item.id)}>
        <Card style={[styles.card, ticked && styles.cardSelected]} mode="elevated">
          <Card.Content style={styles.cardRow}>
            {selectable && (
              <MaterialCommunityIcons
                name={ticked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={24}
                color={ticked ? colors.primary : colors.muted}
                style={styles.check}
              />
            )}
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text variant="titleMedium">{item.employeeName}</Text>
                <Chip
                  compact
                  style={{ backgroundColor: statusColors[item.status] || '#9E9E9E' }}
                  textStyle={styles.chipText}
                >
                  {item.status}
                </Chip>
              </View>
              <Text variant="bodyMedium" style={styles.detail}>
                {item.direction}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
                {item.date} · {item.shift}
              </Text>
              <Text variant="bodyMedium" style={styles.detail}>
                Pickup: {item.pickup}
              </Text>
              {cab && (
                <Text variant="bodyMedium" style={styles.assigned}>
                  → {cab.cabNumber} · {cab.driverName}
                </Text>
              )}
            </View>
          </Card.Content>
        </Card>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.manageRow}>
        <Button
          mode="outlined"
          icon="car-multiple"
          style={styles.manageBtn}
          onPress={() => navigation.navigate('ManageCabs')}
        >
          Manage Cabs
        </Button>
        <Button
          mode="outlined"
          icon="account-tie-hat"
          style={styles.manageBtn}
          onPress={() => navigation.navigate('ManageDrivers')}
        >
          Manage Drivers
        </Button>
      </View>

      <Text variant="bodySmall" style={styles.hint}>
        Tick one or more employees, then assign them a shared cab.
      </Text>

      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        renderItem={renderBooking}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No bookings yet.</Text>}
      />

      {/* Action bar — appears when at least one booking is ticked */}
      {selected.length > 0 && (
        <View style={styles.actionBar}>
          <Button mode="text" onPress={() => setSelected([])}>
            Clear
          </Button>
          <Button mode="contained" icon="car" onPress={openPicker} style={styles.assignBtn}>
            Assign cab to {selected.length} selected
          </Button>
        </View>
      )}

      {/* Cab picker dialog */}
      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)}>
          <Dialog.Title>Assign cab to {selected.length} employee(s)</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group onValueChange={setChosenCab} value={chosenCab}>
              {cabs.map((c) => (
                <RadioButton.Item
                  key={c.id}
                  label={`${c.cabNumber} · ${c.driverName}`}
                  value={c.id}
                />
              ))}
            </RadioButton.Group>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)}>Cancel</Button>
            <Button onPress={confirmAssign} disabled={!chosenCab || saving} loading={saving}>
              Assign
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  manageRow: { flexDirection: 'row', gap: 10, margin: 12, marginBottom: 4 },
  manageBtn: { flex: 1 },
  hint: { opacity: 0.7, marginHorizontal: 14, marginBottom: 4 },
  listContent: { padding: 12, paddingBottom: 90 },
  card: { marginBottom: 12 },
  cardSelected: { borderWidth: 2, borderColor: colors.primary },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  check: { marginRight: 10, marginTop: 2 },
  cardBody: { flex: 1 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chipText: { color: 'white', fontSize: 12 },
  detail: { opacity: 0.8, marginTop: 2 },
  assigned: { marginTop: 8, fontWeight: 'bold', color: '#2E7D32' },
  empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  assignBtn: { flex: 1, marginLeft: 10 },
});
