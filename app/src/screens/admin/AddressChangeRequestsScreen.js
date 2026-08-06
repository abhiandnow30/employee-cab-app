// ---------------------------------------------------------------------------
// ADDRESS CHANGE REQUESTS  (admin)
//
// APPROVAL IS A REVIEW, NOT A RUBBER STAMP. The dialog opens with the requested
// address EDITABLE and the employee's pickup route alongside it, because a move is
// usually both: someone who moves across the city needs the new address AND the
// route that collects that part of the city. Approving the address alone was a real
// hole — the driver navigated to the new house while the rider stayed grouped with
// their old neighbours, so the wrong cab collected them every day until somebody
// noticed by hand.
//
//   • Approve → profile address + pickup route + the address copy on upcoming
//               rides + the request itself, all in one atomic write.
//   • Reject  → address unchanged, an optional reason recorded.
// Either way the employee is notified, so the outcome isn't something they have to
// discover by opening their profile.
//
// Requests are live from Firestore; only an admin can read all of them or act on
// them (enforced by the security rules).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Divider, Chip, SegmentedButtons, Snackbar,
  Portal, Dialog, TextInput, HelperText,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import {
  subscribeAllAddressRequests, approveAddressRequest, rejectAddressRequest,
  REQUEST_STATUS,
} from '../../services/addressRequests';
import { colors } from '../../theme';

