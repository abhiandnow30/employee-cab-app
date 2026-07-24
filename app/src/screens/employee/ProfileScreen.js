// ---------------------------------------------------------------------------
// PROFILE  (read-only)
// Shows the signed-in user's details exactly as the ADMIN entered them. The
// employee can only VIEW their profile — there are no edit buttons. Profile
// data (Employee ID, name, phone, home address, pickup location) is owned by
// the admin and enforced read-only by the Firestore security rules.
//
// To change their home address an employee taps "Request Address Change",
// which files a request the admin approves/rejects. Past requests (with their
// status, and rejection reason if any) are listed below.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Text, Avatar, Card, List, Button, Divider, TextInput, HelperText,
  Portal, Dialog, Chip,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import ScreenContainer from '../../components/ScreenContainer';
import { REQUEST_STATUS } from '../../services/addressRequests';
import { colors } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Firestore Timestamp → "12 Jul 2026". Blank while a write is still pending.
function formatDate(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const STATUS_STYLE = {
  [REQUEST_STATUS.PENDING]: { bg: '#FFF4E0', fg: '#B26A00', icon: 'clock-outline' },
  [REQUEST_STATUS.APPROVED]: { bg: '#E7F4E8', fg: colors.success, icon: 'check-circle-outline' },
  [REQUEST_STATUS.REJECTED]: { bg: '#FDECEC', fg: colors.danger, icon: 'close-circle-outline' },
};

function StatusChip({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE[REQUEST_STATUS.PENDING];
  return (
    <Chip
      compact
      icon={s.icon}
      style={{ backgroundColor: s.bg }}
      textStyle={{ color: s.fg, fontWeight: 'bold' }}
    >
      {status}
    </Chip>
  );
}

const EMPTY_FORM = { requestedAddress: '', landmark: '', reason: '' };

export default function ProfileScreen() {
  const { currentUser, logout, homeAddressOf, myAddressRequests, requestAddressChange } = useApp();
  const u = currentUser || {};
  const isEmployee = u.role === 'employee';
  const roleLabel = u.role === 'admin' ? 'Transport Desk' : u.role === 'driver' ? 'Driver' : 'Employee';
  const address = homeAddressOf(u);

  const initials = (u.name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // --- Request Address Change dialog ---
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setField = (key) => (t) => setForm((f) => ({ ...f, [key]: t }));

  function openDialog() {
    setForm(EMPTY_FORM);
    setError('');
    setOpen(true);
  }

  async function submit() {
    setError('');
    if (!form.requestedAddress.trim()) {
      setError('Please enter your new address.');
      return;
    }
    if (!form.reason.trim()) {
      setError('Please give a reason for the change.');
      return;
    }
    setBusy(true);
    const res = await requestAddressChange(form);
    setBusy(false);
    if (res?.ok) {
      setOpen(false);
      setForm(EMPTY_FORM);
    } else {
      setError(res?.message || 'Could not submit your request. Try again.');
    }
  }

  return (
    <ScreenContainer scroll style={styles.container}>
      <View style={styles.header}>
        <Avatar.Text size={72} label={initials} />
        <Text variant="headlineSmall" style={styles.name}>
          {u.name}
        </Text>
        <Text variant="bodyMedium" style={styles.role}>
          {roleLabel}
        </Text>
      </View>

      {/* All fields are read-only — the admin manages profile data. */}
      <Card mode="outlined" style={styles.card}>
        <List.Item title="Email" description={u.email || '—'} left={(p) => <List.Icon {...p} icon="email" />} />
        <Divider />
        <List.Item
          title="Employee ID"
          description={u.empId || 'Not set'}
          left={(p) => <List.Icon {...p} icon="identifier" />}
        />
        <Divider />
        <List.Item
          title="Phone"
          description={u.phone || 'Not set'}
          left={(p) => <List.Icon {...p} icon="phone" />}
        />
        {isEmployee ? (
          <>
            <Divider />
            <List.Item
              title="Home Address"
              description={address || 'Not set — ask the transport desk to add it'}
              descriptionNumberOfLines={4}
              left={(p) => <List.Icon {...p} icon="map-marker" />}
            />
          </>
        ) : null}
      </Card>

      {isEmployee ? (
        <>
          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium">Home address</Text>
              <Text variant="bodySmall" style={styles.help}>
                Your address is managed by the transport desk and can't be edited
                here. If you've moved, request a change and an admin will review it.
              </Text>
              <Button
                mode="contained"
                icon="home-edit"
                onPress={openDialog}
                style={styles.requestBtn}
              >
                Request Address Change
              </Button>
            </Card.Content>
          </Card>

          {myAddressRequests.length ? (
            <Card mode="outlined" style={styles.card}>
              <Card.Content>
                <Text variant="titleMedium" style={styles.requestsTitle}>
                  My address change requests
                </Text>
                {myAddressRequests.map((r) => {
                  const style = STATUS_STYLE[r.status] || STATUS_STYLE[REQUEST_STATUS.PENDING];
                  return (
                    <View key={r.id} style={[styles.requestRow, { borderLeftColor: style.fg }]}>
                      <View style={styles.requestTop}>
                        <StatusChip status={r.status} />
                        {formatDate(r.requestedAt) ? (
                          <Text variant="bodySmall" style={styles.requestWhen}>
                            {formatDate(r.requestedAt)}
                          </Text>
                        ) : null}
                      </View>
                      <Text variant="bodyMedium" style={styles.requestNew}>
                        {r.requestedAddress}
                      </Text>
                      {r.status === REQUEST_STATUS.REJECTED && r.rejectionReason ? (
                        <Text variant="bodySmall" style={styles.rejectReason}>
                          Reason: {r.rejectionReason}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </Card.Content>
            </Card>
          ) : null}
        </>
      ) : null}

      <Button mode="contained" icon="logout" onPress={logout} style={styles.logout}>
        Log out
      </Button>

      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.dialog}>
          <Dialog.Title>Request Address Change</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              <Text variant="labelMedium" style={styles.currentLabel}>
                Current Address
              </Text>
              <View style={styles.currentBox}>
                <MaterialCommunityIcons name="map-marker" size={16} color={colors.muted} />
                <Text variant="bodyMedium" style={styles.currentText}>
                  {address || 'No address on file'}
                </Text>
              </View>

              <TextInput
                label="New Address"
                value={form.requestedAddress}
                onChangeText={setField('requestedAddress')}
                mode="outlined"
                multiline
                placeholder="Flat / House, Street, Area, City, Pincode"
                style={styles.input}
              />
              <TextInput
                label="Landmark (optional)"
                value={form.landmark}
                onChangeText={setField('landmark')}
                mode="outlined"
                placeholder="e.g. Near Metro pillar 123"
                style={styles.input}
              />
              <TextInput
                label="Reason for Address Change"
                value={form.reason}
                onChangeText={setField('reason')}
                mode="outlined"
                multiline
                placeholder="e.g. Relocated to a new home"
                style={styles.input}
              />
              {error ? <HelperText type="error" visible>{error}</HelperText> : null}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>
              Submit request
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 4 },
  header: { alignItems: 'center', marginBottom: 24 },
  name: { marginTop: 12, fontWeight: 'bold' },
  role: { opacity: 0.7 },
  card: { marginBottom: 20 },
  help: { opacity: 0.7, marginTop: 4, marginBottom: 12 },
  requestBtn: { marginTop: 4 },
  requestsTitle: { marginBottom: 8 },
  requestRow: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  requestTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestWhen: { opacity: 0.6 },
  requestNew: { marginTop: 6 },
  rejectReason: { color: colors.danger, marginTop: 4 },
  logout: { paddingVertical: 4, marginTop: 4 },
  dialog: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  dialogBody: { paddingVertical: 8 },
  currentLabel: { opacity: 0.8, marginBottom: 4 },
  currentBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#EDF3FB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  currentText: { flex: 1, color: colors.text },
  input: { marginBottom: 10 },
});
