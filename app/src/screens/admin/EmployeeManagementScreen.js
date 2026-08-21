// ---------------------------------------------------------------------------
// EMPLOYEE MANAGEMENT  (admin)
// The transport desk owns employee profile data. Here the admin can:
//   • ADD a new employee — creates their login account + profile in one step.
//   • EDIT Employee ID, name, phone, department and home address.
//   • DELETE an employee's profile when they leave the organisation.
// Email is the login identity (Firebase Auth) and is shown read-only after
// creation.
//
// Employees themselves see a read-only profile — the Firestore security rules
// block them from writing their own profile, so this screen is the only way
// these fields change (address also changes via approved address requests).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Divider, TextInput, Snackbar, HelperText,
  IconButton, Portal, Dialog,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeEmployees, subscribeInvites } from '../../services/profile';
import useSyncedDraft from '../../utils/useSyncedDraft';
import { colors, font, radius, shadow, spacing } from '../../theme';

function draftOf(emp, homeAddressOf) {
  return {
    empId: emp.empId || '',
    name: emp.name || '',
    phone: emp.phone || '',
    address: emp.address || homeAddressOf(emp) || '',
    // The pickup route the coordinator groups this person's rides under. Lives at
    // roster.route, so it is saved separately from the fields above.
    route: emp.roster?.route || null,
  };
}

// No `password`: nobody provisioned from here gets one — they sign in with
// Microsoft. `role` is pinned to 'employee' and never changes: coordinators are
// added on the Coordinators tab and drivers on the Drivers tab. It is still sent,
// because adminCreateEmployee branches on it.
const EMPTY_NEW = {
  role: 'employee', email: '', empId: '', name: '', phone: '', address: '',
  route: null,
};

function EmployeeCard({ emp, onSave, onDelete, homeAddressOf, routeOptions }) {
  // Draft over the LIVE profile, so a change made elsewhere (an approved address
  // request, another admin) is picked up while this card is untouched. Seeding
  // once at mount meant a Save could overwrite newer data with a stale copy.
  const live = useMemo(() => draftOf(emp, homeAddressOf), [emp, homeAddressOf]);
  const [draft, setDraft, draftState] = useSyncedDraft(live);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const setField = (key) => (t) => setDraft((d) => ({ ...d, [key]: t }));

  async function handleSave() {
    setMsg('');
    if (!draft.empId.trim()) {
      setMsg('Employee ID is required.');
      return;
    }
    setSaving(true);
    const res = await onSave(emp.uid, {
      empId: draft.empId.trim(),
      name: draft.name.trim() || emp.email,
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      route: draft.route || null,
    });
    setSaving(false);
    setMsg(res?.ok ? 'Saved ✓' : res?.message || 'Could not save.');
  }

  return (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <View style={styles.rowBetween}>
          <View style={styles.cardHeadText}>
            <Text variant="titleMedium" numberOfLines={1}>{emp.name || emp.email}</Text>
            <Text variant="bodySmall" style={styles.email}>{emp.email}</Text>
          </View>
          <IconButton
            icon="trash-can-outline"
            iconColor={colors.danger}
            size={22}
            onPress={() => onDelete(emp)}
            style={styles.deleteBtn}
          />
        </View>

        <Divider style={styles.divider} />

        <TextInput
          label="Employee ID"
          value={draft.empId}
          onChangeText={setField('empId')}
          mode="outlined"
          placeholder="e.g. 1399"
          style={styles.input}
        />
        <TextInput
          label="Name"
          value={draft.name}
          onChangeText={setField('name')}
          mode="outlined"
          style={styles.input}
        />
        <TextInput
          label="Phone"
          value={draft.phone}
          onChangeText={(t) => setField('phone')(t.replace(/[^0-9]/g, ''))}
          mode="outlined"
          keyboardType="phone-pad"
          maxLength={10}
          style={styles.input}
        />
        <TextInput
          label="Home Address"
          value={draft.address}
          onChangeText={setField('address')}
          mode="outlined"
          multiline
          placeholder="Flat / House, Street, Area, City, Pincode"
          style={styles.input}
        />

        {/* The route is what puts this person in a cab with their neighbours.
            Without one they sit under "No route set" on the coordinator's board
            and have to be grouped by hand every day of the month.

            FREE TEXT, not a picker. The route list used to be maintained on a
            Routes & Timings screen and this was a dropdown over it; that screen
            is gone and routes now arrive with the monthly sheet, so there is no
            fixed list to choose from. Capitalisation and spacing are snapped to
            the spelling already in use when this saves (snapRoute in
            AppContext), so typing "jntu cab" still lands on "JNTU Cab". */}
        <TextInput
          label="Pickup route"
          value={draft.route || ''}
          onChangeText={(route) => setDraft((d) => ({ ...d, route }))}
          mode="outlined"
          placeholder="e.g. JNTU Cab"
          left={<TextInput.Icon icon="map-marker-outline" />}
          error={!draft.route}
          style={styles.input}
        />
        <HelperText type={draft.route ? 'info' : 'error'} visible>
          {draft.route
            ? 'Usually set by the monthly roster upload. Edit it here only to correct one person.'
            : "No route set — the coordinator can't group this person into a cab."}
        </HelperText>

        {msg ? (
          <HelperText type={msg.startsWith('Saved') ? 'info' : 'error'} visible>
            {msg}
          </HelperText>
        ) : null}

        <Button
          mode="contained"
          icon="content-save"
          onPress={handleSave}
          loading={saving}
          disabled={saving || !draftState.dirty}
          style={styles.saveBtn}
        >
          {draftState.dirty ? 'Save' : 'Saved'}
        </Button>
      </Card.Content>
    </Card>
  );
}

