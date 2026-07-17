// ---------------------------------------------------------------------------
// PROFILE
// Shows the signed-in user's details. Employees can also set their home /
// pickup location here (drop a pin or use current location) — it's saved once
// and reused for every "Office → Home" trip's tracking route.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Text, Avatar, Card, List, Button, Divider, TextInput, HelperText } from 'react-native-paper';
import * as Location from 'expo-location';
import { useApp } from '../../context/AppContext';
import LocationPicker from '../../components/LocationPicker';
import { searchAddress } from '../../services/geocode';

export default function ProfileScreen() {
  const { currentUser, logout, saveHomeLocation } = useApp();
  const u = currentUser || {};
  const isEmployee = u.role === 'employee';

  const [home, setHome] = useState(u.home || null); // { latitude, longitude }
  const [label, setLabel] = useState(u.home?.label || '');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function findAddress() {
    if (!search.trim()) return;
    setSearching(true);
    setStatus('');
    try {
      const hit = await searchAddress(search);
      if (!hit) {
        setStatus('Address not found. Try a nearby landmark, or drop the pin manually.');
      } else {
        setHome({ latitude: hit.latitude, longitude: hit.longitude });
        if (!label) setLabel(search.trim());
      }
    } catch (e) {
      setStatus(e.message);
    } finally {
      setSearching(false);
    }
  }

  const initials = (u.name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  async function useCurrentLocation() {
    setStatus('');
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== 'granted') {
      setStatus('Location permission denied.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setHome({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
  }

  async function save() {
    if (!home) {
      setStatus('Please set your location on the map first.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      await saveHomeLocation({ latitude: home.latitude, longitude: home.longitude, label: label.trim() });
      setStatus('Saved ✓');
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Avatar.Text size={72} label={initials} />
        <Text variant="headlineSmall" style={styles.name}>
          {u.name}
        </Text>
        <Text variant="bodyMedium" style={styles.role}>
          {u.role === 'admin' ? 'Transport Desk' : u.role === 'driver' ? 'Driver' : 'Employee'}
        </Text>
      </View>

      <Card mode="outlined" style={styles.card}>
        <List.Item title="Email" description={u.email} left={(p) => <List.Icon {...p} icon="email" />} />
        <Divider />
        <List.Item title="Employee ID" description={u.empId} left={(p) => <List.Icon {...p} icon="identifier" />} />
        <Divider />
        <List.Item title="Phone" description={u.phone} left={(p) => <List.Icon {...p} icon="phone" />} />
      </Card>

      {isEmployee && (
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">My pickup location</Text>
            <Text variant="bodySmall" style={styles.help}>
              Search your address, tap the map to drop a pin, or use your current
              location. Used for your Office → Home rides.
            </Text>

            <TextInput
              label="Search address"
              value={search}
              onChangeText={setSearch}
              mode="outlined"
              placeholder="e.g. Vamsiram Jyothi Granules, Kondapur"
              onSubmitEditing={findAddress}
              returnKeyType="search"
              right={
                <TextInput.Icon
                  icon="magnify"
                  onPress={findAddress}
                  disabled={searching}
                />
              }
              style={styles.input}
            />

            <View style={styles.mapWrap}>
              <LocationPicker value={home} onChange={setHome} />
            </View>

            <Button
              mode="outlined"
              icon="crosshairs-gps"
              onPress={useCurrentLocation}
              style={styles.gpsBtn}
            >
              Use my current location
            </Button>

            <TextInput
              label="Label (e.g. Home – Kondapur)"
              value={label}
              onChangeText={setLabel}
              mode="outlined"
              style={styles.input}
            />

            {home && (
              <Text variant="bodySmall" style={styles.coords}>
                Selected: {home.latitude.toFixed(5)}, {home.longitude.toFixed(5)}
              </Text>
            )}
            {status ? (
              <HelperText type={status === 'Saved ✓' ? 'info' : 'error'} visible={true}>
                {status}
              </HelperText>
            ) : null}

            <Button mode="contained" icon="content-save" onPress={save} loading={busy} disabled={busy}>
              Save location
            </Button>
          </Card.Content>
        </Card>
      )}

      <Button mode="contained" icon="logout" onPress={logout} style={styles.logout}>
        Log out
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  header: { alignItems: 'center', marginBottom: 24 },
  name: { marginTop: 12, fontWeight: 'bold' },
  role: { opacity: 0.7 },
  card: { marginBottom: 20 },
  help: { opacity: 0.7, marginTop: 4, marginBottom: 12 },
  mapWrap: { marginBottom: 12 },
  gpsBtn: { marginBottom: 12 },
  input: { marginBottom: 8 },
  coords: { opacity: 0.7, marginBottom: 4 },
  logout: { paddingVertical: 4, marginTop: 4 },
});
