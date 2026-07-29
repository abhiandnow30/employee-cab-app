// ---------------------------------------------------------------------------
// CHANGE REQUEST QUEUE  (coordinator and HR/Admin) — Step 8
//
// One screen, two audiences, because the work is identical — only the routing
// differs, and the routing is policy:
//
//   • COORDINATOR sees leave, absent, cancel-a-ride, retime, shift-changed and
//     emergency rides. They resolve them as part of running the day. No approval
//     from anyone.
//   • HR/ADMIN sees shift EXTENSIONS (an extra cab outside the rostered shift)
//     and any emergency ride the coordinator had no vehicle for.
//
// Resolving carries out the effect on the day's rides AND stamps the request in a
// single batch — see services/changeRequests.js. The employee is notified either
// way, including on a rejection, so a request never just goes quiet.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Chip, Portal, Dialog, TextInput, Snackbar, Divider,
  SegmentedButtons,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import {
  STATUS_STYLE, REQUEST_STATUS, REQUEST_TYPES, requestMeta,
} from '../../data/changeRequests';
import { colors } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(key) {
  const [y, m, d] = String(key).split('-').map((n) => parseInt(n, 10));
  return `${String(d).padStart(2, '0')} ${MONTHS[(m || 1) - 1]} ${y}`;
}
function formatWhen(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ChangeRequestQueueScreen() {
  const {
    currentUser, changeRequests, myQueue,
    resolveChangeRequest, declineChangeRequest, escalateChangeRequest,
  } = useApp();

  const isCoordinator = currentUser?.role === 'coordinator';

  const [tab, setTab] = useState('pending'); // pending | all
  const [acting, setActing] = useState(null); // { request, mode }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');

  const pending = useMemo(() => myQueue(), [myQueue]);
  const data = tab === 'pending' ? pending : changeRequests;

  function open(request, mode) {
    setNote('');
    setError('');
    setActing({ request, mode });
  }

  async function confirm() {
    const { request, mode } = acting;
    setBusy(true);
    let res;
    if (mode === 'resolve') res = await resolveChangeRequest(request, { note });
    else if (mode === 'reject') res = await declineChangeRequest(request, note);
    else res = await escalateChangeRequest(request, note);
    setBusy(false);
    if (res?.ok) {
      setActing(null);
      setSnack(
        mode === 'resolve'
          ? `${res.outcome || 'Resolved'} — the employee has been notified.`
          : mode === 'reject'
          ? 'Rejected — the employee has been notified.'
          : 'Escalated to HR.'
      );
    } else {
      setError(res?.message || 'Could not update that request.');
    }
  }

  // What the primary button does for this type, in the desk's language.
  function actionLabel(request) {
    const meta = requestMeta(request.type);
    switch (request.type) {
      case REQUEST_TYPES.LEAVE:
        return 'Cancel day & mark Leave';
      case REQUEST_TYPES.ABSENT:
        return "Cancel today's cabs";
      case REQUEST_TYPES.CANCEL_RIDE:
        return 'Release the seat';
      case REQUEST_TYPES.PICKUP_TIME_CHANGE:
        return `Move pickup to ${request.requestedTime || 'the new time'}`;
      case REQUEST_TYPES.SHIFT_CHANGED:
        return `Set roster to ${request.requestedShiftCode || 'the new shift'}`;
      case REQUEST_TYPES.SHIFT_EXTENDED:
        return 'Approve extra cab';
      case REQUEST_TYPES.EMERGENCY_RIDE:
        return 'Approve emergency ride';
      default:
        return meta?.label || 'Resolve';
    }
  }

  // What resolving actually does, spelled out so nobody clicks it blind.
  function consequence(request) {
    switch (request.type) {
      case REQUEST_TYPES.LEAVE:
        return `Every cab for ${request.employeeName} on ${prettyDate(request.date)} is cancelled, and the roster day becomes L (Leave) so it stops generating rides.`;
      case REQUEST_TYPES.ABSENT:
        return `Every cab for ${request.employeeName} on ${prettyDate(request.date)} is cancelled. The roster is left as it is.`;
      case REQUEST_TYPES.CANCEL_RIDE:
        return 'That one ride is cancelled and the seat is released for someone else.';
      case REQUEST_TYPES.PICKUP_TIME_CHANGE:
        return `The booking's pickup time moves to ${request.requestedTime}. Check the cab can still make it.`;
      case REQUEST_TYPES.SHIFT_CHANGED:
        return `The roster day becomes ${request.requestedShiftCode}, so the rides regenerate at that shift's times. Any cab already assigned at the old time is cancelled.`;
      case REQUEST_TYPES.SHIFT_EXTENDED:
        return "Approving adds a return cab to the coordinator's list for that day, flagged as an approved extension. They assign a vehicle to it from Today's Rides.";
      case REQUEST_TYPES.EMERGENCY_RIDE:
        return "Approving adds this ride to Today's Rides for that date, flagged as an emergency. Assign a vehicle to it there.";
      default:
        return '';
    }
  }

  function renderRequest({ item }) {
    const st = STATUS_STYLE[item.status] || STATUS_STYLE[REQUEST_STATUS.PENDING];
    const open_ = item.status === REQUEST_STATUS.PENDING;
    const canEscalate =
      isCoordinator && open_ && item.type === REQUEST_TYPES.EMERGENCY_RIDE && !item.escalated;

    return (
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <View style={styles.rowBetween}>
            <View style={styles.head}>
              <Text variant="titleSmall">{item.employeeName}</Text>
              <Text variant="bodySmall" style={styles.meta}>
                {item.typeLabel || item.type} · {prettyDate(item.date)}
                {item.route ? ` · ${item.route}` : ''}
              </Text>
            </View>
            <Chip
              compact
              icon={st.icon}
              style={{ backgroundColor: st.bg }}
              textStyle={{ color: st.fg, fontSize: 11 }}
            >
              {item.status}
            </Chip>
          </View>

          <View style={styles.detailBox}>
            {item.reason ? (
              <Text variant="bodySmall" style={styles.detail}>
                Reason: {item.reason}
              </Text>
            ) : null}
            {item.comments ? (
              <Text variant="bodySmall" style={styles.comments}>
                “{item.comments}”
              </Text>
            ) : null}
            {item.requestedTime ? (
              <Text variant="bodySmall" style={styles.detail}>
                Time asked for: {item.requestedTime}
              </Text>
            ) : null}
            {item.requestedShiftCode ? (
              <Text variant="bodySmall" style={styles.detail}>
                New shift: {item.requestedShiftCode}
              </Text>
            ) : null}
            {item.direction ? (
              <Text variant="bodySmall" style={styles.detail}>
                Direction: {item.direction}
              </Text>
            ) : null}
            <Text variant="bodySmall" style={styles.raised}>
              Raised {formatWhen(item.createdAt)}
            </Text>
          </View>

          {item.escalated ? (
            <View style={styles.escalatedBox}>
              <MaterialCommunityIcons name="arrow-up-bold-circle" size={15} color="#B26A00" />
              <Text variant="bodySmall" style={styles.escalatedText}>
                Escalated to HR — no vehicle was free
                {item.escalationNote ? `: ${item.escalationNote}` : '.'}
              </Text>
            </View>
          ) : null}

          {item.resolutionNote ? (
            <Text variant="bodySmall" style={styles.resolution}>
              {item.resolvedByName || 'Desk'}: {item.resolutionNote}
            </Text>
          ) : null}

          {open_ ? (
            <>
              <Divider style={styles.divider} />
              <View style={styles.actions}>
                <Button
                  mode="contained"
                  compact
                  icon="check"
                  onPress={() => open(item, 'resolve')}
                  style={styles.primaryAction}
                >
                  {actionLabel(item)}
                </Button>
                <Button
                  mode="outlined"
                  compact
                  textColor={colors.danger}
                  onPress={() => open(item, 'reject')}
                  style={styles.rejectBtn}
                >
                  Reject
                </Button>
                {canEscalate ? (
                  <Button
                    mode="text"
                    compact
                    icon="arrow-up-bold"
                    onPress={() => open(item, 'escalate')}
                  >
                    No cab — escalate
                  </Button>
                ) : null}
              </View>
            </>
          ) : null}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.col}>
        <Text variant="bodySmall" style={styles.hint}>
          {isCoordinator
            ? "Exceptions to today's roster. You resolve these yourself — no approval needed. Escalate an emergency only when no vehicle is free."
            : 'Exceptions that need HR: shift extensions, and emergency rides the coordinator had no cab for.'}
        </Text>

        <SegmentedButtons
          value={tab}
          onValueChange={setTab}
          density="small"
          style={styles.tabs}
          buttons={[
            { value: 'pending', label: `For me (${pending.length})` },
            { value: 'all', label: 'All requests' },
          ]}
        />

        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={renderRequest}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="check-circle-outline" size={44} color={colors.muted} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {tab === 'pending' ? 'Nothing waiting on you.' : 'No requests yet.'}
              </Text>
            </View>
          }
        />
      </View>

      <Portal>
        <Dialog visible={!!acting} onDismiss={() => !busy && setActing(null)} style={styles.dialog}>
          <Dialog.Title>
            {acting?.mode === 'resolve'
              ? actionLabel(acting.request)
              : acting?.mode === 'reject'
              ? 'Reject this request?'
              : 'Escalate to HR?'}
          </Dialog.Title>
          <Dialog.Content>
            {acting?.mode === 'resolve' ? (
              <Text variant="bodyMedium" style={styles.dialogText}>
                {consequence(acting.request)}
              </Text>
            ) : acting?.mode === 'reject' ? (
              <Text variant="bodyMedium" style={styles.dialogText}>
                Nothing changes on the roster or the rides. {acting.request.employeeName} is
                notified, so give them a reason.
              </Text>
            ) : (
              <Text variant="bodyMedium" style={styles.dialogText}>
                The request stays open and moves to HR's queue. Use this when you have
                no vehicle available.
              </Text>
            )}
            <TextInput
              label={acting?.mode === 'reject' ? 'Reason (shown to the employee)' : 'Note (optional)'}
              value={note}
              onChangeText={setNote}
              mode="outlined"
              multiline
              numberOfLines={2}
              style={styles.noteInput}
            />
            {error ? (
              <Text variant="bodySmall" style={styles.dialogError}>
                {error}
              </Text>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setActing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={acting?.mode === 'reject' ? colors.danger : undefined}
              onPress={confirm}
              loading={busy}
              disabled={busy || (acting?.mode === 'reject' && !note.trim())}
            >
              Confirm
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={4000}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  col: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  hint: { opacity: 0.75, padding: 12, paddingBottom: 8, lineHeight: 18 },
  tabs: { marginHorizontal: 12, marginBottom: 6 },
  list: { padding: 12 },
  card: { marginBottom: 12 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  head: { flex: 1 },
  meta: { color: colors.muted, marginTop: 2 },
  detailBox: { marginTop: 10 },
  detail: { color: colors.text, marginTop: 2 },
  comments: { color: colors.text, marginTop: 4, fontStyle: 'italic' },
  raised: { color: colors.muted, marginTop: 6 },
  escalatedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF6E5',
    borderRadius: 8,
    padding: 8,
    marginTop: 10,
  },
  escalatedText: { color: '#B26A00', flex: 1, lineHeight: 18 },
  resolution: { color: colors.text, marginTop: 8, fontStyle: 'italic' },
  divider: { marginVertical: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  primaryAction: { borderRadius: 8, flexGrow: 1 },
  rejectBtn: { borderRadius: 8, borderColor: colors.danger },
  empty: { alignItems: 'center', marginTop: 50, gap: 8 },
  emptyText: { color: colors.muted },
  dialog: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dialogText: { lineHeight: 20, marginBottom: 12 },
  noteInput: { marginTop: 4 },
  dialogError: { color: colors.danger, marginTop: 8 },
});
