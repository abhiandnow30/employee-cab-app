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
import { Platform, Pressable, StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Divider, TextInput, Snackbar, HelperText,
  IconButton, Portal, Dialog,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { subscribeEmployees, subscribeInvites } from '../../services/profile';
import { needsCabServiceSetup } from '../../services/cabServiceRequests';
import useSyncedDraft from '../../utils/useSyncedDraft';
import { colors, font, radius, shadow, spacing } from '../../theme';

// One headline number. Three of them across the top of the screen, because the
// three questions HR opens this page with are "how many people are on the
// service", "who has not arrived yet" and "who can a cab not be sent for" — and
// only the first was answerable at a glance before.
//
// The third is the one that earns its place. needsCabServiceSetup() is what
// holds an employee at the cab-service form, and until now the only way to
// discover somebody was in that state was for them to fail to log in and say so.
// It is a count you want to see fall to zero, so it is also the only tile that
// filters: a number nobody can act on is decoration.
function StatTile({ icon, tint, value, label, sub, onPress, active, disabled }) {
  const body = (
    <>
      <View style={[styles.tileIcon, { backgroundColor: tint.soft }]}>
        <MaterialCommunityIcons name={icon} size={17} color={tint.fg} />
      </View>
      <Text style={[styles.tileValue, { color: tint.fg }]}>{value}</Text>
      <Text variant="bodySmall" style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      {sub ? (
        <Text variant="bodySmall" style={styles.tileSub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.tile}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      accessibilityLabel={`${value} ${label}. ${active ? 'Showing only these. Tap to show everyone' : 'Tap to show only these'}`}
      style={({ pressed, hovered }) => [
        styles.tile,
        !disabled && hovered && styles.tileHover,
        pressed && styles.tilePressed,
        active && styles.tileActive,
      ]}
    >
      {body}
    </Pressable>
  );
}

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

function EmployeeCard({ emp, onSave, onDelete, homeAddressOf, routeOptions, duplicate }) {
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
            {duplicate ? (
              <View style={styles.dupeTag}>
                <MaterialCommunityIcons
                  name="account-alert-outline"
                  size={13}
                  color={colors.danger}
                />
                <Text variant="bodySmall" style={styles.dupeTagText}>
                  Second profile on this email
                </Text>
              </View>
            ) : null}
            {duplicate ? (
              <Text variant="bodySmall" style={styles.dupeUid} selectable>
                Account ID {emp.uid}
              </Text>
            ) : null}
            {duplicate ? (
              <Text variant="bodySmall" style={styles.dupeUidHint}>
                Compare with Firebase → Authentication → Users. The one that
                matches a real account is the one they sign in as — keep that
                one. The other has no login behind it.
              </Text>
            ) : null}
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
  // "Show me only the people a cab cannot be sent for." Off by default: this is
  // a page for managing everybody, not a to-do list.
  const [onlyUnset, setOnlyUnset] = useState(false);
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
    // The tile filter first, then the search — so a search inside the filtered
    // view narrows it rather than escaping it.
    const base = onlyUnset ? (employees || []).filter(needsCabServiceSetup) : employees;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    // Every word must match somewhere, so "bhuvana jntu" narrows rather than widens.
    const words = q.split(/\s+/);
    return base.filter((e) => {
      const haystack = [
        e.name, e.empId, e.email, e.phone, e.roster?.route, e.address, e.department,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [employees, search, onlyUnset]);

  // TWO PROFILES, ONE PERSON — the state the app cannot prevent and must not hide.
  //
  // An employees document is keyed by Firebase uid, so two of them for one email
  // means two AUTH ACCOUNTS. That is created outside this app entirely: with
  // "Prevent creation of multiple accounts with the same email address" turned
  // off in the Firebase console, somebody holding a password login gets a SECOND
  // account the first time they sign in with Microsoft, and a fresh blank profile
  // with it. Nothing here can stop that — a signed-in user with no profile may
  // read only their own document (see the employees read rule), so the app cannot
  // even ask whether that email is already taken at the moment it self-provisions.
  //
  // What it CAN do is refuse to let the result go unnoticed. Undetected, the
  // person signs in to whichever account they authenticate as, finds it empty,
  // gets held at the cab-service form, and their rides stay attached to the other
  // uid — which reads as "she is on the roster but the app says she isn't".
  const duplicateEmails = useMemo(() => {
    const counts = new Map();
    (employees || []).forEach((e) => {
      const key = String(e.email || '').trim().toLowerCase();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [employees]);

  const isDuplicate = (e) =>
    duplicateEmails.has(String(e?.email || '').trim().toLowerCase());

  // Nobody can be sent a cab without BOTH a home address and a pickup route —
  // the same test that decides whether they are held at the cab-service form,
  // reused rather than reimplemented so the count and the gate can never
  // disagree about who is stuck.
  const unsetCount = useMemo(
    () => (employees || []).filter(needsCabServiceSetup).length,
    [employees]
  );

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
        <View style={styles.tileRow}>
          <StatTile
            icon="account-group"
            tint={{ fg: colors.primary, soft: colors.primarySoft }}
            value={employees.length}
            label={employees.length === 1 ? 'Employee' : 'Employees'}
            sub="on the cab service"
          />
          <StatTile
            icon="account-clock-outline"
            tint={{ fg: colors.info, soft: colors.infoSoft }}
            value={invites.length}
            label="Invited"
            sub="not signed in yet"
          />
          <StatTile
            icon={unsetCount ? 'account-alert-outline' : 'check-circle-outline'}
            tint={
              unsetCount
                ? { fg: colors.warning, soft: colors.warningSoft }
                : { fg: colors.success, soft: colors.successSoft }
            }
            value={unsetCount}
            label="Not set up"
            sub={unsetCount ? 'no address or route' : 'everyone is routed'}
            onPress={() => setOnlyUnset((v) => !v)}
            active={onlyUnset}
            disabled={!unsetCount && !onlyUnset}
          />
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
          {search || onlyUnset ? (
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
              duplicate={isDuplicate(item)}
            />
          )}
          contentContainerStyle={styles.list}
          /* Invited, never signed in. Shown ABOVE the real employees rather than
             mixed into them: nothing on these can be edited, because there is no
             employees/<uid> document to write to yet. What they answer is "where
             did the person I just uploaded go?" — and they take themselves off
             the list the moment that person signs in for the first time. */
          ListHeaderComponent={
            <>
              {duplicateEmails.size ? (
                <View style={styles.dupeBox}>
                  <View style={styles.pendingHead}>
                    <MaterialCommunityIcons
                      name="account-alert-outline"
                      size={17}
                      color={colors.danger}
                    />
                    <Text variant="labelLarge" style={styles.dupeTitle}>
                      {duplicateEmails.size} email
                      {duplicateEmails.size === 1 ? ' has' : 's have'} two profiles
                    </Text>
                  </View>
                  <Text variant="bodySmall" style={styles.dupeHint}>
                    One person, two accounts. They sign in to one of them, find it
                    empty, and their rides stay attached to the other — so keep the
                    account they actually sign in with (check the provider in
                    Firebase Console → Authentication), copy the details onto it,
                    then delete the other. Turn on “Prevent creation of multiple
                    accounts with the same email address” in Authentication →
                    Settings to stop it happening again.
                  </Text>
                  {[...duplicateEmails].map((mail) => (
                    <Text
                      key={mail}
                      variant="bodySmall"
                      style={styles.dupeRow}
                      numberOfLines={1}
                    >
                      {mail}
                    </Text>
                  ))}
                </View>
              ) : null}
              {shownInvites.length ? (
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
              ) : null}
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={
                  onlyUnset && !search
                    ? 'check-circle-outline'
                    : search
                    ? 'account-search'
                    : 'account-group'
                }
                size={44}
                color={onlyUnset && !search ? colors.success : colors.muted}
              />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {/* Filtered to "not set up" and finding nobody is the ONE empty
                    list on this screen that is good news, so it does not get the
                    same shrug as the others. */}
                {onlyUnset && !search
                  ? 'Everybody has an address and a route — a cab can be sent for all of them.'
                  : search
                  ? `Nobody matches “${search}”.`
                  : 'No employees yet. Tap “Add Employee” to create one.'}
              </Text>
              {search ? (
                <Button mode="text" onPress={() => setSearch('')}>
                  Clear search
                </Button>
              ) : null}
              {onlyUnset ? (
                <Button mode="text" onPress={() => setOnlyUnset(false)}>
                  Show everyone
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
  // Three across on a desk monitor, wrapping to two then one on a phone. Each
  // tile keeps a floor of 150 so a number never sits on top of its own label.
  tileRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flexWrap: 'wrap',
  },
  tile: {
    flex: 1,
    minWidth: 150,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.xs,
  },
  tileHover: { borderColor: colors.borderStrong },
  tilePressed: { backgroundColor: colors.surfaceAlt },
  // The filter is ON. A border alone is too quiet for a state that is hiding
  // most of the list, so the whole tile takes the brand tint as well.
  tileActive: { borderColor: colors.primary, backgroundColor: colors.primarySofter },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileValue: { fontFamily: font.bold, fontSize: 27, lineHeight: 33, letterSpacing: -0.5 },
  tileLabel: { color: colors.text, fontFamily: font.semibold, marginTop: 1 },
  tileSub: { color: colors.muted, fontSize: 11.5, lineHeight: 16 },
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
  // Red, not amber: an invite waiting to be claimed is normal, two accounts for
  // one person is not — somebody is locked out of their own rides right now.
  dupeBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F3C7C3',
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  dupeTitle: { color: colors.danger, fontFamily: font.semibold },
  dupeHint: { color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 19 },
  dupeRow: { color: colors.danger, fontFamily: font.semibold, marginTop: spacing.xs },
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
  dupeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  dupeTagText: { color: colors.danger, fontFamily: font.semibold, fontSize: 11.5 },
  // Monospace: this is an identifier that gets compared character by character
  // against another screen, and a proportional font makes 0/O and 1/l a guess.
  dupeUid: {
    marginTop: spacing.xs,
    color: colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11.5,
  },
  dupeUidHint: { color: colors.muted, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
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
