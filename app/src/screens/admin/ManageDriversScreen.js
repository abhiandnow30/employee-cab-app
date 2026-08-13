// ---------------------------------------------------------------------------
// DRIVERS  (coordinator) — the people who drive
//
// This screen owns DRIVER ACCOUNTS: add one, see who exists, see which cab each is
// on, and read out the code each one signs in with. A driver is a login, not a name
// written on a vehicle — they sign in to see their trips and to share the cab's
// position, so adding one creates an account.
//
// A NAME AND A PHONE IS THE WHOLE FORM. There is no email and no password: the
// phone derives the address Firebase keys the account by, and the code the driver
// actually types is the last 4 digits of their cab number plus that same phone —
// see utils/driverLogin.js. So a driver added here cannot sign in yet, on purpose.
// The code comes into existence when they are linked to a cab.
//
// The LINK between a driver and a cab is made in ONE place — the Driver dropdown
// on each card of the Cabs tab. This screen shows that relationship from the
// driver's side (read-only), which is how you spot someone with no vehicle, and
// therefore no code.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList, Platform } from 'react-native';
import {
  Text, Card, Chip, Button, Portal, Dialog, TextInput, HelperText, Snackbar,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeDrivers } from '../../services/profile';
import { cabCapacity } from '../../services/cabs';
import {
  formatLoginCode, isShareableCode, driverLoginCode, unassignedLoginCode,
} from '../../utils/driverLogin';
import { colors } from '../../theme';

const EMPTY = { name: '', phone: '' };

export default function ManageDriversScreen({ navigation }) {
  const {
    cabs, addDriverAccount, removeDriver, regenerateDriverCode, currentUser,
  } = useApp();

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
  // The uid whose code is being re-issued, so only that card shows a spinner.
  const [regenFor, setRegenFor] = useState('');

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
      // Say what is still missing. A driver with no cab has no code, so "added"
      // on its own reads as "ready", and the desk would go looking for a code
      // that isn't due yet.
      setSnack(`${form.name} added. Link them to a cab to give them a login code.`);
    } else {
      setFormError(res?.message || 'Could not add that driver.');
    }
  }

  // Put a drifted code back in step with the cab link — the one thing linking and
  // unlinking cannot fix by themselves, since by definition the rotation they'd
  // normally do is the thing that failed.
  async function regenerate(driver) {
    setRegenFor(driver.uid);
    const res = await regenerateDriverCode(driver);
    setRegenFor('');
    setSnack(
      res?.ok
        ? res.code
          ? `Login code for ${driver.name || 'that driver'}: ${formatLoginCode(res.code)}`
          : `${driver.name || 'That driver'}'s old login code has been withdrawn.`
        : res?.message || 'Could not fix that code.'
    );
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
          ? `${driver.name || driver.phone} removed. ${res.unlinkedCab} now has no driver.`
          : `${driver.name || driver.phone} removed.`
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
    // Display the code STORED on the profile, never one recomputed here — the
    // stored value mirrors the actual Firebase password, so a locally derived one
    // would look perfectly plausible while signing nobody in.
    const code = isShareableCode(item.loginCode) ? item.loginCode : '';

    // But DO compute what the cab link implies, purely to compare. The two agree in
    // every normal case; they disagree only when a rotation stopped halfway (the
    // password changed and the mirror didn't, or neither did while the cab moved on)
    // — and that is the entire reason a repair action exists. Detecting it here is
    // what lets the repair stay hidden until there is something to repair, instead
    // of sitting on every card forever inviting a press.
    const expected = cab
      ? driverLoginCode(cab.cabNumber, item.phone)
      : unassignedLoginCode(item.phone);
    const drifted = !!expected && item.loginCode !== expected;
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text variant="titleMedium" style={styles.nameCol} numberOfLines={1}>
              {item.name || item.phone}
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
                accessibilityLabel={`Remove ${item.name || item.phone}`}
              />
            )}
          </View>

          {/* Phone only. Their stored `email` is a synthesized address on an
              unroutable domain — showing it would invite someone to try mailing
              it. See utils/driverLogin.js. */}
          <Text variant="bodySmall" style={styles.detail}>
            {item.phone || 'No phone'}
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
              Not linked to a cab, so no trips can be assigned and there is no login
              code yet. Link one on the Cabs tab.
            </Text>
          )}

          {/* THE CODE, when there is one and it is trustworthy. Selectable so it can
              be copied on the web, and spaced into its two halves so it can be read
              out over the phone. */}
          {cab && code && !drifted ? (
            <View style={styles.codeBox}>
              <MaterialCommunityIcons name="dialpad" size={16} color={colors.primaryDark} />
              <View style={styles.codeCol}>
                <Text variant="bodySmall" style={styles.codeLabel}>
                  Login code
                </Text>
                <Text variant="titleMedium" style={styles.codeValue} selectable>
                  {formatLoginCode(code)}
                </Text>
              </View>
            </View>
          ) : null}

          {/* ONLY WHEN SOMETHING IS ACTUALLY WRONG. Says which way it is wrong,
              because the two directions have opposite consequences: a code that
              doesn't work yet, versus an old one that still does. */}
          {drifted ? (
            <View style={styles.codeBoxWarn}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#E65100" />
              <View style={styles.codeCol}>
                <Text variant="bodySmall" style={styles.codeLabel}>
                  Login code needs fixing
                </Text>
                <Text variant="bodySmall" style={styles.codeWarnText}>
                  {cab
                    ? `This driver is on ${cab.cabNumber}, but the code on file doesn't match it. Don't hand it out — fix it first.`
                    : 'This driver has no cab, but an old code of theirs may still work. Fixing it withdraws that code.'}
                </Text>
              </View>
              {readOnly ? null : (
                <Button
                  mode="contained"
                  compact
                  onPress={() => regenerate(item)}
                  loading={regenFor === item.uid}
                  disabled={!!regenFor || busy}
                >
                  Fix code
                </Button>
              )}
            </View>
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
                  : 'Add one here — a name and a phone number is all it takes. Drivers cannot sign themselves up.'}
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
            {/* The phone is not a detail here — it is half of their login code and
                the thing Firebase keys the account by, so it is required and one
                phone means one driver. */}
            <TextInput
              label="Phone (part of their login code)"
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
              No email and no password. They sign in with a code — the last 4 digits
              of their cab number plus this phone number — which appears here once
              you link them to a cab on the Cabs tab.
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
          <Dialog.Title>Remove {removeFor?.name || removeFor?.phone}?</Dialog.Title>
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
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F0FA',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  codeBoxWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  codeCol: { flex: 1 },
  codeLabel: { color: colors.muted },
  // Monospaced and loosely tracked: this gets read aloud and typed in by hand, so
  // 0/O and 1/l must not be a guess.
  codeValue: {
    color: colors.text,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeWarnText: { color: '#E65100', lineHeight: 18 },
  pending: { color: '#E65100', marginTop: 8, lineHeight: 18 },
  error: { color: colors.danger, padding: 12 },
  empty: { alignItems: 'center', marginTop: 50, gap: 8, paddingHorizontal: 24 },
  emptyText: { color: colors.muted },
  emptyHint: { color: colors.muted, textAlign: 'center', lineHeight: 18 },
});
