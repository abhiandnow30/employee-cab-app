// ---------------------------------------------------------------------------
// App.js — the ROOT of the app. It wires together three things:
//   1. PaperProvider  → gives every screen the React Native Paper theme/components
//   2. AppProvider    → shared state (who's logged in, bookings, cabs)
//   3. Navigation     → decides which screens to show based on the logged-in user
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Image, Linking, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  PaperProvider, Appbar, ActivityIndicator, Text,
  Portal, Dialog, TextInput, Button, HelperText, Snackbar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { theme, colors } from './src/theme';
import { AppProvider, useApp } from './src/context/AppContext';
import AppDrawer, {
  DRAWER_ITEMS, ADMIN_DRAWER_ITEMS, DRIVER_DRAWER_ITEMS, COORDINATOR_DRAWER_ITEMS,
} from './src/components/AppDrawer';
import ErrorBoundary from './src/components/ErrorBoundary';
import { companyLogo, SUPPORT_HELPLINE } from './src/branding';

import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import EmployeeHomeScreen from './src/screens/employee/EmployeeHomeScreen';
import FeedbackScreen from './src/screens/employee/FeedbackScreen';
import MyRidesScreen from './src/screens/employee/MyRidesScreen';
import RosterHistoryScreen from './src/screens/employee/RosterHistoryScreen';
import TrackCabScreen from './src/screens/employee/TrackCabScreen';
import RateUsScreen from './src/screens/employee/RateUsScreen';
import ProfileScreen from './src/screens/employee/ProfileScreen';
import BookingsScreen from './src/screens/admin/BookingsScreen';
import ManageDriversScreen from './src/screens/admin/ManageDriversScreen';
import ManageCabsScreen from './src/screens/admin/ManageCabsScreen';
import ManageTimingsScreen from './src/screens/admin/ManageTimingsScreen';
import CancelledRidesScreen from './src/screens/admin/CancelledRidesScreen';
import NoShowsScreen from './src/screens/admin/NoShowsScreen';
import TrackCabsScreen from './src/screens/admin/TrackCabsScreen';
import FeedbackInboxScreen from './src/screens/admin/FeedbackInboxScreen';
import EmployeeManagementScreen from './src/screens/admin/EmployeeManagementScreen';
import AddressChangeRequestsScreen from './src/screens/admin/AddressChangeRequestsScreen';
import MessagesScreen from './src/screens/admin/MessagesScreen';
import DriverHomeScreen from './src/screens/driver/DriverHomeScreen';
import DriverShareLocationScreen from './src/screens/driver/DriverShareLocationScreen';
import MyScheduleScreen from './src/screens/employee/MyScheduleScreen';
import RosterUploadScreen from './src/screens/admin/RosterUploadScreen';
import ShiftPolicyScreen from './src/screens/admin/ShiftPolicyScreen';
import CoordinatorDashboardScreen from './src/screens/coordinator/CoordinatorDashboardScreen';
import ChangeRequestQueueScreen from './src/screens/coordinator/ChangeRequestQueueScreen';
import ChangeRequestScreen from './src/screens/employee/ChangeRequestScreen';
import NotificationsScreen from './src/screens/employee/NotificationsScreen';

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
      MySchedule: 'my-schedule',
      ChangeRequest: 'change-request',
      Notifications: 'notifications',
      Feedback: 'feedback',
      MyRides: 'my-rides',
      RosterHistory: 'roster-history',
      TrackCab: 'track',
      RateUs: 'rate-us',
      Profile: 'profile',
      // HR / Admin
      RosterUpload: 'roster-upload',
      ShiftPolicy: 'shift-policy',
      Bookings: 'bookings',
      ManageDrivers: 'drivers',
      ManageCabs: 'cabs',
      ManageTimings: 'manage-timings',
      CancelledRides: 'cancelled-rides',
      NoShows: 'no-shows',
      TrackCabs: 'track-cabs',
      FeedbackInbox: 'feedback-inbox',
      EmployeeManagement: 'employees',
      AddressRequests: 'address-requests',
      Messages: 'messages',
      // Coordinator
      CoordinatorHome: 'coordinator',
      ChangeRequests: 'change-requests',
      // Driver
      DriverHome: 'driver',
      DriverShareLocation: 'driver/share',
    },
  },
};

