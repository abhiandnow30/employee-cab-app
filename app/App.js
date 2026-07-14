// ---------------------------------------------------------------------------
// App.js — the ROOT of the app. It wires together three things:
//   1. PaperProvider  → gives every screen the React Native Paper theme/components
//   2. AppProvider    → shared state (who's logged in, bookings, cabs)
//   3. Navigation     → decides which screens to show based on the logged-in user
// ---------------------------------------------------------------------------

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, Appbar } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { theme } from './src/theme';
import { AppProvider, useApp } from './src/context/AppContext';

import LoginScreen from './src/screens/LoginScreen';
import MyRidesScreen from './src/screens/employee/MyRidesScreen';
import BookCabScreen from './src/screens/employee/BookCabScreen';
import BookingsScreen from './src/screens/admin/BookingsScreen';
import AssignCabScreen from './src/screens/admin/AssignCabScreen';

const Stack = createNativeStackNavigator();

// A custom header that shows the screen title and a Log out action on the right.
// We use Paper's Appbar so the header matches the app's look.
function AppHeader({ navigation, route, options, back }) {
  const { logout } = useApp();
  const title = options.title ?? route.name;

  return (
    <Appbar.Header elevated>
      {back ? <Appbar.BackAction onPress={navigation.goBack} /> : null}
      <Appbar.Content title={title} />
      <Appbar.Action icon="logout" onPress={logout} />
    </Appbar.Header>
  );
}

// Chooses which set of screens to show. Reads the current user from context.
function RootNavigator() {
  const { currentUser } = useApp();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          // Use our Paper-based header everywhere EXCEPT login (set below).
          header: (props) => <AppHeader {...props} />,
        }}
      >
        {!currentUser ? (
          // ---- Logged out ----
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        ) : currentUser.role === 'employee' ? (
          // ---- Employee screens ----
          <>
            <Stack.Screen
              name="MyRides"
              component={MyRidesScreen}
              options={{ title: 'My Rides' }}
            />
            <Stack.Screen
              name="BookCab"
              component={BookCabScreen}
              options={{ title: 'Book a Cab' }}
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
      <PaperProvider theme={theme}>
        <AppProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AppProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
