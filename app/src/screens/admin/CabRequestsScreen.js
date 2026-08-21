// ---------------------------------------------------------------------------
// CAB REQUESTS  (transport desk — HR/admin AND coordinator)
//
// The queue of people who signed in with their company Microsoft account but
// whom HR never entered, so the app has no address or pickup route for them.
// Each row is somebody who currently cannot be sent a cab.
//
// TWO ROLES, TWO JOBS — this is why both see the screen:
//   • The COORDINATOR knows which pickup route an address sits on, because they
//     group the cabs every evening. They set the route.
//   • The ADMIN approves, which writes name / employee ID / phone / address and
//     that route onto the employee's profile.
// The split isn't cosmetic: firestore.rules only lets a coordinator write
// `roster.route` on a profile, so approval genuinely has to be HR's. The screen
// mirrors what the rules already enforce rather than hiding a permission error
// behind a button that fails.
// ---------------------------------------------------------------------------

import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Chip, Divider, Portal, Dialog, TextInput,
  HelperText, Snackbar, SegmentedButtons,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import useSyncedDraft from '../../utils/useSyncedDraft';
import { routeKey } from '../../services/roster';
import { useApp } from '../../context/AppContext';
import { colors, spacing, font, radius, shadow } from '../../theme';

const STATUS_TINT = {
  Pending: { bg: colors.warningSoft, fg: colors.warning, icon: 'clock-outline' },
  Approved: { bg: colors.successSoft, fg: colors.success, icon: 'check-circle' },
  Rejected: { bg: colors.dangerSoft, fg: colors.danger, icon: 'close-circle' },
};