// A custom header that shows the screen title and a Log out action on the right.
// We use Paper's Appbar so the header matches the app's look.
function AppHeader({ navigation, route, options, back }) {
  const {
    logout, currentUser, changePassword, sendMessage, unreadCount, menuCounts,
  } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { width } = useWindowDimensions();

  // Message-the-transport-desk popup (employees).
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgErr, setMsgErr] = useState('');
  const [msgSent, setMsgSent] = useState(false);

  // Tapping the phone icon calls the transport desk directly.
  const callDesk = () => {
    Linking.openURL('tel:' + SUPPORT_HELPLINE.replace(/\s/g, '')).catch(() => {});
  };
  const openMsg = () => {
    setMsgErr('');
    setMsgText('');
    setMsgOpen(true);
  };
  async function submitMsg() {
    setMsgErr('');
    if (!msgText.trim()) {
      setMsgErr('Please type your message.');
      return;
    }
    setMsgBusy(true);
    const res = await sendMessage(msgText);
    setMsgBusy(false);
    if (res?.ok) {
      setMsgText('');
      setMsgOpen(false);
      setMsgSent(true);
    } else {
      setMsgErr(res?.message || 'Could not send. Try again.');
    }
  }

  const isEmployee = currentUser?.role === 'employee';
  const isAdmin = currentUser?.role === 'admin';
  const isCoordinator = currentUser?.role === 'coordinator';
  const isDriver = currentUser?.role === 'driver';
  // Every signed-in role gets a navigation drawer. On wide screens it's a
  // permanent left sidebar (rendered in RootNavigator), so the header's ☰ menu
  // button isn't needed there. (Drivers had no drawer at all, which left their
  // Profile screen unreachable.)
  const hasDrawer = !!currentUser;
  const drawerItems = isAdmin
    ? ADMIN_DRAWER_ITEMS
    : isCoordinator
    ? COORDINATOR_DRAWER_ITEMS
    : isDriver
    ? DRIVER_DRAWER_ITEMS
    : DRAWER_ITEMS;
  const hasPermanentSidebar = hasDrawer && width >= WIDE_BREAKPOINT;
  // Which screen "home" means for this role.
  const homeRoute =
    currentUser?.role === 'admin'
      ? 'RosterUpload'
      : currentUser?.role === 'coordinator'
      ? 'CoordinatorHome'
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
        {/* Notifications, message + call the transport desk — employees only. */}
        {isEmployee ? (
          <>
            {/* The badge is the whole point of in-app notifications: an employee
                shouldn't have to go looking to find out a cab was assigned. */}
            <View style={styles.bellWrap}>
              <Appbar.Action
                icon="bell"
                color="#FFFFFF"
                onPress={() => navigation.navigate('Notifications')}
                accessibilityLabel={
                  unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'
                }
              />
              {unreadCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              ) : null}
            </View>
            <Appbar.Action icon="message-text" color="#FFFFFF" onPress={openMsg} />
            <Appbar.Action icon="phone" color="#FFFFFF" onPress={callDesk} />
          </>
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
        onLogout={isAdmin || isCoordinator ? logout : undefined}
        activeScreen={route.name}
        counts={menuCounts}
        onNavigate={(item) => {
          setDrawerOpen(false);
          navigation.navigate(item.screen, item.params);
        }}
      />

      {/* Message the transport desk (popup) */}
      <Portal>
        <Dialog visible={msgOpen} onDismiss={() => !msgBusy && setMsgOpen(false)} style={styles.msgDialog}>
          <Dialog.Title>Message transport desk</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Your message"
              value={msgText}
              onChangeText={setMsgText}
              mode="outlined"
              multiline
              numberOfLines={4}
              placeholder="e.g. Please change my pickup time for tomorrow."
            />
            {msgErr ? <HelperText type="error" visible>{msgErr}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setMsgOpen(false)} disabled={msgBusy}>Cancel</Button>
            <Button mode="contained" icon="send" onPress={submitMsg} loading={msgBusy} disabled={msgBusy}>
              Send
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={msgSent} onDismiss={() => setMsgSent(false)} duration={2500}>
        Message sent to the transport desk.
      </Snackbar>
    </>
  );
}

