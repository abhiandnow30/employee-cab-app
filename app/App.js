// ---------------------------------------------------------------------------
// App.js — the ROOT of the app. It wires together three things:
//   1. PaperProvider  → gives every screen the React Native Paper theme/components
//   2. AppProvider    → shared state (who's logged in, bookings, cabs)
//   3. Navigation     → decides which screens to show based on the logged-in user
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, Appbar, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { theme, colors } from './src/theme';
import { AppProvider, useApp } from './src/context/AppContext';
import AppDrawer from './src/components/AppDrawer';

import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import EmployeeHomeScreen from './src/screens/employee/EmployeeHomeScreen';
import SelfRosterScreen from './src/screens/employee/SelfRosterScreen';
import FeedbackScreen from './src/screens/employee/FeedbackScreen';
import MyRidesScreen from './src/screens/employee/MyRidesScreen';
import BookCabScreen from './src/screens/employee/BookCabScreen';
import RosterHistoryScreen from './src/screens/employee/RosterHistoryScreen';
import TripCancelScreen from './src/screens/employee/TripCancelScreen';
import TrackCabScreen from './src/screens/employee/TrackCabScreen';
import RateUsScreen from './src/screens/employee/RateUsScreen';
import ProfileScreen from './src/screens/employee/ProfileScreen';
import BookingsScreen from './src/screens/admin/BookingsScreen';
import AssignCabScreen from './src/screens/admin/AssignCabScreen';
import ManageDriversScreen from './src/screens/admin/ManageDriversScreen';
import ManageCabsScreen from './src/screens/admin/ManageCabsScreen';
import DriverHomeScreen from './src/screens/driver/DriverHomeScreen';
import DriverShareLocationScreen from './src/screens/driver/DriverShareLocationScreen';
import DriverSimScreen from './src/screens/driver/DriverSimScreen';

const Stack = createNativeStackNavigator();

const BRAND = 'Cab Service';

// URL-based routing: each screen gets its own web address so the browser's
// back/forward buttons work and pages are refresh-safe. (On the phone this is
// harmless — navigation still works the same.)
const linking = {
  prefixes: [
    typeof window !== 'undefined' && window.location ? window.location.origin : 'cabservice://',
  ],
  config: {
    screens: {
      Login: '',
      SignUp: 'signup',
      // Employee
      EmployeeHome: 'home',
      SelfRoster: 'self-roster',
      BookCab: 'adhoc',
      Feedback: 'feedback',
      MyRides: 'my-rides',
      RosterHistory: 'roster-history',
      TripCancel: 'trip-cancel',
      TrackCab: 'track',
      RateUs: 'rate-us',
      Profile: 'profile',
      // Admin
      Bookings: 'bookings',
      AssignCab: 'assign-cab',
      ManageDrivers: 'drivers',
      ManageCabs: 'cabs',
      // Driver
      DriverHome: 'driver',
      DriverShareLocation: 'driver/share',
      DriverSim: 'driver/simulate',
    },
  },
};

// A custom header that shows the screen title and a Log out action on the right.
// We use Paper's Appbar so the header matches the app's look.
function AppHeader({ navigation, route, options, back }) {
  const { logout, currentUser } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isEmployee = currentUser?.role === 'employee';
  // Which screen "home" means for this role.
  const homeRoute =
    currentUser?.role === 'admin'
      ? 'Bookings'
      : currentUser?.role === 'driver'
      ? 'DriverHome'
      : 'EmployeeHome';
  // After login the brand name stays fixed; before login use the screen title.
  const title = currentUser ? BRAND : options.title ?? route.name;

  // Go back if there's history; otherwise fall back to the role's home screen
  // (so the arrow is never a dead end).
  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate(homeRoute);
  };

  return (
    <>
      <Appbar.Header style={styles.appbar} dark>
        {isEmployee ? (
          // Employees get the ☰ menu on the left (opens the drawer).
          <Appbar.Action icon="menu" color="#FFFFFF" onPress={() => setDrawerOpen(true)} />
        ) : back ? (
          <Appbar.BackAction color="#FFFFFF" onPress={goBack} />
        ) : null}
        <Appbar.Content
          title={title}
          color="#FFFFFF"
          titleStyle={styles.appbarTitle}
          style={styles.appbarContent}
          // Tapping the brand title returns to the role's home screen.
          onPress={currentUser ? () => navigation.navigate(homeRoute) : undefined}
        />
        {/* Log out — shown for every role (employee, admin, driver). */}
        {currentUser ? (
          <Appbar.Action icon="logout" color="#FFFFFF" onPress={logout} />
        ) : null}
      </Appbar.Header>

      <AppDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        email={currentUser?.email}
        onNavigate={(item) => {
          setDrawerOpen(false);
          navigation.navigate(item.screen, item.params);
        }}
      />
    </>
  );
}

