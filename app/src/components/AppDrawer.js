// ---------------------------------------------------------------------------
// AppDrawer — the slide-in menu opened by the ☰ button in the header.
// Matches the reference: a blue "Emp Id" strip with a close (✕), then a list
// of navigation items. Rendered in a Portal so it floats above everything.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { Portal, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Each menu item → which screen it opens.
export const DRAWER_ITEMS = [
  { label: 'Home', icon: 'home', screen: 'EmployeeHome' },
  { label: 'Profile', icon: 'account', screen: 'Profile' },
  { label: 'View Roster', icon: 'calendar-search', screen: 'MyRides' },
  { label: 'Roster History', icon: 'history', screen: 'RosterHistory' },
  { label: 'Trip Cancel', icon: 'car-off', screen: 'TripCancel' },
  { label: 'Track Cab', icon: 'map-marker-radius', screen: 'TrackCab' },
  { label: 'Driver (demo)', icon: 'steering', screen: 'DriverSim' },
  { label: 'Driver (live GPS)', icon: 'crosshairs-gps', screen: 'DriverLive' },
  { label: 'Feedback', icon: 'message-text', screen: 'Feedback' },
  { label: 'Rate Us', icon: 'star', screen: 'RateUs' },
];

export default function AppDrawer({ visible, onClose, email, onNavigate }) {
  if (!visible) return null;

  return (
    <Portal>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          {/* Email strip + close */}
          <View style={styles.empBar}>
            <MaterialCommunityIcons name="account-circle" size={22} color="#FFFFFF" />
            <Text style={styles.empText} numberOfLines={1}>
              {email || '—'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* Menu items */}
          <ScrollView>
            {DRAWER_ITEMS.map((item) => (
              <Pressable
                key={item.label}
                style={styles.item}
                onPress={() => onNavigate(item)}
                android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
              >
                <MaterialCommunityIcons
                  name={item.icon}
                  size={20}
                  color="#FFFFFF"
                  style={styles.itemIcon}
                />
                <Text style={styles.itemText}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Tapping outside the panel closes it */}
        <Pressable style={styles.backdrop} onPress={onClose} />
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  panel: {
    width: '78%',
    maxWidth: 320,
    height: '100%',
    backgroundColor: '#0D47A1', // dark blue
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  empBar: {
    backgroundColor: '#1E88E5', // lighter blue strip
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingTop: 40, // clears the status bar
  },
  empText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14, flex: 1, marginHorizontal: 10 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  itemIcon: { width: 30 },
  itemText: { color: '#FFFFFF', fontSize: 16 },
});
