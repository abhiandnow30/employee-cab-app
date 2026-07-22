// ---------------------------------------------------------------------------
// PROFILE
// Shows the signed-in user's details. Employees can also set their home /
// pickup location here (drop a pin or use current location) — it's saved once
// and reused for every "Office → Home" trip's tracking route.
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Avatar, Card, List, Button, Divider, TextInput, HelperText } from 'react-native-paper';
import * as Location from 'expo-location';
import { useApp } from '../../context/AppContext';
import LocationPicker from '../../components/LocationPicker';
import ScreenContainer from '../../components/ScreenContainer';
import { searchAddress, reverseGeocode, geocodeParts } from '../../services/geocode';

export default function ProfileScreen() {
  const { currentUser, logout, saveHomeLocation, saveProfileDetails } = useApp();
  const u = currentUser || {};
  const isEmployee = u.role === 'employee';

  // --- Basic details (name / employee id / phone), editable in place. Lets a
  // user fill in a profile that was created without an Employee ID. ---
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({
    name: u.name || '',
    empId: u.empId || '',
    phone: u.phone || '',
  });
  const setDetailField = (key) => (t) => setDetails((d) => ({ ...d, [key]: t }));
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsMsg, setDetailsMsg] = useState('');

  // Keep the form in sync if the profile loads/changes while not editing.
  useEffect(() => {
    if (!editing) {
      setDetails({ name: u.name || '', empId: u.empId || '', phone: u.phone || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u.name, u.empId, u.phone]);

  async function saveDetails() {
    if (!details.empId.trim()) {
      setDetailsMsg('Please enter your Employee ID.');
      return;
    }
    setSavingDetails(true);
    setDetailsMsg('');
    try {
      await saveProfileDetails({
        name: details.name.trim() || u.email,
        empId: details.empId.trim(),
        phone: details.phone.trim(),
      });
      setDetailsMsg('Saved ✓');
      setEditing(false);
    } catch (e) {
      setDetailsMsg(e.message);
    } finally {
      setSavingDetails(false);
    }
  }

  const [home, setHome] = useState(u.home || null); // { latitude, longitude }
  // Structured street address, saved alongside the map pin in `home`.
  const [addr, setAddr] = useState({
    line1: u.home?.line1 || '',
    area: u.home?.area || '',
    city: u.home?.city || '',
    pincode: u.home?.pincode || '',
    landmark: u.home?.landmark || '',
  });
  const setAddrField = (key) => (t) => setAddr((a) => ({ ...a, [key]: t }));
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState('info'); // 'info' | 'success' | 'warning' | 'error'
  const [busy, setBusy] = useState(false);

  // Show a status line with a kind that controls its color (so a helpful hint
  // isn't shown in alarming red like a real error).
  const note = (msg, kind = 'info') => {
    setStatus(msg);
    setStatusKind(kind);
  };
  // Readable address for the current pin (reverse-geocoded) so the user can
  // confirm it points to the right place.
  const [resolvedAddr, setResolvedAddr] = useState(u.home?.displayName || '');
  const [resolving, setResolving] = useState(false);

  // Whenever the pin moves, look up its address (debounced so dragging the pin
  // doesn't spam the lookup service).
  useEffect(() => {
    if (home?.latitude == null) {
      setResolvedAddr('');
      return;
    }
    let cancelled = false;
    setResolving(true);
    const timer = setTimeout(async () => {
      try {
        const r = await reverseGeocode(home.latitude, home.longitude);
        if (!cancelled) setResolvedAddr(r?.displayName || '');
      } catch {
        if (!cancelled) setResolvedAddr('');
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [home?.latitude, home?.longitude]);

  async function findAddress() {
    if (!search.trim()) return;
    setSearching(true);
    setStatus('');
    try {
      const hit = await searchAddress(search);
      if (!hit) {
        note('Address not found. Try a nearby landmark, or drop the pin manually.', 'error');
      } else {
        setHome({ latitude: hit.latitude, longitude: hit.longitude });
      }
    } catch (e) {
      note(e.message, 'error');
    } finally {
      setSearching(false);
    }
  }

  // Move the pin to the address typed in the fields below (address drives pin).
  // Buildings/apartments usually aren't on the free map, so we fall back to the
  // area/pincode and ask the user to nudge the pin to their exact spot.
  async function locateAddress() {
    if (!addr.line1.trim() && !addr.area.trim() && !addr.city.trim() && !addr.pincode.trim()) {
      note('Type your address in the fields below first.', 'error');
      return;
    }
    setLocating(true);
    setStatus('');
    try {
      const hit = await geocodeParts(addr);
      if (!hit) {
        note(
          'Could not find that address on the map. Add area/city/pincode, or drop the pin manually.',
          'error'
        );
      } else {
        setHome({ latitude: hit.latitude, longitude: hit.longitude });
        if (hit.relaxed) {
          note(
            'The exact building isn’t on the map — pinned to the nearest area. Please drag the pin to your building, then Save.',
            'warning'
          );
        } else {
          note('Pin placed ✓ — check it on the map, then Save.', 'success');
        }
      }
    } catch (e) {
      note(e.message, 'error');
    } finally {
      setLocating(false);
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
      note('Location permission denied.', 'error');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setHome({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
  }

  async function save() {
    if (!home) {
      note('Please set your location on the map first.', 'error');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      await saveHomeLocation({
        latitude: home.latitude,
        longitude: home.longitude,
        line1: addr.line1.trim(),
        area: addr.area.trim(),
        city: addr.city.trim(),
        pincode: addr.pincode.trim(),
        landmark: addr.landmark.trim(),
        displayName: resolvedAddr, // readable address for the saved pin
      });
      note('Saved ✓', 'success');
    } catch (e) {
      note(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenContainer scroll style={styles.container}>
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
        {/* Email is the auth identity — always read-only. */}
        <List.Item title="Email" description={u.email} left={(p) => <List.Icon {...p} icon="email" />} />
        <Divider />

        {editing ? (
          <Card.Content style={styles.detailsEdit}>
            <TextInput
              label="Name"
              value={details.name}
              onChangeText={setDetailField('name')}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="Employee ID"
              value={details.empId}
              onChangeText={setDetailField('empId')}
              mode="outlined"
              placeholder="e.g. 1399"
              style={styles.input}
            />
            <TextInput
              label="Phone"
              value={details.phone}
              onChangeText={(t) => setDetailField('phone')(t.replace(/[^0-9]/g, ''))}
              mode="outlined"
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.input}
            />
            {detailsMsg ? (
              <HelperText type={detailsMsg === 'Saved ✓' ? 'info' : 'error'} visible={true}>
                {detailsMsg}
              </HelperText>
            ) : null}
            <View style={styles.detailsBtnRow}>
              <Button
                mode="outlined"
                onPress={() => {
                  setEditing(false);
                  setDetailsMsg('');
                  setDetails({ name: u.name || '', empId: u.empId || '', phone: u.phone || '' });
                }}
                style={styles.detailsBtn}
                disabled={savingDetails}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                icon="content-save"
                onPress={saveDetails}
                loading={savingDetails}
                disabled={savingDetails}
                style={styles.detailsBtn}
              >
                Save
              </Button>
            </View>
          </Card.Content>
        ) : (
          <>
            <List.Item
              title="Employee ID"
              description={u.empId || 'Not set — tap Edit to add'}
              left={(p) => <List.Icon {...p} icon="identifier" />}
            />
            <Divider />
            <List.Item
              title="Phone"
              description={u.phone || 'Not set'}
              left={(p) => <List.Icon {...p} icon="phone" />}
            />
            <Divider />
            <Card.Content style={styles.detailsEditAction}>
              <Button mode="text" icon="pencil" onPress={() => setEditing(true)}>
                Edit details
              </Button>
            </Card.Content>
          </>
        )}
      </Card>

      {isEmployee && (
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">My pickup location</Text>
            <Text variant="bodySmall" style={styles.help}>
              Enter your address below and tap “Locate this address on map”, or
              search / drop a pin / use your current location. The map pin is
              where your cab will come for Office → Home rides.
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
              <LocationPicker
                value={home}
                onChange={setHome}
                address={resolving ? 'Finding address…' : resolvedAddr}
              />
            </View>

            <Button
              mode="outlined"
              icon="crosshairs-gps"
              onPress={useCurrentLocation}
              style={styles.gpsBtn}
            >
              Use my current location
            </Button>

            {home && (
              <View style={styles.pinAddrBox}>
                <Text variant="labelMedium" style={styles.pinAddrLabel}>
                  Pinned location
                </Text>
                <Text variant="bodyMedium" style={styles.pinAddrText}>
                  {resolving
                    ? 'Finding address…'
                    : resolvedAddr ||
                      'No address found for this pin — check the map or fill in your address below.'}
                </Text>
                <Text variant="labelSmall" style={styles.coords}>
                  {home.latitude.toFixed(5)}, {home.longitude.toFixed(5)}
                </Text>
              </View>
            )}

            <Divider style={styles.addrDivider} />
            <Text variant="titleSmall" style={styles.addrHeading}>
              Address details
            </Text>

            <TextInput
              label="Flat / House / Street"
              value={addr.line1}
              onChangeText={setAddrField('line1')}
              mode="outlined"
              placeholder="e.g. Flat 302, Vamsiram Residency"
              style={styles.input}
            />
            <TextInput
              label="Area / Locality"
              value={addr.area}
              onChangeText={setAddrField('area')}
              mode="outlined"
              placeholder="e.g. Kondapur"
              style={styles.input}
            />
            <View style={styles.addrRow}>
              <TextInput
                label="City"
                value={addr.city}
                onChangeText={setAddrField('city')}
                mode="outlined"
                style={[styles.input, styles.addrHalf]}
              />
              <TextInput
                label="Pincode"
                value={addr.pincode}
                onChangeText={(t) => setAddrField('pincode')(t.replace(/[^0-9]/g, ''))}
                mode="outlined"
                keyboardType="number-pad"
                maxLength={6}
                style={[styles.input, styles.addrHalf]}
              />
            </View>
            <TextInput
              label="Landmark (optional)"
              value={addr.landmark}
              onChangeText={setAddrField('landmark')}
              mode="outlined"
              placeholder="e.g. Near Metro pillar 123"
              style={styles.input}
            />

            <Button
              mode="outlined"
              icon="map-marker-check"
              onPress={locateAddress}
              loading={locating}
              disabled={locating}
              style={styles.locateBtn}
            >
              Locate this address on map
            </Button>
            <Text variant="bodySmall" style={styles.locateHint}>
              This drops the pin on the address above. The pin is where your cab
              will come — check it on the map, then Save.
            </Text>

            {status ? (
              <HelperText
                type={statusKind === 'error' ? 'error' : 'info'}
                visible={true}
                style={
                  statusKind === 'success'
                    ? styles.statusSuccess
                    : statusKind === 'warning'
                    ? styles.statusWarning
                    : undefined
                }
              >
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  statusSuccess: { color: '#2E7D32' }, // green — pin placed / saved
  statusWarning: { color: '#B26A00' }, // amber — pinned to area, drag to building
  container: { paddingVertical: 4 },
  header: { alignItems: 'center', marginBottom: 24 },
  name: { marginTop: 12, fontWeight: 'bold' },
  role: { opacity: 0.7 },
  card: { marginBottom: 20 },
  detailsEdit: { paddingTop: 12 },
  detailsEditAction: { alignItems: 'flex-start', paddingVertical: 4 },
  detailsBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  detailsBtn: { flex: 1 },
  help: { opacity: 0.7, marginTop: 4, marginBottom: 12 },
  mapWrap: { marginBottom: 12 },
  gpsBtn: { marginBottom: 12 },
  input: { marginBottom: 8 },
  pinAddrBox: {
    backgroundColor: '#EDF3FB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  pinAddrLabel: { color: '#1565C0', fontWeight: 'bold', marginBottom: 4 },
  pinAddrText: { color: '#1A2233' },
  addrDivider: { marginTop: 8, marginBottom: 12 },
  addrHeading: { marginBottom: 8, fontWeight: 'bold' },
  addrRow: { flexDirection: 'row', gap: 10 },
  addrHalf: { flex: 1 },
  locateBtn: { marginTop: 4, marginBottom: 6 },
  locateHint: { opacity: 0.65, marginBottom: 4 },
  coords: { opacity: 0.6, marginTop: 6 },
  logout: { paddingVertical: 4, marginTop: 4 },
});
