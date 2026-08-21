// ---------------------------------------------------------------------------
// FLEET  (coordinator)
//
// The coordinator maintains the vehicles they assign every day: add a cab, keep
// its number and seat count current, link the driver account it follows, and
// retire it when it leaves service.
//
// THREE SEPARATE THINGS, THREE PLACES. A cab is a vehicle (here). A driver is an
// account (the Drivers screen). Which driver is on which cab is the LINK — the
// dropdown on each card below, and nowhere else. The add-cab form used to also ask
// for a driver name and phone, which read as a fourth way of doing the third
// thing: it granted nobody access, showed nobody the trip, and was overwritten
// the moment a real driver was linked.
//
// LINKING A DRIVER IS WHAT MAKES A CAB USABLE. The driver's trip list is scoped
// by that link (cabs/<id>.driverUid ←→ employees/<uid>.cabId), and live tracking
// is keyed off the driver's id, so an unlinked cab has nobody to drive it and no
// feed to follow. Assignment refuses such a cab outright — it used to accept it,
// which produced rides no driver account could see while the rider had already
// been told a cab was on the way. A typed-in driver NAME is not a link.
//
// LINKING ALSO ISSUES THE DRIVER'S LOGIN CODE — the last 4 digits of this cab's
// number plus their phone, which is the only thing they type to sign in (see
// utils/driverLogin.js). Two consequences worth knowing: renaming a cab changes its
// driver's code, and unlinking revokes it.
//
// THE CODE ITSELF IS NOT DISPLAYED, deliberately (Aug 2026). It used to sit on every
// card, which put a live password on a screen the whole desk can see — and bought
// nothing, because both halves are already on that same card: the last 4 digits are
// in the cab number heading and the phone is on the line beneath it. The desk tells
// the driver the RULE ("your cab's last 4 digits, then your mobile") and the driver
// derives it from the vehicle they're sitting in. What IS still shown is the drift
// warning below — the one case where that rule is a lie.
//
// Removing a vehicle is refused while it still has upcoming rides, so no rider
// silently loses their cab.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Portal, Dialog, Snackbar, Chip, Divider, TextInput,
  HelperText, IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import { subscribeCabs, cabCapacity } from '../../services/cabs';
import { subscribeDrivers } from '../../services/profile';
import { DEFAULT_CAB_CAPACITY, STATUS } from '../../data/mockData';
import { todayKey } from '../../utils/datetime';
// driverLoginCode only — this screen computes the code the cab link implies purely
// to compare it against the stored one, and never renders either.
import { driverLoginCode } from '../../utils/driverLogin';
import { colors, font, radius, shadow, spacing } from '../../theme';

// A ride in one of these states is over, whatever its date says.
const FINISHED = [STATUS.CANCELLED, STATUS.COMPLETED, STATUS.NO_SHOW];

// The form describes the VEHICLE only. Driver name and number are not asked for
// here — they belong to the driver's account and are copied onto the cab when one
// is linked, so there is a single source for them.
const EMPTY = {
  cabNumber: '',
  capacity: String(DEFAULT_CAB_CAPACITY),
};

// The dropdown value meaning "no driver".
const NO_DRIVER = '__none__';

