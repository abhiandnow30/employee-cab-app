// ---------------------------------------------------------------------------
// DRIVERS  (coordinator) — the people who drive
//
// This screen owns DRIVER ACCOUNTS: add one, see who exists, and see which cab
// each is on. A driver is a login, not a name written on a vehicle — they sign in
// to see their trips and to share the cab's position, so adding one creates an
// account. No password is invented here; Firebase emails them a link to set their
// own.
//
// The LINK between a driver and a cab is made in ONE place — the Driver dropdown
// on each card of the Fleet screen. This screen shows that relationship from the
// driver's side (read-only), which is how you spot someone with no vehicle.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Chip, Button, Portal, Dialog, TextInput, HelperText, Snackbar,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeDrivers } from '../../services/profile';
import { cabCapacity } from '../../services/cabs';
import { colors } from '../../theme';

const EMPTY = { name: '', email: '', phone: '' };

export default function ManageDriversScreen({ navigation }) {
  const { cabs, addDriverAccount, removeDriver, currentUser } = useApp();

  // HR/Admin sees the drivers and which cab each is on; the coordinator owns the
  // list, because they are the one who hires and rosters them onto vehicles.
  const readOnly = currentUser?.role === 'admin';
  const [drivers, setDrivers] = useState([]);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState('');
  // The driver whose removal is being confirmed, and why it was refused if it was.
  const [removeFor, setRemoveFor] = useState(null);
  const [removeError, setRemoveError] = useState('');

  useEffect(() => {
    const unsub = subscribeDrivers(setDrivers, (e) => setError(e.message));
    return unsub;
  }, []);

  function openAdd() {
    setForm(EMPTY);
    setFormError('');
    setFormOpen(true);
  }

  async function saveDriver() {
    setFormError('');
    setBusy(true);
    const res = await addDriverAccount(form);
    setBusy(false);
    if (res?.ok) {
      setFormOpen(false);
      setSnack(
        res.emailed
          ? `${form.name} added — emailed a link to set their password.`
          : `${form.name} added, but the set-password email didn't send. They can use "Forgot password" on the login screen.`
      );
    } else {
      setFormError(res?.message || 'Could not add that driver.');
    }
  }

  function openRemove(driver) {
    setRemoveError('');
    setRemoveFor(driver);
  }

  async function confirmRemove() {
    const driver = removeFor;
    if (!driver) return;
    setRemoveError('');
    setBusy(true);
    const res = await removeDriver(driver.uid);
    setBusy(false);
    if (res?.ok) {
      setRemoveFor(null);
      setSnack(
        res.unlinkedCab
          ? `${driver.name || driver.email} removed. ${res.unlinkedCab} now has no driver.`
          : `${driver.name || driver.email} removed.`
      );
    } else {
      // Stay open. The usual refusal is "link a replacement to that cab first",
      // which is something to read and act on — not a message to dismiss.
      setRemoveError(res?.message || 'Could not remove that driver.');
    }
  }

  // The cab this driver is on, found by which cab POINTS AT them rather than by
  // their profile's stored cabId, so the two sides can never appear to disagree.
  const cabOf = (uid) => cabs.find((c) => c.driverUid === uid) || null;

  function renderDriver({ item }) {
    const cab = cabOf(item.uid);
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium" style={styles.nameCol} numberOfLines={1}>
              {item.name || item.email}
            </Text>
            <Chip
              compact
              icon={cab ? 'car' : 'car-off'}
              style={{ backgroundColor: cab ? '#E7F4E8' : '#FFF3E0' }}
              textStyle={{ color: cab ? colors.success : '#E65100', fontSize: 12 }}
            >
              {cab ? 'Linked' : 'No cab'}
            </Chip>
            {readOnly ? null : (
              <IconButton
                icon="delete"
                size={20}
                iconColor={colors.danger}
                onPress={() => openRemove(item)}
                accessibilityLabel={`Remove ${item.name || item.email}`}
              />
            )}
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
        <View style={styles.topBar}>
          <Text variant="bodySmall" style={styles.hint}>
            {readOnly
              ? 'The people who drive, and the cab each one is on. The coordinator maintains this list.'
              : 'The people who drive. Which cab each one takes is set on the Fleet screen — this is the same link seen from the driver’s side.'}
          </Text>
          {readOnly ? null : (
            <Button mode="contained" icon="account-plus" onPress={openAdd}>
              Add driver
            </Button>
          )}
        </View>
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
                {readOnly
                  ? 'The coordinator adds drivers on this screen.'
                  : 'Add one here, or let them sign up themselves from the login screen.'}
              </Text>
              {readOnly ? null : (
                <Button mode="contained" icon="account-plus" onPress={openAdd}>
                  Add your first driver
                </Button>
              )}
            </View>
          }
        />
      </View>

      <Portal>
        <Dialog visible={formOpen} onDismiss={() => !busy && setFormOpen(false)} style={styles.dialog}>
          <Dialog.Title>Add driver</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Name"
              value={form.name}
              onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="Email (their login)"
              value={form.email}
              onChangeText={(t) => setForm((f) => ({ ...f, email: t.trim() }))}
              mode="outlined"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              label="Phone"
              value={form.phone}
              onChangeText={(t) =>
                setForm((f) => ({ ...f, phone: t.replace(/[^0-9]/g, '').slice(0, 10) }))
              }
              mode="outlined"
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.input}
            />
            <HelperText type="info" visible>
              They're emailed a link to set their own password — you don't create or
              share one. Link them to a cab on the Fleet screen afterwards.
            </HelperText>
            {formError ? <HelperText type="error" visible>{formError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button mode="contained" onPress={saveDriver} loading={busy} disabled={busy}>
              Add driver
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Remove a driver who has left */}
        <Dialog
          visible={!!removeFor}
          onDismiss={() => !busy && setRemoveFor(null)}
          style={styles.dialog}
        >
          <Dialog.Title>Remove {removeFor?.name || removeFor?.email}?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              They lose access to the app immediately and disappear from this list.
              Any cab they were driving is left with no driver, and completed trips
              keep their record.
            </Text>
            <View style={styles.noteBox}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.muted} />
              <Text variant="bodySmall" style={styles.noteText}>
                Their login still exists in Firebase — with no profile it can't do
                anything, but delete the user under Authentication in the Firebase
                console if you want to revoke sign-in completely.
              </Text>
            </View>
            {removeError ? (
              <View style={styles.blockedBox}>
                <MaterialCommunityIcons name="cancel" size={16} color={colors.danger} />
                <Text variant="bodySmall" style={styles.blockedText}>
                  {removeError}
                </Text>
              </View>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRemoveFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={confirmRemove}
              loading={busy}
              disabled={busy}
            >
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={5000}>
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
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  input: { marginBottom: 10, backgroundColor: colors.surface },
  nameCol: { flex: 1 },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  noteText: { color: colors.muted, flex: 1, lineHeight: 18 },
  blockedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    backgroundColor: '#FEF3F3',
    borderRadius: 8,
    padding: 10,
  },
  blockedText: { color: colors.danger, flex: 1, lineHeight: 18 },
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
