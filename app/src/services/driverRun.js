// ---------------------------------------------------------------------------
// DRIVER RUN — turning a driver's flat list of bookings into the two things
// their screen actually acts on: a RUN, and what is left to do on it.
//
// WHY THIS FILE EXISTS. The driver used to walk a four-tap ladder per rider —
// Start Trip, Arrived, Enter OTP, Complete Trip — which mixed decisions about
// ONE PERSON ("this rider is aboard") with decisions about THE WHOLE CAB ("the
// run has started", "the run is finished") and laid them out as one flat list of
// buttons. On a carpool of four that is sixteen taps, every one of them a
// question about which button belongs to whom, answered at a kerb at 8 PM.
//
// Split those two kinds of decision and the shape falls out on its own. Every
// journey has a boarding half and a dropping half, and exactly one of them is
// spread across the stops:
//
//   PICKUP (Home → Office)   boarding is per stop     · the drop is one place
//   DROP   (Office → Home)   boarding is one place    · the drops are per stop
//
// So the spread half gets a card per rider, and the batched half gets a single
// cab-level button. Same idea both ways round, mirrored.
//
// NOTHING HERE IS PERSISTED. The phase is derived from the riders' statuses on
// every render, which is what makes the screen recoverable: kill the app
// mid-run, reopen it, and it works out where the cab is from the same documents
// the desk is looking at. There is no run object in Firestore and there must not
// be one — it would be a second source of truth for something the statuses
// already say.
//
// This module is pure: no Firebase, no React. It is imported by the driver
// screen AND by AppContext (for the location-sharing hook), and those two must
// agree on what "the current run" means or they will act on different riders.
// ---------------------------------------------------------------------------

import { DIRECTION } from './rides';
import { STATUS } from '../data/mockData';
import { timeToMinutes } from '../utils/datetime';

// A RUN is one cab, one departure: same travel date, same time, same direction.
// The driver screen already computed this exact string and then never used it.
export const runKeyOf = (b) => `${b?.date}|${b?.shift}|${b?.direction}`;

// Anything that is not explicitly the outbound leg is treated as a pickup —
// matching the existing default in tripPickupPoint/tripPlaceLabels, so a
// booking with a missing or unrecognised direction behaves consistently
// everywhere rather than differently on this one screen.
export const isOutbound = (b) => b?.direction === DIRECTION.OUT;

export const RUN_PHASE = {
  AT_OFFICE: 'at-office', // drop run: the cab has not been declared at the pickup yet
  BOARDING: 'boarding', // riders are getting in — one decision each
  READY: 'ready', // everyone resolved, at least one aboard; the cab can leave
  DROPPING: 'dropping', // drop run: riders being delivered — one decision each
  DONE: 'done', // nothing left that this driver can do
};

// ---------------------------------------------------------------------------
// The four questions every rule below is built from.
// ---------------------------------------------------------------------------

// "Has the boarding question been answered for this person?" — they got in,
// they didn't turn up, or the trip is already over.
const RESOLVED = [STATUS.ON_BOARD, STATUS.COMPLETED, STATUS.NO_SHOW];
const isResolved = (b) => RESOLVED.includes(b.status);

// "Is this person's trip over?" — nothing the driver can do either way.
const FINISHED = [STATUS.COMPLETED, STATUS.NO_SHOW];
const isFinished = (b) => FINISHED.includes(b.status);

const isOnBoard = (b) => b.status === STATUS.ON_BOARD;
const isArrived = (b) => b.status === STATUS.ARRIVED;

// ---------------------------------------------------------------------------
// WHICH RIDERS EACH BATCH MAY TOUCH.
//
// READ THIS BEFORE CHANGING ANY OF THE THREE FUNCTIONS BELOW. They are not
// convenience filters; they are the only thing standing between a cab-level
// button and a corrupted run, for two independent reasons:
//
// 1. THE RULES DO NOT STOP A RUN GOING BACKWARDS. driverAdvancingTrip() in
//    firestore.rules whitelists DESTINATIONS ('On the way', 'Arrived',
//    'Completed', 'No show') and constrains the FROM status for exactly one of
//    them — Completed. So a batch that blindly wrote 'On the way' across a cab
//    would be accepted, and would demote riders who are already aboard, or whose
//    trip has finished, back to waiting at the kerb.
//
// 2. A BATCH IS ALL-OR-NOTHING. One ineligible document does not get skipped;
//    it fails the entire commit. Send a no-show into the "trip complete" batch
//    and completingOnlyAfterBoarding() refuses it, and with it every rider who
//    legitimately boarded.
//
// So each function answers "who is this write actually legal and correct for?",
// and the caller passes the answer straight to the batch.
// ---------------------------------------------------------------------------

// Setting off. ONLY from 'Cab assigned' — see reason 1. Being this narrow is
// also what makes the location-sharing hook idempotent: run it twice and the
// second call finds nobody left to mark, so it writes nothing at all.
export const idsToMarkOnTheWay = (riders) =>
  riders.filter((b) => b.status === STATUS.ASSIGNED).map((b) => b.id);

