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

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Divider, TextInput, Snackbar, HelperText,
  IconButton, Portal, Dialog,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeEmployees } from '../../services/profile';
import { colors } from '../../theme';

function draftOf(emp, homeAddressOf) {
  return {
    empId: emp.empId || '',
    name: emp.name || '',
    phone: emp.phone || '',
    address: emp.address || homeAddressOf(emp) || '',
  };
}

// Fixed default contact number stamped on every new employee (change it here).
// Kept as a constant — not the admin's own number — so it stays the same no
// matter which admin creates the employee.
const DEFAULT_EMPLOYEE_PHONE = '9848094029';

const EMPTY_NEW = { email: '', password: '', empId: '', name: '', phone: '', address: '' };

function EmployeeCard({ emp, onSave, onDelete, homeAddressOf }) {
  const [draft, setDraft] = useState(() => draftOf(emp, homeAddressOf));
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
          disabled={saving}
          style={styles.saveBtn}
        >
          Save
        </Button>
      </Card.Content>
    </Card>
  );
}

// The "Add Employee" dialog — creates a login account + profile. New employees
// default to the admin's own mobile number (editable per employee).
function AddEmployeeDialog({ visible, onDismiss, onCreate, defaultPhone = '' }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_NEW, phone: defaultPhone }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setField = (key) => (t) => setForm((f) => ({ ...f, [key]: t }));

  function close() {
    setForm({ ...EMPTY_NEW, phone: defaultPhone });
    setError('');
    setBusy(false);
    onDismiss();
  }

  async function submit() {
    setError('');
    setBusy(true);
    const res = await onCreate(form);
    setBusy(false);
    if (res?.ok) {
      close();
    } else {
      setError(res?.message || 'Could not create the employee.');
    }
  }

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={close} style={styles.dialog}>
        <Dialog.Title>Add Employee</Dialog.Title>
        <Dialog.ScrollArea>
          <View style={styles.dialogBody}>
            <Text variant="bodySmall" style={styles.dialogHint}>
              Creates a login account and profile. Share the email and temporary
              password with the employee; they can change the password after
              signing in.
            </Text>
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
              label="Temporary password"
              value={form.password}
              onChangeText={setField('password')}
              mode="outlined"
              autoCapitalize="none"
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
  const { adminSaveEmployee, adminCreateEmployee, adminRemoveEmployee, homeAddressOf } = useApp();
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null); // employee pending deletion
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = subscribeEmployees(setEmployees, (e) => setError(e.message));
    return unsub;
  }, []);

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
    if (res?.ok) setSnack(`Employee ${form.name || form.email} created.`);
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={employees}
          keyExtractor={(item) => item.uid}
          renderItem={({ item }) => (
            <EmployeeCard
              emp={item}
              onSave={handleSave}
              onDelete={setDeleteFor}
              homeAddressOf={homeAddressOf}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-group" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                No employees yet. Tap “Add Employee” to create one.
              </Text>
            </View>
          }
        />
      </View>

      <AddEmployeeDialog
        visible={addOpen}
        onDismiss={() => setAddOpen(false)}
        onCreate={handleCreate}
        defaultPhone={DEFAULT_EMPLOYEE_PHONE}
      />

      <Portal>
        <Dialog visible={!!deleteFor} onDismiss={() => setDeleteFor(null)} style={styles.dialog}>
          <Dialog.Title>Remove employee?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This removes {deleteFor?.name || deleteFor?.email}'s profile from the
              app. Their login account stays in Firebase Auth — delete it in the
              Firebase console if you also want to revoke sign-in.
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
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeadText: { flex: 1 },
  email: { opacity: 0.6, marginTop: 2 },
  deleteBtn: { margin: 0 },
  divider: { marginVertical: 10 },
  input: { marginBottom: 10 },
  saveBtn: { marginTop: 2 },
  error: { color: colors.danger, paddingHorizontal: 12 },
  empty: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: colors.muted, marginTop: 8, textAlign: 'center' },
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  dialogBody: { paddingVertical: 8 },
  dialogHint: { opacity: 0.7, marginBottom: 12 },
});
