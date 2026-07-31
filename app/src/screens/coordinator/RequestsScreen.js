// ---------------------------------------------------------------------------
// REQUESTS  (coordinator) — a tab shell over two existing screens.
//
// Change Requests (leave/absent/cancel-one/shift-changed, needing a decision)
// and Cancelled Rides (the log of what's already been cancelled) both land on
// the coordinator's desk, so they share one menu entry with a tab switch.
// Neither screen's internals changed — this just renders one or the other.
//
// Admin doesn't get this screen: change requests route to the coordinator only
// (see CLAUDE.md — "nothing routes to HR any more"). Admin keeps its own
// standalone Cancelled Rides entry.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import ChangeRequestQueueScreen from './ChangeRequestQueueScreen';
import CancelledRidesScreen from '../admin/CancelledRidesScreen';

export default function RequestsScreen() {
  const [tab, setTab] = useState('change');

  return (
    <View style={styles.root}>
      <View style={styles.tabsRow}>
        <SegmentedButtons
          value={tab}
          onValueChange={setTab}
          buttons={[
            { value: 'change', label: 'Change Requests', icon: 'clipboard-list-outline' },
            { value: 'cancelled', label: 'Cancelled Rides', icon: 'car-off' },
          ]}
        />
      </View>
      <View style={styles.content}>
        {tab === 'change' ? <ChangeRequestQueueScreen /> : <CancelledRidesScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabsRow: { padding: 16, paddingBottom: 8 },
  content: { flex: 1 },
});
