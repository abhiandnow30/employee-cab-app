// ---------------------------------------------------------------------------
// FLEET & DRIVERS — a tab shell over the two existing screens.
//
// Fleet (vehicles) and Drivers (accounts) used to be separate sidebar items.
// They're closely related — a driver is only useful once linked to a cab — so
// they now share one menu entry with a tab switch. Nothing about either screen
// changed: this just renders one or the other underneath the tabs.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import ManageCabsScreen from './ManageCabsScreen';
import ManageDriversScreen from './ManageDriversScreen';

export default function ManageFleetScreen() {
  const [tab, setTab] = useState('fleet');

  return (
    <View style={styles.root}>
      <View style={styles.tabsRow}>
        <SegmentedButtons
          value={tab}
          onValueChange={setTab}
          buttons={[
            { value: 'fleet', label: 'Cabs', icon: 'car-multiple' },
            { value: 'drivers', label: 'Drivers', icon: 'account-tie-hat' },
          ]}
        />
      </View>
      <View style={styles.content}>
        {tab === 'fleet' ? <ManageCabsScreen /> : <ManageDriversScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabsRow: { padding: 16, paddingBottom: 8 },
  content: { flex: 1 },
});