// The dropdown value meaning "not on a route".
const NO_ROUTE = '__none__';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWhen(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const STATUS_STYLE = {
  [REQUEST_STATUS.PENDING]: { bg: '#FFF4E0', fg: '#B26A00' },
  [REQUEST_STATUS.APPROVED]: { bg: '#E7F4E8', fg: colors.success },
  [REQUEST_STATUS.REJECTED]: { bg: '#FDECEC', fg: colors.danger },
};

function StatusChip({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE[REQUEST_STATUS.PENDING];
  return (
    <Chip compact style={{ backgroundColor: s.bg }} textStyle={{ color: s.fg, fontWeight: 'bold' }}>
      {status}
    </Chip>
  );
}

function RequestCard({ req, currentRoute, onApprove, onReject, busy }) {
  const isPending = req.status === REQUEST_STATUS.PENDING;
  return (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <View style={styles.rowBetween}>
          <Text variant="titleMedium" numberOfLines={1} style={styles.name}>
            {req.employeeName || 'Employee'}
          </Text>
          <StatusChip status={req.status} />
        </View>
        {formatWhen(req.requestedAt) ? (
          <Text variant="bodySmall" style={styles.when}>Requested {formatWhen(req.requestedAt)}</Text>
        ) : null}

        <Divider style={styles.divider} />

        <Text variant="labelMedium" style={styles.fieldLabel}>Current Address</Text>
        <Text variant="bodyMedium" style={styles.fieldValue}>{req.currentAddress || '—'}</Text>

        <Text variant="labelMedium" style={[styles.fieldLabel, styles.newLabel]}>Requested Address</Text>
        <Text variant="bodyMedium" style={styles.fieldValue}>{req.requestedAddress}</Text>

        {req.landmark ? (
          <>
            <Text variant="labelMedium" style={[styles.fieldLabel, styles.newLabel]}>Landmark</Text>
            <Text variant="bodyMedium" style={styles.fieldValue}>{req.landmark}</Text>
          </>
        ) : null}

        <Text variant="labelMedium" style={[styles.fieldLabel, styles.newLabel]}>Reason</Text>
        <Text variant="bodyMedium" style={styles.fieldValue}>{req.reason || '—'}</Text>

        {/* The route they're on today. Shown next to the addresses because that is
            the comparison that matters: if the new address is in a different part
            of the city, the route almost certainly has to move with it. */}
        {isPending ? (
          <>
            <Text variant="labelMedium" style={[styles.fieldLabel, styles.newLabel]}>
              Current pickup route
            </Text>
            <Text variant="bodyMedium" style={styles.fieldValue}>
              {currentRoute || 'No route set'}
            </Text>
          </>
        ) : null}

        {req.status === REQUEST_STATUS.REJECTED && req.rejectionReason ? (
          <View style={styles.rejectBox}>
            <Text variant="bodySmall" style={styles.rejectText}>
              Rejection reason: {req.rejectionReason}
            </Text>
          </View>
        ) : null}
        {!isPending && req.reviewedBy ? (
          <Text variant="bodySmall" style={styles.reviewedBy}>
            {req.status} by {req.reviewedBy}
            {formatWhen(req.reviewedAt) ? ` · ${formatWhen(req.reviewedAt)}` : ''}
          </Text>
        ) : null}

        {isPending ? (
          <View style={styles.actions}>
            <Button
              mode="outlined"
              icon="close"
              textColor={colors.danger}
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() => onReject(req)}
              disabled={busy}
            >
              Reject
            </Button>
            <Button
              mode="contained"
              icon="check"
              style={styles.actionBtn}
              onPress={() => onApprove(req)}
              loading={busy}
              disabled={busy}
            >
              Approve
            </Button>
          </View>
        ) : null}
      </Card.Content>
    </Card>
  );
}

export default function AddressChangeRequestsScreen() {
  const { currentUser, employees, routeOptions } = useApp();
  const adminName = currentUser?.name || 'Admin';
  const [requests, setRequests] = useState([]);
  const [tab, setTab] = useState('pending');
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [busyId, setBusyId] = useState('');

  // Approve dialog state — the address as it will be SAVED, and the route.
  const [approveFor, setApproveFor] = useState(null);
  const [approveAddress, setApproveAddress] = useState('');
  const [approveRoute, setApproveRoute] = useState(NO_ROUTE);
  const [approveError, setApproveError] = useState('');

  // Reject dialog state.
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    const unsub = subscribeAllAddressRequests(setRequests, (e) => setError(e.message));
    return unsub;
  }, []);

  const pending = useMemo(
    () => requests.filter((r) => r.status === REQUEST_STATUS.PENDING),
    [requests]
  );
  const data = tab === 'pending' ? pending : requests;

  // The route the employee is on RIGHT NOW, from their live profile — the request
  // document doesn't carry it.
  const currentRouteOf = (employeeId) =>
    employees.find((e) => e.uid === employeeId)?.roster?.route || null;

  function openApprove(req) {
    setApproveError('');
    // Seed with what they asked for, including the landmark they typed — the desk
    // shouldn't have to retype it to keep it.
    setApproveAddress(
      [req.requestedAddress, req.landmark ? `Landmark: ${req.landmark}` : '']
        .filter(Boolean)
        .join(', ')
    );
    setApproveRoute(currentRouteOf(req.employeeId) || NO_ROUTE);
    setApproveFor(req);
  }

  async function confirmApprove() {
    const req = approveFor;
    if (!req) return;
    if (!approveAddress.trim()) {
      setApproveError('The address cannot be empty.');
      return;
    }
    setApproveError('');
    setBusyId(req.id);
    try {
      // Writes the profile address, the pickup route, the address copy on every
      // upcoming ride, and the request — atomically. `syncedRides` says how many
      // rides were corrected so drivers navigate to the new house.
      const { syncedRides, route } = await approveAddressRequest(req, adminName, {
        address: approveAddress,
        route: approveRoute === NO_ROUTE ? '' : approveRoute,
      });
      setApproveFor(null);
      const who = req.employeeName || 'employee';
      setSnack(
        `Approved — ${who}'s address updated` +
          (route ? `, route set to ${route}` : '') +
          (syncedRides
            ? `, and ${syncedRides} upcoming ride${syncedRides > 1 ? 's' : ''} corrected.`
            : '.')
      );
    } catch (e) {
      setApproveError(e.message);
    } finally {
      setBusyId('');
    }
  }

  function openReject(req) {
    setRejectFor(req);
    setRejectReason('');
  }

  async function confirmReject() {
    if (!rejectFor) return;
    const req = rejectFor;
    setRejectFor(null);
    setError('');
    setBusyId(req.id);
    try {
      await rejectAddressRequest(req, adminName, rejectReason);
      setSnack(`Rejected — ${req.employeeName || 'employee'}'s address unchanged.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerCol}>
        <SegmentedButtons
          value={tab}
          onValueChange={setTab}
          style={styles.tabs}
          buttons={[
            { value: 'pending', label: `Pending (${pending.length})`, icon: 'clock-outline' },
            { value: 'all', label: `All (${requests.length})`, icon: 'format-list-bulleted' },
          ]}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <RequestCard
              req={item}
              currentRoute={currentRouteOf(item.employeeId)}
              onApprove={openApprove}
              onReject={openReject}
              busy={busyId === item.id}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="home-city-outline" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {tab === 'pending' ? 'No pending requests.' : 'No address change requests yet.'}
              </Text>
            </View>
          }
        />
      </View>

      <Portal>
        {/* Review and save — not a rubber stamp. */}
        <Dialog
          visible={!!approveFor}
          onDismiss={() => !busyId && setApproveFor(null)}
          style={styles.dialog}
        >
          <Dialog.Title>Approve address change</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodySmall" style={styles.dialogText}>
              Check the wording before saving — this is what drivers navigate to.
            </Text>
            <TextInput
              label="Home address (as it will be saved)"
              value={approveAddress}
              onChangeText={setApproveAddress}
              mode="outlined"
              multiline
              numberOfLines={3}
              style={styles.input}
            />

            <Text variant="labelLarge" style={styles.dialogLabel}>
              Pickup route
            </Text>
            <Dropdown
              value={approveRoute}
              options={[NO_ROUTE, ...routeOptions]}
              onSelect={setApproveRoute}
              format={(r) => (r === NO_ROUTE ? 'No route set' : r)}
              compact={false}
              leadingIcon="map-marker-path"
            />
            <HelperText type="info" visible>
              A move usually changes the route too. Leave it as it is if the new
              address is in the same pickup area — otherwise the cab keeps
              collecting them with their old neighbours.
            </HelperText>

            {approveError ? (
              <HelperText type="error" visible>
                {approveError}
              </HelperText>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setApproveFor(null)} disabled={!!busyId}>
              Cancel
            </Button>
            <Button
              mode="contained"
              icon="check"
              onPress={confirmApprove}
              loading={!!busyId}
              disabled={!!busyId}
            >
              Approve &amp; save
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={!!rejectFor} onDismiss={() => setRejectFor(null)} style={styles.dialog}>
          <Dialog.Title>Reject request</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogText}>
              The employee's current address stays unchanged. You can add an
              optional reason they'll see on their profile.
            </Text>
            <TextInput
              label="Rejection reason (optional)"
              value={rejectReason}
              onChangeText={setRejectReason}
              mode="outlined"
              multiline
              placeholder="e.g. Please provide a valid pincode"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRejectFor(null)}>Cancel</Button>
            <Button mode="contained" buttonColor={colors.danger} onPress={confirmReject}>
              Reject
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
  centerCol: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', padding: 12 },
  tabs: { marginBottom: 12 },
  list: { paddingBottom: 24 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { flex: 1 },
  when: { opacity: 0.6, marginTop: 2 },
  divider: { marginVertical: 10 },
  fieldLabel: { opacity: 0.7 },
  newLabel: { marginTop: 8 },
  fieldValue: { marginTop: 2 },
  rejectBox: {
    backgroundColor: '#FDECEC',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  rejectText: { color: colors.danger },
  reviewedBy: { opacity: 0.6, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1 },
  rejectBtn: { borderColor: colors.danger },
  error: { color: colors.danger, marginBottom: 8 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { opacity: 0.7 },
  dialog: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  dialogText: { marginBottom: 12, opacity: 0.8 },
  dialogLabel: { marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.surface },
});