// Chooses which set of screens to show. Reads the current user from context.
// Signed in, but this account has no profile in Firestore — it was never
// provisioned, or an admin removed it. Previously the app quietly minted a fresh
// employee profile here, which handed a removed employee a working account
// again. Now the session stops with an explanation.
function UnprovisionedScreen() {
  const { logout, currentUser } = useApp();
  return (
    <View style={styles.splash}>
      <View style={styles.lockedCard}>
        <MaterialCommunityIcons name="account-lock-outline" size={56} color={colors.muted} />
        <Text variant="headlineSmall" style={styles.lockedTitle}>
          Account not set up
        </Text>
        <Text variant="bodyMedium" style={styles.lockedBody}>
          This login isn't linked to an employee record{currentUser?.email ? '' : ''}, so
          there's nothing to show yet. Ask the transport desk to add you, then sign
          in again.
        </Text>
        <Text variant="bodySmall" style={styles.lockedHelp}>
          Transport desk: {SUPPORT_HELPLINE}
        </Text>
        <Button mode="contained" icon="logout" onPress={logout} style={styles.lockedBtn}>
          Sign out
        </Button>
      </View>
    </View>
  );
}

// Signed in, but the database couldn't be reached — so we don't know whether this
// account has a profile or not. Distinct from UnprovisionedScreen on purpose: the
// old code showed "Account not set up" for a network failure, which sent people
// looking for an administrator when the real problem was a blocked connection.
function ConnectionErrorScreen() {
  const { profileError, retryProfile, logout } = useApp();
  return (
    <View style={styles.splash}>
      <View style={styles.lockedCard}>
        <MaterialCommunityIcons name="cloud-alert" size={56} color={colors.danger} />
        <Text variant="headlineSmall" style={styles.lockedTitle}>
          Can't reach the server
        </Text>
        <Text variant="bodyMedium" style={styles.lockedBody}>
          {profileError}
        </Text>
        <Text variant="bodySmall" style={styles.lockedHelp}>
          Your data is safe — the app simply couldn't load it. On a company network,
          try a different browser or an incognito window with extensions disabled.
        </Text>
        <Button mode="contained" icon="refresh" onPress={retryProfile} style={styles.lockedBtn}>
          Try again
        </Button>
        <Button mode="text" icon="logout" onPress={logout}>
          Sign out
        </Button>
      </View>
    </View>
  );
}

// A dismissible banner for live-subscription failures. Without it a permissions
// error or a dropped connection just renders an empty list, which reads as
// "you have no rides".
function DataErrorBanner() {
  const { dataError, dismissDataError } = useApp();
  if (!dataError) return null;
  return (
    <View style={styles.dataError}>
      <MaterialCommunityIcons name="cloud-alert" size={18} color="#B26A00" />
      <Text variant="bodySmall" style={styles.dataErrorText}>
        {dataError}
      </Text>
      <Button compact mode="text" onPress={dismissDataError} textColor="#B26A00">
        Dismiss
      </Button>
    </View>
  );
}

