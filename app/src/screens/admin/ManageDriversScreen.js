// ---------------------------------------------------------------------------
// DRIVERS  (coordinator) — who is driving what
// Every driver account and the vehicle it is linked to. The LINK is made on the
// Fleet screen (pick a driver on the cab), because the desk thinks in vehicles —
// this screen is the other view of the same relationship, for spotting drivers
// with no cab.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeDrivers } from '../../services/profile';
import { cabCapacity } from '../../services/cabs';
import { colors } from '../../theme';

export default function ManageDriversScreen({ navigation }) {
  const { cabs } = useApp();
  const [drivers, setDrivers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = subscribeDrivers(setDrivers, (e) => setError(e.message));
    return unsub;
  }, []);

  // The vehicle a coordinator owns, found by ownership rather than by the
  // profile's stored cabId so the two can never appear to disagree.
  const cabOf = (uid) => cabs.find((c) => c.driverUid === uid) || null;

  function renderDriver({ item }) {
    const cab = cabOf(item.uid);
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium">{item.name || item.email}</Text>
            <Chip
              compact
              icon={cab ? 'car' : 'car-off'}
              style={{ backgroundColor: cab ? '#E7F4E8' : '#FFF3E0' }}
              textStyle={{ color: cab ? colors.success : '#E65100', fontSize: 12 }}
            >
              {cab ? 'Linked' : 'No cab'}
            </Chip>
          </View>

          <Text variant="bodySmall" style={styles.detail}>
            {item.phone || 'No phone'} · {item.email}
          </Text>

          {cab ? (
            <View style={styles.cabBox}>
              <MaterialCommunityIcons name="car-cog" size={16} color={colors.primaryDark} />
              <Text variant="bodyMedium" style={styles.cabText}>
                {cab.cabNumber} · {cabCapacity(cab)} seats
              </Text>
            </View>
          ) : (
            <Text variant="bodySmall" style={styles.pending}>
              Not linked to a cab, so no trips can be assigned to them. Link one on
              the Fleet screen.
            </Text>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <Text variant="bodySmall" style={styles.hint}>
          Drivers are linked to a cab on the Fleet screen. This is the same
          relationship seen from the driver's side — useful for spotting anyone
          without a vehicle.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={drivers}
          keyExtractor={(item) => item.uid}
          renderItem={renderDriver}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-tie-hat" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No drivers yet.
              </Text>
              <Text variant="bodySmall" style={styles.emptyHint}>
                Ask HR to add one from Employees, or let them sign up themselves
                from the login screen.
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
  hint: { opacity: 0.7, padding: 12, paddingBottom: 4, lineHeight: 18 },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  detail: { opacity: 0.7, marginTop: 4 },
  cabBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EAF2FE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  cabText: { color: colors.primaryDark, fontWeight: '600' },
  pending: { color: '#E65100', marginTop: 8, lineHeight: 18 },
  error: { color: colors.danger, padding: 12 },
  empty: { alignItems: 'center', marginTop: 50, gap: 8, paddingHorizontal: 24 },
  emptyText: { color: colors.muted },
  emptyHint: { color: colors.muted, textAlign: 'center', lineHeight: 18 },
});
