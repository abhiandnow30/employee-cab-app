// ---------------------------------------------------------------------------
// App.js — the ROOT of the app. It wires together three things:
//   1. PaperProvider  → gives every screen the React Native Paper theme/components
//   2. AppProvider    → shared state (who's logged in, bookings, cabs)
//   3. Navigation     → decides which screens to show based on the logged-in user
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Image, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, Appbar, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { theme, colors } from './src/theme';
import { AppProvider, useApp } from './src/context/AppContext';
import AppDrawer, { DRAWER_ITEMS, ADMIN_DRAWER_ITEMS } from './src/components/AppDrawer';
import { companyLogo } from './src/branding';

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
import ContactUsScreen from './src/screens/employee/ContactUsScreen';
import ProfileScreen from './src/screens/employee/ProfileScreen';
import BookingsScreen from './src/screens/admin/BookingsScreen';
import AssignCabScreen from './src/screens/admin/AssignCabScreen';
import ManageDriversScreen from './src/screens/admin/ManageDriversScreen';
import ManageCabsScreen from './src/screens/admin/ManageCabsScreen';
import ShiftRosterScreen from './src/screens/admin/ShiftRosterScreen';
import ManageTimingsScreen from './src/screens/admin/ManageTimingsScreen';
import CancelledRidesScreen from './src/screens/admin/CancelledRidesScreen';
import NoShowsScreen from './src/screens/admin/NoShowsScreen';
import TrackCabsScreen from './src/screens/admin/TrackCabsScreen';
import FeedbackInboxScreen from './src/screens/admin/FeedbackInboxScreen';
import EmployeeManagementScreen from './src/screens/admin/EmployeeManagementScreen';
import AddressChangeRequestsScreen from './src/screens/admin/AddressChangeRequestsScreen';
import DriverHomeScreen from './src/screens/driver/DriverHomeScreen';
import DriverShareLocationScreen from './src/screens/driver/DriverShareLocationScreen';

const Stack = createNativeStackNavigator();

const BRAND = 'Cab Service';

// At/above this width we show a permanent left sidebar (web / tablets) instead
// of the slide-in drawer.
const WIDE_BREAKPOINT = 900;

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
      ContactUs: 'contact-us',
      Profile: 'profile',
      // Admin
      Bookings: 'bookings',
      AssignCab: 'assign-cab',
      ManageDrivers: 'drivers',
      ManageCabs: 'cabs',
      ShiftRoster: 'shift-roster',
      ManageTimings: 'manage-timings',
      CancelledRides: 'cancelled-rides',
      NoShows: 'no-shows',
      TrackCabs: 'track-cabs',
      FeedbackInbox: 'feedback-inbox',
      EmployeeManagement: 'employees',
      AddressRequests: 'address-requests',
      // Driver
      DriverHome: 'driver',
      DriverShareLocation: 'driver/share',
    },
  },
};