function RootNavigator() {
  const {
    currentUser, authReady, profileMissing, profileError, changePassword, logout,
    menuCounts,
  } = useApp();
  const { width } = useWindowDimensions();
  const navRef = useNavigationContainerRef();
  const [activeRoute, setActiveRoute] = useState(null);

  // On a wide screen every signed-in role gets a permanent left sidebar.
  const isAdmin = currentUser?.role === 'admin';
  const isCoordinator = currentUser?.role === 'coordinator';
  const isDriver = currentUser?.role === 'driver';
  const showSidebar = !!currentUser && width >= WIDE_BREAKPOINT;
  const sidebarItems = isAdmin
    ? ADMIN_DRAWER_ITEMS
    : isCoordinator
    ? COORDINATOR_DRAWER_ITEMS
    : isDriver
    ? DRIVER_DRAWER_ITEMS
    : DRAWER_ITEMS;

  // While Firebase checks for an existing session, show a spinner instead of
  // briefly flashing the login screen.
  if (!authReady) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Couldn't reach the database → say so, and offer a retry. Checked BEFORE
  // profileMissing, because a failed read tells us nothing about provisioning.
  if (profileError) return <ConnectionErrorScreen />;

  // Authenticated but not provisioned → locked out, with a way to sign out.
  if (profileMissing) return <UnprovisionedScreen />;

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
            onLogout={isAdmin || isCoordinator ? logout : undefined}
            activeScreen={activeRoute}
            counts={menuCounts}
            onNavigate={(item) => navRef.navigate(item.screen, item.params)}
          />
        ) : null}
        <View style={styles.appContent}>
          <DataErrorBanner />
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
              name="MySchedule"
              component={MyScheduleScreen}
              options={{ title: 'My Shift Calendar' }}
            />
            <Stack.Screen
              name="ChangeRequest"
              component={ChangeRequestScreen}
              options={{ title: 'Change Request' }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ title: 'Notifications' }}
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
              name="Profile"
              component={ProfileScreen}
              options={{ title: 'Profile' }}
            />
          </>
        ) : (
          // ---- Desk screens (HR/Admin + Coordinator) ----
          // Both desk roles share the operational screens; the two role-specific
          // groups below are what differ. Registering both sets for both roles
          // would let a coordinator deep-link into roster upload, so each is
          // gated on the role.
          <>
            {currentUser.role === 'admin' ? (
              <>
                <Stack.Screen
                  name="RosterUpload"
                  component={RosterUploadScreen}
                  options={{ title: 'Upload Monthly Roster' }}
                />
                <Stack.Screen
                  name="ShiftPolicy"
                  component={ShiftPolicyScreen}
                  options={{ title: 'Shift Policy' }}
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
                <Stack.Screen
                  name="ManageTimings"
                  component={ManageTimingsScreen}
                  options={{ title: 'Routes & Timings' }}
                />
                <Stack.Screen
                  name="FeedbackInbox"
                  component={FeedbackInboxScreen}
                  options={{ title: 'Feedback & Ratings' }}
                />
              </>
            ) : (
              <>
                <Stack.Screen
                  name="CoordinatorHome"
                  component={CoordinatorDashboardScreen}
                  options={{ title: "Today's Rides" }}
                />
                <Stack.Screen
                  name="ChangeRequests"
                  component={ChangeRequestQueueScreen}
                  options={{ title: 'Change Requests' }}
                />
              </>
            )}
            <Stack.Screen
              name="Bookings"
              component={BookingsScreen}
              options={{ title: 'All Bookings' }}
            />
            <Stack.Screen
              name="ManageDrivers"
              component={ManageDriversScreen}
              options={{ title: 'Coordinators' }}
            />
            <Stack.Screen
              name="ManageCabs"
              component={ManageCabsScreen}
              options={{ title: 'Fleet' }}
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
              name="Messages"
              component={MessagesScreen}
              options={{ title: 'Messages' }}
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
        {/* Inside Paper (so the fallback screen is themed) but around everything
            else: any render error shows a recoverable message instead of a
            blank white screen. */}
        <ErrorBoundary>
          <AppProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </AppProvider>
        </ErrorBoundary>
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
  msgDialog: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: 24,
  },
  lockedCard: {
    alignItems: 'center',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 28,
  },
  lockedTitle: { fontWeight: 'bold', marginTop: 12, color: colors.text, textAlign: 'center' },
  lockedBody: { marginTop: 10, textAlign: 'center', color: colors.muted, lineHeight: 20 },
  lockedHelp: { marginTop: 12, color: colors.muted },
  lockedBtn: { marginTop: 20 },
  dataError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF6E5',
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
  },
  dataErrorText: { color: '#B26A00', flex: 1 },
  bellWrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
});
