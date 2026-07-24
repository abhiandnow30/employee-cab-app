// ---------------------------------------------------------------------------
// ADDRESS CHANGE REQUESTS  (admin)
// The transport desk reviews employees' home-address change requests.
//   • Approve → writes the new address onto the employee's profile and marks
//               the request "Approved" (done atomically in the service).
//   • Reject  → keeps the current address, marks the request "Rejected", with
//               an optional reason the employee then sees on their profile.
// Requests are live from Firestore; only an admin can read all of them or act
// on them (enforced by the security rules).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Divider, Chip, SegmentedButtons, Snackbar,
  Portal, Dialog, TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import {
  subscribeAllAddressRequests, approveAddressRequest, rejectAddressRequest,
  REQUEST_STATUS,
} from '../../services/addressRequests';
import { colors } from '../../theme';

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

function RequestCard({ req, onApprove, onReject, busy }) {
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
  const { currentUser } = useApp();
  const adminName = currentUser?.name || 'Admin';
  const [requests, setRequests] = useState([]);
  const [tab, setTab] = useState('pending');
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [busyId, setBusyId] = useState('');

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

  async function handleApprove(req) {
    setError('');
    setBusyId(req.id);
    try {
      await approveAddressRequest(req, adminName);
      setSnack(`Approved — ${req.employeeName || 'employee'}'s address updated.`);
    } catch (e) {
      setError(e.message);
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
              onApprove={handleApprove}
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
});
