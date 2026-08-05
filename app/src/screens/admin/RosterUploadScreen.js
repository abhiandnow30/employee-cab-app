// ---------------------------------------------------------------------------
// UPLOAD MONTHLY SHIFT ROSTER  (HR / Admin)
//
// The entry point of the whole workflow. HR uploads one spreadsheet a month and
// every ride in the system follows from it — employees never submit shifts.
//
// Four visible stages, so nothing is written until HR has seen what will happen:
//   1. Choose a file (drag-and-drop, or the file picker). Nothing leaves the page.
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

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Platform, ScrollView } from 'react-native';
import {
  Text, Card, Button, Chip, Divider, DataTable, HelperText, Snackbar,
  ActivityIndicator, IconButton, Portal, Dialog, Tooltip, ProgressBar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import Dropdown from '../../components/Dropdown';
import {
  parseRosterFile, validateRoster, downloadTemplate, ERROR_KINDS,
} from '../../services/roster';
import { subscribeEmployees, adminInviteEmployees } from '../../services/profile';
import { ALL_SHIFT_CODES, SHIFT_COLORS, shiftSummary } from '../../data/shifts';
import {
  saveDraft, loadDraft, clearDraft, describeAge, encodeBytes, decodeBytes,
  openOriginalFile,
} from '../../utils/rosterDraft';
import { colors, spacing } from '../../theme';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "2026-07-28" → 2026. The template and the parser both need a year, which the
// spreadsheet's "01-Jul" headers never carry.
function thisYear() {
  return new Date().getFullYear();
}

// Just the date, for the Import history table — "30 Jul 2026".
function formatDateOnly(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export default function RosterUploadScreen({ navigation }) {
  const {
    shiftPolicy, importRoster, subscribeImportHistory, routeOptions, deleteImportHistory,
    addSingleEmployeeRoster,
  } = useApp();

  const [employees, setEmployees] = useState([]);
  // Validation is meaningless until the employee directory has arrived — against
  // an empty list every row reads "Unknown employee". The screen shows a spinner
  // rather than a summary it would have to immediately correct.
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [year, setYear] = useState(() => thisYear());
  const [busy, setBusy] = useState(false);
  // The PARSED sheet, not the validation report. The report is derived below, so
  // it re-computes whenever the employee directory or the shift policy changes —
  // which means adding a missing employee in another tab updates this summary
  // without HR re-uploading the file.
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [dragging, setDragging] = useState(false);
  // "Add single employee" — one roster row for a walk-in, no spreadsheet.
  const [singleEmployeeUid, setSingleEmployeeUid] = useState(null);
  const [singleYear, setSingleYear] = useState(() => thisYear());
  const [singleMonth, setSingleMonth] = useState(() => new Date().getMonth() + 1); // 1-12
  const [singleCode, setSingleCode] = useState(null);
  const [singleStartDay, setSingleStartDay] = useState(() => new Date().getDate());
  const [singleEndDay, setSingleEndDay] = useState(null); // filled in by the effect below
  const [singleBusy, setSingleBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null); // history entry pending removal confirmation
  const [deleting, setDeleting] = useState(false);
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
    if (draft.year) setYear(draft.year);

    const bytes = draft.fileBytes ? decodeBytes(draft.fileBytes) : null;
    if (bytes) {
      try {
        const fresh = parseRosterFile(bytes, {
          year: draft.year || thisYear(),
          fileName: draft.picked?.name || '',
        });
        setParsed(fresh);
        // Write the fresh reading back so the next restore starts from it.
        saveDraft({
          parsed: fresh,
          picked: draft.picked,
          year: draft.year,
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

  // Keep the "add single employee" day range inside the picked month — e.g.
  // switching from July (31 days) to a month with fewer days shouldn't leave
  // day 31 selected somewhere that no longer exists.
  useEffect(() => {
    const daysInMonth = new Date(singleYear, singleMonth, 0).getDate();
    setSingleStartDay((d) => Math.min(d, daysInMonth));
    setSingleEndDay((d) => (d == null ? daysInMonth : Math.min(d, daysInMonth)));
  }, [singleYear, singleMonth]);

  const yearOptions = useMemo(() => {
    const y = thisYear();
    return [y - 1, y, y + 1];
  }, []);

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
    clearDraft();
  }

  // Create accounts for the people this sheet names who don't have one. Their
  // shifts then import on the next render — the report re-derives as soon as the
  // employees subscription reports the new documents, so there is nothing to
  // re-upload and no second button to press.
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
          ? `Created ${res.createdCount}, ${res.failedCount} could not be created`
          : `Created ${res.createdCount} employee${res.createdCount === 1 ? '' : 's'} — each has been emailed a link to set their password`
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
      const sheet = parseRosterFile(buffer, { year, fileName: file.name });
      const nowPicked = { name: file.name, size: file.size, state: 'ok' };
      // Keep the original bytes so "open the actual spreadsheet" is possible even
      // after a reload, when the browser no longer has a handle on the disk file.
      const bytes = encodeBytes(buffer);
      setParsed(sheet);
      setPicked(nowPicked);
      setFileBytes(bytes);
      // Stash it so a reload doesn't lose the preview. If this fails (quota,
      // private browsing) the upload still works — the draft is a convenience.
      saveDraft({ parsed: sheet, picked: nowPicked, year, fileBytes: bytes });
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
    setBusy(true);
    setImportProgress({ done: 0, total: report.valid });
    const res = await importRoster(report, {
      onProgress: (done, total) => setImportProgress({ done, total }),
    });
    setBusy(false);
    setImportProgress(null);
    if (res?.ok) {
      setSnack(
        `Imported ${res.imported} employee${res.imported === 1 ? '' : 's'} for ${report.monthLabel}` +
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

  // Add one employee's roster for a day range — the walk-in case, no
  // spreadsheet. Shows up in Import history exactly like a real upload.
  async function submitSingleEmployee() {
    const emp = employees.find((e) => e.uid === singleEmployeeUid);
    if (!emp || !singleCode) return;
    if (singleEndDay < singleStartDay) {
      setError('End day must be on or after the start day.');
      return;
    }
    setSingleBusy(true);
    const month = `${singleYear}-${String(singleMonth).padStart(2, '0')}`;
    const monthLabel = `${MONTH_NAMES[singleMonth - 1].slice(0, 3)} ${singleYear}`;
    const res = await addSingleEmployeeRoster({
      month,
      monthLabel,
      employee: emp,
      startDay: singleStartDay,
      endDay: singleEndDay,
      code: singleCode,
    });
    setSingleBusy(false);
    if (res?.ok) {
      const codeLabel = shiftPolicy?.[singleCode]?.label || singleCode;
      setSnack(
        `Added ${codeLabel} for ${emp.name}, day ${singleStartDay}–${singleEndDay} of ${monthLabel}.`
      );
      setSingleEmployeeUid(null);
      setSingleCode(null);
    } else {
      setError(res?.message || 'Could not add that roster row.');
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

  const singleDaysInMonth = new Date(singleYear, singleMonth, 0).getDate();
  const singleDayOptions = Array.from({ length: singleDaysInMonth }, (_, i) => i + 1);
  const employeeOptions = employees
    .filter((e) => e.role === 'employee')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map((e) => e.uid);
  const employeeLabel = (uid) => {
    const emp = employees.find((e) => e.uid === uid);
    if (!emp) return 'Select employee';
    return emp.empId ? `${emp.name} · ${emp.empId}` : emp.name;
  };

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
            <SectionHeader icon="file-upload-outline" title="Choose a file" />

            <View style={styles.fieldsRow}>
              <View style={styles.fieldGroup}>
                <Text variant="labelLarge" style={styles.yearLabel}>
                  Year
                </Text>
                <View style={styles.yearPicker}>
                  <Dropdown
                    value={year}
                    options={yearOptions}
                    onSelect={setYear}
                    format={(y) => String(y)}
                  />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text variant="labelLarge" style={styles.yearLabel}>
                  Month
                </Text>
                <View style={styles.yearPicker}>
                  {/* Read-only — the month always comes from the file's own date
                      headers, never from a pick here. Shows what was detected
                      once a file has been read. */}
                  <Dropdown
                    value={report ? report.monthLabel : null}
                    options={report ? [report.monthLabel] : []}
                    onSelect={() => {}}
                    placeholder="Detected from file"
                    disabled
                  />
                </View>
              </View>
            </View>
            <Text variant="bodySmall" style={styles.yearHint}>
              The month is read from the file's own date headers, not picked here.
            </Text>

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
              <Button
                mode="text"
                icon="download"
                onPress={() => {
                  const name = downloadTemplate(year, new Date().getMonth());
                  setSnack(`Template downloaded: ${name}`);
                }}
              >
                Download sample template
              </Button>
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
                const c = SHIFT_COLORS[code] || { bg: '#EEE', fg: colors.text };
                const label = shiftPolicy?.[code]?.label || code;
                return (
                  <Tooltip key={code} title={shiftSummary(shiftPolicy, code)}>
                    <Chip
                      compact
                      style={[styles.shiftBadge, { backgroundColor: c.bg }]}
                      textStyle={{ color: c.fg, fontSize: 12, fontWeight: '600' }}
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

        {/* ---- Add a single employee's roster, no spreadsheet ----------------
            For the walk-in: someone needs a cab arranged for the rest of the
            month and editing + re-uploading the whole sheet is overkill for
            one person. Writes the same roster shape a real import would, so
            it shows up in Import history exactly like one. */}
        <Card mode="elevated" style={styles.card}>
          <Card.Content>
            <SectionHeader
              icon="account-plus-outline"
              title="Add a single employee"
              subtitle="For a walk-in mid-month — one employee, one shift, a day range. Skips the spreadsheet."
            />

            <View style={styles.soloFieldGroup}>
              <Text variant="labelLarge" style={styles.yearLabel}>
                Employee
              </Text>
              <Dropdown
                compact={false}
                value={singleEmployeeUid}
                options={employeeOptions}
                onSelect={setSingleEmployeeUid}
                format={employeeLabel}
                placeholder={
                  employeesLoaded && employeeOptions.length === 0
                    ? 'No employees on file yet'
                    : 'Select employee'
                }
                disabled={employeeOptions.length === 0}
              />
            </View>

            <View style={styles.fieldsRow}>
              <View style={styles.fieldGroup}>
                <Text variant="labelLarge" style={styles.yearLabel}>
                  Year
                </Text>
                <View style={styles.yearPicker}>
                  <Dropdown
                    value={singleYear}
                    options={yearOptions}
                    onSelect={setSingleYear}
                    format={(y) => String(y)}
                  />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text variant="labelLarge" style={styles.yearLabel}>
                  Month
                </Text>
                <View style={styles.yearPicker}>
                  <Dropdown
                    value={singleMonth}
                    options={Array.from({ length: 12 }, (_, i) => i + 1)}
                    onSelect={setSingleMonth}
                    format={(m) => MONTH_NAMES[m - 1]}
                  />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text variant="labelLarge" style={styles.yearLabel}>
                  Shift
                </Text>
                <View style={styles.yearPicker}>
                  <Dropdown
                    value={singleCode}
                    options={ALL_SHIFT_CODES}
                    onSelect={setSingleCode}
                    format={(c) => shiftPolicy?.[c]?.label || c}
                    placeholder="Select shift"
                  />
                </View>
              </View>
            </View>

            <View style={styles.fieldsRow}>
              <View style={styles.fieldGroup}>
                <Text variant="labelLarge" style={styles.yearLabel}>
                  From day
                </Text>
                <View style={styles.dayPicker}>
                  <Dropdown
                    value={singleStartDay}
                    options={singleDayOptions}
                    onSelect={setSingleStartDay}
                    format={(d) => String(d)}
                  />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text variant="labelLarge" style={styles.yearLabel}>
                  To day
                </Text>
                <View style={styles.dayPicker}>
                  <Dropdown
                    value={singleEndDay}
                    options={singleDayOptions}
                    onSelect={setSingleEndDay}
                    format={(d) => String(d)}
                  />
                </View>
              </View>
            </View>

            <Button
              mode="contained"
              icon="calendar-plus"
              onPress={submitSingleEmployee}
              loading={singleBusy}
              disabled={singleBusy || !singleEmployeeUid || !singleCode}
              style={styles.singleAddBtn}
            >
              Add roster row
            </Button>
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
            HR has to fill in by hand. Nobody is issued a password: each account is
            created with a throwaway one and Firebase emails a set-your-own link. */}
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
                    {report.creatableCount} can be created from this file
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
                        Creating {inviteProgress.done} of {inviteProgress.total}
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
                    Create {report.creatableCount} employee
                    {report.creatableCount === 1 ? '' : 's'}
                  </Button>
                  <HelperText type="info" visible>
                    Each person is emailed a link to set their own password. No
                    temporary passwords are created or shared. Their shifts import
                    straight after — this list updates itself.
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

              {inviteResult?.notInvited?.length ? (
                <View style={styles.warnBox}>
                  <MaterialCommunityIcons name="email-alert-outline" size={15} color="#B26A00" />
                  <Text variant="bodySmall" style={styles.warnText}>
                    {inviteResult.notInvited.length} account
                    {inviteResult.notInvited.length === 1 ? ' was' : 's were'} created but
                    the set-password email didn't send. They can use “Forgot password”
                    on the login screen.
                  </Text>
                </View>
              ) : null}

              {report.uncreatableCount > 0 ? (
                <>
                  <Divider style={styles.divider} />
                  <Text variant="labelLarge" style={styles.legendLabel}>
                    {report.uncreatableCount} can't be created — no email in the file
                  </Text>
                  <Text variant="bodySmall" style={styles.sub}>
                    An account needs an email address to log in with. Add an Email
                    column to your roster for these people, or add them by hand in
                    Employees.
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
              {/* A route the sheet named that isn't configured. Spelled out, because
                  "fix it" is only actionable if HR can see which value was rejected —
                  and because the fix might be to add the route rather than edit the
                  sheet. Capitalisation alone never lands here: those are matched. */}
              {report.unknownRoutes?.length ? (
                <View style={styles.warnBox}>
                  <MaterialCommunityIcons name="map-marker-question" size={15} color="#B26A00" />
                  <Text variant="bodySmall" style={styles.warnText}>
                    {report.unknownRoutes.length === 1 ? 'This route is' : 'These routes are'}{' '}
                    not in your list, so {report.unknownRoutes.length === 1 ? 'it was' : 'they were'}{' '}
                    not applied:{' '}
                    <Text style={styles.warnStrong}>{report.unknownRoutes.join(', ')}</Text>. Correct
                    the spelling in the sheet, or add{' '}
                    {report.unknownRoutes.length === 1 ? 'it' : 'them'} under{' '}
                    <Text style={styles.warnStrong}>Routes &amp; Timings</Text> — this screen
                    re-checks itself, no re-upload needed. (Capitalisation is matched for you.)
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
              subtitle="Every roster that has actually been saved. If a month isn't here, it wasn't imported."
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
                        <DataTable.Title style={styles.histColImported} numeric>
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
                            <DataTable.Cell style={styles.histColImported} numeric>
                              {ok ? `${h.importedCount ?? h.valid} Employees` : '—'}
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
              <MaterialCommunityIcons name="file-replace-outline" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                Re-uploading a corrected sheet for the same month replaces it, not a
                duplicate — and overwrites name, phone, address, and route for every
                employee it matches, using whatever the sheet says.
              </Text>
            </View>
            <View style={styles.helpItem}>
              <MaterialCommunityIcons name="account-plus-outline" size={18} color={colors.primary} style={styles.helpIcon} />
              <Text variant="bodyMedium" style={styles.helpText}>
                Need to add just one person mid-month, without touching the whole
                sheet? Use "Add a single employee" below instead of re-uploading.
              </Text>
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setHelpOpen(false)}>Got it</Button>
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
  // Local page background — a touch lighter than the app-wide theme
  // background, per this screen's own redesign brief.
  page: { flex: 1, backgroundColor: '#F8FAFC' },
  scroll: { padding: spacing.xl, alignItems: 'center', paddingBottom: 48 },
  col: { width: '100%', maxWidth: 900 },

  pageHeader: { marginBottom: spacing.lg, paddingHorizontal: 2 },
  pageHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  pageHeaderText: { flex: 1 },
  pageTitle: { fontWeight: '700', color: colors.text, letterSpacing: 0.1 },
  pageSubtitle: { color: colors.muted, marginTop: 4, lineHeight: 20 },
  helpDialog: { maxWidth: 480, alignSelf: 'center', width: '100%' },
  helpItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  helpIcon: { marginTop: 2 },
  helpText: { flex: 1, lineHeight: 20 },

  // Flat white cards with a soft shadow instead of a hard outline — the
  // "modern SaaS dashboard" look asked for, scoped to this screen only.
  card: {
    marginBottom: spacing.lg,
    borderRadius: 12,
    backgroundColor: colors.surface,
    shadowColor: '#1A2233',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
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
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EAF2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  sectionHeaderText: { flex: 1 },
  sectionHeaderRight: { marginLeft: spacing.sm },
  sectionTitle: { fontWeight: '700', color: colors.text },
  sectionSubtitle: { color: colors.muted, marginTop: 2, lineHeight: 18 },

  fieldsRow: { flexDirection: 'row', gap: 20, marginTop: 14, flexWrap: 'wrap' },
  fieldGroup: { gap: 6 },
  soloFieldGroup: { gap: 6, marginTop: 14 },
  yearLabel: { color: colors.text },
  yearPicker: { width: 160 },
  dayPicker: { width: 90 },
  yearHint: { color: colors.muted, marginTop: 8 },
  shiftBadge: { borderRadius: 16 },
  singleAddBtn: { marginTop: 18, alignSelf: 'flex-start', borderRadius: 10 },

  drop: {
    marginTop: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FAFCFF',
  },
  dropActive: { borderColor: colors.primary, backgroundColor: '#EAF2FE' },
  dropText: { color: colors.muted },

  divider: { marginVertical: 14 },
  legendLabel: { color: colors.text, marginBottom: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  errChip: { backgroundColor: '#FDECEC' },

  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F7FAFF',
  },
  pickedOk: { borderColor: colors.success, backgroundColor: '#F1FAF2' },
  pickedFailed: { borderColor: colors.danger, backgroundColor: '#FEF3F3' },
  pickedText: { flex: 1 },
  pickedName: { fontWeight: '600', color: colors.text },
  pickedState: { color: colors.muted, marginTop: 1 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    backgroundColor: '#FEF3F3',
    borderRadius: 10,
    padding: 10,
  },
  errorBoxText: { color: colors.danger, flex: 1, lineHeight: 18 },
  blockedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    backgroundColor: '#FEF3F3',
    borderRadius: 10,
    padding: 10,
  },
  blockedText: { color: colors.danger, flex: 1, lineHeight: 18 },
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
  inviteName: { fontWeight: '600', minWidth: 200 },
  inviteEmail: { color: colors.muted, flex: 1 },
  inviteBtn: { marginTop: 14, alignSelf: 'flex-start' },
  colMap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  colChip: { backgroundColor: '#F1F3F7' },
  colChipFound: { backgroundColor: '#E7F4E8' },
  colChipMissing: { backgroundColor: '#FDECEC' },
  colChipText: { fontSize: 12 },
  sheetScroll: { marginTop: 12, borderWidth: 1, borderColor: '#E4E8EF', borderRadius: 10 },
  sheetRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: '#EEF1F6' },
  sheetHeadRow: { backgroundColor: '#F5F7FA' },
  sheetHeadText: { color: colors.muted, paddingVertical: 8, textAlign: 'center' },
  // A fixed name column keeps the day grid aligned; 34px per day fits a 31-day
  // month in a scroll region without the codes wrapping.
  sheetCellName: { width: 170, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center' },
  sheetCellDay: { width: 34, justifyContent: 'center' },
  sheetName: { fontWeight: '600' },
  sheetMeta: { color: colors.muted, fontSize: 11 },
  sheetDayBox: { alignItems: 'center', justifyContent: 'center', margin: 2, borderRadius: 4, minHeight: 26 },
  sheetDayText: { fontSize: 11, fontWeight: '600' },
  sheetDayBad: { backgroundColor: '#FDECEC', borderWidth: 1, borderColor: colors.danger },
  sheetDayBadText: { color: colors.danger },
  historyEmpty: { color: colors.muted, marginTop: 10, fontStyle: 'italic' },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 16 },
  stat: { minWidth: 120 },
  statValue: { fontWeight: 'bold' },
  statLabel: { color: colors.muted },

  fileErrors: {
    marginTop: 12,
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    padding: 10,
  },
  fileErrorText: { color: colors.danger, lineHeight: 18 },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 12,
    backgroundColor: '#FFF6E5',
    borderRadius: 10,
    padding: 10,
  },
  warnText: { color: '#B26A00', flex: 1, lineHeight: 18 },
  warnStrong: { color: '#B26A00', fontWeight: '700' },

  colRow: { flex: 0.5 },
  colName: { flex: 1.4 },
  colErr: { flex: 3 },
  errText: { color: colors.danger },
  allGood: { color: colors.success, marginTop: 12, fontWeight: '600' },

  // One large primary action, full width — the single thing left to do once
  // the sheet checks out.
  importBtn: { borderRadius: 10 },
  importBtnContent: { paddingVertical: 6 },
  cancelLink: { alignSelf: 'center', marginTop: 4 },
  progressWrap: { marginTop: 12, gap: 6 },
  progressBar: { height: 8, borderRadius: 4 },
  progressText: { color: colors.muted, textAlign: 'center' },

  historyTable: { minWidth: 640 },
  histColMonth: { flex: 1.1 },
  histColFile: { flex: 2 },
  histColImported: { flex: 1.4 },
  histColDate: { flex: 1.2 },
  histColStatus: { flex: 1.2 },
  histColActions: { flex: 0.6, justifyContent: 'flex-end' },
  histFileName: { fontWeight: '600', color: colors.text },
  histFileMeta: { color: colors.muted, marginTop: 1 },
  histStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  centerTitle: { marginTop: 8, textAlign: 'center' },
  centerBody: { textAlign: 'center', color: colors.muted, maxWidth: 420, lineHeight: 20 },
});