// A drop run's "At the office": put everybody at the kerb in one go, because
// firestore.rules only lets a rider board FROM 'Arrived' and nothing else on
// this screen can get them there.
//
// DEFINED BY EXCLUSION, DELIBERATELY. Whitelisting 'Cab assigned' and 'On the
// way' looks equivalent and is not: a rider sitting at 'Booked' would match
// neither, so the sweep would skip them, and with no route to 'Arrived' they
// could never board and never be no-showed off the run — stranded with no
// button that does anything. Anyone not already resolved and not already there
// is someone this button is for.
export const idsToMarkArrived = (riders) =>
  riders.filter((b) => !isResolved(b) && !isArrived(b)).map((b) => b.id);

// A pickup run's "Trip complete": only the riders who actually boarded — see
// reason 2. A no-show in this list would take the whole cab down with it.
export const idsToComplete = (riders) => riders.filter(isOnBoard).map((b) => b.id);

// ---------------------------------------------------------------------------
// THE PHASE
// ---------------------------------------------------------------------------

// `departed` is the one fact the statuses cannot tell us on a pickup run, because
// "Start trip" deliberately writes nothing (a driver may only write a booking's
// status, and there is no status for "the cab pulled away" that isn't a lie
// about one of the riders). The screen passes its own local flag in. Losing it
// — an app restart — costs one harmless tap and records nothing wrong.
export function runPhase(riders, out, departed = false) {
  if (!riders.length || riders.every(isFinished)) return RUN_PHASE.DONE;

  // Still someone to board? That is the job, whichever leg this is. On a drop
  // run they must all be at 'Arrived' first, which is what AT_OFFICE is for.
  const boarding = riders.some((b) => !isResolved(b));

  if (out) {
    if (boarding && riders.some((b) => !isResolved(b) && !isArrived(b))) {
      return RUN_PHASE.AT_OFFICE;
    }
    if (boarding) return RUN_PHASE.BOARDING;
    // Everyone resolved. One rider already delivered PROVES the drops began, so
    // the driving phase survives a restart from that point on without needing
    // the local flag.
    if (riders.some((b) => b.status === STATUS.COMPLETED)) return RUN_PHASE.DROPPING;
    if (!riders.some(isOnBoard)) return RUN_PHASE.DONE;
    return departed ? RUN_PHASE.DROPPING : RUN_PHASE.READY;
  }

  if (boarding) return RUN_PHASE.BOARDING;
  // Nobody aboard and nobody left to board means every rider no-showed. There is
  // no trip to start and nothing to complete — 'Completed' is only legal from
  // 'On board', so offering the button would be offering a guaranteed error.
  if (!riders.some(isOnBoard)) return RUN_PHASE.DONE;
  return RUN_PHASE.READY;
}

// ---------------------------------------------------------------------------
// GROUPING
// ---------------------------------------------------------------------------

// Bookings → runs, sorted the way the driver meets them: by day, then by
// departure time, then by direction so a pickup and a drop at the same minute
// keep a stable order.
//
// `departedKeys` is the set of run keys the screen has been told have pulled
// away. Passing it in (rather than holding state here) keeps this file pure.
export function groupRuns(trips, departedKeys = null) {
  const byKey = new Map();
  (trips || []).forEach((b) => {
    const key = runKeyOf(b);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        date: b.date,
        shift: b.shift,
        direction: b.direction,
        out: isOutbound(b),
        riders: [],
      });
    }
    byKey.get(key).riders.push(b);
  });

  return [...byKey.values()]
    .map((run) => ({
      ...run,
      departed: !!departedKeys?.has(run.key),
      phase: runPhase(run.riders, run.out, !!departedKeys?.has(run.key)),
      boarded: run.riders.filter(isOnBoard).length,
      noShow: run.riders.filter((b) => b.status === STATUS.NO_SHOW).length,
      resolved: run.riders.filter(isResolved).length,
    }))
    .sort(
      (a, b) =>
        String(a.date || '').localeCompare(String(b.date || '')) ||
        (timeToMinutes(a.shift) ?? 0) - (timeToMinutes(b.shift) ?? 0) ||
        String(a.direction || '').localeCompare(String(b.direction || ''))
    );
}

// The run the driver is actually on right now: the earliest one still carrying
// work, ON THE GIVEN DAY.
//
// THE DAY FILTER IS NOT OPTIONAL. Two things go wrong without it, both quiet:
//
//   • A driver holds their pickup and their drop simultaneously — both sit in
//     `bookings` all day. Marking the whole cab when sharing starts at 8 PM
//     would tell the 10 PM riders their cab was on its way, and would close
//     their cancellation window hours early (rideCancelState treats 'On the way'
//     as the point of no return).
//   • A run left half-finished yesterday is still the "earliest unfinished" one,
//     so today's first act would reach back and stamp a stale rider.
export function activeRun(runs, dayKey) {
  return (
    (runs || []).find((r) => r.phase !== RUN_PHASE.DONE && (!dayKey || r.date === dayKey)) || null
  );
}
