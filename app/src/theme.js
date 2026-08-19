// ---------------------------------------------------------------------------
// THEME — the app's design system in ONE place: colors, typography, spacing,
// corner radii and elevation. Built on React Native Paper's light (MD3) theme.
//
// Everything visual should come from a token here rather than a hard-coded
// value in a screen, so a re-brand or a spacing tweak is a one-file change.
//
//   colors        palette (brand, surfaces, text, semantic)
//   font          Poppins family names, one per weight  → see src/fonts.js
//   spacing       4-based spacing scale
//   radius        corner-radius scale
//   shadow        soft elevation presets (cross-platform)
//   statusColors  booking-status chip colors
// ---------------------------------------------------------------------------

import { Platform } from 'react-native';
import { MD3LightTheme, configureFonts } from 'react-native-paper';
import { font } from './fonts';

export { font };

// Brand palette (SMART-TRANSPORT-style blues).
export const colors = {
  primary: '#0129AC',
  // Darker/lighter than primary, in that order, so the header/sidebar (dark)
  // and hover/active highlights (light) keep their contrast against the new
  // deep blue instead of accidentally inverting.
  primaryDark: '#03176B',
  primaryLight: '#3B5FE0',
  // Very light brand tints — for icon chips, active rows, selected states and
  // any "quiet" surface that still needs to read as part of the brand.
  primarySoft: '#EAF0FF',
  primarySofter: '#F5F8FF',
  accent: '#0288D1',
  accentSoft: '#E6F4FD',

  background: '#F4F7FC', // soft page background so white cards stand out
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFD', // subtle striping / secondary panels inside a card
  border: '#E5EAF3',
  borderStrong: '#D2DBE9',

  text: '#101828', // crisp near-black — more readable than a mid grey
  textSecondary: '#475467',
  muted: '#667085',
  disabled: '#98A2B3',

  danger: '#D92D20',
  dangerSoft: '#FEF3F2',
  success: '#12805C',
  successSoft: '#ECFDF3',
  warning: '#B26A00', // matches the "pending" amber used on change-request status chips
  warningSoft: '#FFF8EB',
  info: '#0B79D0',
  infoSoft: '#EAF4FD',

  // Semi-transparent white steps, for text/dividers on the dark blue sidebar.
  onDark: '#FFFFFF',
  onDarkMuted: '#D8E3FF',
  onDarkFaint: 'rgba(255,255,255,0.18)',
};

// Reusable spacing scale (keeps padding/margins consistent).
// xs..xl were the original four names — kept so existing code is untouched —
// with a couple of larger steps added for page-level rhythm.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 };

// Corner radii. `pill` is deliberately huge so it always fully rounds.
export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 };

// Soft, layered elevation. Web gets a real box-shadow (two-stop, so a card has
// both a tight contact shadow and a wide ambient one); native gets the platform
// shadow props it understands.
const nativeShadow = (y, blur, opacity, elevation) => ({
  shadowColor: '#0B1B3A',
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: blur,
  elevation,
});

export const shadow = {
  // Barely-there lift: list rows, inputs, quiet chips.
  xs: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.05)' },
    default: nativeShadow(1, 2, 0.05, 1),
  }),
  // The default card shadow.
  sm: Platform.select({
    web: { boxShadow: '0 1px 3px rgba(16, 24, 40, 0.07), 0 1px 2px rgba(16, 24, 40, 0.04)' },
    default: nativeShadow(1, 3, 0.08, 2),
  }),
  // Raised cards, tiles, popovers.
  md: Platform.select({
    web: {
      boxShadow:
        '0 4px 10px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.05)',
    },
    default: nativeShadow(3, 8, 0.1, 4),
  }),
  // Dialogs, floating panels, the login card.
  lg: Platform.select({
    web: {
      boxShadow:
        '0 12px 28px -6px rgba(16, 24, 40, 0.14), 0 4px 10px -4px rgba(16, 24, 40, 0.06)',
    },
    default: nativeShadow(8, 18, 0.16, 10),
  }),
  // Brand-tinted glow, for primary call-to-action surfaces.
  brand: Platform.select({
    web: { boxShadow: '0 8px 20px -6px rgba(1, 41, 172, 0.35)' },
    default: {
      shadowColor: '#0129AC',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.28,
      shadowRadius: 14,
      elevation: 8,
    },
  }),
  none: Platform.select({ web: { boxShadow: 'none' }, default: { elevation: 0 } }),
};

