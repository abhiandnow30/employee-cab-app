// ---------------------------------------------------------------------------
// THEME — the app's colors, built on React Native Paper's default theme.
// Change `primary` here to re-brand the whole app in one place.
// ---------------------------------------------------------------------------

import { MD3LightTheme } from 'react-native-paper';

export const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1565C0', // corporate blue
    secondary: '#0288D1',
  },
};

// Colors used for the booking status chips, so a status reads at a glance.
export const statusColors = {
  Booked: '#F9A825', // amber = waiting for a cab
  'Cab assigned': '#2E7D32', // green = sorted
};
