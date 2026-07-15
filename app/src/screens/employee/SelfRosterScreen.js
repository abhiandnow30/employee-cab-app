// ---------------------------------------------------------------------------
// SELF ROSTER SCREEN
// Book cabs for a whole week at once.
//   • Top bar: ◀ previous week | FROM ... TO ... | next week ▶
//   • Table: 7 rows (Mon–Sun), columns = Date | Pickup | Drop
//     Pickup / Drop are dropdowns of shift times ("—" = no ride that leg).
//   • "Save roster" turns every chosen time into a booking (status "Booked").
// ---------------------------------------------------------------------------

import React, { useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Text, IconButton, Button, Divider, HelperText } from 'react-native-paper';
import Dropdown from '../../components/Dropdown';
import { useApp } from '../../context/AppContext';
import { PICKUP_TIMES, DROP_TIMES, NONE, WEEKDAYS, SOURCE } from '../../data/mockData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monday of the week that contains date `d`.
function startOfWeek(d) {
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(date, n) {
  const copy = new Date(date);
  copy.setDate(date.getDate() + n);
  return copy;
}

// "2026-07-13"  — stable key + what a booking stores.
function toKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${dd}`;
}

// "13-Jul"  — shown to the user.
function toDisplay(date) {
  return `${String(date.getDate()).padStart(2, '0')}-${MONTHS[date.getMonth()]}`;
}

export default function SelfRosterScreen({ navigation }) {
  const { addBookings } = useApp();

  // Which week we're viewing. 0 = this week, -1 = last week, +1 = next week.
  const [weekOffset, setWeekOffset] = useState(0);
  // Chosen times per date: { '2026-07-13': { pickup: '09:00 AM', drop: '—' }, ... }
  const [selections, setSelections] = useState({});
  const [error, setError] = useState('');

  // The 7 days of the currently viewed week.
  const days = useMemo(() => {
    const base = startOfWeek(addDays(new Date(), weekOffset * 7));
    return WEEKDAYS.map((label, i) => {
      const date = addDays(base, i);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      return {
        label,
        date,
        key: toKey(date),
        display: toDisplay(date),
        isWeekend: dow === 0 || dow === 6,
      };
    });
  }, [weekOffset]);

  const rangeFrom = days[0].display;
  const rangeTo = days[6].display;

  function getSel(key) {
    return selections[key] || { pickup: NONE, drop: NONE };
  }

  function setLeg(key, leg, value) {
    setSelections((prev) => ({
      ...prev,
      [key]: { ...getSel(key), [leg]: value },
    }));
  }

  function handleSave() {
    setError('');
    const entries = [];
    days.forEach((d) => {
      const sel = getSel(d.key);
      if (sel.pickup !== NONE) {
        entries.push({
          source: SOURCE.ROSTER,
          date: d.key,
          shift: sel.pickup,
          direction: 'Home → Office',
          pickup: 'Home',
        });
      }
      if (sel.drop !== NONE) {
        entries.push({
          source: SOURCE.ROSTER,
          date: d.key,
          shift: sel.drop,
          direction: 'Office → Home',
          pickup: 'Office',
        });
      }
    });

    if (entries.length === 0) {
      setError('Please pick at least one Pickup or Drop time.');
      return;
    }

    addBookings(entries);
    setSelections({}); // clear for the next round
    // Back to the home page — the new rides show under "My ORS".
    navigation.navigate('EmployeeHome');
  }

  return (
    <View style={styles.container}>
      {/* Week navigator */}
      <View style={styles.weekBar}>
        <IconButton
          icon="chevron-left"
          mode="contained-tonal"
          onPress={() => setWeekOffset((w) => w - 1)}
        />
        <View style={styles.rangeBox}>
          <Text variant="labelSmall" style={styles.rangeLabel}>
            FROM — TO
          </Text>
          <Text variant="titleMedium">
            {rangeFrom} → {rangeTo}
          </Text>
        </View>
        <IconButton
          icon="chevron-right"
          mode="contained-tonal"
          onPress={() => setWeekOffset((w) => w + 1)}
        />
      </View>

      {/* Table header */}
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.cell, styles.colDate, styles.headerText]}>Date</Text>
        <Text style={[styles.cell, styles.colLeg, styles.headerText]}>Pickup</Text>
        <Text style={[styles.cell, styles.colLeg, styles.headerText]}>Drop</Text>
      </View>
      <Divider />

      {/* Table rows */}
      <ScrollView contentContainerStyle={styles.scroll}>
        {days.map((d) => {
          const sel = getSel(d.key);
          return (
            <View key={d.key} style={[styles.row, d.isWeekend && styles.weekendRow]}>
              <View style={[styles.cell, styles.colDate]}>
                <Text variant="titleSmall">{d.label}</Text>
                <Text variant="bodySmall" style={styles.dateSub}>
                  {d.display}
                </Text>
              </View>
              <View style={[styles.cell, styles.colLeg]}>
                <Dropdown
                  value={sel.pickup}
                  options={PICKUP_TIMES}
                  onSelect={(v) => setLeg(d.key, 'pickup', v)}
                />
              </View>
              <View style={[styles.cell, styles.colLeg]}>
                <Dropdown
                  value={sel.drop}
                  options={DROP_TIMES}
                  onSelect={(v) => setLeg(d.key, 'drop', v)}
                />
              </View>
            </View>
          );
        })}

        {error ? (
          <HelperText type="error" visible={true}>
            {error}
          </HelperText>
        ) : null}

        {/* Back + Raise Request */}
        <View style={styles.buttonRow}>
          <Button mode="outlined" onPress={() => navigation.goBack()} style={styles.actionBtn}>
            Back
          </Button>
          <Button mode="contained" onPress={handleSave} style={styles.actionBtn}>
            Raise Request
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rangeBox: { alignItems: 'center' },
  rangeLabel: { opacity: 0.6, letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  weekendRow: { backgroundColor: '#FDE0E0', borderRadius: 6 }, // Sat/Sun highlight
  headerRow: { paddingVertical: 4 },
  headerText: { fontWeight: 'bold', opacity: 0.7 },
  cell: { paddingHorizontal: 4, justifyContent: 'center' },
  colDate: { flex: 1 },
  colLeg: { flex: 1.4, alignItems: 'flex-start' },
  dateSub: { opacity: 0.6 },
  scroll: { paddingBottom: 24 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  actionBtn: { flex: 1, paddingVertical: 4 },
});