// The "Add employee" dialog — creates a profile for an EMPLOYEE, and nothing
// else. Every field here is a rider's: an employee id, a home address to be
// collected from, a route to be grouped on.
//
// It had a role selector once, and neither of the other two roles belonged in
// it. A DRIVER isn't a Microsoft account at all — no email, no employee id, no
// address, no route — and a COORDINATOR is an account but not a rider, so
// picking that tab blanked half the form. Each now has its own screen
// (ManageDriversScreen, ManageCoordinatorsScreen); this one asks six questions
// and means all six.
//
// DRIVERS ARE NOT CREATED HERE. This dialog offered a Driver role once, which
// put two different provisioning routes on two different screens for the same
// thing. A driver isn't a rider and isn't a Microsoft account — no email, no
// employee id, no address, no route — so it shared almost nothing with this form
// beyond a name and a phone. They're created on the Drivers tab
// (ManageDriversScreen), which is also where the cab link that issues their
// login code lives. One account, one place.
// The phone starts EMPTY. It used to be pre-filled with one fixed company
// number, which meant every profile created here shipped with somebody else's
// number on it unless the admin noticed and replaced it — and a wrong number
// looks exactly like a right one.
function AddEmployeeDialog({ visible, onDismiss, onCreate, routeOptions = [] }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_NEW }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setField = (key) => (t) => setForm((f) => ({ ...f, [key]: t }));

  function close() {
    setForm({ ...EMPTY_NEW });
    setError('');
    setBusy(false);
    onDismiss();
  }

  async function submit() {
    setError('');
    // Validate up front so the admin gets a clear message instead of a raw
    // Firebase error after a round-trip. The email is what their Microsoft
    // sign-in has to match, so it is required for everyone this dialog creates.
    if (!form.email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!form.empId.trim()) {
      setError('Employee ID is required.');
      return;
    }
    setBusy(true);
    const res = await onCreate(form);
    setBusy(false);
    if (res?.ok) {
      close();
    } else {
      setError(res?.message || 'Could not create the account.');
    }
  }

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={close} style={styles.dialog}>
        <Dialog.Title>Add Employee</Dialog.Title>
        <Dialog.ScrollArea>
          <View style={styles.dialogBody}>
            <Text variant="bodySmall" style={styles.dialogHint}>
              No password is created. They sign in with their company Microsoft
              account and their profile is set up automatically the first time —
              just make sure the email below is right.
            </Text>

            {/* An employee is identified by their company address — it is what
                their Microsoft sign-in has to match. There is no password field:
                see the dialog hint above. */}
            <TextInput
              label="Email (login)"
              value={form.email}
              onChangeText={(t) => setField('email')(t.trim())}
              mode="outlined"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              label="Employee ID"
              value={form.empId}
              onChangeText={setField('empId')}
              mode="outlined"
              placeholder="e.g. 1399"
              style={styles.input}
            />
            <TextInput
              label="Name"
              value={form.name}
              onChangeText={setField('name')}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="Phone"
              value={form.phone}
              onChangeText={(t) => setField('phone')(t.replace(/[^0-9]/g, ''))}
              mode="outlined"
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.input}
            />
            <TextInput
              label="Home Address"
              value={form.address}
              onChangeText={setField('address')}
              mode="outlined"
              multiline
              placeholder="Flat / House, Street, Area, City, Pincode"
              style={styles.input}
            />
            {/* Route them now. This is the only moment when someone is guaranteed
                to be thinking about where this person lives — asking later is what
                left the coordinator's board full of unrouted riders.

                Free text for the same reason as the card above — there is no
                maintained route list any more. `routeOptions` is still passed in
                so the current areas can be shown as a hint; typing one of them
                (in any capitalisation) snaps onto it when it saves. */}
            <TextInput
              label="Pickup route"
              value={form.route || ''}
              onChangeText={(route) => setForm((f) => ({ ...f, route }))}
              mode="outlined"
              placeholder="e.g. JNTU Cab"
              left={<TextInput.Icon icon="map-marker-outline" />}
              style={styles.input}
            />
            <HelperText type="info" visible style={styles.pwHint}>
              {routeOptions.length
                ? `The coordinator groups the day's cabs by route. In use: ${routeOptions.join(', ')}.`
                : "The coordinator groups the day's cabs by route."}
            </HelperText>
            {error ? <HelperText type="error" visible>{error}</HelperText> : null}
          </View>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={close} disabled={busy}>Cancel</Button>
          <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>
            Create account
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