// A custom header that shows the screen title and a Log out action on the right.
// We use Paper's Appbar so the header matches the app's look.
function AppHeader({ navigation, route, options, back }) {
  const { logout, currentUser, changePassword } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { width } = useWindowDimensions();

  const isEmployee = currentUser?.role === 'employee';
  const isAdmin = currentUser?.role === 'admin';
  // Employees and admins get a navigation drawer. On wide screens it's a
  // permanent left sidebar (rendered in RootNavigator), so the header's ☰ menu
  // button isn't needed there.
  const hasDrawer = isEmployee || isAdmin;
  const drawerItems = isAdmin ? ADMIN_DRAWER_ITEMS : DRAWER_ITEMS;
  const hasPermanentSidebar = hasDrawer && width >= WIDE_BREAKPOINT;
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
        {hasDrawer && !hasPermanentSidebar ? (
          // Employees & admins get the ☰ menu on the left (opens the drawer).
          <Appbar.Action icon="menu" color="#FFFFFF" onPress={() => setDrawerOpen(true)} />
        ) : !hasPermanentSidebar && back ? (
          <Appbar.BackAction color="#FFFFFF" onPress={goBack} />
        ) : null}
        {/* Company logo on a small white chip — hidden when the permanent
            sidebar already shows the brand, to avoid duplicating it. */}
        {currentUser && !hasPermanentSidebar ? (
          <View style={styles.headerLogoChip}>
            <Image source={companyLogo} style={styles.headerLogo} resizeMode="contain" />
          </View>
        ) : null}
        <Appbar.Content
          title={title}
          color="#FFFFFF"
          titleStyle={styles.appbarTitle}
          style={styles.appbarContent}
          // Tapping the brand title returns to the role's home screen.
          onPress={currentUser ? () => navigation.navigate(homeRoute) : undefined}
        />
        {/* Contact us — employees only. */}
        {isEmployee ? (
          <Appbar.Action
            icon="phone"
            color="#FFFFFF"
            onPress={() => navigation.navigate('ContactUs')}
          />
        ) : null}
        {/* Log out — shown for every role (employee, admin, driver). */}
        {currentUser ? (
          <Appbar.Action icon="logout" color="#FFFFFF" onPress={logout} />
        ) : null}
      </Appbar.Header>

      <AppDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={currentUser}
        items={drawerItems}
        onChangePassword={changePassword}
        onLogout={isAdmin ? logout : undefined}
        activeScreen={route.name}
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
  const { currentUser, authReady, changePassword, logout } = useApp();
  const { width } = useWindowDimensions();
  const navRef = useNavigationContainerRef();
  const [activeRoute, setActiveRoute] = useState(null);

  // Employees and admins on a wide screen get a permanent left sidebar.
  const isAdmin = currentUser?.role === 'admin';
  const showSidebar =
    (currentUser?.role === 'employee' || isAdmin) && width >= WIDE_BREAKPOINT;
  const sidebarItems = isAdmin ? ADMIN_DRAWER_ITEMS : DRAWER_ITEMS;

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
    <NavigationContainer
      ref={navRef}
      linking={linking}
      onReady={() => setActiveRoute(navRef.getCurrentRoute()?.name)}
      onStateChange={() => setActiveRoute(navRef.getCurrentRoute()?.name)}
    >
      <View style={styles.appRow}>
        {showSidebar ? (
          <AppDrawer
            permanent
            user={currentUser}
            items={sidebarItems}
            onChangePassword={changePassword}
            onLogout={isAdmin ? logout : undefined}
            activeScreen={activeRoute}
            onNavigate={(item) => navRef.navigate(item.screen, item.params)}
          />
        ) : null}
        <View style={styles.appContent}>
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
              name="ContactUs"
              component={ContactUsScreen}
              options={{ title: 'Contact Us' }}
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
            <Stack.Screen
              name="ShiftRoster"
              component={ShiftRosterScreen}
              options={{ title: 'Shift Roster' }}
            />
            <Stack.Screen
              name="ManageTimings"
              component={ManageTimingsScreen}
              options={{ title: 'Manage Timings' }}
            />
            <Stack.Screen
              name="CancelledRides"
              component={CancelledRidesScreen}
              options={{ title: 'Cancelled Rides' }}
            />
            <Stack.Screen
              name="NoShows"
              component={NoShowsScreen}
              options={{ title: 'No-Shows' }}
            />
            <Stack.Screen
              name="TrackCabs"
              component={TrackCabsScreen}
              options={{ title: 'Track Cabs' }}
            />
            <Stack.Screen
              name="FeedbackInbox"
              component={FeedbackInboxScreen}
              options={{ title: 'Feedback & Ratings' }}
            />
            <Stack.Screen
              name="EmployeeManagement"
              component={EmployeeManagementScreen}
              options={{ title: 'Employee Management' }}
            />
            <Stack.Screen
              name="AddressRequests"
              component={AddressChangeRequestsScreen}
              options={{ title: 'Address Change Requests' }}
            />
          </>
          )}
          </Stack.Navigator>
        </View>
      </View>
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
  appRow: { flex: 1, flexDirection: 'row' },
  appContent: { flex: 1 },
  appbar: { backgroundColor: colors.primary },
  headerLogoChip: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginRight: 4,
  },
  headerLogo: { width: 30, height: 30 },
  appbarContent: { alignItems: 'center' },
  appbarTitle: { fontWeight: 'bold', letterSpacing: 0.3, textAlign: 'center' },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