export default function CabRequestsScreen() {
  const {
    currentUser, cabServiceRequests, routeOptions,
    approveCabService, rejectCabService, proposeCabRequestRoute,
  } = useApp();

  const isAdmin = currentUser?.role === 'admin';

  const [filter, setFilter] = useState('Pending');
  const [snack, setSnack] = useState('');

  // Approve dialog state. The admin can correct anything the employee typed
  // before it lands on the profile — a half-typed employee ID is easier to fix
  // here than to chase afterwards.
  const [approving, setApproving] = useState(null);
  const [edits, setEdits] = useState({});
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);

  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const rows = useMemo(() => {
    const list = cabServiceRequests || [];
    if (filter === 'All') return list;
    return list.filter((r) => r.status === filter);
  }, [cabServiceRequests, filter]);

  const pendingCount = (cabServiceRequests || []).filter((r) => r.status === 'Pending').length;

  // `typedRoute` is what is in the card's route box this instant, which is not
  // always what is on the server: clicking Approve blurs the box and starts the
  // save, but the dialog opens before that round trip lands. Seeding from the
  // saved value alone would show an empty route to someone who had just typed
  // one, and they would type it again.
  function openApprove(req, typedRoute) {
    setDialogError('');
    setEdits({
      name: req.name || '',
      empId: req.empId || '',
      phone: req.phone || '',
      address: req.address || '',
      route: (typedRoute || '').trim() || req.proposedRoute || '',
    });
    setApproving(req);
  }

  async function confirmApprove() {
    setDialogError('');
    setBusy(true);
    const res = await approveCabService(approving, edits);
    setBusy(false);
    if (!res.ok) {
      setDialogError(res.message);
      return;
    }
    setApproving(null);
    setSnack(`${edits.name || 'Employee'} is set up on the ${res.route} route.`);
  }

  async function confirmReject() {
    setBusy(true);
    const res = await rejectCabService(rejecting, reason);
    setBusy(false);
    if (!res.ok) {
      setDialogError(res.message);
      return;
    }
    setRejecting(null);
    setReason('');
    setSnack('Request rejected.');
  }

  // The coordinator's one write. Saved immediately rather than behind a dialog:
  // it's a single field, and the point is that the admin finds it already filled
  // in when they come to approve.
  // Returns the result so the field can adopt the SNAPPED spelling — type
  // "jntu cab" and what comes back is "JNTU Cab". Without that the box would
  // keep showing the typed version, look permanently unsaved, and re-save
  // itself on every blur.
  async function setRoute(req, route) {
    const res = await proposeCabRequestRoute(req.id, route);
    if (!res.ok) setSnack(res.message);
    else if (res.route) setSnack(`Route set to ${res.route} for ${req.name || 'this request'}.`);
    else setSnack(`Route cleared for ${req.name || 'this request'}.`);
    return res;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.headerTitle}>
            {pendingCount
              ? `${pendingCount} waiting to be set up`
              : 'Nobody is waiting to be set up'}
          </Text>
          <Text variant="bodySmall" style={styles.headerBody}>
            These people signed in with their company account but have no home
            address or pickup route yet, so no cab can be sent for them.
            {isAdmin
              ? ' Approving writes their details onto their profile.'
              : ' Set the pickup route for each address — HR does the final approval.'}
          </Text>
        </View>

        <SegmentedButtons
          value={filter}
          onValueChange={setFilter}
          density="small"
          style={styles.filter}
          buttons={[
            { value: 'Pending', label: 'Pending' },
            { value: 'Approved', label: 'Approved' },
            { value: 'Rejected', label: 'Rejected' },
            { value: 'All', label: 'All' },
          ]}
        />

        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="car-off"
                size={44}
                color={colors.muted}
              />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {filter === 'Pending'
                  ? 'Nothing waiting. Anyone who signs in without being on the roster shows up here.'
                  : `No ${filter.toLowerCase()} requests.`}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <RequestCard
              req={item}
              isAdmin={isAdmin}
              routeOptions={routeOptions}
              onSetRoute={(route) => setRoute(item, route)}
              onApprove={(typedRoute) => openApprove(item, typedRoute)}
              onReject={() => {
                setReason('');
                setDialogError('');
                setRejecting(item);
              }}
            />
          )}
        />
      </View>

      {/* --- Approve (admin) --- */}
      <Portal>
        <Dialog
          visible={!!approving}
          onDismiss={() => !busy && setApproving(null)}
          style={styles.dialog}
        >
          <Dialog.Title>Set up cab service</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              <Text variant="bodySmall" style={styles.dialogHint}>
                This writes onto {approving?.name || 'their'} profile. Correct
                anything that looks wrong before approving.
              </Text>
              <TextInput
                label="Full name"
                value={edits.name}
                onChangeText={(t) => setEdits((e) => ({ ...e, name: t }))}
                mode="outlined"
                style={styles.input}
              />
              <TextInput
                label="Employee ID"
                value={edits.empId}
                onChangeText={(t) => setEdits((e) => ({ ...e, empId: t }))}
                mode="outlined"
                autoCapitalize="characters"
                style={styles.input}
              />
              <TextInput
                label="Phone"
                value={edits.phone}
                onChangeText={(t) => setEdits((e) => ({ ...e, phone: t.replace(/[^0-9]/g, '') }))}
                mode="outlined"
                keyboardType="phone-pad"
                maxLength={10}
                style={styles.input}
              />
              <TextInput
                label="Home address"
                value={edits.address}
                onChangeText={(t) => setEdits((e) => ({ ...e, address: t }))}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={styles.input}
              />
              <TextInput
                label="Pickup route"
                value={edits.route}
                onChangeText={(t) => setEdits((e) => ({ ...e, route: t }))}
                mode="outlined"
                placeholder="e.g. JNTU Cab"
                style={styles.input}
              />
              {/* Approving without a route would leave them under "No route
                  set" on the board every single day — the exact problem this
                  screen exists to end. */}
              <HelperText type="info" visible style={styles.hint}>
                Required. Without a route they land under "No route set" every day.
              </HelperText>
              <NewRouteHint value={edits.route} options={routeOptions} />
              {dialogError ? (
                <HelperText type="error" visible>
                  {dialogError}
                </HelperText>
              ) : null}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setApproving(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              icon="check"
              onPress={confirmApprove}
              loading={busy}
              disabled={busy}
            >
              Approve
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* --- Reject (admin) --- */}
        <Dialog
          visible={!!rejecting}
          onDismiss={() => !busy && setRejecting(null)}
          style={styles.dialog}
        >
          <Dialog.Title>Reject request</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodySmall" style={styles.dialogHint}>
              They stay signed in but still can't be sent a cab, so a reason is
              the only useful thing they get — but it is optional, and leaving it
              blank still rejects the request.
            </Text>
            <TextInput
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              mode="outlined"
              multiline
              numberOfLines={3}
              placeholder="e.g. Address is outside our pickup area — call the desk."
            />
            {dialogError ? (
              <HelperText type="error" visible>
                {dialogError}
              </HelperText>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRejecting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              icon="close"
              onPress={confirmReject}
              loading={busy}
              disabled={busy}
            >
              Reject
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

function RequestCard({ req, isAdmin, routeOptions, onSetRoute, onApprove, onReject }) {
  const tint = STATUS_TINT[req.status] || STATUS_TINT.Pending;
  const isPending = req.status === 'Pending';

  // TYPED, NOT PICKED. A dropdown could only ever offer routes that already
  // exist, which is no help to the one person this screen is for: somebody at
  // an address no current route covers.
  //
  // useSyncedDraft rather than useState, because the queue is a live
  // subscription that both desk roles are looking at — a route the coordinator
  // sets from their own screen should appear in this box, but never on top of
  // something being typed into it right now.
  const [route, setRoute, { dirty }] = useSyncedDraft(req.proposedRoute || '');
  const saving = useRef(false);

  // A write per keystroke is not an option, so the save happens on leaving the
  // field — blur, Enter, or the save icon. A single click on that icon fires
  // the blur too, hence the latch.
  async function commitRoute() {
    if (saving.current) return;
    const next = route.trim();
    if (next === (req.proposedRoute || '').trim()) return;
    saving.current = true;
    const res = await onSetRoute(next);
    saving.current = false;
    if (res?.ok) setRoute(res.route || '');
  }

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <View style={styles.cardTop}>
          <View style={styles.cardWho}>
            <Text variant="titleMedium" style={styles.name}>
              {req.name || 'Unnamed'}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              {req.email}
            </Text>
          </View>
          <Chip
            compact
            icon={tint.icon}
            style={[styles.statusChip, { backgroundColor: tint.bg }]}
            textStyle={{ color: tint.fg, fontSize: 12 }}
          >
            {req.status}
          </Chip>
        </View>

        <Divider style={styles.divider} />

        <Field icon="card-account-details" label="Employee ID" value={req.empId} />
        <Field icon="phone" label="Phone" value={req.phone} />
        <Field icon="map-marker" label="Home address" value={req.address} />
        {req.landmark ? (
          <Field icon="signs-post" label="Landmark" value={req.landmark} />
        ) : null}
        {req.note ? <Field icon="note-text" label="Note" value={req.note} /> : null}

        {isPending ? (
          <>
            <Text variant="bodySmall" style={styles.fieldLabel}>
              Pickup route {req.proposedRoute ? '' : '— not set yet'}
            </Text>
            <TextInput
              mode="outlined"
              value={route}
              onChangeText={setRoute}
              onBlur={commitRoute}
              onSubmitEditing={commitRoute}
              returnKeyType="done"
              placeholder="Which route covers this address?"
              outlineColor={req.proposedRoute ? colors.success : colors.borderStrong}
              style={styles.routeInput}
              right={
                dirty ? (
                  <TextInput.Icon
                    icon="content-save"
                    onPress={commitRoute}
                    forceTextInputFocus={false}
                    accessibilityLabel="Save pickup route"
                  />
                ) : undefined
              }
            />
            <NewRouteHint value={route} options={routeOptions} />
            {isAdmin ? (
              <View style={styles.actions}>
                <Button mode="text" textColor={colors.danger} onPress={onReject}>
                  Reject
                </Button>
                <Button mode="contained" icon="check" onPress={() => onApprove(route)}>
                  Approve
                </Button>
              </View>
            ) : (
              <HelperText type="info" visible style={styles.hint}>
                Set the route here — HR approves it and the details go onto their
                profile.
              </HelperText>
            )}
          </>
        ) : (
          <View style={styles.decided}>
            <Text variant="bodySmall" style={styles.muted}>
              {req.status === 'Approved'
                ? `Approved${req.approvedRoute ? ` on the ${req.approvedRoute} route` : ''}${
                    req.reviewedBy ? ` by ${req.reviewedBy}` : ''
                  }.`
                : `Rejected${req.reviewedBy ? ` by ${req.reviewedBy}` : ''}. ${
                    req.rejectionReason || 'No reason recorded.'
                  }`}
            </Text>
          </View>
        )}
      </Card.Content>
    </Card>
  );
}

// THE COST OF A FREE-TEXT ROUTE, SAID OUT LOUD RATHER THAN PREVENTED.
//
// Route names are matched exactly — canonicalRoute() snaps case and spacing and
// nothing else — so "Miyapur" and "Miyapur Cab" are two different pickup areas
// as far as the coordinator's board is concerned, and one carpool quietly
// becomes two. A dropdown made that impossible; a text box makes it a typo away.
//
// Not blocked, because a genuinely new route is exactly what this field is for.
// Just named, at the moment it is being created, to the only person who can
// tell a new route from a misspelt one.
function NewRouteHint({ value, options }) {
  const text = String(value || '').trim();
  if (!text) return null;
  if ((options || []).some((r) => routeKey(r) === routeKey(text))) return null;
  return (
    <HelperText type="info" visible style={styles.hint}>
      "{text}" is a new route — nobody is on it yet. Check the spelling, or the
      same pickup area ends up as two groups.
    </HelperText>
  );
}

function Field({ icon, label, value }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.muted} />
      <View style={styles.fieldText}>
        <Text variant="bodySmall" style={styles.muted}>
          {label}
        </Text>
        <Text variant="bodyMedium" style={styles.fieldValue}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: spacing.lg,
  },
  header: { marginBottom: spacing.lg },
  headerTitle: { fontFamily: font.bold, color: colors.text },
  headerBody: { color: colors.muted, marginTop: spacing.xs, lineHeight: 20 },
  filter: { marginBottom: spacing.lg },
  list: { paddingBottom: spacing.xl },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardWho: { flex: 1, minWidth: 0 },
  name: { fontFamily: font.semibold, color: colors.text },
  muted: { color: colors.muted },
  statusChip: { alignSelf: 'flex-start' },
  divider: { marginVertical: spacing.md, backgroundColor: colors.border },
  field: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  fieldText: { flex: 1, minWidth: 0 },
  fieldValue: { color: colors.text, lineHeight: 21 },
  fieldLabel: {
    color: colors.muted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    letterSpacing: 0.3,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  decided: { marginTop: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: 56 },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: 340,
    lineHeight: 20,
  },
  routeInput: { backgroundColor: colors.surface },
  dialog: { width: '100%', maxWidth: 540, alignSelf: 'center' },
  dialogBody: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  dialogHint: { color: colors.muted, marginBottom: spacing.md, lineHeight: 19 },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  hint: { marginTop: 0, color: colors.muted },
});
