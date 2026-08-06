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

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Chip, Divider, Portal, Dialog, TextInput,
  HelperText, Snackbar, SegmentedButtons,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Dropdown from '../../components/Dropdown';
import { useApp } from '../../context/AppContext';
import { colors, spacing } from '../../theme';

const STATUS_TINT = {
  Pending: { bg: '#FFF6E5', fg: colors.warning, icon: 'clock-outline' },
  Approved: { bg: '#E8F5E9', fg: colors.success, icon: 'check-circle' },
  Rejected: { bg: '#FDECEA', fg: colors.danger, icon: 'close-circle' },
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

  function openApprove(req) {
    setDialogError('');
    setEdits({
      name: req.name || '',
      empId: req.empId || '',
      phone: req.phone || '',
      address: req.address || '',
      route: req.proposedRoute || '',
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
  async function setRoute(req, route) {
    const res = await proposeCabRequestRoute(req.id, route);
    setSnack(res.ok ? `Route set to ${route} for ${req.name || 'this request'}.` : res.message);
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
              onApprove={() => openApprove(item)}
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
              <Text variant="bodySmall" style={styles.fieldLabel}>
                Pickup route
              </Text>
              <Dropdown
                compact={false}
                value={edits.route}
                options={routeOptions}
                onSelect={(r) => setEdits((e) => ({ ...e, route: r }))}
                placeholder="Pick the route for this address"
                status={edits.route ? 'success' : undefined}
              />
              {/* Approving without a route would leave them under "No route
                  set" on the board every single day — the exact problem this
                  screen exists to end. */}
              <HelperText type="info" visible style={styles.hint}>
                Required. Without a route they land under "No route set" every day.
              </HelperText>
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
              the only useful thing they get.
            </Text>
            <TextInput
              label="Reason"
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
            <Dropdown
              compact={false}
              value={req.proposedRoute || ''}
              options={routeOptions}
              onSelect={onSetRoute}
              placeholder="Which route covers this address?"
              status={req.proposedRoute ? 'success' : 'error'}
            />
            {isAdmin ? (
              <View style={styles.actions}>
                <Button mode="text" textColor={colors.danger} onPress={onReject}>
                  Reject
                </Button>
                <Button mode="contained" icon="check" onPress={onApprove}>
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
  screen: { flex: 1 },
  inner: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg },
  header: { marginBottom: spacing.md },
  headerTitle: { fontWeight: 'bold', color: colors.text },
  headerBody: { color: colors.muted, marginTop: spacing.xs, lineHeight: 18 },
  filter: { marginBottom: spacing.md },
  list: { paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardWho: { flex: 1, minWidth: 0 },
  name: { fontWeight: 'bold', color: colors.text },
  muted: { color: colors.muted },
  statusChip: { alignSelf: 'flex-start' },
  divider: { marginVertical: spacing.md },
  field: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  fieldText: { flex: 1, minWidth: 0 },
  fieldValue: { color: colors.text },
  fieldLabel: {
    color: colors.muted,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  decided: { marginTop: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: 320,
  },
  dialog: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  dialogBody: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  dialogHint: { color: colors.muted, marginBottom: spacing.md, lineHeight: 18 },
  input: { marginBottom: spacing.md },
  hint: { marginTop: 0 },
});
