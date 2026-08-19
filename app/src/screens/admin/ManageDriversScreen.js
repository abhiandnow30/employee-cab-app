// ---------------------------------------------------------------------------
// DRIVERS  (coordinator) — the people who drive
//
// This screen owns DRIVER ACCOUNTS: add one, see who exists, and see which cab each
// is on. A driver is a login, not a name written on a vehicle — they sign in to see
// their trips and to share the cab's position, so adding one creates an account.
//
// IT NO LONGER PRINTS ANYONE'S LOGIN CODE (Aug 2026). The code is the driver's cab's
// last 4 digits followed by their own mobile, so the desk states that rule and the
// driver assembles it from the vehicle in front of them — displaying the join put a
// working password on a shared screen for no gain, since the cab and the phone are
// both already on the card. The drift warning stays: it is the only case where the
// rule doesn't hold, and the only thing that should ever prompt a "Fix code".
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
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Chip, Button, Portal, Dialog, TextInput, HelperText, Snackbar,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeDrivers } from '../../services/profile';
import { cabCapacity } from '../../services/cabs';
import {
  // No formatter here any more — the code is never rendered. These two compute what
  // the cab link (or the lack of one) implies, purely to detect drift.
  driverLoginCode, unassignedLoginCode,
} from '../../utils/driverLogin';
import { colors, font, radius, shadow, spacing } from '../../theme';

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
    // Says that it worked, not what the code is. A successful fix sets the stored
    // code TO the value the cab link implies, so after this the spoken rule ("last 4
    // digits of the cab, then your mobile") is correct again — which is the useful
    // thing to tell the desk, and it isn't a secret.
    setSnack(
      res?.ok
        ? res.code
          ? `Fixed. ${driver.name || 'That driver'} signs in with their cab's last 4 digits followed by their mobile number.`
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
    // NO CODE IS DISPLAYED. It is the cab's last 4 digits followed by this driver's
    // mobile — the cab is named on this card and the phone is two lines above it, so
    // printing the join only put a live password on a shared screen. The desk states
    // the rule instead; see the header hint at the bottom of this file.

    // The cab link's implied code is still computed, purely to compare. The two agree in
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
              style={{ backgroundColor: cab ? colors.successSoft : colors.warningSoft }}
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
              Not linked to a cab, so no trips can be assigned and they cannot sign in
              at all. Link one on the Cabs tab.
            </Text>
          )}

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
                    ? `This driver is on ${cab.cabNumber}, but the code on file doesn't match it — "last 4 digits + your mobile" will NOT let them in until this is fixed.`
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
              : 'The people who drive. Which cab each one takes is set on the Fleet screen — this is the same link seen from the driver’s side. They sign in with their cab’s last 4 digits followed by their own mobile number.'}
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
  container: { flex: 1, backgroundColor: colors.background },
  centerCol: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xs,
    flexWrap: 'wrap',
  },
  hint: { color: colors.muted, flex: 1, minWidth: 200, lineHeight: 19 },
  dialog: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  nameCol: { flex: 1, minWidth: 0 },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  noteText: { color: colors.muted, flex: 1, lineHeight: 19 },
  blockedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  blockedText: { color: colors.danger, flex: 1, lineHeight: 19 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detail: { color: colors.muted, marginTop: spacing.xs },
  cabBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  cabText: { color: colors.primaryDark, fontFamily: font.semibold },
  codeBoxWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  codeCol: { flex: 1, minWidth: 0 },
  codeLabel: { color: colors.muted },
  codeWarnText: { color: '#C2410C', lineHeight: 19 },
  pending: { color: '#C2410C', marginTop: spacing.sm, lineHeight: 19 },
  error: { color: colors.danger, padding: spacing.lg },
  empty: {
    alignItems: 'center',
    marginTop: 56,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyText: { color: colors.text, fontFamily: font.semibold },
  emptyHint: { color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
