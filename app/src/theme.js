// ---------------------------------------------------------------------------
// THEME — the app's colors + shared style tokens, built on Paper's light theme.
// Change the palette here to re-brand the whole app in one place.
// ---------------------------------------------------------------------------

import { MD3LightTheme } from 'react-native-paper';

// Brand palette (SMART-TRANSPORT-style blues).
export const colors = {
  primary: '#1565C0',
  primaryDark: '#0D47A1',
  primaryLight: '#1E88E5',
  accent: '#0288D1',
  background: '#EEF2F8', // soft page background so white cards stand out
  surface: '#FFFFFF',
  border: '#E2E8F0',
  text: '#1A2233',
  muted: '#667085',
  danger: '#C62828',
  success: '#2E7D32',
};

export const theme = {
  ...MD3LightTheme,
  roundness: 4,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: '#FFFFFF',
    secondary: colors.accent,
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: '#EDF2F9',
    outline: colors.border,
    onSurface: colors.text,
  },
};

// Reusable spacing scale (keeps padding/margins consistent).
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Colors used for the booking status chips, so a status reads at a glance.
export const statusColors = {
  Booked: '#F9A825', // amber = waiting for a cab
  'Cab assigned': '#2E7D32', // green = cab assigned
  'On the way': '#1565C0', // blue = driver en route
  Arrived: '#00897B', // teal = driver at pickup
  Completed: '#455A64', // blue-grey = trip done
  'No show': '#C62828', // red = employee wasn't at pickup
  Cancelled: '#9E9E9E', // grey = no longer active
};
