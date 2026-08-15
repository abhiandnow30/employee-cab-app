// ---------------------------------------------------------------------------
// COORDINATORS  (HR / Admin) — the transport desk
//
// Owns COORDINATOR ACCOUNTS: add one, read out their passcode, re-issue it, or
// remove them.
//
// A NAME AND A PHONE IS THE WHOLE FORM. There is no email: a coordinator signs
// in with their phone number plus a short numeric passcode generated here and handed
// to them by HR. The Auth address is synthesized from the phone and nobody ever
// types or reads it — see utils/coordinatorLogin.js for the scheme.
//
// NOTHING IS PENDING HERE. Employees are INVITED and only become real accounts
// on their first Microsoft sign-in, which is why the Employees page carries a
// "waiting for their first sign-in" list. A coordinator is a full account the
// moment this screen saves, so they can be used immediately — that is the point
// of provisioning them this way rather than through an invite.
//
// THE PASSCODE IS SHOWN, DELIBERATELY. It is the only record of it anywhere:
// it is random, so unlike a driver's cab-derived code nothing can recompute it.
// If it is lost, HR re-issues it here; there is no self-service reset, because
// there is no mailbox to send one to.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Portal, Dialog, TextInput, HelperText, Snackbar, IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeCoordinators, subscribeInvites, adminRevokeInvite } from '../../services/profile';
import { formatPasscode } from '../../utils/coordinatorLogin';
import { colors } from '../../theme';

const EMPTY = { name: '', phone: '' };