// ---------------------------------------------------------------------------
// TYPOGRAPHY
//
// Poppins ships one file per weight, and expo-font registers each under its own
// family name. So weight is chosen by FAMILY, never by `fontWeight` — every
// variant pins fontWeight to 'normal' on purpose. On the web that also stops the
// browser painting a fake-bold on top of an already-bold face; on Android a
// `fontWeight` on its own would simply have been ignored.
//
// Letter-spacing is pulled in tighter than Material's defaults: Poppins is a
// wide, geometric face and the stock MD3 tracking makes it look loose.
// ---------------------------------------------------------------------------
const type = (family, fontSize, lineHeight, letterSpacing = 0) => ({
  fontFamily: family,
  fontWeight: 'normal',
  fontSize,
  lineHeight,
  letterSpacing,
});

export const fontConfig = {
  displayLarge: type(font.bold, 52, 62, -0.5),
  displayMedium: type(font.bold, 42, 52, -0.4),
  displaySmall: type(font.bold, 34, 44, -0.3),

  headlineLarge: type(font.bold, 30, 40, -0.3),
  headlineMedium: type(font.bold, 26, 34, -0.2),
  headlineSmall: type(font.semibold, 22, 30, -0.1),

  titleLarge: type(font.semibold, 20, 28, 0),
  titleMedium: type(font.semibold, 16, 24, 0.05),
  titleSmall: type(font.semibold, 14, 20, 0.05),

  labelLarge: type(font.semibold, 14, 20, 0.15),
  labelMedium: type(font.semibold, 12, 16, 0.3),
  labelSmall: type(font.medium, 11, 16, 0.4),

  bodyLarge: type(font.regular, 16, 25, 0.1),
  bodyMedium: type(font.regular, 14, 22, 0.1),
  bodySmall: type(font.regular, 12, 18, 0.2),

  // Paper falls back to this for anything without a variant.
  default: type(font.regular, 14, 22, 0.1),
};

export const theme = {
  ...MD3LightTheme,
  roundness: 4, // Paper multiplies this: cards ×3, buttons ×5, dialogs ×7, chips ×2
  fonts: configureFonts({ config: fontConfig }),
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: '#FFFFFF',
    primaryContainer: colors.primarySoft,
    onPrimaryContainer: colors.primaryDark,
    secondary: colors.accent,
    onSecondary: '#FFFFFF',
    secondaryContainer: colors.accentSoft,
    onSecondaryContainer: '#03436B',
    tertiary: colors.primaryLight,
    error: colors.danger,
    onError: '#FFFFFF',
    errorContainer: colors.dangerSoft,
    onErrorContainer: '#7A1810',
    background: colors.background,
    onBackground: colors.text,
    surface: colors.surface,
    onSurface: colors.text,
    surfaceVariant: colors.surfaceAlt,
    onSurfaceVariant: colors.textSecondary,
    surfaceDisabled: 'rgba(16, 24, 40, 0.06)',
    onSurfaceDisabled: colors.disabled,
    outline: colors.borderStrong,
    outlineVariant: colors.border,
    inverseSurface: '#1D2939',
    inverseOnSurface: '#F9FAFB',
    backdrop: 'rgba(16, 24, 40, 0.45)',
    // Paper tints raised surfaces by blending the primary color in. That turned
    // every elevated card faintly blue-grey; pinning the levels to white keeps
    // cards clean white and lets the shadow do the lifting instead.
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#FFFFFF',
      level3: '#FFFFFF',
      level4: '#FFFFFF',
      level5: '#FFFFFF',
    },
  },
};

// Colors used for the booking status chips, so a status reads at a glance.
export const statusColors = {
  Booked: '#E08700', // amber = waiting for a cab
  'Cab assigned': '#12805C', // green = cab assigned
  'On the way': colors.primary, // blue = driver en route
  Arrived: '#00897B', // teal = driver at pickup
  'On board': '#1B7F3B', // green = rider verified by OTP, cab moving
  Completed: '#475467', // blue-grey = trip done
  'No show': colors.danger, // red = employee wasn't at pickup
  Cancelled: '#98A2B3', // grey = no longer active
};
