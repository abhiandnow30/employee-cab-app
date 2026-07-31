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
  ActivityIndicator, IconButton,
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
import { colors } from '../../theme';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "2026-07-28" → 2026. The template and the parser both need a year, which the
// spreadsheet's "01-Jul" headers never carry.
function thisYear() {
  return new Date().getFullYear();
}

// A short "07 Jul 2026, 14:32" for the import history.
function formatWhen(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function RosterUploadScreen({ navigation }) {
  const { shiftPolicy, importRoster, subscribeImportHistory, routeOptions } = useApp();

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
  const [history, setHistory] = useState([]);
  const [showAllErrors, setShowAllErrors] = useState(false);
  // Closed by default. This grid is a diagnostic for "did you read my file
  // correctly?", not a spreadsheet viewer — Open in Excel is for reading the file.
  const [showSheet, setShowSheet] = useState(false);
  const [showAllSheetRows, setShowAllSheetRows] = useState(false);
  // The original bytes, kept so the file itself can be opened in Excel.
  const [fileBytes, setFileBytes] = useState(null);
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
    const res = await importRoster(report);
    setBusy(false);
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

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.col}>
        {/* ---- Step 1: choose a file ---- */}
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">Upload monthly shift roster</Text>
            <Text variant="bodySmall" style={styles.sub}>
              One row per employee, one column per day. Rides are generated from
              this — employees don't submit shifts.
            </Text>

            <View style={styles.yearRow}>
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
              <Text variant="bodySmall" style={styles.yearHint}>
                The month comes from the date headers in the file.
              </Text>
            </View>

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

            {/* Shift-code legend, straight from the live policy. */}
            <Divider style={styles.divider} />
            <Text variant="labelLarge" style={styles.legendLabel}>
              Shift codes
            </Text>
            <View style={styles.legend}>
              {ALL_SHIFT_CODES.map((code) => {
                const c = SHIFT_COLORS[code] || { bg: '#EEE', fg: colors.text };
                return (
                  <Chip
                    key={code}
                    compact
                    style={{ backgroundColor: c.bg }}
                    textStyle={{ color: c.fg, fontSize: 12 }}
                  >
                    {code} — {shiftSummary(shiftPolicy, code)}
                  </Chip>
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
          <Card mode="outlined" style={styles.card}>
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
          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <View style={styles.rowBetween}>
                <View style={styles.summaryHead}>
                  <Text variant="titleMedium">What the app read from your file</Text>
                  <Text variant="bodySmall" style={styles.sub}>
                    {report.total} row{report.total === 1 ? '' : 's'} ·{' '}
                    {report.dayKeys.length} day
                    {report.dayKeys.length === 1 ? '' : 's'} · {report.monthLabel} · to
                    read the spreadsheet itself use Open in Excel above
                  </Text>
                </View>
                <Button
                  mode="text"
                  icon={showSheet ? 'chevron-up' : 'chevron-down'}
                  onPress={() => setShowSheet((v) => !v)}
                >
                  {showSheet ? 'Hide' : 'Show'}
                </Button>
              </View>

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
          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium">
                {report.creatableCount + report.uncreatableCount} in this sheet have no
                account yet
              </Text>
              <Text variant="bodySmall" style={styles.sub}>
                Their shifts can't import until they exist as employees.
              </Text>

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
          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <View style={styles.rowBetween}>
                <View style={styles.summaryHead}>
                  <Text variant="titleMedium">Validation summary</Text>
                  <Text variant="bodySmall" style={styles.sub}>
                    {report.fileName} · {report.monthLabel}
                  </Text>
                </View>
                <IconButton icon="close" onPress={dismiss} />
              </View>

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
              <View style={styles.actions}>
                <Button mode="outlined" onPress={dismiss} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  icon="database-import"
                  onPress={doImport}
                  loading={busy}
                  disabled={busy || !report.canImport}
                  style={styles.importBtn}
                >
                  {!report.canImport
                    ? 'Nothing to import'
                    : report.errorCount
                    ? `Import ${report.valid} valid, skip ${report.errorCount}`
                    : `Import ${report.valid} employees`}
                </Button>
              </View>
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
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">Import history</Text>
            <Text variant="bodySmall" style={styles.sub}>
              Every roster that has actually been saved. If a month isn't here, it
              wasn't imported.
            </Text>
            {history.length === 0 ? (
              <Text variant="bodySmall" style={styles.historyEmpty}>
                No roster has been imported yet.
              </Text>
            ) : (
              history.map((h) => (
                <View key={h.id} style={styles.historyRow}>
                  <View style={styles.historyMain}>
                    <Text variant="bodyMedium" style={styles.historyMonth}>
                      {h.monthLabel || h.month}
                    </Text>
                    <Text variant="bodySmall" style={styles.sub}>
                      {h.fileName || 'file'} · {h.uploadedByName || 'admin'} ·{' '}
                      {formatWhen(h.uploadedAt)}
                    </Text>
                  </View>
                  <Chip
                    compact
                    style={{
                      backgroundColor: h.status === 'imported' ? '#E7F4E8' : '#FFF4E0',
                    }}
                    textStyle={{
                      color: h.status === 'imported' ? colors.success : '#B26A00',
                      fontSize: 12,
                    }}
                  >
                    {h.status === 'imported'
                      ? `${h.importedCount ?? h.valid} imported`
                      : h.status}
                  </Chip>
                </View>
              ))
            )}
          </Card.Content>
        </Card>
      </View>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={4000}>
        {snack}
      </Snackbar>
    </ScrollView>
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
  scroll: { padding: 12, alignItems: 'center' },
  col: { width: '100%', maxWidth: 900 },
  card: { marginBottom: 14 },
  sub: { color: colors.muted, marginTop: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  summaryHead: { flex: 1 },

  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  yearLabel: { color: colors.text },
  yearPicker: { width: 120 },
  yearHint: { color: colors.muted, flex: 1, minWidth: 180 },

  drop: {
    marginTop: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 28,
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
    borderRadius: 8,
    padding: 10,
  },
  errorBoxText: { color: colors.danger, flex: 1, lineHeight: 18 },
  blockedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    backgroundColor: '#FEF3F3',
    borderRadius: 8,
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
  sheetScroll: { marginTop: 12, borderWidth: 1, borderColor: '#E4E8EF', borderRadius: 8 },
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
    borderRadius: 8,
    padding: 10,
  },
  fileErrorText: { color: colors.danger, lineHeight: 18 },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 12,
    backgroundColor: '#FFF6E5',
    borderRadius: 8,
    padding: 10,
  },
  warnText: { color: '#B26A00', flex: 1, lineHeight: 18 },
  warnStrong: { color: '#B26A00', fontWeight: '700' },

  colRow: { flex: 0.5 },
  colName: { flex: 1.4 },
  colErr: { flex: 3 },
  errText: { color: colors.danger },
  allGood: { color: colors.success, marginTop: 12, fontWeight: '600' },

  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  importBtn: { flex: 1, minWidth: 220 },

  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 10,
  },
  historyMain: { flex: 1 },
  historyMonth: { fontWeight: '600' },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  centerTitle: { marginTop: 8, textAlign: 'center' },
  centerBody: { textAlign: 'center', color: colors.muted, maxWidth: 420, lineHeight: 20 },
});