export default function ManageCoordinatorsScreen() {
  const { addCoordinatorAccount, regenerateCoordinatorPasscode, adminRemoveEmployee } = useApp();

  const [coordinators, setCoordinators] = useState([]);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeFor, setRemoveFor] = useState(null);
  // Unclaimed coordinator invites left by the old Microsoft flow — see below.
  const [staleInvites, setStaleInvites] = useState([]);
  const [clearing, setClearing] = useState(false);
  // The uid whose passcode is being re-issued, so only that card shows a spinner.
  const [regenFor, setRegenFor] = useState('');
  // The passcode of a JUST-CREATED coordinator, shown once in its own dialog.
  // It is on their card too, but a code that only appeared in a list is a code
  // nobody notices they were supposed to write down.
  const [issued, setIssued] = useState(null);

  useEffect(() => {
    const unsub = subscribeCoordinators(setCoordinators, (e) => setError(e.message));
    return unsub;
  }, []);

  // LEFTOVERS FROM THE OLD SIGN-IN METHOD, and nothing else.
  //
  // Coordinators used to be provisioned like employees: an invite filed under
  // their email, claimed on their first Microsoft sign-in. That is gone — they
  // now get a real account and a passcode the moment they are added — but any
  // invite filed before the change is still sitting in employeeInvites, showing
  // on no screen and still claimable. Whoever it names could sign in with
  // Microsoft and become a coordinator with no passcode at all.
  //
  // This block is SELF-RETIRING: nothing creates a coordinator invite any more,
  // so once these are cleared it never appears again.
  useEffect(() => {
    const unsub = subscribeInvites(
      (list) => setStaleInvites(list.filter((i) => i.role === 'coordinator')),
      () => setStaleInvites([])
    );
    return unsub;
  }, []);

  function openAdd() {
    setForm(EMPTY);
    setFormError('');
    setFormOpen(true);
  }

  async function save() {
    setFormError('');
    setBusy(true);
    const res = await addCoordinatorAccount(form);
    setBusy(false);
    if (res?.ok) {
      setFormOpen(false);
      setIssued({ name: form.name.trim(), phone: form.phone, passcode: res.passcode });
    } else {
      setFormError(res?.message || 'Could not add that coordinator.');
    }
  }

  async function regenerate(coordinator) {
    setRegenFor(coordinator.uid);
    const res = await regenerateCoordinatorPasscode(coordinator);
    setRegenFor('');
    if (res?.ok) {
      setIssued({
        name: coordinator.name || coordinator.phone,
        phone: coordinator.phone,
        passcode: res.passcode,
        reissued: true,
      });
    } else {
      setError(res?.message || 'Could not re-issue that passcode.');
    }
  }

  // Revoke every leftover invite. Each is independent, so one failure must not
  // abandon the rest — they are reported together at the end instead.
  async function clearStaleInvites() {
    setClearing(true);
    setError('');
    const failed = [];
    for (const invite of staleInvites) {
      try {
        await adminRevokeInvite(invite.email);
      } catch {
        failed.push(invite.email);
      }
    }
    setClearing(false);
    if (failed.length) {
      setError(`Could not remove ${failed.length} of them: ${failed.join(', ')}.`);
    } else {
      setSnack(
        `Removed ${staleInvites.length} old invite${staleInvites.length === 1 ? '' : 's'}. Nobody can claim a coordinator account from them now.`
      );
    }
  }

  async function confirmRemove() {
    const who = removeFor;
    if (!who) return;
    setBusy(true);
    const res = await adminRemoveEmployee(who.uid);
    setBusy(false);
    setRemoveFor(null);
    if (res?.ok) setSnack(`${who.name || who.phone} removed.`);
    else setError(res?.message || 'Could not remove that coordinator.');
  }

  return (
    <View style={styles.screen}>
      <View style={styles.col}>
        <View style={styles.topBar}>
          <Text variant="bodySmall" style={styles.hint}>
            Coordinators run the daily cab assignment and resolve change requests.
            They sign in with their phone number and the passcode shown on their
            card — no email, no password to set.
          </Text>
          <Button mode="contained" icon="account-plus" onPress={openAdd}>
            Add coordinator
          </Button>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          data={coordinators}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={styles.list}
          /* Leftover invites from the old Microsoft flow. Above the list because
             it is a thing to action, not a thing to read — and it disappears for
             good once cleared. */
          ListHeaderComponent={
            staleInvites.length ? (
              <View style={styles.staleBox}>
                <View style={styles.staleHead}>
                  <MaterialCommunityIcons name="alert-outline" size={18} color="#B26A00" />
                  <Text variant="labelLarge" style={styles.staleTitle}>
                    {staleInvites.length} old coordinator invite
                    {staleInvites.length === 1 ? '' : 's'} to clear
                  </Text>
                </View>
                <Text variant="bodySmall" style={styles.staleHint}>
                  Filed under the previous sign-in method, before coordinators used
                  a phone and passcode. They are not accounts and appear nowhere
                  else — but whoever they name could still sign in with Microsoft
                  and become a coordinator without a passcode. Removing them does
                  not affect anyone already listed below.
                </Text>
                {staleInvites.map((i) => (
                  <Text
                    key={i.email}
                    variant="bodySmall"
                    style={styles.staleRow}
                    numberOfLines={1}
                  >
                    {i.name ? `${i.name} · ` : ''}
                    {i.email}
                  </Text>
                ))}
                <Button
                  mode="contained"
                  icon="delete-sweep"
                  buttonColor="#B26A00"
                  onPress={clearStaleInvites}
                  loading={clearing}
                  disabled={clearing}
                  style={styles.staleBtn}
                >
                  Remove {staleInvites.length === 1 ? 'it' : `all ${staleInvites.length}`}
                </Button>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Card mode="elevated" style={styles.card}>
              <Card.Content>
                <View style={styles.rowBetween}>
                  <View style={styles.cardText}>
                    <Text variant="titleSmall" style={styles.name} numberOfLines={1}>
                      {item.name || item.phone}
                    </Text>
                    <Text variant="bodySmall" style={styles.meta} numberOfLines={1}>
                      {item.phone || 'No phone on file'}
                    </Text>
                  </View>
                  <IconButton
                    icon="delete"
                    size={20}
                    iconColor={colors.danger}
                    onPress={() => setRemoveFor(item)}
                    accessibilityLabel={`Remove ${item.name || item.phone}`}
                  />
                </View>

                {/* Their login, in full. Both halves together, because reading
                    out one without the other is useless to them. */}
                <View style={styles.codeBox}>
                  <MaterialCommunityIcons
                    name="shield-key-outline"
                    size={18}
                    color={colors.primary}
                  />
                  <View style={styles.codeText}>
                    <Text variant="labelSmall" style={styles.codeLabel}>
                      Signs in with
                    </Text>
                    <Text variant="titleMedium" style={styles.code} selectable>
                      {item.phone || '—'} · {item.loginCode ? formatPasscode(item.loginCode) : '—'}
                    </Text>
                  </View>
                  <Button
                    mode="text"
                    compact
                    icon="refresh"
                    onPress={() => regenerate(item)}
                    loading={regenFor === item.uid}
                    disabled={!!regenFor || !item.loginCode}
                  >
                    New code
                  </Button>
                </View>
              </Card.Content>
            </Card>
          )}
          /* No button here. "Add coordinator" is already in the top bar and
             stays there whether the list is empty or not, so repeating it in the
             empty state put two identical actions on screen at once — and moved
             the one people had just learned the position of. */
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="headset" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No coordinators yet. Use “Add coordinator” above — they can sign in
                straight away with the passcode you'll be shown.
              </Text>
            </View>
          }
        />
      </View>

      <Portal>
        <Dialog
          visible={formOpen}
          onDismiss={() => !busy && setFormOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Title>Add Coordinator</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodySmall" style={styles.dialogHint}>
              A name and a phone number is all it takes. No email and no password:
              a 4-digit passcode is generated when you save, and they sign in with
              that plus this phone number.
            </Text>
            <TextInput
              label="Name"
              value={form.name}
              onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="Phone (this is their login)"
              value={form.phone}
              onChangeText={(t) => setForm((f) => ({ ...f, phone: t.replace(/[^0-9]/g, '') }))}
              mode="outlined"
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.input}
            />
            {formError ? <HelperText type="error" visible>{formError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button mode="contained" onPress={save} loading={busy} disabled={busy}>
              Create account
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* The passcode, the one moment it is new. It stays on their card, so this
          is a prompt to write it down rather than the only chance to see it. */}
      <Portal>
        <Dialog visible={!!issued} onDismiss={() => setIssued(null)} style={styles.dialog}>
          <Dialog.Title>
            {issued?.reissued ? 'New passcode issued' : `${issued?.name || 'Coordinator'} added`}
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.issuedIntro}>
              Give {issued?.name || 'them'} these two numbers. They sign in with them
              straight away — there is nothing for them to set up.
            </Text>
            <View style={styles.issuedBox}>
              <Text variant="labelSmall" style={styles.codeLabel}>
                Phone
              </Text>
              <Text variant="headlineSmall" style={styles.issuedValue} selectable>
                {issued?.phone}
              </Text>
              <Text variant="labelSmall" style={[styles.codeLabel, styles.issuedSpacer]}>
                Passcode
              </Text>
              <Text variant="headlineSmall" style={styles.issuedValue} selectable>
                {formatPasscode(issued?.passcode || '')}
              </Text>
            </View>
            {issued?.reissued ? (
              <HelperText type="info" visible>
                Their previous passcode stopped working the moment this was issued.
              </HelperText>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button mode="contained" onPress={() => setIssued(null)}>
              Done
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog visible={!!removeFor} onDismiss={() => setRemoveFor(null)} style={styles.dialog}>
          <Dialog.Title>Remove coordinator?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {removeFor?.name || removeFor?.phone} loses access to the coordinator
              screens. Rides they already assigned are not affected.
            </Text>
            <HelperText type="info" visible>
              Their sign-in itself survives — only the Admin SDK can delete that —
              so the same phone number cannot be added again until it is removed in
              the Firebase console.
            </HelperText>
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
  screen: { flex: 1, backgroundColor: colors.background },
  col: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  hint: { color: colors.muted, flex: 1, minWidth: 260, lineHeight: 18 },
  error: { color: colors.danger, paddingHorizontal: 12, paddingTop: 8 },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardText: { flex: 1 },
  name: { color: colors.text },
  meta: { color: colors.muted, marginTop: 1 },

  // Leftover-invite cleanup. Amber rather than the usual blue: this is something
  // to action once and be rid of, not standing information.
  staleBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0D9A8',
    backgroundColor: '#FFF6E5',
    padding: 14,
    marginBottom: 14,
  },
  staleHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  staleTitle: { color: '#B26A00' },
  staleHint: { color: '#8A5A12', lineHeight: 18, marginTop: 4, marginBottom: 8 },
  staleRow: { color: '#8A5A12', fontWeight: '600', paddingVertical: 2 },
  staleBtn: { marginTop: 12, alignSelf: 'flex-start', borderRadius: 10 },

  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: '#F2F6FF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexWrap: 'wrap',
  },
  codeText: { flex: 1, minWidth: 160 },
  codeLabel: { color: colors.muted },
  code: { color: colors.text, fontWeight: '700', letterSpacing: 0.5 },

  issuedIntro: { marginBottom: 12, lineHeight: 20 },
  issuedBox: {
    borderRadius: 12,
    backgroundColor: '#F2F6FF',
    padding: 14,
  },
  issuedValue: { color: colors.primary, fontWeight: '700', letterSpacing: 1 },
  issuedSpacer: { marginTop: 10 },

  empty: { alignItems: 'center', marginTop: 50, gap: 10, paddingHorizontal: 24 },
  emptyText: { color: colors.muted, textAlign: 'center', lineHeight: 20 },

  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  dialogHint: { color: colors.muted, marginBottom: 12, lineHeight: 18 },
  input: { marginBottom: 10 },
});
