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
import OtpScreen from './src/screens/OtpScreen';
import EmployeeHomeScreen from './src/screens/employee/EmployeeHomeScreen';
import SelfRosterScreen from './src/screens/employee/SelfRosterScreen';
import FeedbackScreen from './src/screens/employee/FeedbackScreen';
import MyRidesScreen from './src/screens/employee/MyRidesScreen';
import BookCabScreen from './src/screens/employee/BookCabScreen';
import RosterHistoryScreen from './src/screens/employee/RosterHistoryScreen';
import TripCancelScreen from './src/screens/employee/TripCancelScreen';
import TrackCabScreen from './src/screens/employee/TrackCabScreen';
import DriverSimScreen from './src/screens/employee/DriverSimScreen';
import DriverLiveScreen from './src/screens/employee/DriverLiveScreen';
import RateUsScreen from './src/screens/employee/RateUsScreen';
import ProfileScreen from './src/screens/employee/ProfileScreen';
import BookingsScreen from './src/screens/admin/BookingsScreen';
import AssignCabScreen from './src/screens/admin/AssignCabScreen';

const Stack = createNativeStackNavigator();

const BRAND = 'Cab Service';

// A custom header that shows the screen title and a Log out action on the right.
// We use Paper's Appbar so the header matches the app's look.
function AppHeader({ navigation, route, options, back }) {
  const { logout, currentUser } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isEmployee = currentUser?.role === 'employee';
  // After login the brand name stays fixed; before login use the screen title.
  const title = currentUser ? BRAND : options.title ?? route.name;

  return (
    <>
      <Appbar.Header style={styles.appbar} dark>
        {isEmployee ? (
          // Employees get the ☰ menu on the left (opens the drawer).
          <Appbar.Action icon="menu" color="#FFFFFF" onPress={() => setDrawerOpen(true)} />
        ) : back ? (
          <Appbar.BackAction color="#FFFFFF" onPress={navigation.goBack} />
        ) : null}
        <Appbar.Content
          title={title}
          color="#FFFFFF"
          titleStyle={styles.appbarTitle}
          style={styles.appbarContent}
          // Tapping the brand title returns to the role's home screen.
          onPress={
            currentUser
              ? () => navigation.navigate(isEmployee ? 'EmployeeHome' : 'Bookings')
              : undefined
          }
        />
        {/* Only offer Log out once actually signed in (not on the OTP step). */}
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
    <NavigationContainer>
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
              name="Otp"
              component={OtpScreen}
              options={{ title: 'Verify' }}
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
              options={{ title: 'Self Roster' }}
            />
            <Stack.Screen
              name="BookCab"
              component={BookCabScreen}
              options={{ title: 'Adhoc Request' }}
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
              options={{ title: 'Roster History' }}
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
              name="DriverSim"
              component={DriverSimScreen}
              options={{ title: 'Driver (demo)' }}
            />
            <Stack.Screen
              name="DriverLive"
              component={DriverLiveScreen}
              options={{ title: 'Driver (live GPS)' }}
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
