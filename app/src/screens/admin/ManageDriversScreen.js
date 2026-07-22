// ---------------------------------------------------------------------------
// MANAGE DRIVERS  (admin)
// Lists every driver account and lets the transport desk assign each driver a
// cab. The assignment is saved on the driver's profile (employees/<uid>.cabId),
// so the driver's app then broadcasts location for that cab.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeDrivers, assignCabToDriver } from '../../services/profile';
import Dropdown from '../../components/Dropdown';
import { colors } from '../../theme';

export default function ManageDriversScreen() {
  const { cabs, getCabById } = useApp();
  const [drivers, setDrivers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = subscribeDrivers(setDrivers, (e) => setError(e.message));
    return unsub;
  }, []);

  const cabIds = cabs.map((c) => c.id);
  const cabLabel = (id) => {
    const c = getCabById(id);
    return c ? `${c.cabNumber} · ${c.driverName}` : 'Select cab';
  };

  async function handleAssign(driverUid, cabId) {
    setError('');
    try {
      await assignCabToDriver(driverUid, cabId);
    } catch (e) {
      setError(e.message);
    }
  }

  function renderDriver({ item }) {
    const cab = item.cabId ? getCabById(item.cabId) : null;
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <Text variant="titleMedium">{item.name || item.email}</Text>
          <Text variant="bodySmall" style={styles.detail}>
            {item.phone || 'No phone'} · {item.email}
          </Text>
          <Text variant="bodyMedium" style={cab ? styles.assigned : styles.unassigned}>
            {cab ? `Cab: ${cab.cabNumber}` : 'No cab assigned'}
          </Text>
          <View style={styles.pickRow}>
            <Text variant="labelLarge" style={styles.pickLabel}>
              Assign cab
            </Text>
            <Dropdown
              compact
              value={item.cabId}
              options={cabIds}
              onSelect={(id) => handleAssign(item.uid, id)}
              format={cabLabel}
              placeholder="Choose"
            />
          </View>
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
      <FlatList
        data={drivers}
        keyExtractor={(item) => item.uid}
        renderItem={renderDriver}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="account-tie-hat" size={44} color={colors.muted} />
            <Text variant="bodyMedium" style={styles.emptyText}>
              No drivers have signed up yet.
            </Text>
          </View>
        }
      />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerCol: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  detail: { opacity: 0.7, marginTop: 2 },
  assigned: { marginTop: 8, color: '#2E7D32', fontWeight: 'bold' },
  unassigned: { marginTop: 8, color: '#E65100' },
  pickRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  pickLabel: { opacity: 0.8 },
  error: { color: '#C62828', padding: 12 },
  empty: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: colors.muted, marginTop: 8 },
});
