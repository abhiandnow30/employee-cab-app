// ---------------------------------------------------------------------------
// CHANGE REQUEST QUEUE  (coordinator)
//
// The three things an employee can raise, all of which land here: leave, drop one
// ride, and "I'm working a different shift". The coordinator resolves them as part
// of running the day — there is no HR sign-off, because none of them commits a cab
// beyond the two scheduled rides. (HR had a queue once, for shift extensions and
// emergency rides; those requests no longer exist.)
//
// A fourth, "Absent today", was retired — it cancelled the day's cabs exactly like
// Leave and differed only in leaving the roster code alone. Requests already filed
// under it still arrive here and still resolve; see REQUEST_CATALOGUE.
//
// Resolving carries out the effect on the day's rides AND stamps the request in a
// single batch — see services/changeRequests.js. The employee is notified either
// way, including on a rejection, so a request never just goes quiet.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, FlatList } from 'react-native';
import {
  Text, Card, Button, Chip, Snackbar, Divider, SegmentedButtons,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import {
  STATUS_STYLE, REQUEST_STATUS, REQUEST_TYPES,
} from '../../data/changeRequests';
import { todayKey } from '../../utils/datetime';
import { colors, font, radius, shadow, spacing } from '../../theme';

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
    changeRequests, myQueue, resolveChangeRequest, declineChangeRequest, currentUser,
  } = useApp();

  // HR/ADMIN DOES NOT GET REJECT — they approve, or they leave it for the
  // coordinator. Hidden rather than disabled: a greyed button on every card
  // reads as "you could do this", which is the opposite of what is meant.
  //
  // This is a UI decision only. `firestore.rules` still allows either desk role
  // to reject (isDesk), and declineChangeRequest() still refuses anyone who
  // isn't a desk role — so nothing here is a security boundary, and the
  // coordinator's own Reject is untouched.
  const canReject = currentUser?.role !== 'admin';

  const [tab, setTab] = useState('today'); // today | upcoming | history
  // WHICH ROW IS MID-WRITE, by id — not one screen-wide flag, so acting on one
  // request doesn't grey out the buttons on every other card in the queue.
  const [busyId, setBusyId] = useState(null);
  const [snack, setSnack] = useState('');

  const pending = useMemo(() => myQueue(), [myQueue]);

  // TODAY = the pending requests that need settling now. Anything still pending
  // from an EARLIER date is in here too, not filed away as history — an overdue
  // request is the most urgent thing on this screen, and a date-equality check
  // would have hidden it the moment midnight passed.
  const todayKeyStr = todayKey();
  const todayPending = useMemo(
    () => pending.filter((r) => String(r.date || '') <= todayKeyStr),
    [pending, todayKeyStr]
  );

  // Pending, but for a day that hasn't arrived — leave booked a week out. These
  // are NOT actionable today and would clutter the working list, but they must
  // not become unreachable either: History only holds settled requests, so
  // without this segment a future-dated request could be filed nowhere and
  // silently never seen. The segment only appears when there is something in it.
  const upcomingPending = useMemo(
    () => pending.filter((r) => String(r.date || '') > todayKeyStr),
    [pending, todayKeyStr]
  );

  // HISTORY = settled only (Resolved / Rejected). Deliberately excludes anything
  // still pending, so it reads as a record of decisions rather than a second
  // to-do list.
  const history = useMemo(
    () => (changeRequests || []).filter((r) => r.status !== REQUEST_STATUS.PENDING),
    [changeRequests]
  );

  const data = tab === 'today' ? todayPending : tab === 'upcoming' ? upcomingPending : history;

  // BOTH BUTTONS ACT IMMEDIATELY — no confirmation step and no note.
  //
  // There used to be one dialog serving both, and for a rejection it REQUIRED a
  // typed reason before the confirm button would enable. Removed at request.
  //
  // What that gives up, said plainly rather than discovered later: the employee
  // is still notified either way, but a rejection now reaches them with no
  // reason attached, and neither action gets a second look before it commits —
  // resolving a Leave cancels every cab that person has that day and recodes the
  // roster to L. Both are reversible by other means (the roster can be re-coded,
  // a desk-cancelled ride has Put back on the day board), which is what makes
  // one-tap defensible here. `resolveChangeRequest` and `declineChangeRequest`
  // both still accept a note, so restoring the prompt is a UI change only.
  async function act(request, mode) {
    if (busyId) return;
    setBusyId(request.id);
    const res =
      mode === 'resolve'
        ? await resolveChangeRequest(request, {})
        : await declineChangeRequest(request, '');
    setBusyId(null);
    if (res?.ok) {
      setSnack(
        mode === 'resolve'
          ? `${res.outcome || 'Resolved'} — the employee has been notified.`
          : 'Rejected — the employee has been notified.'
      );
    } else {
      // The snackbar is the only error channel now that there is no dialog to
      // hold one, so a refusal still gets said out loud.
      setSnack(res?.message || 'Could not update that request.');
    }
  }

  // THE BUTTON'S LABEL — one word.
  //
  // The card used to carry the full sentence ("Cancel day & mark Leave"), which
  // made a full-width button out of a one-word decision and pushed Reject onto
  // its own line. The long forms (actionLabel/consequence) were only ever read
  // by the confirmation dialog and went with it.
  //
  // SHIFT_CHANGED keeps its own word. It re-codes the roster day rather than
  // cancelling anything, so labelling it "Cancel" would be plainly wrong.
  function actionLabelShort(request) {
    return request.type === REQUEST_TYPES.SHIFT_CHANGED ? 'Approve' : 'Cancel';
  }


  function renderRequest({ item }) {
    const st = STATUS_STYLE[item.status] || STATUS_STYLE[REQUEST_STATUS.PENDING];
    const open_ = item.status === REQUEST_STATUS.PENDING;

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
            {item.requestedShiftCode ? (
              <Text variant="bodySmall" style={styles.detail}>
                New shift: {item.requestedShiftCode}
              </Text>
            ) : null}
            <Text variant="bodySmall" style={styles.raised}>
              Raised {formatWhen(item.createdAt)}
            </Text>
          </View>

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
                  onPress={() => act(item, 'resolve')}
                  loading={busyId === item.id}
                  disabled={!!busyId}
                  style={styles.primaryAction}
                >
                  {actionLabelShort(item)}
                </Button>
                {canReject ? (
                  <Button
                    mode="outlined"
                    compact
                    textColor={colors.danger}
                    onPress={() => act(item, 'reject')}
                    disabled={!!busyId}
                    style={styles.rejectBtn}
                  >
                    Reject
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
        {/* Wording is role-neutral on purpose: HR and the coordinator both work
            this queue now, and the old line ("you resolve these yourself — no
            approval needed") described a division of labour that no longer
            holds. Saying the list is shared is the part that matters — either
            desk deciding a request settles it for both. */}
        <Text variant="bodySmall" style={styles.hint}>
          Exceptions to today's roster — approve or reject each one. HR and the
          coordinator share this queue, so whoever gets to it first settles it.
        </Text>

        {/* Today = what to settle now. History = decisions already made, not a
            second to-do list. "Upcoming" only appears when a pending request is
            dated in the future — without it those would belong to no tab at all,
            since History holds settled requests only. */}
        <SegmentedButtons
          value={tab}
          onValueChange={setTab}
          density="small"
          style={styles.tabs}
          buttons={[
            { value: 'today', label: `Today (${todayPending.length})` },
            ...(upcomingPending.length
              ? [{ value: 'upcoming', label: `Upcoming (${upcomingPending.length})` }]
              : []),
            { value: 'history', label: 'History' },
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
                {tab === 'today'
                  ? 'Nothing to settle today.'
                  : tab === 'upcoming'
                  ? 'Nothing raised for a later date.'
                  : 'No request has been settled yet.'}
              </Text>
            </View>
          }
        />
      </View>

      {/* No confirmation dialog. It served both buttons and made a rejection
          type a reason first; both act on the tap now — see act() above for what
          that trades away. actionLabel()/consequence() were only ever read by
          that dialog and went with it; the button's own short label lives in
          actionLabelShort(). */}

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={4000}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  col: { flex: 1, width: '100%', maxWidth: 800, alignSelf: 'center' },
  hint: {
    color: colors.muted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    lineHeight: 19,
  },
  tabs: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  head: { flex: 1, minWidth: 0 },
  meta: { color: colors.muted, marginTop: 2 },
  // What was actually asked for, in a tray of its own — it is the thing being
  // decided on, so it should not read as more of the header above it.
  detailBox: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  detail: { color: colors.text, marginTop: 2 },
  comments: { color: colors.textSecondary, marginTop: spacing.xs, fontStyle: 'italic' },
  raised: { color: colors.muted, marginTop: spacing.sm },
  resolution: { color: colors.textSecondary, marginTop: spacing.md, fontStyle: 'italic' },
  divider: { marginVertical: spacing.lg, backgroundColor: colors.border },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  // flexGrow: 0 — it holds one short word now, so it sizes to that instead of
  // stretching across the card. With the long label it had to grow, which is
  // what shoved Reject onto a line of its own; the two now sit side by side.
  primaryAction: { borderRadius: radius.md, flexGrow: 0 },
  rejectBtn: { borderRadius: radius.md, borderColor: colors.danger },
  empty: { alignItems: 'center', marginTop: 56, gap: spacing.sm },
  emptyText: { color: colors.muted },
});
