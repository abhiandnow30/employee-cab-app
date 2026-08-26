// ---------------------------------------------------------------------------
// UPLOAD MONTHLY SHIFT ROSTER  (HR / Admin)
//
// The entry point of the whole workflow. HR uploads one spreadsheet a month and
// every ride in the system follows from it — employees never submit shifts.
//
// Four visible stages, so nothing is written until HR has seen what will happen:
//   1. Choose a file (drag-and-drop, or the file picker). Nothing leaves the page.
//      The roster MONTH AND YEAR are read out of the file's own date headers and
//      shown back as "Detected roster period" — HR picks neither. There were Year
//      and Month controls here once; the Month one was read-only ("Detected from
//      file") and the Year one existed on the belief that these headers never
//      carry a year. They usually do — a real Excel date cell, an ISO header,
//      "01-Jul-2026" and "01-07-2026" all did, and it was being parsed and thrown
//      away. Asking for a value the file already states is how the wrong year gets
//      picked and a month key overwrites rosters nobody meant to touch.
//   2. The sheet as the app read it — every row and every day. This comes BEFORE
//      the verdict on purpose: "did you read my file correctly?" is the first
//      question anyone asks, and it was unanswerable while the only table on the
//      page listed failures.
//   3. Validation summary — total rows, valid rows, and every error grouped by
//      kind with the offending rows listed. HR fixes the sheet and re-uploads.
//   4. Import — writes only the clean rows, then reports what landed.
//
// The chosen sheet survives a reload (see utils/rosterDraft.js). It is kept in
// this browser only and is still not saved for anyone else until Import. The
// validation report is DERIVED from the sheet on every render, so adding a missing
// employee elsewhere updates this screen without re-uploading the file.
//
// Re-uploading a corrected file for the same month OVERWRITES that month rather
// than duplicating it, because each row's document id is <month>_<uid>.
//
// WEB ONLY. Reading a spreadsheet needs the browser File API; HR uploads from a
// desk. On a phone this screen explains that instead of half-working.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Platform, ScrollView, useWindowDimensions } from 'react-native';
import {
  Text, Card, Button, Chip, Divider, DataTable, HelperText, Snackbar,
  ActivityIndicator, IconButton, Portal, Dialog, Tooltip, ProgressBar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import {
  parseRosterFile, validateRoster, ERROR_KINDS,
  fetchMonthRosters, summariseStoredRoster, downloadStoredRoster,
  rosterOrphans, removeRosterEntries,
} from '../../services/roster';
import { subscribeEmployees, adminInviteEmployees } from '../../services/profile';
import { ALL_SHIFT_CODES, SHIFT_COLORS, shiftSummary } from '../../data/shifts';
import {
  saveDraft, loadDraft, clearDraft, describeAge, encodeBytes, decodeBytes,
  openOriginalFile,
} from '../../utils/rosterDraft';
import { colors, spacing, font, radius, shadow } from '../../theme';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Just the date, for the Import history table — "30 Jul 2026".
function formatDateOnly(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export default function RosterUploadScreen({ navigation }) {
  const {
    shiftPolicy, importRoster, subscribeImportHistory, routeOptions, deleteImportHistory,
  } = useApp();

  // The "what's stored" dialog holds a table that can run to hundreds of rows —
  // a dialog fixed at 640px reads as broken on anything wider than a laptop, and
  // on a phone-width browser window 640px overflows the viewport instead of
  // shrinking to fit. Both directions are sized off the actual window instead.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const verifyDialogStyle = {
    width: '100%',
    maxWidth: Math.min(winWidth - 32, 1000),
    maxHeight: winHeight - 64,
    alignSelf: 'center',
  };

  const [employees, setEmployees] = useState([]);
  // Validation is meaningless until the employee directory has arrived — against
  // an empty list every row reads "Unknown employee". The screen shows a spinner
  // rather than a summary it would have to immediately correct.
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // The PARSED sheet, not the validation report. The report is derived below, so
  // it re-computes whenever the employee directory or the shift policy changes —
  // which means adding a missing employee in another tab updates this summary
  // without HR re-uploading the file.
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState([]);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null); // history entry pending removal confirmation
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null); // history row being exported
  // "Show me what actually landed" — the history entry being inspected, the
  // per-employee summary read back from Firestore, and the raw docs (kept so the
  // sheet can be rebuilt for download without a second read).
  const [verifyFor, setVerifyFor] = useState(null);
  const [verifyRows, setVerifyRows] = useState(null); // null = still loading
  // The documents behind the Download button, TAGGED with the month they were
  // read for — { month, docs } — rather than a bare array. The download builds
  // its filename from the month on screen and its contents from these docs, so
  // the two must be provably the same month; when they were separate values they
  // drifted, and a failed or still-loading read left July's rows to be
  // downloaded as August's file. Nulled the moment a new read starts.
  const [verifyData, setVerifyData] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  // One token per open. A reply that isn't the current one is discarded: two
  // clicks on a slow connection otherwise land in either order, and the loser
  // paints its month's rows under the winner's title.
  const verifySeq = useRef(0);
  const [importProgress, setImportProgress] = useState(null); // { done, total } while writing
  const [showAllErrors, setShowAllErrors] = useState(false);
  // Closed by default. This grid is a diagnostic for "did you read my file
  // correctly?", not a spreadsheet viewer — Open in Excel is for reading the file.
  const [showSheet, setShowSheet] = useState(false);
  const [showAllSheetRows, setShowAllSheetRows] = useState(false);
  // The original bytes, kept so the file itself can be opened in Excel.
  const [fileBytes, setFileBytes] = useState(null);
  // "How this works" — explains the roster-driven model in plain language.
  // This screen has real hidden rules (rides are never booked directly, a
  // re-upload overwrites profile data) that a new admin has no way to guess.
  const [helpOpen, setHelpOpen] = useState(false);
  // WHO IS STORED FOR THIS MONTH BUT NOT IN THIS SHEET.
  //
  // An import only ever writes, so taking somebody out of the spreadsheet does
  // not take them off the board — their document from a previous upload keeps
  // deriving a ride every day, and re-uploading cannot fix it because a file
  // that simply omits a person carries no "they are gone" signal. Read once per
  // sheet and compared here, so the difference is visible BEFORE importing.
  const [storedMonth, setStoredMonth] = useState(null); // { month, rows } | null
  const [removingOrphans, setRemovingOrphans] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Bulk-provisioning the people the sheet names who have no account yet.
  const [inviting, setInviting] = useState(false);
  const [inviteProgress, setInviteProgress] = useState(null); // { done, total, label }
  const [inviteResult, setInviteResult] = useState(null);
  // The file currently in hand, and what happened to it. Without this a rejected
  // file looked identical to no file at all — nothing on screen changed, so it
  // seemed as though the upload hadn't registered.
  const [picked, setPicked] = useState(null); // { name, size, state: 'reading'|'ok'|'failed' }
  // Set when the sheet on screen came back from the browser after a reload, so we
  // can say so instead of implying it was just read.
  const [restoredAt, setRestoredAt] = useState(null);

  // The directory the roster is matched against. Without it every row would come
  // back "Unknown employee", so the screen waits for it.
  useEffect(() => {
    const unsub = subscribeEmployees(
      (list) => {
        setEmployees(list);
        setEmployeesLoaded(true);
      },
      (e) => {
        setError(e.message);
        // Failing open here would validate against nothing and blame every row.
        setEmployeesLoaded(true);
      }
    );
    return unsub;
  }, []);

  // Bring back the sheet chosen before the last reload. Runs once, before the
  // employee list lands; the derived report below fills in once it does.
  //
  // The stored bytes are RE-PARSED rather than the stored reading being trusted.
  // A cached parse is only ever as good as the parser that produced it, and the
  // parser gets fixed — so a draft saved an hour ago could keep insisting on a
  // conclusion the code no longer draws, which looks exactly like the fix not
  // working. Re-reading the original file costs a few milliseconds and means the
  // preview always reflects today's code.
  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    setPicked(draft.picked || null);
    setFileBytes(draft.fileBytes || null);
    setRestoredAt(draft.savedAt);

    const bytes = draft.fileBytes ? decodeBytes(draft.fileBytes) : null;
    if (bytes) {
      try {
        const fresh = parseRosterFile(bytes, { fileName: draft.picked?.name || '' });
        setParsed(fresh);
        // Write the fresh reading back so the next restore starts from it.
        saveDraft({
          parsed: fresh,
          picked: draft.picked,
          fileBytes: draft.fileBytes,
        });
        return;
      } catch {
        // The file no longer parses — fall through to the stored reading rather
        // than showing an empty screen.
      }
    }
    setParsed(draft.parsed);
  }, []);

  useEffect(() => {
    const unsub = subscribeImportHistory(setHistory, (e) =>
      console.warn('[roster] history error:', e?.message)
    );
    return unsub;
  }, [subscribeImportHistory]);

  // The validation report is DERIVED, never stored. Re-checking the same sheet
  // against a changed directory is cheap, and it's the only way a restored draft
  // can be trusted: the alternative is showing errors that were fixed hours ago.
  const report = useMemo(() => {
    if (!parsed || !employeesLoaded) return null;
    try {
      // routeOptions is passed so a sheet's route spelling can be snapped onto the
      // configured one — "Jntu Cab" must not become a second JNTU group.
      return validateRoster(parsed, employees, shiftPolicy, routeOptions);
    } catch (e) {
      console.warn('[roster] validate failed:', e?.message);
      return null;
    }
  }, [parsed, employees, employeesLoaded, shiftPolicy, routeOptions]);

  // One read per sheet. Deliberately NOT a live subscription: this is compared
  // against a file the admin is holding, and a list that shifted under them
  // mid-decision would be worse than one that is a few seconds old. It is
  // re-read after a removal so the panel reflects what actually happened.
  const loadStoredMonth = useCallback(async (month) => {
    if (!month) {
      setStoredMonth(null);
      return;
    }
    try {
      setStoredMonth({ month, rows: await fetchMonthRosters(month) });
    } catch (e) {
      console.warn('[roster] could not read the stored month:', e?.message);
      setStoredMonth(null); // the panel simply does not appear; nothing is claimed
    }
  }, []);

  useEffect(() => {
    loadStoredMonth(parsed?.month || null);
  }, [parsed?.month, loadStoredMonth]);

  // Forget the sheet on screen — including the stashed copy, or it would come
  // straight back on the next reload.
  function dismiss() {
    setParsed(null);
    setPicked(null);
    setRestoredAt(null);
    setShowAllErrors(false);
    setShowSheet(false);
    setShowAllSheetRows(false);
    setFileBytes(null);
    // Same reasoning as handleFile: don't leave a previous month's read-back
    // behind on a screen that has just been emptied.
    closeVerify();
    clearDraft();
  }

  // Invite the people this sheet names who don't have a profile yet. No account
  // and no password is created — each invite is claimed automatically the first
  // time that person signs in with Microsoft (see services/profile.js).
  //
  // Their shifts import once they have signed in at least once, because a shift
  // document is keyed by uid and a uid only exists from then on. The report
  // re-derives live off the employees subscription, so the sheet on screen
  // picks them up as they arrive — nothing to re-upload.
  async function doInvite() {
    const people = (report?.creatable || []).map((r) => ({
      email: r.email,
      name: r.name,
      empId: r.empId,
      phone: r.phone,
      address: r.sheetAddress || r.address,
      route: r.sheetRoute || r.route,
    }));
    if (!people.length) return;
    setInviting(true);
    setInviteResult(null);
    setInviteProgress({ done: 0, total: people.length, label: '' });
    try {
      const res = await adminInviteEmployees(people, {
        onProgress: (done, total, label) => setInviteProgress({ done, total, label }),
      });
      setInviteResult(res);
      setSnack(
        res.failedCount
          ? `Invited ${res.createdCount}, ${res.failedCount} could not be invited`
          : `Invited ${res.createdCount} employee${res.createdCount === 1 ? '' : 's'} — they sign in with Microsoft, no password needed`
      );
    } catch (e) {
      setError(e.message || 'Could not create the accounts.');
    } finally {
      setInviting(false);
      setInviteProgress(null);
    }
  }

  // Hand HR a sheet of exactly who couldn't be created, with an empty Email column
  // to fill in. Better than a screenful of names to copy by hand.
  function downloadMissingList() {
    const rows = report?.uncreatable || [];
    if (!rows.length) return;
    const header = ['Employee ID', 'Employee Name', 'Email', 'Phone', 'Home Address'];
    const body = rows.map((r) => [r.empId || '', r.name || '', '', r.phone || '', r.sheetAddress || '']);
    const csv = [header, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    try {
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `employees-to-add-${report.month}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setSnack('Downloaded the list — fill in the Email column and add it to your roster.');
    } catch {
      setError('Could not download the list.');
    }
  }

  // Parse + validate a chosen file. Everything happens in the page; nothing is
  // written until HR presses Import.
  async function handleFile(file) {
    setError('');
    setParsed(null);
    setRestoredAt(null);
    setShowAllErrors(false);
    setShowSheet(false);
    setShowAllSheetRows(false);
    setFileBytes(null);
    // A new file means anything read back for an earlier month is history. Kept
    // around it is a downloadable sheet of last month's data sitting behind a
    // screen that now talks about this month.
    closeVerify();
    if (!file) return;

    setPicked({ name: file.name, size: file.size, state: 'reading' });
    setBusy(true);
    // Parsing a spreadsheet is synchronous and blocks the UI thread, so without
    // yielding first the "reading" state never gets painted — the page just
    // freezes for a moment and then looks unchanged, which reads as "nothing
    // happened".
    await new Promise((r) => setTimeout(r, 0));

    try {
      const buffer = await file.arrayBuffer();
      // No year is passed: the roster period is the file's to state. A sheet whose
      // headers carry no year throws here and lands in the catch below as a plain
      // error message, rather than importing under a guessed year.
      const sheet = parseRosterFile(buffer, { fileName: file.name });
      const nowPicked = { name: file.name, size: file.size, state: 'ok' };
      // Keep the original bytes so "open the actual spreadsheet" is possible even
      // after a reload, when the browser no longer has a handle on the disk file.
      const bytes = encodeBytes(buffer);
      setParsed(sheet);
      setPicked(nowPicked);
      setFileBytes(bytes);
      // Stash it so a reload doesn't lose the preview. If this fails (quota,
      // private browsing) the upload still works — the draft is a convenience.
      saveDraft({ parsed: sheet, picked: nowPicked, fileBytes: bytes });
      if (!sheet.rows.length) {
        setError('That file has no employee rows under the date headers.');
      }
    } catch (e) {
      setPicked({ name: file.name, size: file.size, state: 'failed' });
      clearDraft();
      setError(e.message || 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  function pickFile() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    // Attach to the document before clicking: a detached input works in most
    // browsers but not reliably in all of them, and a dialog that opens without
    // ever firing `change` is indistinguishable from a broken button.
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      handleFile(file);
    };
    input.click();
  }

  async function doImport() {
    if (!report?.canImport) return;
    // No year-agreement check any more: there is no year on screen to disagree
    // with. The month key comes from the file's own date headers, is shown back
    // as the detected period before Import, and is the same value validation ran
    // against — one source, so the two can't drift apart.
    setBusy(true);

    // INVITE FIRST, THEN IMPORT — one press does the whole sheet.
    //
    // Anyone the file names who has no profile is invited here rather than being
    // reported as something for HR to go and do. Import used to write only the
    // people who already existed and leave the rest sitting behind a separate
    // "Invite" button, which reads as the upload having half-failed. It hadn't:
    // there was simply a second step nobody had told them about.
    //
    // Their SHIFTS still can't be written today — rosters/<month>_<uid> needs a
    // uid, and that only exists after their first Microsoft sign-in — so the
    // import reports them as waiting rather than imported. The Invite button
    // below stays for re-running this by hand if a name is added later.
    let invited = 0;
    const toInvite = report.creatable || [];
    if (toInvite.length) {
      setInviteProgress({ done: 0, total: toInvite.length, label: '' });
      try {
        const res = await adminInviteEmployees(
          toInvite.map((r) => ({
            email: r.email,
            name: r.name,
            empId: r.empId,
            phone: r.phone,
            address: r.sheetAddress || r.address,
            route: r.sheetRoute || r.route,
          })),
          { onProgress: (done, total, label) => setInviteProgress({ done, total, label }) }
        );
        invited = res?.createdCount || 0;
      } catch {
        // A failed invite must not block the shifts of everyone who DOES have an
        // account. The people it missed stay listed as creatable, and the Invite
        // button is still there to retry.
      }
      setInviteProgress(null);
    }

    setImportProgress({ done: 0, total: report.valid });
    const res = await importRoster(report, {
      onProgress: (done, total) => setImportProgress({ done, total }),
    });
    setBusy(false);
    setImportProgress(null);
    if (res?.ok) {
      setSnack(
        `Imported ${res.imported} employee${res.imported === 1 ? '' : 's'} for ${report.monthLabel}` +
          (invited ? ` · ${invited} invited` : '') +
          (res.waiting
            ? ` · ${res.waiting} waiting for their first sign-in`
            : '') +
          (res.skipped ? ` · ${res.skipped} row${res.skipped === 1 ? '' : 's'} skipped` : '') +
          // Say it: the sheet just routed people, which is a change to their
          // profiles and not something HR should have to discover later.
          (res.routed ? ` · ${res.routed} routed from the sheet` : '')
      );
      // The sheet has served its purpose and is now recorded in Import history;
      // keeping the draft would offer to re-import what's already in.
      dismiss();
    } else {
      setError(res?.message || 'Could not import the roster.');
    }
  }

  // Removes one Import history row — the log entry only. The roster rows it
  // wrote stay put, so nobody's shifts or already-generated rides disappear.
  async function confirmDeleteHistory() {
    if (!deleteFor) return;
    setDeleting(true);
    const res = await deleteImportHistory(deleteFor.id);
    setDeleting(false);
    setDeleteFor(null);
    if (!res?.ok) setError(res?.message || 'Could not remove that record.');
  }

  // Live directory names, keyed by uid — the fallback when a roster row carries
  // no name of its own (rows written before `employeeName` existed).
  const namesByUid = useMemo(
    () => new Map((employees || []).map((e) => [e.uid, (e.name || '').trim()])),
    [employees]
  );

  // The whole live record, keyed by uid. A downloaded sheet takes email and route
  // from here rather than from the frozen copy on the roster document, so a sheet
  // that goes back in doesn't revert a profile changed since the last import.
  const employeesByUid = useMemo(
    () => new Map((employees || []).map((e) => [e.uid, e])),
    [employees]
  );

  // The people this sheet does not mention. Split so a rider the DESK added for a
  // day the sheet missed is never offered up for deletion — being absent from the
  // sheet is exactly why they were added by hand.
  //
  // Declared HERE, after namesByUid, and not up beside the report it derives
  // from: namesByUid is a const, so reading it earlier in the component body is a
  // temporal-dead-zone ReferenceError on the first render — which parses and
  // builds perfectly and then shows a blank screen.
  const orphans = useMemo(() => {
    if (!report || storedMonth?.month !== report.month) return { removable: [], handAdded: [] };
    return rosterOrphans(report, storedMonth.rows, namesByUid);
  }, [report, storedMonth, namesByUid]);

  async function doRemoveOrphans() {
    setConfirmRemove(false);
    setRemovingOrphans(true);
    try {
      const n = await removeRosterEntries(orphans.removable.map((o) => o.id));
      setSnack(
        `Removed ${n} ${n === 1 ? 'person' : 'people'} from ${report?.monthLabel || report?.month}. ` +
          'Their rides stop from now; past bookings are untouched.'
      );
      await loadStoredMonth(report?.month || null);
    } catch (e) {
      setError(e?.message || 'Could not remove those roster rows.');
    } finally {
      setRemovingOrphans(false);
    }
  }

  // Download a month's roster as a spreadsheet, straight from the history row.
  //
  // The point is the ROUND TRIP: download the month, add the people who joined
  // since (or fix a shift), upload it again. Re-importing replaces that month
  // rather than duplicating it, because each row's document id is <month>_<uid>.
  //
  // The rows aren't in hand here — the history table is a log, not the roster —
  // so this reads them back out of Firestore first. That's the same read the
  // verify dialog does, and it's the honest source: what's stored is what the
  // coordinator's board sees, which is not necessarily what the file said.
  async function downloadMonth(entry) {
    if (!entry?.month || downloadingId) return;
    setDownloadingId(entry.id);
    setError('');
    try {
      const docs = await fetchMonthRosters(entry.month);
      if (!docs.length) {
        setError(
          `Nothing is stored for ${entry.monthLabel || entry.month}, so there is nothing to download.`
        );
        return;
      }
      const { fileName, rowCount } = downloadStoredRoster(
        entry.month,
        docs,
        namesByUid,
        employeesByUid
      );
      setSnack(
        `Downloaded ${fileName} — ${rowCount} employee row${rowCount === 1 ? '' : 's'}. ` +
          'Add rows for anyone new, then upload it again to replace this month.'
      );
    } catch (e) {
      setError(e?.message || 'Could not build that month’s sheet.');
    } finally {
      setDownloadingId(null);
    }
  }

  // --- Verify an import ------------------------------------------------------
  //
  // "Success" only tells you the write didn't throw. It can't tell you a row
  // imported with every cell blank, or that a person the sheet named never
  // matched an account — both of which look identical in the history table and
  // produce no rides. So this reads the rosters/<month>_<uid> documents back out
  // of Firestore: what's here is what the coordinator's board will see.
  async function openVerify(entry) {
    const seq = verifySeq.current + 1;
    verifySeq.current = seq;
    setVerifyFor(entry);
    // Clear the PREVIOUS month's read-back before this one starts, not after it
    // succeeds. Left in place it survives a read that fails or is merely still
    // running, which kept Download enabled next to the new month's title and
    // handed HR the old month's rows under the new month's filename.
    setVerifyRows(null);
    setVerifyData(null);
    setVerifyError('');
    try {
      const stored = await fetchMonthRosters(entry.month);
      if (seq !== verifySeq.current) return; // superseded or closed meanwhile
      setVerifyRows(summariseStoredRoster(stored, shiftPolicy, namesByUid));
      setVerifyData({ month: entry.month, docs: stored });
    } catch (e) {
      if (seq !== verifySeq.current) return;
      setVerifyError(e?.message || 'Could not read that month back.');
    }
  }

  // Closing throws the read-back away rather than leaving it for the next open
  // to inherit, and retires the token so an in-flight read can't land afterwards.
  function closeVerify() {
    verifySeq.current += 1;
    setVerifyFor(null);
    setVerifyRows(null);
    setVerifyData(null);
    setVerifyError('');
  }

  // Is there a read-back on hand that genuinely belongs to the month on screen?
  // Both halves matter: docs to write, and proof they came from THIS month.
  const canDownloadVerified =
    !!verifyData?.docs?.length && !!verifyFor && verifyData.month === verifyFor.month;

  // Download what's STORED, not what was uploaded — the original file's bytes
  // are only ever kept in the local draft, which is cleared on import.
  function downloadVerified() {
    // Re-checked here and not just on the button: writing one month's rows into
    // another month's file is the one outcome that leaves HR holding a wrong
    // sheet with no sign anything went wrong.
    if (!canDownloadVerified) {
      setVerifyError(
        "Nothing has been read back for this month yet, so there's nothing to " +
          'download. Close this and open it again.'
      );
      return;
    }
    try {
      const { fileName, rowCount } = downloadStoredRoster(
        verifyData.month,
        verifyData.docs,
        namesByUid,
        employeesByUid
      );
      setSnack(`Downloaded ${fileName} — ${rowCount} employee row(s) as stored.`);
    } catch (e) {
      setVerifyError(e?.message || 'Could not build that file.');
    }
  }

  // --- Web-only guard -------------------------------------------------------
  if (Platform.OS !== 'web') {
    return (
      <View style={styles.centerWrap}>
        <MaterialCommunityIcons name="file-upload-outline" size={56} color={colors.muted} />
        <Text variant="titleMedium" style={styles.centerTitle}>
          Roster upload is on the web dashboard
        </Text>
        <Text variant="bodyMedium" style={styles.centerBody}>
          Reading a spreadsheet needs a desktop browser. Open the transport
          dashboard on a computer to upload the monthly roster — everything else in
          the app works here.
        </Text>
      </View>
    );
  }

  // Drag-and-drop props, web only.
  const dropProps = {
    onDragOver: (e) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      handleFile(e.dataTransfer?.files?.[0]);
    },
  };

  const errorRows = report ? report.rows.filter((r) => !r.valid) : [];
  const shownErrors = showAllErrors ? errorRows : errorRows.slice(0, 12);
  // A 500-employee roster would otherwise push the verdict and the Import button
  // off the bottom of the page — the problem this card was moved up to solve.
  const sheetRows = report
    ? showAllSheetRows
      ? report.rows
      : report.rows.slice(0, 15)
    : [];
  const shownHistory = showAllHistory ? history : history.slice(0, 5);

  // Which history row is the CURRENT one for its month. Download always reads
  // rosters/<month>_<uid> as it stands right now — there is no per-upload
  // snapshot — so every row sharing a month gives back byte-for-byte the same
  // file. Offered on every row that looked like separate exports of separate
  // uploads; clicking an older one and getting today's data back read as the
  // button being broken / hardcoded to one file. Restricting Download to the
  // most recent row per month makes what's actually happening honest, and the
  // "what's stored" (eye) button — which says outright that it reads live
  // state — stays available on every row to explain why.
  const latestHistoryIdByMonth = useMemo(() => {
    const latest = new Map(); // month -> { id, seconds }
    for (const h of history) {
      const seconds = h.uploadedAt?.seconds || 0;
      const current = latest.get(h.month);
      if (!current || seconds > current.seconds) latest.set(h.month, { id: h.id, seconds });
    }
    return new Map(Array.from(latest, ([month, v]) => [month, v.id]));
  }, [history]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.scroll}>
      <View style={styles.col}>
        <View style={styles.pageHeader}>
          <View style={styles.pageHeaderRow}>
            <View style={styles.pageHeaderText}>
              <Text variant="headlineSmall" style={styles.pageTitle}>
                Upload Monthly Roster
              </Text>
              <Text variant="bodyMedium" style={styles.pageSubtitle}>
                Upload the monthly shift roster for employees — rides are generated
                from it automatically.
              </Text>
            </View>
            <Button
              mode="text"
              icon="help-circle-outline"
              compact
              onPress={() => setHelpOpen(true)}
            >
              How this works
            </Button>
          </View>
        </View>

        {/* ---- Step 1: choose a file ---- */}
        <Card mode="elevated" style={styles.card}>
          <Card.Content>
            <SectionHeader
              icon="file-upload-outline"
              title="Choose a file"
              subtitle="The roster month and year are read from the file's own date headers — there is nothing to pick."
            />

            {/* Drop zone. `dataSet` reaches the DOM node on react-native-web. */}
            <View
              {...dropProps}
              style={[styles.drop, dragging && styles.dropActive]}
            >
              <MaterialCommunityIcons
                name={dragging ? 'tray-arrow-down' : 'file-excel-outline'}
                size={40}
                color={dragging ? colors.primary : colors.muted}
              />
              <Text variant="bodyMedium" style={styles.dropText}>
                {dragging ? 'Drop to read the file' : 'Drag an .xlsx or .csv here'}
              </Text>
              <Button mode="contained" icon="folder-open" onPress={pickFile} disabled={busy}>
                Choose file
              </Button>
              {/* No "Download sample template" here, at HR's request: it sat
                  next to Choose file and read as "download the sheet I just
                  uploaded", which it never was — and that misreading is exactly
                  what the download button on each Import history row DOES do, so
                  putting one here again would make the two impossible to tell
                  apart. Download a month there; check what landed with the eye
                  button beside it. buildTemplate() in services/roster.js is still
                  there if a blank starter sheet is ever wanted again. */}
            </View>

            {/* What happened to the file you just chose — right here, not buried
                further down the page. */}
            {picked ? (
              <View
                style={[
                  styles.pickedRow,
                  picked.state === 'failed' && styles.pickedFailed,
                  picked.state === 'ok' && styles.pickedOk,
                ]}
              >
                {picked.state === 'reading' ? (
                  <ActivityIndicator size={16} />
                ) : (
                  <MaterialCommunityIcons
                    name={picked.state === 'ok' ? 'check-circle' : 'alert-circle'}
                    size={17}
                    color={picked.state === 'ok' ? colors.success : colors.danger}
                  />
                )}
                <View style={styles.pickedText}>
                  <Text variant="bodySmall" style={styles.pickedName} numberOfLines={1}>
                    {picked.name}
                    {picked.size ? ` · ${Math.max(1, Math.round(picked.size / 1024))} KB` : ''}
                  </Text>
                  <Text variant="bodySmall" style={styles.pickedState}>
                    {picked.state === 'reading'
                      ? 'Reading and validating…'
                      : picked.state === 'failed'
                      ? "Couldn't be read. Nothing was imported."
                      : restoredAt
                      ? `Restored in this browser — you chose it ${describeAge(restoredAt)}. Still not imported.`
                      : 'Read successfully — see the summary below.'}
                  </Text>
                </View>
                {picked.state === 'ok' && fileBytes ? (
                  <Button
                    mode="text"
                    icon="microsoft-excel"
                    compact
                    onPress={() => {
                      const ok = openOriginalFile(fileBytes, picked.name);
                      setSnack(
                        ok
                          ? `Opening ${picked.name} — check your downloads.`
                          : 'Could not open the file. Open it from where you saved it.'
                      );
                    }}
                  >
                    Open in Excel
                  </Button>
                ) : null}
                {picked.state === 'ok' ? (
                  <IconButton
                    icon="close"
                    size={18}
                    onPress={dismiss}
                    accessibilityLabel="Discard this file"
                  />
                ) : null}
              </View>
            ) : null}

            {/* The period the file turned out to be for. This is the whole reason
                the Year and Month pickers could go: HR no longer chooses it, so
                the one thing they still need is to SEE what was detected before
                they import — the month key decides which rosters/<month>_<uid>
                documents get overwritten. Reads off `parsed`, not `report`, so it
                appears the moment the sheet is read rather than waiting for the
                employee directory to land. */}
            {picked?.state === 'ok' && parsed?.monthLabel ? (
              <View style={styles.periodBox}>
                <MaterialCommunityIcons
                  name="calendar-check-outline"
                  size={17}
                  color={colors.primary}
                />
                <Text variant="bodySmall" style={styles.periodText}>
                  Detected roster period:{' '}
                  <Text style={styles.periodStrong}>{parsed.monthLabel}</Text>
                </Text>
              </View>
            ) : null}

            {/* A restored sheet is a SNAPSHOT taken when the file was chosen. Edit
                the spreadsheet afterwards and this screen keeps showing the old
                reading — which looks exactly like "I fixed it and nothing changed".
                Say so, right where the confusion happens. */}
            {restoredAt && picked?.state === 'ok' ? (
              <View style={styles.warnBox}>
                <MaterialCommunityIcons name="history" size={15} color="#B26A00" />
                <Text variant="bodySmall" style={styles.warnText}>
                  This is what the file looked like when you chose it{' '}
                  {describeAge(restoredAt)}. If you have edited the spreadsheet since
                  — added a column, fixed an ID — press Choose file again to re-read
                  it. Nothing below will change until you do.
                </Text>
              </View>
            ) : null}

            {/* The reason a file was rejected belongs next to the file, not under
                the shift-code legend where it was easy to miss. */}
            {error ? (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text variant="bodySmall" style={styles.errorBoxText}>
                  {error}
                </Text>
              </View>
            ) : null}

            {/* Shift-code legend, straight from the live policy. Just the name on
                the badge — hover (or tap, on a phone) to see the timing, so the
                row itself doesn't turn into a wall of text. */}
            <Divider style={styles.divider} />
            <Text variant="labelLarge" style={styles.legendLabel}>
              Shift codes
            </Text>
            <View style={styles.legend}>
              {ALL_SHIFT_CODES.map((code) => {
                const c = SHIFT_COLORS[code] || { bg: colors.surfaceAlt, fg: colors.text };
                const label = shiftPolicy?.[code]?.label || code;
                return (
                  <Tooltip key={code} title={shiftSummary(shiftPolicy, code)}>
                    <Chip
                      compact
                      style={[styles.shiftBadge, { backgroundColor: c.bg }]}
                      textStyle={{ color: c.fg, fontSize: 12, fontFamily: font.semibold }}
                    >
                      {label}
                    </Chip>
                  </Tooltip>
                );
              })}
            </View>

            {employeesLoaded && employees.length === 0 ? (
              <HelperText type="info" visible>
                No employees on file yet. Add them in Employees first, or every row
                will come back as "Unknown employee".
              </HelperText>
            ) : null}
          </Card.Content>
        </Card>

        {/* A sheet is in hand but the employee directory hasn't arrived, so there
            is nothing honest to say about it yet. */}
        {parsed && !report ? (
          <Card mode="elevated" style={styles.card}>
            <Card.Content style={styles.waitRow}>
              <ActivityIndicator size={18} />
              <Text variant="bodyMedium" style={styles.waitText}>
                Checking {parsed.rows.length} row
                {parsed.rows.length === 1 ? '' : 's'} against the employee list…
              </Text>
            </Card.Content>
          </Card>
        ) : null}

        {/* ---- The sheet, as the app read it -------------------------------
            HR's first instinct after uploading is "show me what you read". Without
            this the only table on the page listed FAILING rows, so a sheet where
            everything failed looked like a wall of complaints with no way to check
            whether the file had been understood at all. This is the file: every
            row, every day, in the app's own words. -------------------------- */}
        {report ? (
          <Card mode="elevated" style={styles.card}>
            <Card.Content>
              <SectionHeader
                icon="table-eye"
                title="What the app read from your file"
                subtitle={`${report.total} row${report.total === 1 ? '' : 's'} · ${report.dayKeys.length} day${report.dayKeys.length === 1 ? '' : 's'} · ${report.monthLabel} · to read the spreadsheet itself use Open in Excel above`}
                right={
                  <Button
                    mode="text"
                    compact
                    icon={showSheet ? 'chevron-up' : 'chevron-down'}
                    onPress={() => setShowSheet((v) => !v)}
                  >
                    {showSheet ? 'Hide' : 'Show'}
                  </Button>
                }
              />

              {/* Always visible, even with the grid closed. "I added an Employee ID
                  column, why does it say missing?" is answered here in one line:
                  either it names the column it read, or it says not found. */}
              <View style={styles.colMap}>
                {(report.columnMap || []).map((e) => {
                  const found = e.col >= 0;
                  const required = e.field === 'Employee Name';
                  return (
                    <Chip
                      key={e.field}
                      compact
                      icon={found ? (e.guessed ? 'help-circle-outline' : 'check') : 'minus'}
                      style={[
                        styles.colChip,
                        found ? styles.colChipFound : null,
                        !found && (required || e.field === 'Employee ID')
                          ? styles.colChipMissing
                          : null,
                      ]}
                      textStyle={styles.colChipText}
                    >
                      {e.field}
                      {found ? ` · column ${e.column}` : ' · not in the file'}
                    </Chip>
                  );
                })}
              </View>
              {report.idColumnGuessed || report.nameColumnGuessed ? (
                <Text variant="bodySmall" style={styles.sheetHint}>
                  A column marked “?” had no heading the app recognised, so it was
                  identified by what's in it. Check it read the right one.
                </Text>
              ) : null}

              {showSheet ? (
                <>
                  <Text variant="bodySmall" style={styles.sheetHint}>
                    Compare this with your spreadsheet. A blank cell means the app
                    found nothing there; a code in red isn't one it recognises.
                    Headings were read from row {report.headerRowNumber}.
                  </Text>
                  {/* Horizontal scroll: 31 day columns never fit, and letting the
                      page itself scroll sideways would drag the whole layout. */}
                  <ScrollView horizontal style={styles.sheetScroll}>
                    <View>
                      <View style={[styles.sheetRow, styles.sheetHeadRow]}>
                        <Text variant="labelSmall" style={[styles.sheetCellName, styles.sheetHeadText]}>
                          Employee
                        </Text>
                        {report.dayKeys.map((d) => (
                          <Text
                            key={d}
                            variant="labelSmall"
                            style={[styles.sheetCellDay, styles.sheetHeadText]}
                          >
                            {d}
                          </Text>
                        ))}
                      </View>
                      {sheetRows.map((r) => (
                        <View key={r.rowNumber} style={styles.sheetRow}>
                          <View style={styles.sheetCellName}>
                            <Text variant="bodySmall" numberOfLines={1} style={styles.sheetName}>
                              {r.name || '—'}
                            </Text>
                            <Text variant="bodySmall" style={styles.sheetMeta} numberOfLines={1}>
                              {r.empId ? `ID ${r.empId}` : 'no ID'}
                              {r.valid ? '' : ' · will be skipped'}
                            </Text>
                          </View>
                          {report.dayKeys.map((d) => {
                            const code = r.days[d] || '';
                            const known = !!SHIFT_COLORS[code];
                            const c = SHIFT_COLORS[code];
                            return (
                              <View
                                key={d}
                                style={[
                                  styles.sheetCellDay,
                                  styles.sheetDayBox,
                                  known ? { backgroundColor: c.bg } : null,
                                  code && !known ? styles.sheetDayBad : null,
                                ]}
                              >
                                <Text
                                  variant="bodySmall"
                                  style={[
                                    styles.sheetDayText,
                                    known ? { color: c.fg } : null,
                                    code && !known ? styles.sheetDayBadText : null,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {code}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                  {report.rows.length > sheetRows.length ? (
                    <Button mode="text" onPress={() => setShowAllSheetRows(true)}>
                      Show all {report.rows.length} rows
                    </Button>
                  ) : null}
                </>
              ) : (
                <Text variant="bodySmall" style={styles.sheetHint}>
                  Open this to check the app read your file correctly — names, IDs
                  and every day's shift code.
                </Text>
              )}
            </Card.Content>
          </Card>
        ) : null}

        {/* ---- People in the sheet with no account yet ----------------------
            The sheet names everyone with their id, email, phone and address, so
            "10 unknown employees" is a job the app can do rather than ten dialogs
            HR has to fill in by hand.

            What this button does is FILE AN INVITE (employeeInvites/<email>) —
            it creates no login, issues no password, and sends no email. The
            invite is claimed automatically the first time that person signs in
            with Microsoft. The copy below has to say exactly that: it used to
            promise "each person is emailed a link to set their own password",
            which was left over from the old adminCreateAccount flow and had HR
            waiting on an email that was never sent, and telling new hires to go
            looking for it. See adminInviteEmployees in services/profile.js. */}
        {/* STORED FOR THIS MONTH, ABSENT FROM THIS SHEET.
            Placed above the "no account yet" card because it is the one thing on
            this screen that is true whether or not the admin presses Import —
            these rides are being generated right now. */}
        {orphans.removable.length || orphans.handAdded.length ? (
          <Card mode="elevated" style={styles.card}>
            <Card.Content>
              <SectionHeader
                icon="account-off-outline"
                title={
                  orphans.removable.length
                    ? `${orphans.removable.length} rostered for ${report?.monthLabel || report?.month} but not in this sheet`
                    : `${orphans.handAdded.length} added by the desk, not from a sheet`
                }
                subtitle={
                  orphans.removable.length
                    ? 'They keep generating rides every day until they are removed — re-uploading without them does not stop it.'
                    : 'Nothing here needs doing.'
                }
              />

              {orphans.removable.length ? (
                <>
                  {orphans.removable.slice(0, 12).map((o) => (
                    <View key={o.id} style={styles.orphanRow}>
                      <Text variant="bodyMedium" style={styles.orphanName} numberOfLines={1}>
                        {o.name}
                        {o.empId ? ` · ${o.empId}` : ''}
                      </Text>
                      <Text variant="bodySmall" style={styles.orphanMeta} numberOfLines={1}>
                        {o.days} day{o.days === 1 ? '' : 's'} rostered
                        {o.route ? ` · ${o.route}` : ''}
                      </Text>
                    </View>
                  ))}
                  {orphans.removable.length > 12 ? (
                    <Text variant="bodySmall" style={styles.orphanMeta}>
                      …and {orphans.removable.length - 12} more
                    </Text>
                  ) : null}

                  <Button
                    mode="contained"
                    icon="calendar-remove"
                    buttonColor={colors.danger}
                    onPress={() => setConfirmRemove(true)}
                    loading={removingOrphans}
                    disabled={removingOrphans}
                    style={styles.inviteBtn}
                  >
                    Remove {orphans.removable.length} from{' '}
                    {report?.monthLabel || report?.month}
                  </Button>
                  <HelperText type="info" visible>
                    This deletes only their shifts for this month. Their employee
                    record, their profile and every booking they have already had
                    are untouched — check the sheet is the complete one for the
                    month before pressing it.
                  </HelperText>
                </>
              ) : null}

              {orphans.handAdded.length ? (
                <View style={styles.handAddedBox}>
                  <Text variant="bodySmall" style={styles.orphanMeta}>
                    {orphans.handAdded.length} more{orphans.removable.length ? ' also' : ''} rostered
                    for this month came from &ldquo;Add a rider&rdquo;, not from a sheet, so
                    they are left alone:{' '}
                    {orphans.handAdded.map((o) => o.name).join(', ')}. Remove one of
                    those from Today&rsquo;s Rides instead.
                  </Text>
                </View>
              ) : null}
            </Card.Content>
          </Card>
        ) : null}

        {report && (report.creatableCount > 0 || report.uncreatableCount > 0) ? (
          <Card mode="elevated" style={styles.card}>
            <Card.Content>
              <SectionHeader
                icon="account-alert-outline"
                title={`${report.creatableCount + report.uncreatableCount} in this sheet have no account yet`}
                subtitle="Their shifts can't import until they exist as employees."
              />

              {report.creatableCount > 0 ? (
                <>
                  <Divider style={styles.divider} />
                  <Text variant="labelLarge" style={styles.legendLabel}>
                    {report.creatableCount} can be invited from this file
                  </Text>
                  <View style={styles.inviteList}>
                    {report.creatable.slice(0, 12).map((r) => (
                      <View key={r.rowNumber} style={styles.inviteRow}>
                        <Text variant="bodySmall" style={styles.inviteName} numberOfLines={1}>
                          {r.name}
                          {r.empId ? ` · ${r.empId}` : ''}
                        </Text>
                        <Text variant="bodySmall" style={styles.inviteEmail} numberOfLines={1}>
                          {r.email}
                        </Text>
                      </View>
                    ))}
                    {report.creatableCount > 12 ? (
                      <Text variant="bodySmall" style={styles.sub}>
                        …and {report.creatableCount - 12} more
                      </Text>
                    ) : null}
                  </View>

                  {inviteProgress ? (
                    <View style={styles.waitRow}>
                      <ActivityIndicator size={16} />
                      <Text variant="bodySmall" style={styles.waitText}>
                        Inviting {inviteProgress.done} of {inviteProgress.total}
                        {inviteProgress.label ? ` — ${inviteProgress.label}` : ''}…
                      </Text>
                    </View>
                  ) : null}

                  <Button
                    mode="contained"
                    icon="account-multiple-plus"
                    onPress={doInvite}
                    loading={inviting}
                    disabled={inviting}
                    style={styles.inviteBtn}
                  >
                    Invite {report.creatableCount} employee
                    {report.creatableCount === 1 ? '' : 's'}
                  </Button>
                  <HelperText type="info" visible>
                    No email is sent and no password is created — tell them to
                    open the app and choose "Sign in with Microsoft", and their
                    details here are picked up automatically on that first
                    sign-in. Their shifts import once they have signed in at
                    least once, and this list updates itself as they do.
                  </HelperText>
                </>
              ) : null}

              {inviteResult?.failedCount ? (
                <View style={styles.errorBox}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
                  <View style={styles.pickedText}>
                    {inviteResult.failed.slice(0, 8).map((f) => (
                      <Text key={f.email || f.name} variant="bodySmall" style={styles.errorBoxText}>
                        {f.name || f.email}: {f.reason}
                      </Text>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* A "the set-password email didn't send" warning used to sit here.
                  It could never appear: this screen invites employees, and an
                  invite sends nothing that could fail to send. Removed rather than
                  left in — a warning that cannot fire is one nobody can trust, and
                  this one described a password flow employees don't have. Real
                  failures still surface in the block above. */}

              {report.uncreatableCount > 0 ? (
                <>
                  <Divider style={styles.divider} />
                  <Text variant="labelLarge" style={styles.legendLabel}>
                    {report.uncreatableCount} can't be invited — no email in the file
                  </Text>
                  <Text variant="bodySmall" style={styles.sub}>
                    An invite is filed under the person's email address — that
                    address is what matches them to it when they first sign in, so
                    there is nothing to file without one. Add an Email column to
                    your roster for these people, or add them by hand in Employees.
                  </Text>
                  <Button mode="text" icon="download" onPress={downloadMissingList}>
                    Download the list of {report.uncreatableCount}
                  </Button>
                </>
              ) : null}
            </Card.Content>
          </Card>
        ) : null}

        {/* ---- Step 2: validation summary ---- */}
        {report ? (
          <Card mode="elevated" style={styles.card}>
            <Card.Content>
              <SectionHeader
                icon="clipboard-check-outline"
                title="Validation summary"
                subtitle={`${report.fileName} · ${report.monthLabel}`}
                right={<IconButton icon="close" onPress={dismiss} />}
              />

              <View style={styles.stats}>
                <Stat label="Total employees" value={report.total} />
                <Stat label="Valid records" value={report.valid} tone="good" />
                <Stat
                  label="Errors"
                  value={report.errorCount}
                  tone={report.errorCount ? 'bad' : 'muted'}
                />
              </View>

              {report.fileErrors?.length ? (
                <View style={styles.fileErrors}>
                  {report.fileErrors.map((e) => (
                    <Text key={e} variant="bodySmall" style={styles.fileErrorText}>
                      • {e}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Warnings don't block a row. The common one: a sheet with names but
                  no Employee ID column — those rows matched on name and will
                  import, but HR should know an ID column is safer. */}
              {report.warningCount ? (
                <View style={styles.warnBox}>
                  <MaterialCommunityIcons name="information" size={15} color="#B26A00" />
                  <Text variant="bodySmall" style={styles.warnText}>
                    {report.warningCount} row{report.warningCount > 1 ? 's' : ''} will
                    import with a note:{' '}
                    {Object.entries(report.byWarning || {})
                      .map(([k, n]) => `${k} (${n})`)
                      .join(', ')}
                    {!report.hasIdColumn
                      ? '. Add an "Employee ID" column so people are matched on ID rather than name.'
                      : '.'}
                  </Text>
                </View>
              ) : null}

              {/* "No pickup route" is the one warning with a specific next step, and
                  it is worth spelling out: those people import fine and then sit
                  ungroupable on the coordinator's board for the whole month. */}
              {/* A pickup area this sheet INTRODUCES — nobody is on it yet. It
                  will be applied; this is a "did you mean that?", because a new
                  area and a typo are indistinguishable from here and a typo
                  becomes a route with one rider stranded on it. Capitalisation
                  and spacing never land here: those are snapped to the spelling
                  already in use. */}
              {report.unknownRoutes?.length ? (
                <View style={styles.warnBox}>
                  <MaterialCommunityIcons name="map-marker-plus-outline" size={15} color="#B26A00" />
                  <Text variant="bodySmall" style={styles.warnText}>
                    {report.unknownRoutes.length === 1
                      ? 'This is a new pickup route'
                      : 'These are new pickup routes'}{' '}
                    — nobody is on {report.unknownRoutes.length === 1 ? 'it' : 'them'} yet:{' '}
                    <Text style={styles.warnStrong}>{report.unknownRoutes.join(', ')}</Text>.{' '}
                    {report.unknownRoutes.length === 1 ? 'It' : 'They'} will be created on import.
                    If that was a typo, fix the sheet and choose it again — a misspelt route
                    becomes a group with one person in it, and their cab never fills.
                    (Capitalisation and spacing are matched for you.)
                  </Text>
                </View>
              ) : null}

              {report.byWarning?.[ERROR_KINDS.NO_ROUTE] ? (
                <View style={styles.warnBox}>
                  <MaterialCommunityIcons name="map-marker-alert" size={15} color="#B26A00" />
                  <Text variant="bodySmall" style={styles.warnText}>
                    {report.byWarning[ERROR_KINDS.NO_ROUTE]} of them are on no pickup
                    route. Their shifts still import, but the coordinator groups each
                    day's cabs by route — add a{' '}
                    <Text style={styles.warnStrong}>Route</Text> column to this sheet
                    and re-upload, or set it on each person in{' '}
                    <Text style={styles.warnStrong}>Employees</Text>.
                  </Text>
                </View>
              ) : null}

              {Object.keys(report.byKind).length ? (
                <>
                  <Divider style={styles.divider} />
                  <Text variant="labelLarge" style={styles.legendLabel}>
                    Errors by type
                  </Text>
                  <View style={styles.legend}>
                    {Object.entries(report.byKind).map(([kind, count]) => (
                      <Chip key={kind} compact icon="alert-circle-outline" style={styles.errChip}>
                        {kind} · {count}
                      </Chip>
                    ))}
                  </View>
                </>
              ) : null}

              {errorRows.length ? (
                <>
                  <Divider style={styles.divider} />
                  <DataTable>
                    <DataTable.Header>
                      <DataTable.Title style={styles.colRow}>Row</DataTable.Title>
                      <DataTable.Title style={styles.colName}>Employee</DataTable.Title>
                      <DataTable.Title style={styles.colErr}>Problem</DataTable.Title>
                    </DataTable.Header>
                    {shownErrors.map((r) => (
                      <DataTable.Row key={r.rowNumber}>
                        <DataTable.Cell style={styles.colRow}>{r.rowNumber}</DataTable.Cell>
                        <DataTable.Cell style={styles.colName}>
                          {r.name || r.empId || '—'}
                        </DataTable.Cell>
                        <DataTable.Cell style={styles.colErr}>
                          <Text variant="bodySmall" style={styles.errText}>
                            {r.errors.join('; ')}
                          </Text>
                        </DataTable.Cell>
                      </DataTable.Row>
                    ))}
                  </DataTable>
                  {errorRows.length > shownErrors.length ? (
                    <Button mode="text" onPress={() => setShowAllErrors(true)}>
                      Show all {errorRows.length} problem rows
                    </Button>
                  ) : null}
                </>
              ) : (
                <Text variant="bodyMedium" style={styles.allGood}>
                  Every row checks out.
                </Text>
              )}

              <View style={styles.overwriteNote}>
                <MaterialCommunityIcons name="alert-outline" size={15} color={colors.warning} />
                <Text variant="bodySmall" style={styles.overwriteText}>
                  Importing overwrites name, phone, address and route on every matched
                  employee's profile with what this sheet says — including any change
                  made since the last upload. Make sure the sheet is current first.
                </Text>
              </View>

              <Divider style={styles.divider} />
              <Button
                mode="contained"
                icon="database-import"
                onPress={doImport}
                loading={busy}
                disabled={busy || !report.canImport}
                style={styles.importBtn}
                contentStyle={styles.importBtnContent}
              >
                {!report.canImport
                  ? 'Nothing to import'
                  : report.errorCount
                  ? `Import ${report.valid} valid, skip ${report.errorCount}`
                  : `Import ${report.valid} employees`}
              </Button>
              {importProgress ? (
                <View style={styles.progressWrap}>
                  <ProgressBar
                    progress={importProgress.total ? importProgress.done / importProgress.total : 0}
                    color={colors.primary}
                    style={styles.progressBar}
                  />
                  <Text variant="bodySmall" style={styles.progressText}>
                    Importing {importProgress.done} of {importProgress.total} rows…
                  </Text>
                </View>
              ) : (
                <Button mode="text" onPress={dismiss} disabled={busy} style={styles.cancelLink}>
                  Cancel
                </Button>
              )}
              {!report.canImport ? (
                <View style={styles.blockedBox}>
                  <MaterialCommunityIcons name="cancel" size={16} color={colors.danger} />
                  <Text variant="bodySmall" style={styles.blockedText}>
                    Every row has an error, so there is nothing valid to import and
                    nothing has been saved. Fix the sheet using the table above and
                    upload it again.
                  </Text>
                </View>
              ) : report.errorCount ? (
                <HelperText type="info" visible>
                  Skipped rows aren't written at all. Fix them in the sheet and
                  upload again — re-importing the same month replaces it rather
                  than duplicating it.
                </HelperText>
              ) : null}

              {/* The preview now survives a reload, but it still isn't stored
                  anywhere anyone else can see. Both halves of that matter. */}
              <View style={styles.draftNote}>
                <MaterialCommunityIcons name="information-outline" size={15} color={colors.muted} />
                <Text variant="bodySmall" style={styles.draftText}>
                  This is a preview. It stays on this screen in this browser if you
                  reload, but nothing is saved for anyone else until you press
                  Import. What has actually been saved is under Import history below.
                </Text>
              </View>
            </Card.Content>
          </Card>
        ) : null}


        {/* ---- Import history ---- */}
        <Card mode="elevated" style={styles.card}>
          <Card.Content>
            <SectionHeader
              icon="history"
              title="Import history"
              subtitle="Every roster that has actually been saved. If a month isn't here, it wasn't imported. Download a month to add someone mid-month, then upload it again — it replaces that month rather than duplicating it."
            />
            {history.length === 0 ? (
              <Text variant="bodySmall" style={styles.historyEmpty}>
                No roster has been imported yet.
              </Text>
            ) : (
              <>
                <ScrollView horizontal>
                  <View>
                    <DataTable style={styles.historyTable}>
                      <DataTable.Header>
                        <DataTable.Title style={styles.histColMonth}>Month</DataTable.Title>
                        <DataTable.Title style={styles.histColFile}>File</DataTable.Title>
                        {/* NOT `numeric`. Right-aligning this pushed "11
                            Employees" flush against the left-aligned Date cell
                            beside it, so the two read as one run-together value
                            ("11 Employees06 Aug 2026") and the headers as
                            "ImportedDate". */}
                        <DataTable.Title style={styles.histColImported}>
                          Imported
                        </DataTable.Title>
                        <DataTable.Title style={styles.histColDate}>Date</DataTable.Title>
                        <DataTable.Title style={styles.histColStatus}>Status</DataTable.Title>
                        <DataTable.Title style={styles.histColActions}> </DataTable.Title>
                      </DataTable.Header>
                      {shownHistory.map((h) => {
                        const ok = h.status === 'imported';
                        return (
                          <DataTable.Row key={h.id}>
                            <DataTable.Cell style={styles.histColMonth}>
                              {h.monthLabel || h.month}
                            </DataTable.Cell>
                            <DataTable.Cell style={styles.histColFile}>
                              <View>
                                <Text variant="bodySmall" numberOfLines={1} style={styles.histFileName}>
                                  {h.fileName || 'file'}
                                </Text>
                                <Text variant="bodySmall" style={styles.histFileMeta} numberOfLines={1}>
                                  {h.uploadedByName || 'admin'}
                                </Text>
                              </View>
                            </DataTable.Cell>
                            <DataTable.Cell style={styles.histColImported}>
                              {ok ? `${h.importedCount ?? h.valid} employees` : '—'}
                            </DataTable.Cell>
                            <DataTable.Cell style={styles.histColDate}>
                              {formatDateOnly(h.uploadedAt)}
                            </DataTable.Cell>
                            <DataTable.Cell style={styles.histColStatus}>
                              <View style={styles.histStatusRow}>
                                <MaterialCommunityIcons
                                  name={ok ? 'check-circle' : 'progress-clock'}
                                  size={15}
                                  color={ok ? colors.success : '#B26A00'}
                                />
                                <Text
                                  variant="bodySmall"
                                  style={{ color: ok ? colors.success : '#B26A00' }}
                                >
                                  {ok ? 'Success' : h.status}
                                </Text>
                              </View>
                            </DataTable.Cell>
                            <DataTable.Cell style={styles.histColActions}>
                              {/* "Success" only means the write didn't error.
                                  This opens what actually landed in Firestore
                                  for that month, which is the thing worth
                                  checking. */}
                              <IconButton
                                icon="table-eye"
                                size={18}
                                iconColor={colors.primary}
                                onPress={() => openVerify(h)}
                                accessibilityLabel="See what was imported for this month"
                              />
                              {/* Download this month as a sheet to edit and
                                  re-upload. Built from what's STORED, not from
                                  the file that was uploaded — the original bytes
                                  are never kept, and after an edit the two are
                                  different documents anyway. Every row for the
                                  same month reads the same current documents, so
                                  only the most recent row offers it — otherwise
                                  an older row's button silently hands back
                                  today's data under its own upload's name, which
                                  looks like the button is stuck on one file. */}
                              {downloadingId === h.id ? (
                                <ActivityIndicator size={16} style={styles.histSpinner} />
                              ) : latestHistoryIdByMonth.get(h.month) === h.id ? (
                                <IconButton
                                  icon="download"
                                  size={18}
                                  iconColor={colors.primary}
                                  disabled={!!downloadingId}
                                  onPress={() => downloadMonth(h)}
                                  accessibilityLabel="Download this month's roster to edit and re-upload"
                                />
                              ) : (
                                <Tooltip title="Superseded by a later upload for this month — use the eye icon to see what's stored now, or download from that row instead.">
                                  <IconButton
                                    icon="download"
                                    size={18}
                                    iconColor={colors.muted}
                                    disabled
                                    accessibilityLabel="Superseded by a later upload for this month"
                                  />
                                </Tooltip>
                              )}
                              <IconButton
                                icon="delete"
                                size={18}
                                iconColor={colors.danger}
                                onPress={() => setDeleteFor(h)}
                                accessibilityLabel="Remove this import record"
                              />
                            </DataTable.Cell>
                          </DataTable.Row>
                        );
                      })}
                    </DataTable>
                  </View>
                </ScrollView>
                {history.length > 5 ? (
                  <Button mode="text" onPress={() => setShowAllHistory((v) => !v)}>
                    {showAllHistory ? 'Show less' : `View all ${history.length}`}
                  </Button>
                ) : null}
              </>
            )}
          </Card.Content>
        </Card>
      </View>

      {/* "How this works" — the hidden rules this screen runs on */}
      <Portal>
        <Dialog visible={helpOpen} onDismiss={() => setHelpOpen(false)} style={styles.helpDialog}>
          <Dialog.Title>How Roster Upload works</Dialog.Title>
          <Dialog.Content>
            <View style={styles.helpItem}>
              <MaterialCommunityIcons name="car-clock" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                Rides are generated automatically from this roster — employees never
                book a ride themselves. Their shift code decides their pickup or drop.
              </Text>
            </View>
            <View style={styles.helpItem}>
              <MaterialCommunityIcons name="calendar-check-outline" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                You don't pick a month or a year — both are read from the sheet's own
                date headers and shown back as the detected period before you import.
                Those headers need to carry a year ("01-Aug-2026", "01-08-2026",
                "2026-08-01", or real date cells). A bare "01-Aug" is refused rather
                than guessed at, because the year decides which month gets replaced.
              </Text>
            </View>
            <View style={styles.helpItem}>
              <MaterialCommunityIcons name="file-replace-outline" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                Re-uploading a corrected sheet for the same month replaces it, not a
                duplicate — and overwrites name, phone, address, and route for every
                employee it matches, using whatever the sheet says.
              </Text>
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setHelpOpen(false)}>Got it</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* What actually landed for this month — read back out of Firestore */}
      <Portal>
        <Dialog
          visible={!!verifyFor}
          onDismiss={closeVerify}
          style={verifyDialogStyle}
        >
          <Dialog.Title>
            What's stored for {verifyFor?.monthLabel || verifyFor?.month}
          </Dialog.Title>
          <Dialog.ScrollArea style={styles.verifyScrollArea}>
            <ScrollView contentContainerStyle={styles.verifyBody}>
              <Text variant="bodySmall" style={styles.verifyIntro}>
                Read straight from the roster documents the coordinator's board
                uses — not from the upload log. If somebody isn't listed here,
                they have no shifts this month whatever the upload said.
              </Text>

              {verifyError ? (
                <Text variant="bodyMedium" style={styles.verifyError}>
                  {verifyError}
                </Text>
              ) : verifyRows === null ? (
                <View style={styles.verifyLoading}>
                  <ActivityIndicator />
                  <Text variant="bodySmall" style={styles.verifyIntro}>
                    Reading {verifyFor?.month}…
                  </Text>
                </View>
              ) : verifyRows.length === 0 ? (
                <Text variant="bodyMedium" style={styles.verifyError}>
                  Nothing is stored for this month. The upload was logged as
                  successful but wrote no roster rows — re-upload the sheet and
                  check the validation summary before importing.
                </Text>
              ) : (
                <>
                  <Text variant="bodyMedium" style={styles.verifyCount}>
                    {verifyRows.length} employee row(s) stored ·{' '}
                    {verifyRows.filter((r) => r.rideDays > 0).length} generate rides
                  </Text>
                  {/* This total is EVERYONE currently stored for the month, not
                      what this one upload wrote — an import only ever adds/
                      overwrites rows, it never removes someone missing from a
                      later sheet (see importRoster/rosterOrphans). So a row
                      logged as "14 employees" can show 15 stored here whenever
                      an earlier upload this month covered someone this one
                      didn't mention. Silent otherwise, this reads as the count
                      simply being wrong — say why instead. */}
                  {typeof verifyFor?.importedCount === 'number'
                  && verifyFor.importedCount !== verifyRows.length ? (
                    <View style={styles.warnBox}>
                      <MaterialCommunityIcons name="information" size={15} color="#B26A00" />
                      <Text variant="bodySmall" style={styles.warnText}>
                        This upload itself imported {verifyFor.importedCount}. The other{' '}
                        {Math.abs(verifyRows.length - verifyFor.importedCount)} row
                        {Math.abs(verifyRows.length - verifyFor.importedCount) === 1 ? '' : 's'} came
                        from an earlier upload this month and weren&rsquo;t removed — imports
                        never delete anyone, only add or overwrite. Open Upload Roster and
                        choose this month&rsquo;s current sheet to see exactly who&rsquo;s stored but
                        missing from it.
                      </Text>
                    </View>
                  ) : null}
                  {/* Two numbers, because they fail differently: a row can import
                      with every cell blank (codedDays 0), and a row can be full of
                      Evening/Week Off codes that legitimately produce no cab
                      (rideDays 0). "Success" hides both. */}
                  <DataTable>
                    <DataTable.Header>
                      <DataTable.Title style={styles.vColName}>Employee</DataTable.Title>
                      <DataTable.Title style={styles.vColRoute}>Route</DataTable.Title>
                      <DataTable.Title style={styles.vColNum}>Days</DataTable.Title>
                      <DataTable.Title style={styles.vColNum}>Rides</DataTable.Title>
                    </DataTable.Header>
                    {verifyRows.map((r) => (
                      <DataTable.Row key={r.employeeId}>
                        <DataTable.Cell style={styles.vColName}>
                          <View>
                            <Text variant="bodySmall" numberOfLines={1}>
                              {r.name}
                            </Text>
                            <Text variant="bodySmall" style={styles.histFileMeta}>
                              {r.empId || 'no ID'}
                            </Text>
                          </View>
                        </DataTable.Cell>
                        <DataTable.Cell style={styles.vColRoute}>
                          <Text
                            variant="bodySmall"
                            style={r.route ? undefined : styles.verifyWarn}
                            numberOfLines={1}
                          >
                            {r.route || 'No route set'}
                          </Text>
                        </DataTable.Cell>
                        <DataTable.Cell style={styles.vColNum}>
                          <Text
                            variant="bodySmall"
                            style={r.codedDays ? undefined : styles.verifyWarn}
                          >
                            {r.codedDays}
                          </Text>
                        </DataTable.Cell>
                        <DataTable.Cell style={styles.vColNum}>
                          <Text
                            variant="bodySmall"
                            style={r.rideDays ? undefined : styles.verifyWarn}
                          >
                            {r.rideDays}
                          </Text>
                        </DataTable.Cell>
                      </DataTable.Row>
                    ))}
                  </DataTable>
                </>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={closeVerify}>Close</Button>
            <Button
              mode="contained"
              icon="download"
              onPress={downloadVerified}
              // Enabled only while the rows on hand are this month's. It used to
              // be enabled by the mere existence of rows, whichever month they
              // came from.
              disabled={!canDownloadVerified}
            >
              Download as .xlsx
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Remove one Import history row */}
      <Portal>
        <Dialog visible={!!deleteFor} onDismiss={() => setDeleteFor(null)}>
          <Dialog.Title>Remove this import record?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This removes the log entry for {deleteFor?.monthLabel || deleteFor?.month}
              {' '}({deleteFor?.fileName || 'file'}) from Import history. The employee
              shifts it already wrote are not affected — only this record of the upload
              disappears.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteFor(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={confirmDeleteHistory}
              loading={deleting}
              disabled={deleting}
            >
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Deleting a month of somebody's shifts is not an undo-able click, and the
          dangerous input is a PARTIAL sheet — one route, a correction for three
          people, the wrong file — which would list everybody else as missing. So
          the confirmation names the count and says what a wrong file would do. */}
      <Portal>
        <Dialog
          visible={confirmRemove}
          onDismiss={() => setConfirmRemove(false)}
          style={styles.helpDialog}
        >
          <Dialog.Title>
            Remove {orphans.removable.length} from {report?.monthLabel || report?.month}?
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.confirmLead}>
              {orphans.removable.map((o) => o.name).join(', ')}
            </Text>
            <Text variant="bodySmall" style={styles.confirmBody}>
              Their shifts for this month are deleted and they stop appearing on
              Today&rsquo;s Rides. Employee records, profiles and past bookings are
              not touched.
            </Text>
            <Text variant="bodySmall" style={styles.confirmWarn}>
              Only do this if the sheet on screen covers the WHOLE month. If it is
              a partial file, everybody left out of it is on this list.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmRemove(false)}>Cancel</Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              icon="calendar-remove"
              onPress={doRemoveOrphans}
            >
              Remove {orphans.removable.length}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={4000}>
        {snack}
      </Snackbar>
    </ScrollView>
  );
}

// One consistent title style for every card: an icon chip, a title, an
// optional subtitle, and an optional right-aligned action (a button or
// close icon). Keeps every section reading the same way instead of each
// card inventing its own header layout.
function SectionHeader({ icon, title, subtitle, right }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        {icon ? (
          <View style={styles.sectionIconWrap}>
            <MaterialCommunityIcons name={icon} size={18} color={colors.primary} />
          </View>
        ) : null}
        <View style={styles.sectionHeaderText}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="bodySmall" style={styles.sectionSubtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right ? <View style={styles.sectionHeaderRight}>{right}</View> : null}
    </View>
  );
}

function Stat({ label, value, tone }) {
  const color =
    tone === 'good' ? colors.success : tone === 'bad' ? colors.danger : colors.text;
  return (
    <View style={styles.stat}>
      <Text variant="headlineSmall" style={[styles.statValue, { color }]}>
        {value}
      </Text>
      <Text variant="bodySmall" style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, alignItems: 'center', paddingBottom: 48 },
  col: { width: '100%', maxWidth: 900 },

  pageHeader: { marginBottom: spacing.lg, paddingHorizontal: 2 },
  pageHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  pageHeaderText: { flex: 1 },
  pageTitle: { fontFamily: font.bold, color: colors.text, letterSpacing: 0.1 },
  pageSubtitle: { color: colors.muted, marginTop: 4, lineHeight: 20 },
  helpDialog: { maxWidth: 480, alignSelf: 'center', width: '100%' },
  helpItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  helpIcon: { marginTop: 2 },
  helpText: { flex: 1, lineHeight: 20 },

  // Flat white cards with a soft shadow instead of a hard outline — the
  // "modern SaaS dashboard" look asked for, scoped to this screen only.
  card: {
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  sub: { color: colors.muted, marginTop: 2 },

  // Shared card header: icon chip + title + optional subtitle + optional
  // right-aligned action, so every card reads the same way.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  sectionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  sectionHeaderText: { flex: 1 },
  sectionHeaderRight: { marginLeft: spacing.sm },
  sectionTitle: { fontFamily: font.semibold, color: colors.text },
  sectionSubtitle: { color: colors.muted, marginTop: 2, lineHeight: 19 },

  shiftBadge: { borderRadius: radius.pill },

  drop: {
    marginTop: spacing.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primarySofter,
  },
  dropActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dropText: { color: colors.textSecondary },

  divider: { marginVertical: spacing.lg, backgroundColor: colors.border },
  legendLabel: { color: colors.text, marginBottom: spacing.sm, fontFamily: font.semibold },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  errChip: { backgroundColor: colors.dangerSoft },

  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.primarySofter,
  },
  pickedOk: { borderColor: colors.success, backgroundColor: colors.successSoft },
  pickedFailed: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  pickedText: { flex: 1 },
  pickedName: { fontFamily: font.semibold, color: colors.text },
  pickedState: { color: colors.muted, marginTop: 1 },
  periodBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  periodText: { color: colors.primaryDark, flex: 1, lineHeight: 19 },
  periodStrong: { fontFamily: font.bold, color: colors.primary },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBoxText: { color: colors.danger, flex: 1, lineHeight: 19 },
  blockedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  blockedText: { color: colors.danger, flex: 1, lineHeight: 19 },
  draftNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
  },
  draftText: { color: colors.muted, flex: 1, lineHeight: 18 },
  overwriteNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
  },
  overwriteText: { color: colors.warning, flex: 1, lineHeight: 18 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitText: { color: colors.muted },
  sheetHint: { color: colors.muted, marginTop: 6, lineHeight: 18 },
  inviteList: { marginTop: 8, gap: 4 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteName: { fontFamily: font.semibold, minWidth: 200 },
  inviteEmail: { color: colors.muted, flex: 1 },
  orphanRow: { marginTop: spacing.md },
  orphanName: { fontFamily: font.semibold, color: colors.text },
  orphanMeta: { color: colors.muted, lineHeight: 18 },
  handAddedBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  confirmLead: { fontFamily: font.semibold, color: colors.text, lineHeight: 21 },
  confirmBody: { color: colors.textSecondary, marginTop: spacing.md, lineHeight: 19 },
  confirmWarn: { color: colors.warning, marginTop: spacing.md, lineHeight: 19 },
  inviteBtn: { marginTop: 14, alignSelf: 'flex-start' },
  colMap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  colChip: { backgroundColor: colors.surfaceAlt },
  colChipFound: { backgroundColor: colors.successSoft },
  colChipMissing: { backgroundColor: colors.dangerSoft },
  colChipText: { fontSize: 12 },
  sheetScroll: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sheetRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetHeadRow: { backgroundColor: colors.surfaceAlt },
  sheetHeadText: { color: colors.muted, paddingVertical: 8, textAlign: 'center' },
  // A fixed name column keeps the day grid aligned; 34px per day fits a 31-day
  // month in a scroll region without the codes wrapping.
  sheetCellName: { width: 170, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center' },
  sheetCellDay: { width: 34, justifyContent: 'center' },
  sheetName: { fontFamily: font.semibold },
  sheetMeta: { color: colors.muted, fontSize: 11 },
  sheetDayBox: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
    borderRadius: radius.xs,
    minHeight: 26,
  },
  sheetDayText: { fontSize: 11, fontFamily: font.semibold },
  sheetDayBad: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  sheetDayBadText: { color: colors.danger },
  historyEmpty: { color: colors.muted, marginTop: 10, fontStyle: 'italic' },

  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xl,
    marginTop: spacing.lg,
  },
  stat: { minWidth: 120 },
  statValue: { fontFamily: font.bold, color: colors.text },
  statLabel: { color: colors.muted, letterSpacing: 0.3 },

  fileErrors: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3C2BD',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  fileErrorText: { color: colors.danger, lineHeight: 19 },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F2E3C4',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warnText: { color: colors.warning, flex: 1, lineHeight: 19 },
  warnStrong: { color: colors.warning, fontFamily: font.bold },

  colRow: { flex: 0.5 },
  colName: { flex: 1.4 },
  colErr: { flex: 3 },
  errText: { color: colors.danger },
  allGood: { color: colors.success, marginTop: 12, fontFamily: font.semibold },

  // One large primary action, full width — the single thing left to do once
  // the sheet checks out.
  importBtn: { borderRadius: radius.md, ...shadow.brand },
  importBtnContent: { paddingVertical: 8 },
  cancelLink: { alignSelf: 'center', marginTop: spacing.xs },
  progressWrap: { marginTop: spacing.md, gap: spacing.sm },
  progressBar: { height: 8, borderRadius: radius.pill },
  progressText: { color: colors.muted, textAlign: 'center' },

  // Sizing itself is computed at render time from the actual window (see
  // verifyDialogStyle) — this only bounds how tall the scroll area inside the
  // dialog is allowed to grow, which Paper otherwise caps low enough that a
  // roster of any real size shows two rows and then hides the rest.
  verifyScrollArea: { maxHeight: '100%' },
  verifyBody: { paddingBottom: 8 },
  verifyIntro: { color: colors.muted, marginBottom: 8, lineHeight: 18 },
  verifyCount: { fontFamily: font.bold, marginBottom: 4 },
  verifyError: { color: colors.danger, lineHeight: 20 },
  verifyLoading: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  // Amber, not red: a zero here is worth looking at but is sometimes correct
  // (a month of Week Offs), so it flags rather than accuses.
  verifyWarn: { color: colors.warning, fontFamily: font.bold },
  vColName: { flex: 2.2 },
  vColRoute: { flex: 1.6 },
  vColNum: { flex: 0.7, justifyContent: 'center' },
  historyTable: { minWidth: 720 },
  histColMonth: { flex: 1.1 },
  histColFile: { flex: 2 },
  // paddingRight keeps the count clear of the date column even if this table is
  // ever squeezed narrower than its minWidth.
  histColImported: { flex: 1.4, paddingRight: 12 },
  histColDate: { flex: 1.2 },
  histColStatus: { flex: 1.2 },
  // Three actions now (verify, download, remove), so this needs more room than
  // the two it was sized for or the last one clips.
  histColActions: { flex: 1.5, justifyContent: 'flex-end' },
  // Stands in for the download IconButton while its month is being read back,
  // sized to match so the row doesn't jump.
  histSpinner: { marginHorizontal: 14 },
  histFileName: { fontFamily: font.semibold, color: colors.text },
  histFileMeta: { color: colors.muted, marginTop: 1 },
  histStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  centerTitle: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.text,
    fontFamily: font.semibold,
  },
  centerBody: { textAlign: 'center', color: colors.muted, maxWidth: 440, lineHeight: 21 },
});
