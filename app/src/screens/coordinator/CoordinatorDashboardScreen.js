// ---------------------------------------------------------------------------
// THE DAY BOARD  (today's rides) — the coordinator's home, and HR's too
//
// The operational centre of the app. The coordinator does NOT wait for employees
// to request rides and does NOT need admin approval to run the day — they take
// the rides the roster implies and put people in cabs.
//
// HR/ADMIN OPENS THE SAME SCREEN (registered for both desk roles in App.js). Not
// so they can run the day, but because "Add a rider" is here: the monthly sheet
// always misses somebody, and HR is usually who hears about it. They add the rider,
// the ride appears on this board for the coordinator to give a cab to. Nothing on
// this screen is role-gated — an admin could assign a cab from here too, which they
// could already do from All Bookings, so no new power is being handed out.
//
// Rides shown here are DERIVED from the monthly roster (see services/rides.js),
// so a ride exists the moment HR imports the month. A booking document is only
// written when this screen assigns a cab, which is what keeps ~11,000 rides a
// month from becoming 11,000 documents.
//
// HOW THE BOARD IS ARRANGED — one way, not a choice:
//   • sections are ROUTES — everyone from one pickup area, which is a cabful
//   • an IN / OUT segment picks the direction, so only one of the day's two runs
//     is on screen at a time
// The old "By route / By shift" toggle was removed at explicit request. By-shift was
// the browsing view; with direction now its own control there was little left in it,
// and route is the grouping a cab is actually filled from.
//
// Selecting riders across a group and assigning one cab is the carpool action.
// Capacity and "that cab is already going the other way" are enforced before the
// write, not after.
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, SectionList, Pressable, useWindowDimensions } from 'react-native';
import {
  Text, Card, Chip, Button, SegmentedButtons, Portal, Dialog, RadioButton,
  TextInput, Snackbar, IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import RideStartCode from '../../components/RideStartCode';
import DeskCancelDialog from '../../components/DeskCancelDialog';
// groupByShift is no longer imported — the board groups by route only. It is still
// exported from services/rides.js, so restoring the removed toggle means adding it
// back here and nothing more.
import {
  groupByRoute, rideStats, rideMatches, searchWordsOf,
} from '../../services/rides';
import { routeKey } from '../../services/roster';
import { cabCapacity } from '../../services/cabs';
import { STATUS } from '../../data/mockData';
import { todayKey, shiftDateKey } from '../../utils/datetime';
import {
  SHIFT_COLORS, WORKING_CODES, legsForShift, isWorkingCode, shiftSummary,
} from '../../data/shifts';
import { statusColors, colors, font, radius, shadow, spacing } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-07-05" → "Sun 05 Jul"
function prettyDate(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((n) => parseInt(n, 10));
  const date = new Date(y, (m || 1) - 1, d || 1);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  return `${dow} ${String(d).padStart(2, '0')} ${MONTHS[(m || 1) - 1]}`;
}

export default function CoordinatorDashboardScreen({ navigation }) {
  const {
    ridesOn, assignCabToRides, cabs, rosterMonth, setRosterMonth, monthRosters,
    routeOptions, setEmployeeRoute, employeeCancellationsOn, getCabById,
    employees, shiftPolicy, addRiderToDay, deskCancelRide,
    restoreDeskCancelledRide, deskCancelState, currentUser,
  } = useApp();

  // "ADD A RIDER" IS HR'S ONLY (Aug 2026, at explicit request).
  //
  // A UI DECISION, AND IT TAKES A REAL CAPABILITY AWAY — say so plainly rather
  // than letting the next reader assume it was tidying. firestore.rules has
  // `coordinatorAddingRider()`, written specifically so a coordinator CAN create
  // rosters/<month>_<uid> for a single day (one key in `days`, stamped with their
  // own uid). That rule is untouched and still permits it; this only removes the
  // button that used it, so the ability now rests with HR alone.
  //
  // What that costs, since the coordinator is the one on the board at 9 PM: a
  // walk-up who is not on the month's sheet cannot be added to tonight by the
  // person who just found out about them. It has to go through HR — who reach
  // the same screen from their own menu, where the button still shows.
  //
  // Hidden, not disabled: a greyed button on the header of a screen they run all
  // day reads as "you could do this", which is the opposite of what is meant.
  const canAddRider = currentUser?.role === 'admin';

  // PHONE OR NOT. One breakpoint, matching ShiftPolicyScreen's — this board is
  // either being read on a desk monitor or on the coordinator's phone in a car
  // park, and there is nothing in between worth a third layout.
  //
  // What it changes is only ARRANGEMENT, never what is on screen: the four
  // headline numbers wrap into a 2×2 grid instead of squeezing onto one row, the
  // rider's name and its badges stack instead of competing for the same line, and
  // the taps grow to the 44px a thumb needs. Nothing is hidden on a small screen —
  // a coordinator working from their phone is working the same day, and a ride
  // they cannot see is a ride nobody drives.
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const [date, setDate] = useState(() => todayKey());
  // Grouping is FIXED to route — the "By route / By shift" toggle was removed from
  // the UI at explicit request. Route is the unit a cab is filled in (one route ≈ one
  // cabful of neighbours), so it is the grouping that turns ~200 rides into ~15
  // decisions; by-shift was the browsing view, and with the IN / OUT segments now
  // splitting the day by direction it had little left to show. `groupByShift` is
  // still exported by services/rides.js if it is ever wanted back.
  const [selected, setSelected] = useState([]); // ride keys
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenCab, setChosenCab] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  // Which slice of the day's rides the board is showing. The headline numbers
  // above it are the control: tapping "Waiting" or "Assigned" filters to exactly
  // the rides that number counts, so a coordinator can check what a figure is
  // made of instead of reading it and then hunting for the rows by eye.
  //   all      — every ride
  //   waiting  — no cab yet (the default: this is the work still to do)
  //   assigned — already in a cab (who is covered, and by which vehicle)
  const [rideFilter, setRideFilter] = useState('waiting');
  // Which CAB the board is narrowed to — a cab id, or null for every cab (and
  // unassigned rides too). Sits beside the search box rather than replacing it:
  // typing a cab number already worked through search, but that also matches a
  // ride whose ADDRESS happens to contain the same digits. This is the precise
  // version — "show me exactly this vehicle's manifest, nothing else" — for
  // checking a cab isn't overloaded or confirming who's actually riding in it.
  const [cabFilter, setCabFilter] = useState(null);
  // Which DIRECTION the board is showing: 'in' | 'out'. One or the other, always —
  // there is deliberately no "both" any more (it was removed at explicit request).
  //
  // The company's two rides go opposite ways at different times — an 8 PM pickup
  // from home and a 10 PM drop home — so they are two separate runs of the fleet
  // that happen to share one screen. Showing exactly one keeps the board to the run
  // the coordinator is actually working, with no other-leg riders between the rows.
  //
  // THE COST, stated so nobody is surprised by it: half the day is always off
  // screen, so an unassigned ride can only be found by pressing the other segment.
  // Two things carry that weight — the "In / Out" tile above stays a whole-day
  // count (never the current leg's), and the empty state names the other direction
  // rather than claiming the day has nothing. Keep both if this is ever reworked.
  //
  // Starts on 'in': the pickup run is the earlier of the two, so it is what a
  // coordinator opening the board during the day is working on first.
  const [legFilter, setLegFilter] = useState('in');
  // The rider whose route we're fixing, and the route picked for them. Routing is
  // HR's job, but the coordinator is the one who discovers at 9 PM that somebody
  // is on no route at all — and a ride nobody can group is a ride nobody drives.
  const [routeFor, setRouteFor] = useState(null);
  const [routeChoice, setRouteChoice] = useState(null);
  // "Add a rider" — the employee picked and the shift chosen for them, for the
  // day currently on screen.
  // The ride the desk is standing down. Only ever one at a time — this is a
  // per-rider decision taken while someone is on the phone.
  const [cancelFor, setCancelFor] = useState(null);
  const [addRiderOpen, setAddRiderOpen] = useState(false);
  const [addRiderUid, setAddRiderUid] = useState(null);
  const [addRiderCode, setAddRiderCode] = useState(null);

  // The derived rides for the chosen day, and the sections to show them in.
  const rides = useMemo(() => ridesOn(date), [ridesOn, date]);

  // The day narrowed to one direction — everything below this line works off it, so
  // the counts, the groups and the list can never disagree about which run they are
  // describing. `leg` is 'in' | 'out' on every derived ride (see makeRide in
  // services/rides.js); matching on that rather than on the `direction` label keeps
  // this from breaking if the display wording is ever reworded.
  const legRides = useMemo(
    () => rides.filter((r) => r.leg === legFilter),
    [rides, legFilter]
  );

  // Counted off the DIRECTION-filtered day, so "7 Waiting" is always 7 rides the
  // coordinator can actually see and tick. Counting the whole day here would leave
  // the headline promising rides the list isn't showing. The one exception is the
  // In / Out ratio in that row, which is deliberately read off the full day — it is
  // the whole point of this control, and a ratio of the slice you already chose
  // ("1/0") tells you nothing.
  const stats = useMemo(() => rideStats(legRides), [legRides]);
  const dayStats = useMemo(() => rideStats(rides), [rides]);
  const searchWords = useMemo(() => searchWordsOf(search), [search]);
  // One place that answers "does this ride match what was typed?", used by the
  // list, by the tick-dropping in changeSearch, and by the other-direction hint.
  const matches = useCallback(
    (r) => rideMatches(r, searchWords, r.assignedCabId ? getCabById(r.assignedCabId) : null),
    [searchWords, getCabById]
  );

  const visible = useMemo(() => {
    // A CANCELLED RIDE IS SHOWN WHATEVER THE COARSE FILTER SAYS.
    //
    // The point of keeping it on the board is that the desk can see what they
    // just stood down and put it back. Run through the filter normally it would
    // disappear the instant it was cancelled — it is neither Waiting (no cab
    // needed) nor Assigned — which is the same "where did it go?" the banner
    // above the board used to cause. It is excluded from every COUNT instead
    // (see rideStats), so the tiles still only measure real work.
    //
    // The bypass is deliberately limited to the two COARSE buckets. Picking an
    // exact status from the dropdown means "only this status", so letting
    // cancelled rides through there would make "On the way" show cancelled rows.
    const isCancelled = (r) => r.status === STATUS.CANCELLED;
    const byStatus =
      rideFilter === 'all'
        ? legRides
        : rideFilter === 'waiting'
        ? legRides.filter((r) => !r.assignedCabId || isCancelled(r))
        : rideFilter === 'assigned'
        ? legRides.filter((r) => r.assignedCabId || isCancelled(r))
        : // 'cancelled' — the one tile that shows cancelled rides ALONE, with no
          // bypass, so it is the place to review what has been stood down.
          legRides.filter(isCancelled);
    const byCab = cabFilter ? byStatus.filter((r) => r.assignedCabId === cabFilter) : byStatus;
    return searchWords.length ? byCab.filter(matches) : byCab;
  }, [legRides, rideFilter, cabFilter, searchWords, matches]);

  // How to name the active status filter in prose — used by the search empty
  // state ("showing Waiting for a cab only"). The dropdown that once needed a
  // full option list is gone; the four tiles are the control now, so this only
  // has to label those four.
  const statusFilterLabel = useCallback((v) => {
    if (v === 'all') return 'All rides';
    if (v === 'waiting') return 'Waiting for a cab';
    if (v === 'assigned') return 'Has a cab';
    return 'Cancelled';
  }, []);

  // Same hazard as the direction, search and cab controls: narrowing by status
  // can take a ticked row off screen, and a tick on a row the coordinator cannot
  // see is a cab about to be assigned to somebody they are not looking at.
  function changeRideFilter(next) {
    setRideFilter(next);
    setSelected((prev) =>
      prev.filter((key) => {
        const r = rides.find((x) => x.key === key);
        if (!r) return false;
        if (next === 'all') return true;
        if (next === 'waiting') return !r.assignedCabId;
        if (next === 'assigned') return !!r.assignedCabId;
        return r.status === next;
      })
    );
  }

  // EVERY MATCH ON THE DAY, ignoring all three narrowing controls — direction,
  // status and cab.
  //
  // The direction segment was the only one of the three the empty state used to
  // account for, but all three hide matches the same way, and the status one
  // hides them by DEFAULT: the board opens on "Waiting", so searching for
  // anybody whose cab is already assigned came back "Nothing matches", which
  // reads as "they are not travelling today". The coordinator has a name in
  // their hand at that moment and no reason to doubt the answer.
  //
  // So this counts the honest total, and the empty state below reports where the
  // matches actually are with one tap to go and see them. Nothing about which
  // rides the filters show has changed — only whether an empty result can lie.
  const searchHits = useMemo(() => {
    if (!searchWords.length) return [];
    return rides.filter(matches);
  }, [rides, searchWords, matches]);

  // Which of the three controls is what's hiding them, so the wording can name
  // it rather than saying "a filter" and leaving the desk to hunt.
  const hiddenBy = useMemo(() => {
    if (!searchWords.length || !searchHits.length) return null;
    // Would this ride survive the status filter as it currently stands? Written
    // once here rather than mirrored per branch, so an exact status from the
    // dropdown is accounted for the same way the coarse buckets are.
    const passesStatus = (r) => {
      if (rideFilter === 'all') return true;
      if (rideFilter === 'waiting') return !r.assignedCabId;
      if (rideFilter === 'assigned') return !!r.assignedCabId;
      return r.status === rideFilter;
    };
    return {
      leg: searchHits.some((r) => r.leg !== legFilter),
      status:
        rideFilter !== 'all' &&
        searchHits.some((r) => r.leg === legFilter && !passesStatus(r)),
      cab: !!cabFilter && searchHits.some((r) => r.assignedCabId !== cabFilter),
    };
  }, [searchWords, searchHits, legFilter, rideFilter, cabFilter]);

  // Drop every narrowing control so the matches on screen are all of them, and
  // move to the leg that actually holds one if this one doesn't.
  function showAllSearchHits() {
    setRideFilter('all');
    setCabFilter(null);
    if (searchHits.length && !searchHits.some((r) => r.leg === legFilter)) {
      // changeLegFilter would clear the selection; do that here too, for the
      // same reason — a tick on a row about to leave the screen.
      setSelected([]);
      setLegFilter(searchHits[0].leg);
    }
  }
  const sections = useMemo(
    () => groupByRoute(visible),
    [visible]
  );

  // Rides the riders themselves called off for this day. They are deliberately
  // NOT in `rides` above — ridesOn() drops cancelled rides so the board shows
  // only what still has to be driven, which is what frees the seat. But a seat
  // silently vanishing from a cab is exactly the kind of change the coordinator
  // has to know about: it may empty a carpool, or leave room for someone who was
  // waiting. So they are listed separately, with the reason the rider gave.
  const riderCancellations = useMemo(
    () => employeeCancellationsOn(date),
    [employeeCancellationsOn, date]
  );

  // deskCancellations / deskCancelOpen went with the panel they fed: a
  // desk-cancelled ride is a card on the board now, derived by ridesOn() itself,
  // so there is nothing for this screen to fetch separately. deskCancellationsOn
  // is still on the context for anything else that wants the list.

  // Switching direction drops the current selection, the same way moving to another
  // day does. A cab cannot run both legs at once — cabAssignmentProblem() refuses it
  // as "already doing a Office → Home trip at that time" — so a selection carried
  // from IN into OUT can only end in a rejected assignment, and worse, some of the
  // ticks causing it would be on rows no longer on screen.
  // THE SAME HAZARD changeLegFilter guards, one control along: a tick on a row
  // the search has just hidden is a cab about to be assigned to somebody the
  // coordinator cannot see. But blanket-clearing on every keystroke would throw
  // away a carpool half-built, so only the ticks that ACTUALLY leave the screen
  // are dropped — the selection stays equal to what is on it.
  function changeSearch(next) {
    setSearch(next);
    const words = searchWordsOf(next);
    if (!words.length) return; // clearing the box only ever reveals rows
    setSelected((prev) =>
      prev.filter((key) => {
        const r = rides.find((x) => x.key === key);
        return (
          !!r &&
          rideMatches(r, words, r.assignedCabId ? getCabById(r.assignedCabId) : null)
        );
      })
    );
  }

  function changeLegFilter(next) {
    setSelected([]);
    setLegFilter(next);
  }

  // Same hazard as changeSearch/changeLegFilter above: narrowing to one cab can
  // take rows off screen that were ticked under "all cabs".
  function changeCabFilter(next) {
    setCabFilter(next);
    setSelected((prev) =>
      prev.filter((key) => {
        const r = rides.find((x) => x.key === key);
        return !!r && (!next || r.assignedCabId === next);
      })
    );
  }

  // Moving off the loaded month has to move the subscription too, or the day
  // would come back empty for a month that hasn't been fetched.
  function goToDate(next) {
    setSelected([]);
    setDate(next);
    const month = next.slice(0, 7);
    if (month !== rosterMonth) setRosterMonth(month);
  }

  const selectedRides = rides.filter((r) => selected.includes(r.key));
  const isSelected = (key) => selected.includes(key);
  const toggle = (key) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // Tick every still-unassigned ride in a group — the fast path to a carpool.
  // Cancelled rides are excluded: they are on the board to be seen and undone,
  // not to be given a cab, and a batch containing one would be assigning a cab
  // to somebody the desk has already stood down.
  function selectGroup(data) {
    const keys = data
      .filter((r) => !r.assignedCabId && r.status !== STATUS.CANCELLED)
      .map((r) => r.key);
    setSelected((prev) => Array.from(new Set([...prev, ...keys])));
  }

  // --- "Add a rider" ---------------------------------------------------------

  // Anyone with a ride already on this day is not a candidate — offering them
  // again would just overwrite the shift code they already have, which is a
  // different action (a shift change) belonging to the request queue.
  const ridersToday = useMemo(
    () => new Set(rides.map((r) => r.employeeId)),
    [rides]
  );
  const addRiderOptions = useMemo(
    () =>
      (employees || [])
        .filter((e) => e.role === 'employee' && !ridersToday.has(e.uid))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((e) => e.uid),
    [employees, ridersToday]
  );
  // EVERY WORKING SHIFT IN THE POLICY, in the order Shift Timings lists them.
  //
  // This used to offer only the codes that put a cab on the road on the day
  // being viewed, which as configured today is two of the five: A and N. The
  // other three were filtered out for three different reasons — E provides
  // neither leg, and A2/E2 provide a drop that (ending at or past midnight)
  // lands on the FOLLOWING day's board. Defensible, but it made the picker
  // disagree with Shift Timings, and a coordinator who has just been told
  // somebody is on E2 tonight found no E2 to pick. So all of them are offered
  // and the ones that put no cab on THIS day say so on their own row (see
  // addRiderCabNote) — visible and explained beats absent and unexplained.
  //
  // WO / H / L are still not here: they are absence markers, not shifts, which
  // is why Shift Timings lists them apart from the shifts too. Adding a rider
  // on Week Off would write a roster day that generates nothing.
  const addRiderCodes = useMemo(() => {
    const policy = shiftPolicy || {};
    // WORKING_CODES first so the order matches Shift Timings, then anything the
    // policy has that the constant doesn't — a code added to config/shifts
    // without a matching entry in data/shifts.js still shows up.
    const known = WORKING_CODES.filter((code) => isWorkingCode(policy, code));
    const extra = Object.keys(policy).filter(
      (code) => isWorkingCode(policy, code) && !known.includes(code)
    );
    return [...known, ...extra];
  }, [shiftPolicy]);

  // What cab this shift actually produces — '' for the ordinary case (a ride on
  // this board, at a time on this board's own clock day).
  //
  // Rewritten when overnight drops moved onto their shift's day: it used to say
  // "Drop at 02:30 AM shows on Thu 27 Aug", pointing at the next board. Every
  // shift's ride now lands on the day being added to, so the only thing left
  // worth saying about a late drop is that its CLOCK time is tomorrow's — the
  // ride is right here.
  const addRiderCabNote = useCallback(
    (code) => {
      const legs = legsForShift(shiftPolicy || {}, code);
      if (!legs) return '';
      if (!legs.providePickup && !legs.provideDrop) {
        // E as configured today: a working shift the company runs no cab for.
        return 'No cab for this shift — they make their own way';
      }
      if (legs.provideDrop && legs.dropNextDay) {
        // A2 and E2: on this board, but after midnight by the clock.
        return `Drop at ${legs.drop} — after midnight, ${prettyDate(shiftDateKey(date, 1))}`;
      }
      return '';
    },
    [shiftPolicy, date]
  );

  const addRiderEmployee = useMemo(
    () => (employees || []).find((e) => e.uid === addRiderUid) || null,
    [employees, addRiderUid]
  );

  function openAddRider() {
    setAddRiderUid(null);
    setAddRiderCode(null);
    setAddRiderOpen(true);
  }

  // Writes the one day's shift code. The board is derived from the roster and the
  // month is already subscribed (see the effect above), so the ride appears by
  // itself — there is nothing to refresh.
  async function confirmAddRider() {
    if (!addRiderUid || !addRiderCode) return;
    setBusy(true);
    const res = await addRiderToDay(addRiderUid, date, addRiderCode);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.message || 'Could not add that rider.');
      return;
    }
    const name = addRiderEmployee?.name || 'Rider';
    const label = shiftPolicy?.[addRiderCode]?.label || addRiderCode;
    // Now that every working shift can be picked, the confirmation has to say
    // where the cab went — three of the five put nothing on THIS board, and
    // "added to Wed 26 Aug" alone would read as a ride that never appears.
    const note = addRiderCabNote(addRiderCode);
    setAddRiderOpen(false);
    setAddRiderUid(null);
    setAddRiderCode(null);
    setSnack(
      `${name} added to ${prettyDate(date)} on ${label}.` +
        (note ? ` ${note}.` : '') +
        (addRiderEmployee?.roster?.route ? '' : ' No route set — group them by hand.')
    );
  }

  // Put this rider on a route. Saved on their PROFILE, so it holds for every
  // remaining day of the roster instead of just today's board.
  async function confirmRoute() {
    if (!routeFor || !routeChoice) return;
    setBusy(true);
    const rider = routeFor;
    const res = await setEmployeeRoute(rider.employeeId, routeChoice);
    setBusy(false);
    setRouteFor(null);
    if (res?.ok) {
      // Tick their still-unassigned rides straight away. Routing someone was
      // only ever step one of "get this person into a cab" — without this they
      // silently drop out of "No route set" into a group further down the
      // board, and the coordinator has to go hunting for the person they were
      // just looking at. Only unassigned rides, matching selectGroup().
      const theirs = rides
        .filter((r) => r.employeeId === rider.employeeId && !r.assignedCabId)
        .map((r) => r.key);
      if (theirs.length) {
        setSelected((prev) => Array.from(new Set([...prev, ...theirs])));
      }
      setSnack(`${rider.employeeName} added to ${routeChoice} — selected, ready to assign.`);
    } else {
      setError(res?.message || 'Could not save that route.');
    }
  }

  function openDeskCancel(ride) {
    setCancelFor(ride);
  }

  // CONFIRMED, NOT ONE-CLICK. Restoring is not destructive — it can be undone by
  // cancelling again — but it does tell the rider their cab is back on, and that
  // message cannot be recalled. On a list of several cancellations the name is
  // the only thing between reinstating the right ride and the wrong one, which
  // is the same reason DeskCancelDialog restates the ride.
  const [restoreFor, setRestoreFor] = useState(null);

  async function confirmRestore() {
    if (!restoreFor) return;
    setBusy(true);
    const res = await restoreDeskCancelledRide(restoreFor);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.message || 'Could not restore that ride.');
      return;
    }
    const name = restoreFor.employeeName || 'Rider';
    setRestoreFor(null);
    setSnack(`${name}'s ride is back on the board — waiting for a cab.`);
  }

  async function confirmDeskCancel() {
    if (!cancelFor) return;
    setBusy(true);
    // No reason is passed — see DeskCancelDialog's header for what that costs and
    // why it was chosen. deskCancelRide still accepts one, so re-adding a reason is
    // a UI change and nothing more.
    const res = await deskCancelRide(cancelFor);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.message || 'Could not cancel that ride.');
      return;
    }
    const name = cancelFor.employeeName || 'Rider';
    setCancelFor(null);
    // Untick it if it was selected — a cancelled ride must not be sitting in a
    // selection the coordinator then assigns a cab to.
    setSelected((prev) => prev.filter((k) => k !== cancelFor.key));
    setSnack(`${name}'s ride cancelled. The seat is free.`);
  }

  async function confirmAssign() {
    if (!chosenCab || !selectedRides.length) return;
    setBusy(true);
    const res = await assignCabToRides(selectedRides, chosenCab);
    setBusy(false);
    if (res?.ok) {
      setPickerOpen(false);
      setSelected([]);
      setSnack(
        `Cab assigned to ${selectedRides.length} rider${selectedRides.length === 1 ? '' : 's'}.`
      );
    } else {
      setError(res?.message || 'Could not assign the cab.');
      setPickerOpen(false);
    }
  }

  function renderSectionHeader({ section }) {
    return (
      <View style={[styles.sectionHeader, isMobile && styles.sectionHeaderMobile]}>
        <View style={styles.sectionTitleWrap}>
          {/* Always a route pin now — sections are always routes. */}
          <MaterialCommunityIcons
            name="map-marker"
            size={isMobile ? 15 : 17}
            color={colors.primaryDark}
          />
          {/* One line, always. A route name that wraps pushes "Select N" off the
              row and the group's heading stops looking like a heading — so on a
              phone the type shrinks and the name ellipsises instead. */}
          <Text
            variant="titleSmall"
            style={[styles.sectionTitle, isMobile && styles.sectionTitleMobile]}
            numberOfLines={1}
          >
            {section.title}
          </Text>
          <Text variant="bodySmall" style={styles.sectionCount}>
            ({section.data.length})
          </Text>
        </View>
        {section.unassigned > 0 ? (
          <Button
            compact
            mode="text"
            onPress={() => selectGroup(section.data)}
            // The whole group in one tap — worth a thumb-sized target even
            // though the label is small. hitSlop rather than padding, so the
            // header row's height doesn't grow to accommodate it.
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            labelStyle={isMobile ? styles.selectLabelMobile : undefined}
          >
            Select {section.unassigned}
          </Button>
        ) : null}
      </View>
    );
  }

  function renderRide({ item, index, section }) {
    const cancelled = item.status === STATUS.CANCELLED;
    // A cancelled ride keeps its assignedCabId on purpose (that is what lets the
    // desk be told which cab has the seat back), so `assigned` must not treat one
    // as a covered ride — it would show a cab chip and hide the Put back action.
    const assigned = !cancelled && !!item.assignedCabId;
    const cab = assigned ? cabs.find((c) => c.id === item.assignedCabId) : null;
    const ticked = isSelected(item.key);
    // Only a PENDING ride is a candidate for the carpool selection — a ride
    // that already has a cab is a decision already made, and giving it a
    // checkbox too reads as "you could reassign this" when in fact nothing
    // downstream treats a re-tick of an assigned ride any differently:
    // selectGroup() already only ticks the unassigned ones, and
    // confirmAssign() would just hand the SAME cab a second assignment call
    // for someone who already has one. So the checkbox — and the tap-to-toggle
    // — only exist where there is actually a decision left to make.
    //
    // A cancelled ride is not one either: nobody is travelling, so there is no
    // cab to give it. Put back is its only action.
    const selectable = !assigned && !cancelled;
    const Wrapper = selectable ? Pressable : View;
    const code = SHIFT_COLORS[item.shiftCode] || { bg: colors.surfaceAlt, fg: colors.text };
    // The DESK's window (30 minutes), not the rider's (4 hours) — same helper, its own
    // cutoff. Reads the booking when there is one and the derived ride when there
    // isn't; both carry date, shift and status.
    const deskCancel = deskCancelState(item.booking || item);

    // A ROUTE CAN RUN AT MORE THAN ONE TIME. "Madhapur" is a pickup area, not a
    // departure — it can hold a 10 PM Afternoon drop and a 1 AM Evening drop in
    // the same list, and a coordinator scanning names has no way to see where
    // one group ends and the next begins. Section.data is already sorted
    // chronologically (ridesForDate sorts before grouping; groupByRoute only
    // buckets it, never reorders), so "does this ride start a new time?" is just
    // "does its time differ from the one before it in this same route" — no
    // second sort, no new grouping function, nothing that could disagree with
    // what's actually on screen.
    // A board can now hold two rides at the same clock time on DIFFERENT days
    // (an overnight drop is listed with its shift), so the group is keyed on
    // depart date as well as time — otherwise a 12:00 AM drop belonging to
    // tomorrow and one belonging to today would merge into a single heading.
    const groupKeyOf = (r) => `${r?.departDate || r?.date}|${r?.shift}`;
    const prev = index > 0 ? section.data[index - 1] : null;
    const isNewTimeGroup = !prev || groupKeyOf(prev) !== groupKeyOf(item);
    const rideCount = section.data.filter((r) => groupKeyOf(r) === groupKeyOf(item)).length;
    // Same reason as the card's own note: "12:00 AM" on the 26th board is the
    // 27th's clock, and the heading is what the desk reads first.
    const groupNextDay = !!item.departDate && item.departDate !== item.date;

    return (
      <>
        {isNewTimeGroup ? (
          <View style={[styles.timeSubhead, !prev && styles.timeSubheadFirst]}>
            <MaterialCommunityIcons
              name={item.leg === 'in' ? 'home-export-outline' : 'home-import-outline'}
              size={13}
              color={colors.primaryDark}
            />
            <Text variant="labelLarge" style={styles.timeSubheadText}>
              {item.direction} · {item.shift}
              {groupNextDay ? ` · ${prettyDate(item.departDate)}` : ''}
            </Text>
            <Text variant="bodySmall" style={styles.timeSubheadCount}>
              {rideCount} rider{rideCount === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}
      <Wrapper {...(selectable ? { onPress: () => toggle(item.key) } : {})}>
        <Card style={[styles.card, ticked && styles.cardSelected]} mode="elevated">
          <Card.Content style={styles.cardRow}>
            {/* The tick is a picture of the card's state, not a target of its own —
                the whole card is the Pressable, which is already far past 44px in
                both directions. Bigger on a phone simply so it reads at arm's
                length.

                ONLY A PENDING RIDE GETS ONE. A ride that already has a cab is a
                decision already made, and a tick-box on it reads as "you could
                add this to the selection" when nothing downstream would act on
                it. But the SLOT is kept either way — an empty box of the same
                width — because a mixed group (one Pending, one assigned) would
                otherwise start its names at two different left edges, and a
                column of names that doesn't line up is harder to scan than the
                checkbox was to ignore. */}
            <View style={[styles.check, isMobile && styles.checkMobile]}>
              {selectable ? (
                <MaterialCommunityIcons
                  name={ticked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={isMobile ? 26 : 22}
                  color={ticked ? colors.primary : colors.muted}
                />
              ) : null}
            </View>
            <View style={styles.cardBody}>
              {/* NAME AND BADGES: side by side with room, stacked without. On a
                  phone the two badges take most of a narrow row, squeezing the
                  name to a few ellipsised characters — and the name is the one
                  thing on the card the coordinator is looking for. Given its own
                  line it stays whole and the badges sit under it. */}
              <View style={[styles.rowBetween, isMobile && styles.rowStacked]}>
                <Text
                  variant="titleSmall"
                  numberOfLines={isMobile ? 2 : 1}
                  style={[styles.name, isMobile && styles.nameStacked]}
                >
                  {item.employeeName}
                </Text>
                <View style={[styles.chips, isMobile && styles.chipsStacked]}>
                  <Chip
                    compact
                    style={{ backgroundColor: code.bg }}
                    textStyle={{ color: code.fg, fontSize: 11 }}
                  >
                    {item.shiftCode}
                  </Chip>
                  <Chip
                    compact
                    style={{
                      backgroundColor: cancelled
                        ? colors.dangerSoft
                        : assigned
                        ? statusColors[item.status] || colors.success
                        : colors.warningSoft,
                    }}
                    textStyle={{
                      color: cancelled ? colors.danger : assigned ? '#FFFFFF' : '#B26A00',
                      fontSize: 11,
                    }}
                  >
                    {cancelled ? 'Cancelled' : assigned ? item.status : 'Pending'}
                  </Chip>
                  {/* THE RIDE'S ONE ACTION, at the top right beside its status —
                      Cancel while it stands, Put back once it doesn't. It used to
                      be a text button on its own row at the BOTTOM of the card,
                      and a desk cancellation then moved the whole ride into a
                      banner above the board, so the row the coordinator had just
                      acted on disappeared from under them. Now the card stays
                      exactly where it is and only its chip and this button change.

                      The responder is claimed so pressing either one cannot also
                      tick the rider for assignment — the whole card is a
                      Pressable. Same trick as RideStartCode below. */}
                  <View onStartShouldSetResponder={() => true}>
                    {cancelled ? (
                      <Button
                        compact
                        mode="text"
                        icon="undo-variant"
                        textColor={colors.primary}
                        onPress={() => setRestoreFor(item.booking || item)}
                        disabled={busy}
                        labelStyle={styles.cardActionLabel}
                      >
                        Put back
                      </Button>
                    ) : deskCancel.canCancel ? (
                      <Button
                        compact
                        mode="text"
                        icon="calendar-remove"
                        textColor={colors.danger}
                        onPress={() => openDeskCancel(item)}
                        disabled={busy}
                        labelStyle={styles.cardActionLabel}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </View>
                </View>
              </View>

              <View style={styles.metaRow}>
                <MaterialCommunityIcons
                  name={item.leg === 'in' ? 'home-export-outline' : 'home-import-outline'}
                  size={14}
                  color={colors.muted}
                />
                <Text variant="bodySmall" style={styles.meta}>
                  {/* The scheduled time, shown plainly. It used to read "by 09:00 PM" for a
                  pickup and "after 10:00 PM" for a drop — the shift's own start/end
                  rather than a promised cab instant. Dropped at explicit request: the
                  ride IS scheduled at that time, and "after 10:00 PM" read as vague
                  where the desk wanted a time. The underlying field is unchanged, so
                  restoring the qualifier is a wording change only. */}
                  {item.direction} · {item.shift}
                </Text>
              </View>
              {item.employeeAddress ? (
                <View style={styles.metaRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.muted} />
                  <Text variant="bodySmall" style={styles.meta} numberOfLines={2}>
                    {item.employeeAddress}
                  </Text>
                </View>
              ) : null}
              {/* The rider's start code, on the desk's board too — this is the
                  escape hatch for a rider whose phone is dead or who can't open
                  the app at the kerb. The coordinator reads it down the phone to
                  the driver. Without it, the OTP would strand a real employee,
                  which is a worse failure than the one it prevents. */}
              <RideStartCode booking={item.booking} variant="inline" />

              {/* The route used to be repeated on the card when the board was grouped
                  by shift, because the section header wasn't showing it then. Sections
                  are always routes now, so the header always says it and repeating it
                  on every card underneath would only be noise. */}
              {/* No route means this rider can't be grouped with their neighbours.
                  Fixable here rather than by a message to HR that lands tomorrow —
                  and because it saves to their profile, it stays fixed. */}
              {!item.route ? (
                <View style={styles.noRouteRow}>
                  <MaterialCommunityIcons name="map-marker-alert" size={14} color="#B26A00" />
                  <Text variant="bodySmall" style={styles.noRouteText}>
                    No route set
                  </Text>
                  <Button
                    compact
                    mode="text"
                    onPress={() => {
                      setRouteChoice(null);
                      setRouteFor(item);
                    }}
                  >
                    Set route
                  </Button>
                </View>
              ) : null}
              {/* The Cancel / Put back button that used to sit here has moved
                  to the TOP RIGHT of the card, beside the status chip — see the
                  chips row above. It was a text button at the bottom of every
                  card, furthest from the status it changes, and a cancellation
                  then moved the ride off the board into a banner. */}

              {/* Every ride on this board comes from the roster. There is no
                  "approved extra ride" badge because there are no extra rides —
                  the company runs the 8 PM pickup and the 10 PM drop, full stop. */}

              {/* THE CAB LEAVES AFTER MIDNIGHT, so its clock time belongs to the
                  next calendar day even though it is worked from this board.
                  Keyed on departDate vs date — it used to compare shiftDate with
                  date, which stopped being able to fire at all when overnight
                  drops moved onto their shift's own day (those two are now always
                  equal). Without this the desk reads "02:30 AM" on the 26th board
                  and books a cab for the wrong night. */}
              {item.departDate && item.departDate !== item.date ? (
                <Text variant="bodySmall" style={styles.overnight}>
                  After midnight — {item.shift} on {prettyDate(item.departDate)}
                </Text>
              ) : null}
              {cab ? (
                <Text variant="bodySmall" style={styles.assignedText}>
                  → {cab.cabNumber} · {cab.driverName || 'no driver'}
                </Text>
              ) : null}
            </View>
          </Card.Content>
        </Card>
      </Wrapper>
      </>
    );
  }

  const noRoster = monthRosters.length === 0;

  // Everything above the ride list, as the SectionList's OWN header rather than
  // a sibling above it. It used to be a sibling — a plain View wrapping the day
  // navigator, the stat tiles, the cancellation cards and the search row, sat
  // next to <SectionList> inside a flex:1 column. On web that pins it: the
  // column takes the full viewport height, the header claims whatever it
  // needs, and the SectionList — a virtualized list, which manages its own
  // scrolling — is left the remainder to scroll ALONE. The visible result was
  // a header nothing could move and a second, separate scrollbar squeezed into
  // the leftover space below it, instead of the one full-page scroll every
  // other screen in the app has. Handing this whole block to the list as
  // ListHeaderComponent makes it the list's first (non-sticky) row, so it
  // scrolls away with everything else — one scroll region, the ordinary way.
  //
  // CALL THIS AND PASS THE ELEMENT — never pass the function itself. Virtualized
  // List does `isValidElement(ListHeaderComponent) ? it : <ListHeaderComponent/>`,
  // so handing it a function makes the header a COMPONENT TYPE — and this
  // function is re-declared on every render, so that type is a new identity
  // every time. React can't reconcile a changed type: it unmounts the whole
  // header and mounts a fresh one on each render, which blurs the search box
  // after every single keystroke. That was the "search doesn't work" bug.
  // As an element its type is View, which is stable, so it updates in place.
  function renderListHeader() {
    return (
      <View style={styles.listHeader}>
        {/* Day navigator */}
        <View style={styles.dateBar}>
          <IconButton
            icon="chevron-left"
            mode="contained-tonal"
            onPress={() => goToDate(shiftDateKey(date, -1))}
            accessibilityLabel="Previous day"
          />
          <Pressable
            style={[styles.datePill, isMobile && styles.datePillMobile]}
            onPress={() => goToDate(todayKey())}
          >
            <MaterialCommunityIcons name="calendar-today" size={17} color={colors.primary} />
            <Text style={styles.dateText}>{prettyDate(date)}</Text>
            {date !== todayKey() ? <Text style={styles.dateReset}>· today</Text> : null}
          </Pressable>
          <IconButton
            icon="chevron-right"
            mode="contained-tonal"
            onPress={() => goToDate(shiftDateKey(date, 1))}
            accessibilityLabel="Next day"
          />
        </View>

        {/* DIRECTION, DIRECTLY UNDER THE DATE AND CENTRED. It decides WHICH of the
            day's two runs everything below describes — the tiles, their counts and
            the list — so it belongs above them and read first, not beside a button
            halfway down. It used to share a row with "Add a rider", which put the
            board's most consequential control next to an occasional one. */}
        <View style={[styles.legRow, isMobile && styles.legRowMobile]}>
          {/* Empty cell mirroring the one on the right, so the toggle is centred
              on the ROW rather than on the space left over beside the button.
              Pointless once the row stacks, and with flex:1 in a COLUMN it would
              claim vertical space instead of horizontal — so it is not rendered
              on a phone at all. */}
          {isMobile ? null : <View style={styles.legRowSide} />}
          <SegmentedButtons
          value={legFilter}
          onValueChange={changeLegFilter}
          density="small"
          style={[styles.segmentedLeg, isMobile && styles.segmentedLegMobile]}
          buttons={[
            {
              value: 'in',
              // SHIFT VOCABULARY, NOT DIRECTIONAL. "IN" and "OUT" describe the
              // cab's direction; "Login" and "Logout" describe the employee's
              // shift, which is how the desk and the roster already talk about
              // these two rides. Same filter either way.
              label: 'Login',
              icon: 'home-export-outline',
              accessibilityLabel: 'Login — the ride to work, Home to Office',
              // Colours the ICON as well as the text; the weight comes from
              // labelStyle below.
              checkedColor: '#FFFFFF',
              uncheckedColor: colors.muted,
              style: legFilter === 'in' ? styles.legSegOn : styles.legSegOff,
              labelStyle: legFilter === 'in' ? styles.legLabelOn : styles.legLabelOff,
              // Grows the touch target without growing the row — the control keeps
              // its small density, so the header's height is unchanged.
              hitSlop: { top: 8, bottom: 8 },
            },
            {
              value: 'out',
              label: 'Logout',
              icon: 'home-import-outline',
              accessibilityLabel: 'Logout — the ride home, Office to Home',
              checkedColor: '#FFFFFF',
              uncheckedColor: colors.muted,
              style: legFilter === 'out' ? styles.legSegOn : styles.legSegOff,
              labelStyle: legFilter === 'out' ? styles.legLabelOn : styles.legLabelOff,
              hitSlop: { top: 8, bottom: 8 },
            },
          ]}
          />
          {/* Someone needs a cab tonight who the month's roster doesn't have
              working today — a mid-month joiner, or somebody who turns out to
              need one. Up here with the toggle at request; it is the only thing
              on the header that ADDS a ride, so it sits away from the controls
              that merely narrow the list. */}
          <View
            style={[
              styles.legRowSide,
              styles.legRowRight,
              isMobile && styles.legRowRightMobile,
            ]}
          >
            {canAddRider ? (
              <Button
                compact
                mode="text"
                icon="account-plus"
                onPress={openAddRider}
                style={styles.addRider}
              >
                Add a rider
              </Button>
            ) : null}
          </View>
        </View>

        {/* THE BOARD'S STATUS FILTER, and its headline counts — one control, four
            slices of the chosen direction. Tapping one shows exactly the rides it
            counted, so a figure can always be opened rather than just read.
            Cancelled is one of them now, which is what let the separate status
            dropdown beside the search box go: with all four states on tiles the
            dropdown was a second way to say the same thing.

            "In / Out" used to be a fifth, a read-only inbound/outbound ratio. It
            was removed at request — with the direction toggle now sitting directly
            above, the split it described is the control you are already looking at.
            dayStats is still computed, because the empty state uses it to say how
            many rides are waiting on the OTHER direction.

            On a phone the four wrap into a 2×2 grid: four across a 360px screen
            leaves each about 80px, where a two-digit count sits against its
            neighbour — and these are the figures the whole board is read from. */}
        <View style={[styles.stats, isMobile && styles.statsGrid]}>
          <Stat
            label="Rides"
            value={stats.total}
            active={rideFilter === 'all'}
            onPress={() => changeRideFilter('all')}
            showsLabel="every ride"
            half={isMobile}
          />
          <Stat
            label="Waiting"
            value={stats.pending}
            tone={stats.pending ? 'warn' : 'muted'}
            active={rideFilter === 'waiting'}
            onPress={() => changeRideFilter('waiting')}
            showsLabel="only rides with no cab yet"
            half={isMobile}
          />
          <Stat
            label="Assigned"
            value={stats.assigned}
            tone="good"
            active={rideFilter === 'assigned'}
            onPress={() => changeRideFilter('assigned')}
            showsLabel="only rides that already have a cab"
            half={isMobile}
          />
          {/* Counted apart from the other three on purpose — a cancelled ride is
              neither work to do nor work covered (see rideStats), so it is in
              none of their totals. Tapping it is the one place that shows ONLY
              cancelled rides; they also stay visible under Waiting and Assigned
              so a card does not vanish the moment the desk stands it down. */}
          <Stat
            label="Cancelled"
            value={stats.cancelled}
            tone={stats.cancelled ? 'bad' : 'muted'}
            active={rideFilter === 'cancelled'}
            onPress={() => changeRideFilter('cancelled')}
            showsLabel="only rides that have been cancelled"
            half={isMobile}
          />
        </View>

        {/* Riders who stood their own cab down today. Above the board rather
            than inside it: this is news, and it changes what the cabs below
            should be carrying. */}
        {riderCancellations.length ? (
          <Card mode="outlined" style={styles.cancelCard}>
            <Card.Content>
              <View style={styles.cancelHead}>
                <MaterialCommunityIcons name="account-cancel" size={18} color={colors.danger} />
                <Text variant="titleSmall" style={styles.cancelTitle}>
                  {riderCancellations.length} rider
                  {riderCancellations.length === 1 ? '' : 's'} cancelled
                </Text>
              </View>
              <Text variant="bodySmall" style={styles.cancelIntro}>
                These rides are already off the board below — the seats are free.
              </Text>
              {riderCancellations.map((b) => {
                const cab = b.assignedCabId ? getCabById(b.assignedCabId) : null;
                return (
                  <View key={b.id} style={styles.cancelRow}>
                    <Text variant="bodyMedium" style={styles.cancelName}>
                      {b.employeeName || 'Employee'}
                      {b.empId ? ` · ${b.empId}` : ''}
                    </Text>
                    <Text variant="bodySmall" style={styles.cancelMeta}>
                      {b.direction} · {b.shift}
                      {/* Which cab has the seat back. Cancelled rides keep their
                          assignedCabId precisely so this can be said. */}
                      {cab ? ` · seat free on ${cab.cabNumber}` : ''}
                    </Text>
                    <Text variant="bodySmall" style={styles.cancelWhy}>
                      “{b.cancellationReason || b.cancelReason || 'No reason given'}”
                    </Text>
                  </View>
                );
              })}
            </Card.Content>
          </Card>
        ) : null}

        {/* The "N rides cancelled by the desk" panel that used to sit here is
            gone. A desk-cancelled ride now stays on the board as its own card,
            showing Cancelled with a Put back button at the top right, so the row
            the coordinator just acted on never moves. The panel existed only
            because ridesOn() dropped cancelled rides entirely; it now keeps the
            desk's own (keepDeskCancelled in AppContext).

            The RIDER-cancellation card above is deliberately still there: a
            rider's cancellation cannot be put back (restoreDeskCancelledRide
            refuses one), so it has no card action to offer, and the reason they
            gave is worth reading in one place. */}

        {/* Its own row rather than squeezed in beside IN/OUT: that row already
            wraps on a phone with just the segments and "Add a rider" in it, and
            a search box is not something to hunt for on a board of sixteen. */}
        <View style={styles.searchRow}>
          <View style={styles.searchRowMain}>
            <TextInput
              mode="outlined"
              dense
              value={search}
              onChangeText={changeSearch}
              placeholder="Search name, ID, route, address, shift or cab"
              accessibilityLabel="Search today's rides"
              left={<TextInput.Icon icon="magnify" />}
              right={
                search ? (
                  <TextInput.Icon
                    icon="close"
                    onPress={() => changeSearch('')}
                    accessibilityLabel="Clear the search"
                  />
                ) : undefined
              }
              style={[styles.search, styles.searchInput]}
            />
            {/* Narrow the board to one vehicle's manifest — separate from typing
                the cab number into search above, which also matches a ride whose
                address happens to contain the same digits. This is exact: pick a
                cab, see exactly who's in it (or, combined with the Waiting
                filter, confirm nobody has been double-booked onto it). */}
            <View style={styles.cabFilterWrap}>
              <Dropdown
                compact={false}
                value={cabFilter}
                onSelect={changeCabFilter}
                options={[null, ...cabs.map((c) => c.id)]}
                format={(v) => {
                  if (!v) return 'All cabs';
                  const c = cabs.find((x) => x.id === v);
                  return c ? c.cabNumber : 'Cab';
                }}
                placeholder="All cabs"
                leadingIcon="car"
              />
            </View>
          </View>
          {searchWords.length || cabFilter ? (
            <Text variant="bodySmall" style={styles.searchCount}>
              {visible.length} of {stats.total} shown
              {/* Said here as well as in the empty state, because a search can
                  hide matches while still showing some — "2 of 9 shown" gives no
                  hint that a third match is one tab away. */}
              {searchWords.length && searchHits.length > visible.length
                ? ` · ${searchHits.length - visible.length} more match${
                    searchHits.length - visible.length === 1 ? '' : 'es'
                  } hidden by the filters`
                : ''}
              {cabFilter
                ? ` · cab ${cabs.find((c) => c.id === cabFilter)?.cabNumber || ''}`
                : ''}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.col}>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={renderRide}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={renderListHeader()}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            searchWords.length ? (
              /* Kept ahead of everything below, because those branches all
                 explain the DAY — "every pickup has a cab", "nobody is down to
                 travel". With a search running they would all be answering a
                 question nobody asked, and the one that matters ("no match") is
                 not among them. */
              <View style={styles.empty}>
                <MaterialCommunityIcons
                  name={searchHits.length ? 'filter-remove-outline' : 'magnify-close'}
                  size={44}
                  color={colors.muted}
                />
                {/* TWO GENUINELY DIFFERENT ANSWERS, told apart rather than
                    sharing one sentence: nobody on this day matches at all, or
                    somebody does and a filter is hiding them. The second used to
                    read identically to the first, which is how a rider with a cab
                    already assigned came back as "no match" on the default
                    Waiting tab. */}
                <Text variant="bodyMedium" style={styles.emptyText}>
                  {searchHits.length
                    ? `${searchHits.length} ride${
                        searchHits.length === 1 ? '' : 's'
                      } match “${search.trim()}”, hidden by the filters.`
                    : `Nothing on this day matches “${search.trim()}”.`}
                </Text>
                <Text variant="bodySmall" style={styles.emptyHint}>
                  {searchHits.length
                    ? [
                        hiddenBy?.status &&
                          `showing ${statusFilterLabel(rideFilter)} only`,
                        hiddenBy?.leg && `on ${legFilter === 'in' ? 'Logout' : 'Login'}`,
                        hiddenBy?.cab && 'on another cab',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Searched every ride on this day — name, ID, route, address, shift and cab.'}
                </Text>
                <View style={styles.emptyActions}>
                  {searchHits.length ? (
                    <Button mode="contained" icon="filter-remove" onPress={showAllSearchHits}>
                      Show {searchHits.length === 1 ? 'it' : 'all ' + searchHits.length}
                    </Button>
                  ) : null}
                  <Button mode="text" onPress={() => changeSearch('')}>
                    Clear search
                  </Button>
                </View>
              </View>
            ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={noRoster ? 'calendar-alert' : 'check-circle-outline'}
                size={44}
                color={colors.muted}
              />
              <Text variant="bodyMedium" style={styles.emptyText}>
                {noRoster
                  ? `No roster imported for ${date.slice(0, 7)}.`
                  : /* "Every ride has a cab" is only true when there ARE rides.
                       This branch used to ignore the count, so a day that
                       generated nothing — a weekend, or a month imported wrong —
                       reported itself as fully assigned and the coordinator
                       moved on. Zero rides is its own state, not a success. */
                  stats.total === 0
                  ? /* Every count on this screen is direction-aware, so an empty
                       board can mean "nothing today" OR "nothing THIS WAY". Those
                       need different words: telling someone "no rides on this day"
                       while the other leg has ten of them sends them off to check
                       the roster for a problem that isn't there. The hint below
                       names the other direction and its count. */
                    legFilter === 'in'
                    ? 'No Home → Office pickups on this day.'
                    : 'No Office → Home drops on this day.'
                  : rideFilter === 'waiting'
                  ? `Every ${legFilter === 'in' ? 'pickup' : 'drop'} today has a cab.`
                  : /* The day HAS rides and none of them are assigned — an empty
                       board here means the work hasn't started, not that there is
                       none. Saying "no rides" would read as the opposite. */
                    rideFilter === 'assigned'
                  ? `No ${legFilter === 'in' ? 'pickup' : 'drop'} today has a cab yet.`
                  : 'No rides on this day.'}
              </Text>
              {noRoster ? (
                <Text variant="bodySmall" style={styles.emptyHint}>
                  Ask HR to upload the monthly shift roster — rides are generated
                  from it.
                </Text>
              ) : dayStats.total === 0 ? (
                /* The roster IS loaded, so an empty day is a rostering answer,
                   not a missing one. Saying which answers are possible saves
                   the coordinator checking whether the upload went wrong.
                   dayStats, not stats: this speaks about the ROSTER, so it must
                   only appear when the whole day is empty. Keyed on the
                   direction-filtered count it would tell someone nobody is
                   travelling while ten riders sat one segment away. */
                <Text variant="bodySmall" style={styles.emptyHint}>
                  The roster is loaded — nobody is down to travel today. Week off,
                  holiday, leave, or a shift the company runs no cab for.
                </Text>
              ) : stats.total === 0 ? (
                /* The day has rides, just none going this way. With no "both" option
                   the other leg is entirely off screen, so this line is the only
                   thing telling the coordinator it exists — it names the segment to
                   press and how many rides are waiting behind it. */
                <Text variant="bodySmall" style={styles.emptyHint}>
                  {legFilter === 'in'
                    ? `${dayStats.outbound} drop${dayStats.outbound === 1 ? '' : 's'} today — press Logout to see ${dayStats.outbound === 1 ? 'it' : 'them'}.`
                    : `${dayStats.inbound} pickup${dayStats.inbound === 1 ? '' : 's'} today — press Login to see ${dayStats.inbound === 1 ? 'it' : 'them'}.`}
                </Text>
              ) : null}
            </View>
            )
          }
        />

        {/* Assign bar */}
        {selected.length > 0 ? (
          <View style={styles.actionBar}>
            <Button mode="text" onPress={() => setSelected([])}>
              Clear
            </Button>
            <Button
              mode="contained"
              icon="car"
              style={styles.assignBtn}
              onPress={() => {
                setChosenCab(null);
                setPickerOpen(true);
              }}
            >
              {/* selectedRides, not selected.length. A ride cancelled by HR while the
                  coordinator had it ticked leaves a stale key behind: the write
                  (confirmAssign) works off selectedRides and would have given the cab
                  to two riders while this button promised three. */}
              Assign cab to {selectedRides.length}
            </Button>
          </View>
        ) : null}
      </View>

      {/* Cab picker */}
      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)} style={styles.dialog}>
          <Dialog.Title>Assign a cab to {selectedRides.length} rider(s)</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              {cabs.length === 0 ? (
                <Text variant="bodyMedium">
                  No cabs in the fleet yet. Add one on the Fleet screen first.
                </Text>
              ) : (
                <RadioButton.Group onValueChange={setChosenCab} value={chosenCab}>
                  {cabs.map((c) => (
                    // A cab with no driver ACCOUNT linked can't be assigned: the
                    // driver's trip list is scoped by that link, so the ride would
                    // be invisible to everyone while the rider was told a cab was
                    // coming. Greyed out here rather than rejected after the tap.
                    <RadioButton.Item
                      key={c.id}
                      label={
                        c.driverUid
                          ? `${c.cabNumber} · ${c.driverName || 'driver'} · ${cabCapacity(c)} seats`
                          : `${c.cabNumber} · no driver linked`
                      }
                      value={c.id}
                      disabled={!c.driverUid}
                    />
                  ))}
                </RadioButton.Group>
              )}
              <Text variant="bodySmall" style={styles.dialogHint}>
                A cab can't take more riders than it has seats, or run two trips in
                opposite directions at the same time. A cab with no driver linked
                can't be assigned at all — link one on the Fleet screen.
              </Text>
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={confirmAssign}
              loading={busy}
              disabled={busy || !chosenCab}
            >
              Assign
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Add a rider to THIS day only. HR owns the month; this is the one-off. */}
      <Portal>
        <Dialog
          visible={addRiderOpen}
          onDismiss={() => setAddRiderOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Title>Add a rider — {prettyDate(date)}</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              <Text variant="bodySmall" style={styles.dialogHint}>
                Puts this person on today&apos;s board only. For a run of days, HR adds
                them on Roster Upload.
              </Text>

              {addRiderOptions.length === 0 ? (
                <Text variant="bodyMedium">
                  Everyone with an account already has a ride today.
                </Text>
              ) : (
                <>
                  <Text variant="labelLarge" style={styles.dialogLabel}>
                    Employee
                  </Text>
                  <Dropdown
                    compact={false}
                    value={addRiderUid}
                    options={addRiderOptions}
                    onSelect={setAddRiderUid}
                    placeholder="Select employee"
                    format={(uid) => {
                      const e = (employees || []).find((x) => x.uid === uid);
                      if (!e) return 'Select employee';
                      return e.empId ? `${e.name} · ${e.empId}` : e.name || 'Unnamed';
                    }}
                  />

                  {addRiderEmployee ? (
                    <Text variant="bodySmall" style={styles.dialogHint}>
                      {addRiderEmployee.roster?.route
                        ? `Route: ${addRiderEmployee.roster.route}`
                        : 'No route set — they land under “No route set”.'}
                      {addRiderEmployee.address ? `\nHome: ${addRiderEmployee.address}` : ''}
                    </Text>
                  ) : null}

                  <Text variant="labelLarge" style={styles.dialogLabel}>
                    Shift
                  </Text>
                  {addRiderCodes.length === 0 ? (
                    <Text variant="bodyMedium">
                      No working shift is configured. HR sets these on Shift Timings.
                    </Text>
                  ) : (
                    <RadioButton.Group onValueChange={setAddRiderCode} value={addRiderCode}>
                      {addRiderCodes.map((code) => {
                        // Every working shift is offered; this says what each one
                        // actually puts on a board, for the ones where that isn't
                        // "a ride today".
                        const note = addRiderCabNote(code);
                        return (
                          <View key={code}>
                            <RadioButton.Item
                              label={shiftSummary(shiftPolicy, code)}
                              value={code}
                            />
                            {note ? (
                              <Text variant="bodySmall" style={styles.shiftNote}>
                                {note}
                              </Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </RadioButton.Group>
                  )}
                </>
              )}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setAddRiderOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={confirmAddRider}
              loading={busy}
              disabled={busy || !addRiderUid || !addRiderCode}
            >
              Add to today
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* The desk standing a ride down for a rider who asked off-app. */}
      {/* Deliberately plain, and deliberately explicit about the two things that
          are NOT a straight undo: the cab does not come back with the ride, and
          the rider gets told. */}
      <Portal>
        <Dialog
          visible={!!restoreFor}
          onDismiss={() => !busy && setRestoreFor(null)}
          style={styles.restoreDialog}
        >
          <Dialog.Title>Put this ride back?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.restoreWho}>
              {restoreFor?.employeeName || 'This rider'}
              {restoreFor?.empId ? ` · ${restoreFor.empId}` : ''}
            </Text>
            <Text variant="bodySmall" style={styles.restoreMeta}>
              {restoreFor?.direction} · {restoreFor?.shift}
            </Text>
            <Text variant="bodySmall" style={styles.restoreNote}>
              It comes back waiting for a cab — the seat it had was freed when it
              was cancelled, so assign one again. The rider is told the ride is
              back on.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRestoreFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              icon="undo-variant"
              onPress={confirmRestore}
              loading={busy}
              disabled={busy}
            >
              Put it back
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <DeskCancelDialog
        visible={!!cancelFor}
        ride={cancelFor}
        cab={cancelFor?.assignedCabId ? getCabById(cancelFor.assignedCabId) : null}
        busy={busy}
        onDismiss={() => setCancelFor(null)}
        onConfirm={confirmDeskCancel}
      />

      {/* Route picker — the one employee field the rules let a coordinator write.
          It saves to the profile, so it also fixes every other day this month. */}
      <Portal>
        <Dialog visible={!!routeFor} onDismiss={() => setRouteFor(null)} style={styles.dialog}>
          <Dialog.Title>Route for {routeFor?.employeeName}</Dialog.Title>
          <Dialog.ScrollArea>
            <View style={styles.dialogBody}>
              <Text variant="bodySmall" style={styles.dialogHint}>
                {routeFor?.employeeAddress
                  ? `Home: ${routeFor.employeeAddress}`
                  : 'No home address on file — ask HR to add one.'}
              </Text>
              {/* Free text, not a radio list. There is no maintained route list
                  any more — routes arrive with the monthly sheet — so this can't
                  offer a closed set. Capitalisation and spacing are snapped to
                  the spelling already in use on save (snapRoute in AppContext),
                  so typing "jntu cab" at 9 PM still puts them in the JNTU group
                  rather than a second one of their own. */}
              <TextInput
                label="Pickup route"
                value={routeChoice || ''}
                onChangeText={setRouteChoice}
                mode="outlined"
                placeholder="e.g. JNTU Cab"
                autoFocus
                left={<TextInput.Icon icon="map-marker-outline" />}
              />
              {routeOptions.length ? (
                <>
                  <Text variant="bodySmall" style={styles.dialogHint}>
                    Tap a route already in use:
                  </Text>
                  <View style={styles.routeChips}>
                    {routeOptions.map((r) => (
                      <Chip
                        key={r}
                        compact
                        selected={routeKey(routeChoice) === routeKey(r)}
                        onPress={() => setRouteChoice(r)}
                        style={styles.routeChip}
                      >
                        {r}
                      </Chip>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setRouteFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={confirmRoute}
              loading={busy}
              disabled={busy || !routeChoice}
            >
              Save route
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!error} onDismiss={() => setError('')} duration={5000}>
        {error}
      </Snackbar>
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
        {snack}
      </Snackbar>
    </View>
  );
}

// One headline number. With `onPress` it doubles as the board's filter — the
// active one is underlined in its own colour, so which slice is on screen is
// answered by the same thing that changes it. Without `onPress` it renders as a
// plain figure (see "In / Out"), which is why the wrapper is chosen per call
// rather than always being pressable: a Pressable that does nothing still
// invites a tap.
// `half` is the phone layout: the stat takes half the row so four of them wrap
// into a 2×2 grid, and grows its own height to the 44px a thumb needs.
function Stat({ label, value, tone, active = false, onPress, showsLabel = '', half = false }) {
  const color =
    tone === 'good' ? colors.success
    : tone === 'warn' ? '#B26A00'
    : tone === 'muted' ? colors.muted
    : colors.text;
  const body = (
    <>
      <Text variant="titleLarge" style={[styles.statValue, { color }]}>
        {value}
      </Text>
      <Text variant="bodySmall" style={[styles.statLabel, active && { color }]}>
        {label}
      </Text>
    </>
  );
  if (!onPress) return <View style={[styles.stat, half && styles.statHalf]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.stat,
        styles.statTappable,
        half && styles.statHalf,
        half && styles.statTappableMobile,
        active && { borderBottomColor: color },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}: ${value}.${showsLabel ? ` Show ${showsLabel}.` : ''}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  col: { flex: 1, width: '100%', maxWidth: 860, alignSelf: 'center' },

  // The two "someone wants out of a ride" cards. Each carries its own tint and
  // a matching left rule, so the board's two kinds of exception are told apart
  // before a word is read.
  cancelCard: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  restoreDialog: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  restoreWho: { fontFamily: font.semibold, color: colors.text },
  restoreMeta: { color: colors.textSecondary, marginTop: 2 },
  restoreNote: { color: colors.muted, marginTop: spacing.md, lineHeight: 19 },
  cancelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancelTitle: { color: colors.danger, fontFamily: font.semibold },
  cancelIntro: { color: colors.textSecondary, marginTop: 2 },
  // Text on the left taking the slack, action on the right. alignItems
  // flex-start pins the button to the NAME's line rather than floating it to the
  // middle of a three-line block; minWidth:0 is what lets the text actually wrap
  // instead of shoving the button off the card.
  cancelRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cancelRowText: { flex: 1, minWidth: 0 },
  cancelName: { fontFamily: font.semibold, color: colors.text },
  cancelMeta: { color: colors.textSecondary, marginTop: 1 },
  cancelWhy: { fontStyle: 'italic', marginTop: 2, color: colors.text },

  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  // "Today" is a one-tap trip back from wherever the arrows took you, so it gets
  // the full 44px on a phone — 8px of padding around a 15px line lands at ~37.
  datePillMobile: { paddingVertical: 11, paddingHorizontal: 14 },
  dateText: { fontFamily: font.semibold, color: colors.primaryDark, fontSize: 15 },
  dateReset: { color: colors.primary, fontSize: 12, fontFamily: font.medium },

  // The day's numbers, in their own white panel — they are a summary of the
  // board, not a row floating on the page background.
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  // 2×2 on a phone. `stats` is already a row, so wrapping plus a half-width
  // basis on each child is the whole grid — no second container.
  statsGrid: { flexWrap: 'wrap', rowGap: spacing.sm },
  stat: { alignItems: 'center', minWidth: 64 },
  // Just under half, so two sit per row with the row-gap between them and the
  // third and fourth drop to the second line.
  statHalf: { flexBasis: '46%', flexGrow: 1 },
  // A transparent border on every tappable stat, coloured in only when it's the
  // active one — so selecting a filter can't shift the row's height.
  statTappable: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingBottom: 2,
    paddingHorizontal: spacing.sm,
  },
  // The number and its label come to ~40px; this takes the filter past 44.
  statTappableMobile: { paddingTop: spacing.xs, paddingBottom: spacing.sm },
  statValue: { fontFamily: font.bold, color: colors.text },
  statLabel: { color: colors.muted, letterSpacing: 0.3 },

  // Two segments, sized to their WORDS. The labels used to be "IN" and "OUT" and
  // 200px was already the floor — at 170 a bold "OUT" beside its icon ellipsised
  // to "O…". "Login"/"Logout" are far wider, so the minimum moved with them.
  //
  // Measured in the shipped font rather than guessed (Poppins SemiBold 14):
  // IN 15px, OUT 29px, Login 38px, Logout 49px. At 290 each segment has ~95px
  // for its label and at 250 about ~75px, so the longest sits with room to
  // spare. Do not tighten these without re-measuring — that is the exact bug
  // the paragraph above records, and now with a longer word to lose.
  segmentedLeg: { flexGrow: 0, flexShrink: 0, minWidth: 290 },
  // The phone floor. `legRow` centres it on its own line now, so there is no
  // neighbour to be squeezed by — this is purely the width the two labels need.
  segmentedLegMobile: { minWidth: 250 },
  // Pushed to the far right of the row, away from IN/OUT. Those two decide which
  // list is on screen; this one opens a dialog and changes the day's roster — sat
  // directly beside them it read as a third segment of the same control. The gap
  // between is the separation.
  //
  // marginLeft:auto rather than justifyContent on the row, because the row wraps
  // on a very narrow screen: 'space-between' would drop the button to a second
  // line and then align it LEFT again, whereas auto margin keeps it right
  // wherever it lands.
  addRider: { borderRadius: radius.md },
  searchRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  // TWO CONTROLS, ONE LINE, SAME HEIGHT. alignItems 'stretch' rather than
  // 'center' is what does the work: the dropdown is a View that sizes to its own
  // padding, so centred it sat as a short pill against a taller input. Stretched,
  // it takes the row's height from the text field beside it and the two read as a
  // matched pair.
  searchRowMain: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  search: { backgroundColor: colors.surface },
  // The search box takes whatever room the cab dropdown doesn't. minWidth keeps
  // it from being squeezed to nothing before the row wraps on a narrow screen.
  searchInput: { flex: 1, minWidth: 220 },
  // A real field, not a pill: wide enough for a full cab number ("TS 08 TR 3456")
  // without ellipsising, and fixed so the search box's width doesn't jump as the
  // selection changes. flexGrow 0 / flexShrink 0 so it keeps that width instead
  // of absorbing the row.
  cabFilterWrap: { width: 200, flexGrow: 0, flexShrink: 0, justifyContent: 'center' },
  // THE TOGGLE, CENTRED ON THE ROW, with "Add a rider" pinned right. The two side
  // cells are equal-width flex so the toggle sits at the row's true centre — with
  // only a right-hand cell it would be pushed left by exactly that button's width.
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  // On a phone the segments alone want 250px, so the three cells cannot share a
  // line. Stacking centres the toggle and puts the button under it rather than
  // letting either be crushed.
  legRowMobile: { flexDirection: 'column', gap: spacing.xs },
  legRowSide: { flex: 1, minWidth: 0 },
  legRowRight: { alignItems: 'flex-end' },
  // Stacked: the cell is a full-width row of its own, so flex:1 would stretch it
  // down the column and the button would drift away from the toggle.
  legRowRightMobile: { flex: 0, alignSelf: 'stretch', alignItems: 'center' },
  searchCount: { color: colors.muted, marginLeft: spacing.xs },
  // THE ACTIVE HALF. Filled with the brand blue — the same colour the sidebar and
  // primary buttons use, so this reads as part of the app rather than a new idea.
  // Paper applies a segment's own `style` last ([buttonStyle, styles.button, style]
  // in SegmentedButtonItem), so this background wins over its computed one without
  // having to fight the component or restyle the theme globally.
  legSegOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  // THE INACTIVE HALF. Still a segment — outlined, on the card surface — but plainly
  // the one that isn't chosen.
  legSegOff: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  // White on #0129AC is ~10:1, well past AA; the heavier weight is the non-colour
  // half of the signal, so the state survives a greyscale screen or colour blindness.
  legLabelOn: { color: '#FFFFFF', fontFamily: font.semibold },
  legLabelOff: { color: colors.textSecondary, fontFamily: font.medium },

  list: { padding: spacing.md, paddingBottom: 96 },
  // ListHeaderComponent renders INSIDE the list's contentContainerStyle (`list`
  // above), which now wraps padding: spacing.md around the header too — extra
  // inset it never had as a sibling of the list. Every element inside the
  // header already carries its own paddingHorizontal/paddingTop (dateBar,
  // stats, searchRow…), so that padding is simply cancelled here rather than
  // rewritten through half a dozen styles that are correct on their own.
  listHeader: { marginHorizontal: -spacing.md, marginTop: -spacing.md },
  // A route heading: tinted band with a brand left rule, so the board reads as
  // groups of riders rather than one long undifferentiated list.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  sectionHeaderMobile: {
    paddingLeft: spacing.sm,
    paddingRight: 2,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  // One route, more than one departure — a lighter, unboxed rule so it reads as
  // a division INSIDE the route's group rather than a group of its own (that
  // weight is reserved for sectionHeader above, which is the thing a cab is
  // actually filled from). No left rule, no tint: two visual languages this
  // close together would compete rather than nest.
  timeSubhead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // The first time-group in a section sits directly under sectionHeader's own
  // bottom margin — a second rule there would double up against it.
  timeSubheadFirst: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
  timeSubheadText: { color: colors.text, fontFamily: font.semibold },
  timeSubheadCount: { color: colors.muted, marginLeft: 'auto' },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  sectionTitle: { color: colors.primaryDark, fontFamily: font.semibold, flexShrink: 1 },
  sectionTitleMobile: { fontSize: 13 },
  sectionCount: { color: colors.primaryDark, opacity: 0.75 },
  selectLabelMobile: { fontSize: 12, marginHorizontal: spacing.xs },

  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardSelected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySofter },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  // A fixed-width SLOT, not the icon itself — an assigned ride leaves it empty
  // (see renderRide) and every card in a group still starts its name at the
  // same left edge. The widths match the icon sizes rendered inside them.
  check: { width: 22, marginRight: spacing.md, marginTop: 2 },
  // Clear air between the tick and the name it belongs to, so a thumb aiming at
  // one doesn't obscure the other.
  checkMobile: { width: 26, marginRight: spacing.lg, marginTop: 1 },
  // EVERYTHING RIGHT OF THE TICK, and it must fill the card. Without flex: 1 this
  // View sizes to its own widest line — the address — so the card looks full width
  // while its contents end early, and the badges pinned "right" land against the
  // address instead of the card's edge. minWidth: 0 lets it shrink below that
  // content width too, so a long address wraps rather than widening the card.
  cardBody: { flex: 1, minWidth: 0 },
  // The Cancel / Put back button now lives in the chips row at the top right of
  // a card, so it has to read as a compact control beside two small chips rather
  // than as a full-size button. Paper pulls the icon left by 16 (md3Icon's
  // negative marginRight) expecting md3Label's 24, so marginLeft has to stay
  // >= 16 or the icon is drawn through the first letter.
  cardActionLabel: {
    fontFamily: font.semibold,
    fontSize: 12,
    marginVertical: 0,
    marginLeft: 22,
    marginRight: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    // Takes the card's full width, so "the right" means the card's right edge and
    // not wherever this row's own content happens to end. Without it the row can
    // be sized to its content inside the column, and the badges drift inward by a
    // different amount on every card — which is exactly how they were landing.
    alignSelf: 'stretch',
  },
  // The phone version of the same row: name on its own line, badges beneath it,
  // both left-aligned with everything else on the card.
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing.xs },
  // minWidth: 0 lets a long name ellipsise instead of pushing the badges off the
  // right edge — a flex item's default floor is its content, which a name can
  // easily exceed.
  name: { flex: 1, minWidth: 0, color: colors.text },
  // flex: 1 is what shares a ROW; stacked, it would fight the column's height
  // instead. Full width and no flex is the same instruction in one direction.
  nameStacked: { flex: 0, width: '100%' },
  // HARD RIGHT. The auto margin eats all the free space to the badges' left, so
  // the shift code and the status sit against the card's right edge on every row
  // and read as a column down the board — the coordinator scans "who is still
  // Pending" vertically, which only works if they all start at the same x.
  // Belt and braces with the row's space-between, deliberately: it is the badges'
  // OWN style, so it survives the row being restyled or stacked.
  // flexShrink: 0 keeps the two chips full-size and on one line; they are short
  // and squeezing "Pending" is never the right sacrifice.
  chips: { flexDirection: 'row', gap: spacing.sm, marginLeft: 'auto', flexShrink: 0 },
  // Stacked, the row above is a COLUMN — and an auto left margin in a column
  // pushes across the cross axis, which would fling the badges to the far right
  // on their own line, adrift from the name they describe. Back to zero so they
  // line up under the name with the route and address lines below.
  chipsStacked: { marginLeft: 0 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  meta: { color: colors.textSecondary, flex: 1 },
  overnight: { color: '#5B3FBF', marginTop: spacing.xs, fontStyle: 'italic' },
  // Wraps, because "No route set" plus a Set route button is close to a narrow
  // card's full width.
  // Sits under the meta lines, pulled left so the text button lines up with them
  // rather than floating in the middle of the card.
  cancelClosed: { color: colors.muted, marginLeft: spacing.sm, marginTop: spacing.xs },
  noRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  noRouteText: { color: colors.warning, fontFamily: font.medium },
  assignedText: { color: colors.success, fontFamily: font.semibold, marginTop: spacing.sm },

  empty: {
    alignItems: 'center',
    marginTop: 56,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyText: { color: colors.text, textAlign: 'center', fontFamily: font.semibold },
  emptyHint: { color: colors.muted, textAlign: 'center', lineHeight: 20 },
  // "Show all N" beside "Clear search" — a row, so the escape from a filtered
  // search and the escape from the search itself sit together.
  emptyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  // Floats over the list, so it needs to read as a bar in front of the page and
  // not as the last row of it.
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadow.lg,
  },
  assignBtn: { flex: 1, marginLeft: spacing.md, borderRadius: radius.md },

  dialog: { width: '100%', maxWidth: 500, alignSelf: 'center' },
  dialogBody: { paddingVertical: spacing.sm },
  dialogHint: { color: colors.muted, marginTop: spacing.md, lineHeight: 19 },
  // Sits under a shift's radio row, indented past the radio itself so it reads
  // as belonging to that shift rather than to the next one down.
  shiftNote: {
    color: colors.muted,
    marginLeft: 52,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  dialogLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    color: colors.text,
    fontFamily: font.semibold,
  },
  // The routes already in use, offered as one-tap chips under the free-text
  // field — typing a route in full at 9 PM is exactly when a typo happens.
  routeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  routeChip: { marginBottom: 2 },
});