// Chooses which set of screens to show. Reads the current user from context.
function RootNavigator() {
  const { currentUser, authReady } = useApp();

  // While Firebase checks for an existing session, show a spinner instead of
  // briefly flashing the login screen.
  if (!authReady) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        screenOptions={{
          // Use our Paper-based header everywhere EXCEPT login (set below).
          header: (props) => <AppHeader {...props} />,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!currentUser ? (
          // ---- Logged out: email/password → OTP ----
          <>
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="SignUp"
              component={SignUpScreen}
              options={{ headerShown: false }}
            />
          </>
        ) : currentUser.role === 'employee' ? (
          // ---- Employee screens ----
          <>
            <Stack.Screen
              name="EmployeeHome"
              component={EmployeeHomeScreen}
              options={{ title: 'Home' }}
            />
            <Stack.Screen
              name="SelfRoster"
              component={SelfRosterScreen}
              options={{ title: 'Weekly Schedule' }}
            />
            <Stack.Screen
              name="BookCab"
              component={BookCabScreen}
              options={{ title: 'Book a Ride' }}
            />
            <Stack.Screen
              name="Feedback"
              component={FeedbackScreen}
              options={{ title: 'Feedback' }}
            />
            <Stack.Screen
              name="MyRides"
              component={MyRidesScreen}
              options={{ title: 'My Rides' }}
            />
            <Stack.Screen
              name="RosterHistory"
              component={RosterHistoryScreen}
              options={{ title: 'Ride History' }}
            />
            <Stack.Screen
              name="TripCancel"
              component={TripCancelScreen}
              options={{ title: 'Trip Cancel' }}
            />
            <Stack.Screen
              name="TrackCab"
              component={TrackCabScreen}
              options={{ title: 'Track Cab' }}
            />
            <Stack.Screen
              name="RateUs"
              component={RateUsScreen}
              options={{ title: 'Rate Us' }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ title: 'Profile' }}
            />
          </>
        ) : currentUser.role === 'driver' ? (
          // ---- Driver screens ----
          <>
            <Stack.Screen
              name="DriverHome"
              component={DriverHomeScreen}
              options={{ title: 'My Trips' }}
            />
            <Stack.Screen
              name="DriverShareLocation"
              component={DriverShareLocationScreen}
              options={{ title: 'Share Location' }}
            />
            <Stack.Screen
              name="DriverSim"
              component={DriverSimScreen}
              options={{ title: 'Simulate (demo)' }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ title: 'Profile' }}
            />
          </>
        ) : (
          // ---- Admin screens ----
          <>
            <Stack.Screen
              name="Bookings"
              component={BookingsScreen}
              options={{ title: 'All Bookings' }}
            />
            <Stack.Screen
              name="AssignCab"
              component={AssignCabScreen}
              options={{ title: 'Assign Cab' }}
            />
            <Stack.Screen
              name="ManageDrivers"
              component={ManageDriversScreen}
              options={{ title: 'Manage Drivers' }}
            />
            <Stack.Screen
              name="ManageCabs"
              component={ManageCabsScreen}
              options={{ title: 'Manage Cabs' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider
        theme={theme}
        settings={{
          // Tells Paper which icon set to draw (Material Community Icons via Expo).
          // Without this, Paper icons (email, lock, +, etc.) render blank.
          icon: (props) => <MaterialCommunityIcons {...props} />,
        }}
      >
        <AppProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AppProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appbar: { backgroundColor: colors.primary },
  appbarContent: { alignItems: 'center' },
  appbarTitle: { fontWeight: 'bold', letterSpacing: 0.3, textAlign: 'center' },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
