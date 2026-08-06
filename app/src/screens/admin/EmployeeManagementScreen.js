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
  IconButton, Portal, Dialog, SegmentedButtons,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeEmployees } from '../../services/profile';
import useSyncedDraft from '../../utils/useSyncedDraft';
import Dropdown from '../../components/Dropdown';
import { colors } from '../../theme';

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

// Fixed default contact number stamped on every new employee (change it here).
// Kept as a constant — not the admin's own number — so it stays the same no
// matter which admin creates the employee.
const DEFAULT_EMPLOYEE_PHONE = '9848094029';

const EMPTY_NEW = {
  role: 'employee', email: '', password: '', empId: '', name: '', phone: '', address: '',
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
            and have to be grouped by hand every day of the month. */}
        <Text variant="labelLarge" style={styles.fieldLabel}>
          Pickup route
        </Text>
        <Dropdown
          value={draft.route}
          options={routeOptions}
          onSelect={(route) => setDraft((d) => ({ ...d, route }))}
          compact={false}
          placeholder="No route set — coordinator can't group this person"
          status={draft.route ? undefined : 'error'}
          leadingIcon="map-marker-outline"
        />
        <View style={styles.routeSpacer} />

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

// The "Add person" dialog — creates a login account + profile for an EMPLOYEE or
// a DRIVER. Drivers previously had no provisioning route at all: this dialog
// always created employees, and the self-signup screen was only reachable by
// typing a URL, so on a phone a driver account couldn't be created.
function AddEmployeeDialog({ visible, onDismiss, onCreate, defaultPhone = '', routeOptions = [] }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_NEW, phone: defaultPhone }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setField = (key) => (t) => setForm((f) => ({ ...f, [key]: t }));
  const isDriver = form.role === 'driver';
  const isCoordinator = form.role === 'coordinator';
  // Only employees ride in cabs, so only they need an ID and a home address.
  const needsRiderFields = !isDriver && !isCoordinator;

  function close() {
    setForm({ ...EMPTY_NEW, phone: defaultPhone });
    setError('');
    setBusy(false);
    onDismiss();
  }

  async function submit() {
    setError('');
    // Validate up front so the admin gets a clear message instead of a raw
    // Firebase error after a round-trip.
    if (!form.email.trim()) {
      setError('Email is required.');
      return;
    }
    // Only a driver gets a password: they aren't in the company Microsoft
    // directory. Employees and coordinators are invited instead and sign in
    // with Microsoft, so there is no password to set or share.
    if (isDriver && (form.password || '').length < 6) {
      setError('Temporary password must be at least 6 characters.');
      return;
    }
    if (needsRiderFields && !form.empId.trim()) {
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
        <Dialog.Title>
          Add {isDriver ? 'Driver' : isCoordinator ? 'Coordinator' : 'Employee'}
        </Dialog.Title>
        <Dialog.ScrollArea>
          <View style={styles.dialogBody}>
            <Text variant="bodySmall" style={styles.dialogHint}>
              {isDriver
                ? 'Creates a login account and profile. Share the email and temporary password with them; they can change the password after signing in.'
                : 'No password is created. They sign in with their company Microsoft account and their profile is set up automatically the first time — just make sure the email below is right.'}
            </Text>

            <SegmentedButtons
              value={form.role}
              onValueChange={(role) => setForm((f) => ({ ...f, role }))}
              density="small"
              style={styles.roleRow}
              buttons={[
                { value: 'employee', label: 'Employee', icon: 'account' },
                { value: 'driver', label: 'Driver', icon: 'account-tie-hat' },
                { value: 'coordinator', label: 'Coordinator', icon: 'headset' },
              ]}
            />
            {isDriver ? (
              <HelperText type="info" visible style={styles.pwHint}>
                The coordinator links this driver to a cab on the Fleet screen —
                that's what turns on their live location.
              </HelperText>
            ) : null}
            {isCoordinator ? (
              <HelperText type="info" visible style={styles.pwHint}>
                Coordinators run the daily cab assignment and resolve change
                requests. They can't upload rosters or change policy.
              </HelperText>
            ) : null}
            <TextInput
              label="Email (login)"
              value={form.email}
              onChangeText={(t) => setField('email')(t.trim())}
              mode="outlined"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            {/* Drivers only — everyone else signs in with Microsoft, so there is
                no password for HR to invent, share, or for anyone to reuse. */}
            {isDriver ? (
              <>
                <TextInput
                  label="Temporary password"
                  value={form.password}
                  onChangeText={setField('password')}
                  mode="outlined"
                  autoCapitalize="none"
                  style={styles.input}
                />
                <HelperText type="info" visible style={styles.pwHint}>
                  At least 6 characters. They can change it after signing in.
                </HelperText>
              </>
            ) : null}
            {/* Only employees ride, so only they get an ID and home address. */}
            {needsRiderFields ? (
              <TextInput
                label="Employee ID"
                value={form.empId}
                onChangeText={setField('empId')}
                mode="outlined"
                placeholder="e.g. 1399"
                style={styles.input}
              />
            ) : null}
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
            {needsRiderFields ? (
              <TextInput
                label="Home Address"
                value={form.address}
                onChangeText={setField('address')}
                mode="outlined"
                multiline
                placeholder="Flat / House, Street, Area, City, Pincode"
                style={styles.input}
              />
            ) : null}
            {/* Route them now. This is the only moment when someone is guaranteed
                to be thinking about where this person lives — asking later is what
                left the coordinator's board full of unrouted riders. */}
            {needsRiderFields ? (
              <>
                <Text variant="labelLarge" style={styles.fieldLabel}>
                  Pickup route
                </Text>
                <Dropdown
                  value={form.route}
                  options={routeOptions}
                  onSelect={(route) => setForm((f) => ({ ...f, route }))}
                  compact={false}
                  placeholder="Choose the pickup route"
                  leadingIcon="map-marker-outline"
                />
                <HelperText type="info" visible style={styles.pwHint}>
                  The coordinator groups the day's cabs by route. You can change it
                  later on this employee's card below.
                </HelperText>
              </>
            ) : null}
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
      const who =
        form.role === 'driver' ? 'Driver'
        : form.role === 'coordinator' ? 'Coordinator'
        : 'Employee';
      setSnack(`${who} ${form.name || form.email} created.`);
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
            Add Employee / Driver
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
        defaultPhone={DEFAULT_EMPLOYEE_PHONE}
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
  hint: { opacity: 0.7, flex: 1, minWidth: 200 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  searchInput: { flex: 1, backgroundColor: colors.surface },
  searchCount: { color: colors.muted },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeadText: { flex: 1 },
  email: { opacity: 0.6, marginTop: 2 },
  deleteBtn: { margin: 0 },
  divider: { marginVertical: 10 },
  input: { marginBottom: 10 },
  fieldLabel: { opacity: 0.8, marginBottom: 6 },
  routeSpacer: { height: 10 },
  pwHint: { marginTop: -8, marginBottom: 2 },
  saveBtn: { marginTop: 2 },
  error: { color: colors.danger, paddingHorizontal: 12 },
  empty: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: colors.muted, marginTop: 8, textAlign: 'center' },
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  dialogBody: { paddingVertical: 8 },
  dialogHint: { opacity: 0.7, marginBottom: 12 },
  roleRow: { marginBottom: 12 },
});