export default function ManageCabsScreen() {
  const {
    createCab, editCab, deleteCab, assignDriverToCab, bookings, currentUser,
  } = useApp();

  // HR/Admin can see the fleet and who is driving what, but the vehicles and the
  // driver links belong to the coordinator who runs the day. Read-only rather than
  // hidden: "which cab took that ride, and who was driving" is a question HR has to
  // be able to answer.
  const readOnly = currentUser?.role === 'admin';

  const [cabs, setCabs] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null);
  // Set when the driver being picked is already on another cab: { cabId, uid, from }.
  const [moveFor, setMoveFor] = useState(null);

  useEffect(() => {
    const unsub = subscribeCabs(
      (list) => {
        setCabs(list);
        setLoaded(true);
      },
      (e) => {
        setError(e.message);
        setLoaded(true);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeDrivers(setDrivers, (e) =>
      console.warn('[fleet] drivers error:', e?.message)
    );
    return unsub;
  }, []);

  const driverOptions = useMemo(
    () => [NO_DRIVER, ...drivers.map((d) => d.uid)],
    [drivers]
  );
  const driverLabel = (uid) => {
    if (uid === NO_DRIVER) return 'No driver';
    const d = drivers.find((x) => x.uid === uid);
    if (!d) return 'Select driver';
    // Flag a driver already on another cab — picking them moves them.
    const holding = cabs.find((c) => c.driverUid === uid);
    // Falls back to the PHONE, not the stored email: a driver's address is
    // synthesized (utils/driverLogin.js) and would be gibberish in a dropdown.
    return `${d.name || d.phone || 'Unnamed driver'}${holding ? ` · on ${holding.cabNumber}` : ''}`;
  };

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setFormError('');
    setFormOpen(true);
  }
  function openEdit(cab) {
    setEditingId(cab.id);
    setForm({
      cabNumber: cab.cabNumber || '',
      capacity: String(cabCapacity(cab)),
    });
    setFormError('');
    setFormOpen(true);
  }

  async function saveForm() {
    setFormError('');
    setBusy(true);
    const res = editingId ? await editCab(editingId, form) : await createCab(form);
    setBusy(false);
    if (res?.ok) {
      setFormOpen(false);
      // Renaming a cab changes its driver's login code, because the last 4 digits
      // are half of it. The code isn't printed anywhere, so what the desk needs to
      // hear is that the driver's OLD code has stopped working — the rule they're
      // told is unchanged, but the number they memorised isn't.
      if (res.codeWarning) setError(res.codeWarning);
      setSnack(
        editingId
          ? 'Cab updated. Renaming it changed the driver’s login code — their old one no longer works.'
          : `${form.cabNumber} added to the fleet.`
      );
    } else {
      setFormError(res?.message || 'Could not save the cab.');
    }
  }

  // Rides already assigned to a cab that haven't run yet. If that cab is about to
  // lose its driver, these are the trips no driver account would be able to see.
  function upcomingRidesOn(cabId) {
    const today = todayKey();
    return bookings.filter(
      (b) =>
        b.assignedCabId === cabId &&
        !FINISHED.includes(b.status) &&
        String(b.date || '') >= today
    ).length;
  }

  // Make the link. Split out from handleLink so the confirmation below can call it.
  //
  // Linking also issues the driver's login code, so `codeWarning` is a real
  // outcome and not noise: the link went through, but the code did not follow it.
  // It goes to `error` rather than the snackbar because the desk has to act on it
  // before telling anyone a code.
  async function doLink(cabId, uid) {
    setError('');
    setBusy(true);
    const res = await assignDriverToCab(cabId, uid === NO_DRIVER ? null : uid);
    setBusy(false);
    setMoveFor(null);
    if (!res?.ok) {
      setError(res?.message || 'Could not link that driver.');
      return;
    }
    if (res.codeWarning) setError(res.codeWarning);
    setSnack(
      uid === NO_DRIVER
        ? 'Driver detached — their login code no longer works.'
        : 'Driver linked — live tracking on, login code issued.'
    );
  }

  // A driver drives one cab at a time, so putting them on this one TAKES THEM OFF
  // whatever they were on. That cab loses its live tracking, and any rides already
  // assigned to it lose the only account that can see them — far too much to happen
  // on one tap of a dropdown, so ask first.
  function handleLink(cabId, uid) {
    setError('');
    const heldElsewhere =
      uid !== NO_DRIVER ? cabs.find((c) => c.driverUid === uid && c.id !== cabId) : null;
    if (heldElsewhere) {
      setMoveFor({ cabId, uid, from: heldElsewhere });
      return;
    }
    doLink(cabId, uid);
  }

  async function confirmDelete() {
    const cab = deleteFor;
    if (!cab) return;
    setBusy(true);
    const res = await deleteCab(cab.id);
    setBusy(false);
    setDeleteFor(null);
    if (res?.ok) {
      if (res.codeWarning) setError(res.codeWarning);
      setSnack(
        res.unlinkedDrivers
          ? `${cab.cabNumber} removed. ${res.unlinkedDrivers} driver link cleared, and their login code with it.`
          : `${cab.cabNumber} removed.`
      );
    } else {
      setError(res?.message || 'Could not remove the cab.');
    }
  }

  // Everything the "move this driver" confirmation needs to state plainly what
  // will happen: who, from where, to where, and what it costs the old cab.
  const moveDriver = moveFor ? drivers.find((d) => d.uid === moveFor.uid) : null;
  const moveToCab = moveFor ? cabs.find((c) => c.id === moveFor.cabId) : null;
  const strandedRides = moveFor ? upcomingRidesOn(moveFor.from.id) : 0;

  function renderCab({ item }) {
    const linked = !!item.driverUid;
    const driver = linked ? drivers.find((d) => d.uid === item.driverUid) : null;
    // The code this cab SHOULD imply, computed only to compare — a mismatch means a
    // rotation stopped halfway, and handing out either value would be a guess.
    const codeDrifted =
      !!driver && driver.loginCode !== driverLoginCode(item.cabNumber, driver.phone);
    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.rowBetween}>
            <View style={styles.headText}>
              <Text variant="titleMedium">{item.cabNumber || 'Unnamed cab'}</Text>
              <Text variant="bodySmall" style={styles.detail}>
                {cabCapacity(item)} seats
                {/* The phone belongs to the linked driver, so it is only shown
                    when there is one — a number with no driver behind it is what
                    made an unlinked cab look ready to use. */}
                {linked && item.driverPhone ? ` · ${item.driverPhone}` : ''}
              </Text>
            </View>
            <Chip
              compact
              icon={linked ? 'access-point' : 'access-point-off'}
              style={{ backgroundColor: linked ? colors.successSoft : colors.warningSoft }}
              textStyle={{ color: linked ? colors.success : '#E65100', fontSize: 12 }}
            >
              {linked ? 'Tracking on' : 'No driver'}
            </Chip>
            {readOnly ? null : (
              <>
                <IconButton icon="pencil" size={20} onPress={() => openEdit(item)} />
                <IconButton
                  icon="delete"
                  size={20}
                  iconColor={colors.danger}
                  onPress={() => setDeleteFor(item)}
                />
              </>
            )}
          </View>

          <Divider style={styles.divider} />

          <View style={styles.linkRow}>
            <Text variant="labelLarge" style={styles.linkLabel}>
              Driver
            </Text>
            {readOnly ? (
              // The same fact, stated rather than editable.
              <Text variant="bodyMedium" style={styles.linkStatic}>
                {linked ? item.driverName || 'Linked driver' : 'No driver linked'}
              </Text>
            ) : (
              <View style={styles.linkPicker}>
                <Dropdown
                  compact
                  value={item.driverUid || NO_DRIVER}
                  options={driverOptions}
                  onSelect={(uid) => handleLink(item.id, uid)}
                  format={driverLabel}
                  placeholder="Choose"
                />
              </View>
            )}
          </View>
          {!linked ? (
            <Text variant="bodySmall" style={styles.warn}>
              {readOnly
                ? 'No driver linked, so no rides can be assigned to this cab and employees cannot follow it. The coordinator links one on the Cabs tab.'
                : 'Link a driver so employees can follow this cab on the map.'}
            </Text>
          ) : null}

          {/* NO LOGIN CODE IS PRINTED HERE ANY MORE, and the reason is on this very
              card: the code is the cab's last 4 digits followed by the driver's
              mobile, and both halves are already in the title and the line beneath
              it. Rendering the join added nothing except a working password sitting
              on a shared screen, so the desk now TELLS the driver the rule ("last 4
              of the cab, then your mobile") instead of reading a secret out.

              The drift check is still computed and still shown, and it matters MORE
              now than it did: that spoken rule is exactly the DERIVED value, so when
              the stored one disagrees the instruction is wrong and the driver is
              locked out. This warning is the only thing standing between the desk
              and confidently telling someone a code that signs nobody in. */}
          {linked && codeDrifted ? (
            <Text variant="bodySmall" style={styles.warn}>
              This driver’s login code doesn’t match this cab, so “last 4 digits + your
              mobile” will NOT let them in. Press “Fix code” on their card in the
              Drivers tab first.
            </Text>
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
              ? "The fleet and who is driving each vehicle. The coordinator maintains this — you're seeing it as it stands."
              : "The vehicles you assign each day. Linking a driver switches on that cab's live tracking and lets them sign in with this cab's last 4 digits followed by their mobile number."}
          </Text>
          {readOnly ? null : (
            <Button mode="contained" icon="plus" onPress={openAdd}>
              Add cab
            </Button>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          data={cabs}
          keyExtractor={(item) => item.id}
          renderItem={renderCab}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            loaded ? (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="car-off" size={44} color={colors.muted} />
                <Text variant="bodyMedium" style={styles.emptyText}>
                  No cabs in the fleet yet.
                </Text>
                {readOnly ? (
                  <Text variant="bodySmall" style={styles.emptyText}>
                    The coordinator adds vehicles on this screen.
                  </Text>
                ) : (
                  <Button mode="contained" icon="plus" onPress={openAdd}>
                    Add your first cab
                  </Button>
                )}
              </View>
            ) : null
          }
        />
      </View>

      <Portal>
        {/* Add / edit */}
        <Dialog visible={formOpen} onDismiss={() => setFormOpen(false)} style={styles.dialog}>
          <Dialog.Title>{editingId ? 'Edit cab' : 'Add cab'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Cab number"
              value={form.cabNumber}
              onChangeText={(t) => setForm((f) => ({ ...f, cabNumber: t.toUpperCase() }))}
              mode="outlined"
              autoCapitalize="characters"
              placeholder="TS 09 AB 1234"
              maxLength={32}
              style={styles.input}
            />
            <TextInput
              label="Seats"
              value={form.capacity}
              onChangeText={(t) =>
                setForm((f) => ({ ...f, capacity: t.replace(/[^0-9]/g, '').slice(0, 2) }))
              }
              mode="outlined"
              keyboardType="number-pad"
              style={styles.input}
            />
            <HelperText type="info" visible style={styles.seatHint}>
              Carpool assignments stop once a cab is full for a time slot. The
              driver is chosen on the cab's card after saving — their name and
              number come from their own account.
            </HelperText>
            {formError ? <HelperText type="error" visible>{formError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button mode="contained" onPress={saveForm} loading={busy} disabled={busy}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Moving a driver who is already on another cab */}
        <Dialog visible={!!moveFor} onDismiss={() => !busy && setMoveFor(null)} style={styles.dialog}>
          <Dialog.Title>
            Move {moveDriver?.name || 'this driver'} to {moveToCab?.cabNumber || 'this cab'}?
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {moveDriver?.name || 'This driver'} is currently driving{' '}
              <Text style={styles.strong}>{moveFor?.from?.cabNumber}</Text>. A driver
              can only be on one cab, so {moveFor?.from?.cabNumber} will be left with
              no driver and its live tracking will switch off until you link someone
              else.
            </Text>
            {strandedRides > 0 ? (
              <View style={styles.moveWarn}>
                <MaterialCommunityIcons name="alert" size={16} color="#B26A00" />
                <Text variant="bodySmall" style={styles.moveWarnText}>
                  {moveFor?.from?.cabNumber} has {strandedRides} upcoming ride
                  {strandedRides === 1 ? '' : 's'} assigned. Nobody will be able to see
                  {strandedRides === 1 ? ' it' : ' them'} until that cab has a driver
                  again — link one, or re-assign those rides to another cab.
                </Text>
              </View>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setMoveFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={() => doLink(moveFor.cabId, moveFor.uid)}
              loading={busy}
              disabled={busy}
            >
              Move driver
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Remove */}
        <Dialog visible={!!deleteFor} onDismiss={() => setDeleteFor(null)} style={styles.dialog}>
          <Dialog.Title>Remove {deleteFor?.cabNumber}?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              The vehicle leaves the fleet and its driver is unlinked. Completed
              rides keep their record. If it still has upcoming rides, re-assign
              those first.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={confirmDelete}
              loading={busy}
              disabled={busy}
            >
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
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
  linkStatic: { color: colors.text, fontFamily: font.medium, flex: 1 },
  strong: { fontFamily: font.semibold },
  moveWarn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  moveWarnText: { color: colors.warning, flex: 1, lineHeight: 19 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headText: { flex: 1, minWidth: 0 },
  detail: { color: colors.muted, marginTop: 2 },
  divider: { marginVertical: spacing.md, backgroundColor: colors.border },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  linkLabel: { color: colors.textSecondary },
  linkPicker: { flex: 1, maxWidth: 260 },
  warn: { color: '#C2410C', marginTop: spacing.sm, lineHeight: 19 },
  error: { color: colors.danger, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  empty: {
    alignItems: 'center',
    marginTop: 56,
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emptyText: { color: colors.muted, textAlign: 'center', lineHeight: 20 },
  dialog: { width: '100%', maxWidth: 470, alignSelf: 'center' },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  seatHint: { marginTop: -spacing.sm, color: colors.muted },
});