export default function EmployeeManagementScreen() {
  const {
    adminSaveEmployee, adminCreateEmployee, adminRemoveEmployee, homeAddressOf,
    routeOptions,
  } = useApp();
  const [employees, setEmployees] = useState([]);
  // People HR (or a roster upload) has invited who have never signed in. They
  // have NO uid yet — a profile only exists from their first Microsoft sign-in —
  // so they are not in `employees` and cannot be edited here. Listed anyway,
  // because leaving them out is what made a roster upload look like it had
  // silently dropped somebody: their invite was filed, and this screen showed no
  // sign of it until they happened to sign in.
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null); // employee pending deletion
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsub = subscribeEmployees(setEmployees, (e) => setError(e.message));
    return unsub;
  }, []);

  useEffect(() => {
    // EMPLOYEE INVITES ONLY. An invite carries the role it was filed under
    // (adminCreateInvite writes it, and claimInvite copies it onto the profile),
    // so this has to match on that role exactly — drivers are never invited at
    // all, and coordinators are created on their own page, so anything else on
    // this list would be someone who does not belong on an employee screen.
    //
    // Non-fatal on error: the screen then shows real employees only, which is
    // what it does anyway once everyone has signed in. Not worth blocking the
    // whole page over.
    const unsub = subscribeInvites(
      (list) => setInvites(list.filter((i) => (i.role || 'employee') === 'employee')),
      () => setInvites([])
    );
    return unsub;
  }, []);

  // Find one person in a list of a few hundred. Matches name, employee ID, email,
  // phone, route and address, because "which of these is Bhuvana" is only one of
  // the questions the desk arrives with — "who is on the JNTU route" and "whose
  // number is this" are the others.
  //
  // Each card holds its own unsaved edits, so filtering has to leave the cards
  // themselves alone: FlatList keys on `uid`, so a card that stays in the list
  // keeps its draft while the search narrows around it.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    // Every word must match somewhere, so "bhuvana jntu" narrows rather than widens.
    const words = q.split(/\s+/);
    return employees.filter((e) => {
      const haystack = [
        e.name, e.empId, e.email, e.phone, e.roster?.route, e.address, e.department,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [employees, search]);

  // The same search narrows the pending list, so "where is Abhilasha" finds her
  // whether or not she has signed in yet.
  const shownInvites = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invites;
    const words = q.split(/\s+/);
    return invites.filter((i) => {
      const haystack = [i.name, i.email, i.empId, i.phone, i.route, i.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [invites, search]);

  async function handleSave(uid, fields) {
    setError('');
    const res = await adminSaveEmployee(uid, fields);
    if (res?.ok) {
      const emp = employees.find((e) => e.uid === uid);
      setSnack(`Profile saved for ${emp?.name || emp?.email || 'employee'}.`);
    }
    return res;
  }

  async function handleCreate(form) {
    setError('');
    const res = await adminCreateEmployee(form);
    if (res?.ok) {
      setSnack(`Employee ${form.name || form.email} created.`);
    }
    return res;
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    const emp = deleteFor;
    setDeleting(true);
    const res = await adminRemoveEmployee(emp.uid);
    setDeleting(false);
    setDeleteFor(null);
    if (res?.ok) setSnack(`${emp.name || emp.email} removed.`);
    else setError(res?.message || 'Could not delete.');
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <View style={styles.topBar}>
          <Text variant="bodySmall" style={styles.hint}>
            Add, edit or remove employees. Employees can only view their own
            profile — they can't edit it.
          </Text>
          <Button mode="contained" icon="account-plus" onPress={() => setAddOpen(true)}>
            Add Employee
          </Button>
        </View>
        <View style={styles.searchRow}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            mode="outlined"
            dense
            placeholder="Search name, ID, email, phone or route"
            left={<TextInput.Icon icon="magnify" />}
            right={
              search ? (
                <TextInput.Icon icon="close" onPress={() => setSearch('')} />
              ) : null
            }
            style={styles.searchInput}
          />
          {search ? (
            <Text variant="bodySmall" style={styles.searchCount}>
              {shown.length} of {employees.length}
            </Text>
          ) : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={shown}
          keyExtractor={(item) => item.uid}
          renderItem={({ item }) => (
            <EmployeeCard
              emp={item}
              onSave={handleSave}
              onDelete={setDeleteFor}
              homeAddressOf={homeAddressOf}
              routeOptions={routeOptions}
            />
          )}
          contentContainerStyle={styles.list}
          /* Invited, never signed in. Shown ABOVE the real employees rather than
             mixed into them: nothing on these can be edited, because there is no
             employees/<uid> document to write to yet. What they answer is "where
             did the person I just uploaded go?" — and they take themselves off
             the list the moment that person signs in for the first time. */
          ListHeaderComponent={
            shownInvites.length ? (
              <View style={styles.pendingBox}>
                <View style={styles.pendingHead}>
                  <MaterialCommunityIcons
                    name="account-clock-outline"
                    size={17}
                    color={colors.primary}
                  />
                  <Text variant="labelLarge" style={styles.pendingTitle}>
                    {shownInvites.length} invited · waiting for their first sign-in
                  </Text>
                </View>
                <Text variant="bodySmall" style={styles.pendingHint}>
                  Their details are saved. They become full profiles — and their
                  shifts import — the first time they open the app and choose
                  &ldquo;Sign in with Microsoft&rdquo;. Nothing to do here.
                </Text>
                {shownInvites.map((i) => (
                  <View key={i.email} style={styles.pendingRow}>
                    <Text variant="bodySmall" style={styles.pendingName} numberOfLines={1}>
                      {i.name || i.email}
                      {i.empId ? ` · ${i.empId}` : ''}
                    </Text>
                    <Text variant="bodySmall" style={styles.pendingEmail} numberOfLines={1}>
                      {i.email}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={search ? 'account-search' : 'account-group'}
                size={44}
                color={colors.muted}
              />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {search
                  ? `Nobody matches “${search}”.`
                  : 'No employees yet. Tap “Add Employee” to create one.'}
              </Text>
              {search ? (
                <Button mode="text" onPress={() => setSearch('')}>
                  Clear search
                </Button>
              ) : null}
            </View>
          }
        />
      </View>

      <AddEmployeeDialog
        visible={addOpen}
        onDismiss={() => setAddOpen(false)}
        onCreate={handleCreate}
        routeOptions={routeOptions}
      />

      <Portal>
        <Dialog visible={!!deleteFor} onDismiss={() => setDeleteFor(null)} style={styles.dialog}>
          <Dialog.Title>Remove employee?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This removes {deleteFor?.name || deleteFor?.email}'s profile and
              unlinks any cab they hold. Their login still exists in Firebase Auth,
              but signing in will show "account not set up" — delete the login in
              the Firebase console to revoke it completely.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteFor(null)} disabled={deleting}>Cancel</Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={confirmDelete}
              loading={deleting}
              disabled={deleting}
            >
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  searchInput: { flex: 1, backgroundColor: colors.surface },
  searchCount: { color: colors.muted },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // Invited-but-not-signed-in block, above the editable employee cards. A brand
  // tint rather than a warning colour: nobody has done anything wrong and there
  // is nothing to action — it is answering "where did the person I just uploaded
  // go?", and it removes itself as each of them signs in.
  pendingBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.primarySofter,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pendingTitle: { color: colors.primaryDark, fontFamily: font.semibold },
  pendingHint: {
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  pendingRow: { paddingVertical: spacing.xs },
  pendingName: { fontFamily: font.semibold, color: colors.text },
  pendingEmail: { color: colors.muted },

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
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardHeadText: { flex: 1, minWidth: 0 },
  email: { color: colors.muted, marginTop: 2 },
  deleteBtn: { margin: 0 },
  divider: { marginVertical: spacing.md, backgroundColor: colors.border },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  fieldLabel: { color: colors.textSecondary, marginBottom: spacing.sm },
  pwHint: { marginTop: -spacing.sm, marginBottom: 2, color: colors.muted },
  saveBtn: { marginTop: spacing.xs, borderRadius: radius.md },
  error: { color: colors.danger, paddingHorizontal: spacing.lg },
  empty: { alignItems: 'center', marginTop: 56 },
  emptyText: {
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  dialog: { width: '100%', maxWidth: 470, alignSelf: 'center' },
  dialogBody: { paddingVertical: spacing.sm },
  dialogHint: { color: colors.muted, marginBottom: spacing.md, lineHeight: 19 },
});
