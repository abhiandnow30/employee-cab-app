// ---------------------------------------------------------------------------
// LOGIN SCREEN
//
// MICROSOFT IS THE WAY IN. A PASSWORD IS THE EXCEPTION, AND THE SCREEN NOW SAYS
// SO. Employees are provisioned as invites with no account and no password at
// all — they click "Sign in with Microsoft" once and their profile is created
// from the invite (see services/profile.js). The email and password fields exist
// for exactly two kinds of account: the admins created in the Firebase console,
// and anyone still holding a password login from before invites existed.
//
// The form used to be laid out the other way round — two text fields and a
// filled "Sign In" at the top, Microsoft demoted below an "or" — so the whole
// company read the password path as the front door and used it. The controls are
// unchanged; which one looks like the answer is what moved. The password half is
// folded away behind a plain link rather than deleted, because the desk's own
// admins sign in with it every day.
//
// On success, AppContext stores the user and the app switches to the employee or
// admin screens (see App.js).
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import {
  Animated, Easing, Pressable, StyleSheet, View, Platform, ActivityIndicator,
} from 'react-native';
import { Text, TextInput, Button, HelperText, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import AuthLayout, { Reveal } from '../components/AuthLayout';
import { colors, font, radius, shadow, spacing } from '../theme';
import useMicrosoftAuthRequest from '../utils/useMicrosoftAuthRequest';

const NATIVE = Platform.OS !== 'web';

// THE REAL MICROSOFT MARK, not the monochrome window glyph in the icon font.
// Four squares in Microsoft's own colours is what every SSO button anywhere
// looks like, and it is the single thing that makes this button read as a
// genuine identity provider rather than a blue rectangle somebody drew. Built
// out of plain Views so it needs no SVG dependency and renders identically on
// web, iOS and Android.
//
// It sits on a white tile because the button behind it is brand blue: four
// saturated colours directly on blue fight it, and Microsoft's own guidance is
// for the mark to sit on white or on a neutral. The tile gives it that without
// giving up the filled button.
const MS_COLORS = ['#F25022', '#7FBA00', '#00A4EF', '#FFB900'];

function MicrosoftMark() {
  return (
    <View style={styles.msTile}>
      <View style={styles.msGrid}>
        {MS_COLORS.map((c) => (
          <View key={c} style={[styles.msSquare, { backgroundColor: c }]} />
        ))}
      </View>
    </View>
  );
}

// The primary sign-in, built rather than themed, for two things Paper's Button
// cannot do: hold the mark above, and answer the press. A sign-in button is the
// one control on this screen, and a control that does not move under the finger
// reads as a picture of a button — especially on the web, where there is a
// cursor to give hover feedback to.
//
// It is still a button in every way that matters: role, disabled and busy are
// all announced, and the label is real text rather than an image.
function BrandButton({ onPress, loading, disabled, label, hint }) {
  const press = useRef(new Animated.Value(0)).current;
  const to = (v) =>
    Animated.timing(press, {
      toValue: v,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: NATIVE,
    }).start();

  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      onHoverIn={() => to(0.45)}
      onHoverOut={() => to(0)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
    >
      <Animated.View
        style={[
          styles.brandBtn,
          disabled && styles.brandBtnOff,
          {
            transform: [
              {
                // Down on press, a hair up on hover. One value drives both, so
                // the two can never fight over the same transform.
                scale: press.interpolate({
                  inputRange: [0, 0.45, 1],
                  outputRange: [1, 1.012, 0.985],
                }),
              },
            ],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size={18} color="#FFFFFF" style={styles.msTile} />
        ) : (
          <MicrosoftMark />
        )}
        <Text style={styles.brandBtnLabel}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

// The two accounts that do not sign in here at all. As plain rows they read as
// leftover text at the bottom of a form; as tiles they read as the third and
// fourth ways in, which is what they are.
function RoleTile({ icon, who, action, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={action}
      style={({ pressed, hovered }) => [
        styles.roleTile,
        hovered && styles.roleTileHover,
        pressed && styles.roleTilePressed,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      <View style={styles.roleText}>
        <Text style={styles.roleWho}>{who}</Text>
        <Text style={styles.roleAction}>{action}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.disabled} />
    </Pressable>
  );
}

export default function LoginScreen({ navigation }) {
  const { login, resetPassword, loginWithMicrosoftPopup, loginWithMicrosoftCredential } = useApp();
  // Only does anything on native — see the hook's own header comment. Calling
  // it unconditionally (web included) is fine; it just never gets prompted.
  const { promptMicrosoftSignIn, ready: microsoftReady } = useMicrosoftAuthRequest();
  const [microsoftBusy, setMicrosoftBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Is the password half open? Closed by default — see the header. Opening it is
  // one tap and nothing is hidden behind a menu, because an admin locked out of
  // the desk at 9 PM is a worse outcome than an employee taking the wrong door.
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(''); // success/neutral message (e.g. reset sent)
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef(null); // lets Enter on the email field jump here

  async function handleLogin() {
    setError('');
    setInfo('');
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setLoading(true);
    const result = await login(email, password); // checks with Firebase
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Success: the auth listener loads the profile and App.js switches to the
    // right home screen automatically — no further navigation needed here.
  }

  // Web uses a plain popup; a phone has no popup, so it drives the OAuth
  // flow itself via useMicrosoftAuthRequest and hands Firebase the resulting
  // token. Either way, loginWithMicrosoftPopup/loginWithMicrosoftCredential
  // (AppContext.js) handle everything from there: if this Microsoft identity
  // already matches an employee, success flows through the same auth
  // listener as email/password (same as handleLogin above) with nothing more
  // to do here. If it's the first time and matches nobody by uid, those
  // functions delete the throwaway account and set microsoftConfirm instead —
  // App.js then shows a one-time password prompt (MicrosoftConfirmScreen) to
  // link Microsoft onto the employee's real existing account. Either way,
  // `result.ok` is true unless something genuinely went wrong.
  async function handleMicrosoftLogin() {
    setError('');
    setInfo('');
    setMicrosoftBusy(true);
    try {
      const result =
        Platform.OS === 'web'
          ? await loginWithMicrosoftPopup()
          : await (async () => {
              const token = await promptMicrosoftSignIn();
              if (!token) return { ok: true }; // cancelled — not an error
              return loginWithMicrosoftCredential(token.idToken, token.rawNonce);
            })();
      if (!result.ok && result.message) {
        setError(result.message);
      }
    } catch (e) {
      setError(e.message || 'Could not sign in with Microsoft.');
    } finally {
      setMicrosoftBusy(false);
    }
  }

  // Emails a password-reset link to the address typed in the Email field.
  async function handleForgot() {
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Enter your email above, then tap “Forgot password?”.');
      return;
    }
    setLoading(true);
    const res = await resetPassword(email);
    setLoading(false);
    if (res.ok) {
      setInfo(`Password-reset link sent to ${email.trim()}. Check your inbox.`);
    } else {
      setError(res.message);
    }
  }

  // Switching halves clears whatever the other one said. A "wrong password"
  // still sitting there after switching to Microsoft is a message about a button
  // that is no longer on screen.
  function openPasswordForm() {
    setError('');
    setInfo('');
    setUsePassword(true);
  }

  function closePasswordForm() {
    setError('');
    setInfo('');
    setUsePassword(false);
  }

  const feedback = (
    <>
      {error ? (
        <HelperText type="error" visible={true} style={styles.error}>
          {error}
        </HelperText>
      ) : null}
      {info ? (
        <HelperText type="info" visible={true} style={styles.error}>
          {info}
        </HelperText>
      ) : null}
    </>
  );

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to see your rides, track your cab and reach the transport desk."
    >
      {/* THE FRONT DOOR. Contained and first, which is the whole change — this
          is the only sign-in almost anybody here has.

          Works directly for anyone the admin already created in Employee
          Management — no prior trip to Profile required. The first time,
          if this Microsoft account doesn't match anyone yet by uid,
          loginWithMicrosoftPopup/loginWithMicrosoftCredential
          (AppContext.js) delete the throwaway account and prompt for a
          one-time password confirmation instead (App.js,
          MicrosoftConfirmScreen) — entirely client-side, no server code
          involved. Every sign-in after that is instant. The manual
          link-from-Profile flow (ProfileScreen.js) still exists too, as
          an alternative for anyone who'd rather set it up proactively. */}
      <Reveal>
        <BrandButton
          label="Sign in with Microsoft"
          hint="Opens your company Microsoft sign-in"
          onPress={handleMicrosoftLogin}
          loading={microsoftBusy}
          disabled={loading || (Platform.OS !== 'web' && !microsoftReady)}
        />
        <Text variant="bodySmall" style={styles.msHint}>
          Use your company account — there is no password to set or remember.
        </Text>
      </Reveal>

      {/* Feedback sits with whichever half is open, so an error never appears
          adrift from the button that caused it. */}
      {!usePassword ? feedback : null}

      <Reveal delay={70}>
        <View style={styles.dividerRow}>
          <Divider style={styles.dividerLine} />
          <Text variant="bodySmall" style={styles.dividerText}>or</Text>
          <Divider style={styles.dividerLine} />
        </View>
      </Reveal>

      {!usePassword ? (
        <Reveal delay={120}>
          <Button
            mode="outlined"
            icon="key-outline"
            onPress={openPasswordForm}
            style={[styles.button, styles.ghostBtn]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.ghostLabel}
            accessibilityState={{ expanded: false }}
          >
            Sign in with a password
          </Button>
        </Reveal>
      ) : (
        /* Mounted on open, so Reveal's own fade-and-rise IS the transition —
           no second animation to keep in step with the first, and the same
           blank-screen failsafe covers it. */
        <Reveal>
          {/* Only two kinds of account reach this: an admin created in the
              Firebase console, and a password login predating invites. Said out
              loud so an employee who opens it knows immediately it is not theirs
              and goes back up, rather than trying to guess a password they were
              never given. */}
          <Text variant="bodySmall" style={styles.pwHint}>
            For accounts the desk set up with a password.
          </Text>

          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            dense
            autoFocus
            autoCapitalize="none"
            keyboardType="email-address"
            left={<TextInput.Icon icon="email" />}
            style={styles.input}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            blurOnSubmit={false}
          />

          <TextInput
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            dense
            secureTextEntry={!showPassword}
            left={<TextInput.Icon icon="lock" />}
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword((s) => !s)}
              />
            }
            style={styles.input}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />

          {feedback}

          <Button
            mode="contained"
            onPress={handleLogin}
            style={[styles.button, styles.primaryButton]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            loading={loading}
            disabled={loading}
          >
            Sign In
          </Button>

          <Button
            mode="text"
            onPress={handleForgot}
            style={styles.link}
            labelStyle={styles.signupLink}
            compact
            disabled={loading}
          >
            Forgot password?
          </Button>

          <Button
            mode="text"
            icon="arrow-left"
            onPress={closePasswordForm}
            style={styles.link}
            labelStyle={styles.backLink}
            compact
            disabled={loading}
            accessibilityState={{ expanded: true }}
          >
            Back to Microsoft sign-in
          </Button>
        </Reveal>
      )}

      {/* Neither drivers nor coordinators sign in here: they have no email
          and no password of their own, just a number the desk issues them
          (a cab-derived code, or a short numeric passcode — see
          DriverLoginScreen and CoordinatorLoginScreen). These links are the
          only way to those screens on a phone, so they can't be dropped. */}
      <Reveal delay={190} style={styles.altTray}>
        <RoleTile
          icon="steering"
          who="Are you a driver?"
          action="Driver sign in"
          onPress={() => navigation.navigate('DriverLogin')}
          disabled={loading}
        />
        <RoleTile
          icon="headset"
          who="Are you a coordinator?"
          action="Coordinator sign in"
          onPress={() => navigation.navigate('CoordinatorLogin')}
          disabled={loading}
        />
      </Reveal>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  error: { marginTop: -spacing.xs, marginBottom: 2 },
  // Squarer and taller than Paper's default pill — that shape is what makes the
  // primary action read as the one thing on the form to press.
  button: { marginTop: spacing.sm, borderRadius: radius.md },
  buttonContent: { paddingVertical: 8 },
  buttonLabel: { fontFamily: font.semibold, fontSize: 15, letterSpacing: 0.2 },
  primaryButton: { ...shadow.brand },
  msHint: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 18,
  },

  // -- the Microsoft button ---------------------------------------------------
  brandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    ...shadow.brand,
  },
  brandBtnOff: { backgroundColor: colors.disabled, ...shadow.none },
  brandBtnLabel: {
    color: '#FFFFFF',
    fontFamily: font.semibold,
    fontSize: 15.5,
    letterSpacing: 0.2,
  },
  // The white chip the mark sits in. Fixed size so the label never shifts
  // sideways when the spinner replaces the logo.
  msTile: {
    width: 26,
    height: 26,
    borderRadius: radius.xs,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  msGrid: { width: 16, height: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  msSquare: { width: 7, height: 7 },

  // -- the password door ------------------------------------------------------
  ghostBtn: {
    borderColor: colors.border,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
  },
  ghostLabel: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    letterSpacing: 0.2,
    color: colors.primary,
  },

  // -- driver / coordinator ---------------------------------------------------
  roleTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  roleTileHover: { borderColor: colors.primaryLight, backgroundColor: colors.primarySofter },
  roleTilePressed: { backgroundColor: colors.primarySoft },
  roleText: { flex: 1, minWidth: 0 },
  roleWho: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  roleAction: { color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  pwHint: {
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  // Quieter than the other links: it is a way back, not an action to consider.
  backLink: { fontFamily: font.medium, color: colors.muted },
  link: { marginTop: spacing.xs, alignSelf: 'center' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  dividerLine: { flex: 1, backgroundColor: colors.border },
  dividerText: {
    color: colors.muted,
    fontFamily: font.medium,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // The two "are you a driver / coordinator" rows sit in their own tray at the
  // foot of the form, so they don't compete with the sign-in button above.
  altTray: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  signupLink: { fontFamily: font.semibold },
});
