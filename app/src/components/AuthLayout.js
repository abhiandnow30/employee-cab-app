// ---------------------------------------------------------------------------
// AuthLayout — the shell every sign-in screen sits in (employee, driver,
// coordinator). One file, so the three cannot drift apart visually.
//
// TWO LAYOUTS, ONE COMPONENT:
//
//   Wide (≥ 980px)   A brand panel on the left and the form on the right. The
//                    panel carries the logo, what the product is, the animated
//                    live-ride illustration (RideJourney) and three lines on
//                    what the app does. The form column is plain white, so the
//                    eye lands on the fields rather than competing with colour.
//
//   Narrow           The panel would eat a phone screen, so it collapses to a
//                    short gradient header — logo, name, title — with the form
//                    beneath it on the page background. Nothing is lost that
//                    matters at that size: the illustration is atmosphere, the
//                    fields are the job.
//
// The breakpoint is 980 rather than the app's usual 900 because the split needs
// room for BOTH a readable form column and a panel wide enough for the map card;
// below that the two halves start squeezing each other.
//
// The form itself is passed in as `children` — this file owns no field, no
// button and no submit handler, so restyling the shell can never change what
// signing in does.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COMPANY_NAME, SUPPORT_HELPLINE, companyLogo } from '../branding';
import { colors, font, radius, shadow, spacing } from '../theme';
import RideJourney from './RideJourney';

const NATIVE = Platform.OS !== 'web';
export const SPLIT_BREAKPOINT = 980;

// Roughly the rendered height of RideJourney's card. Only used to work out how
// much vertical margin a scaled-up copy needs to reserve, so an approximation is
// fine — a few pixels either way is invisible next to a 32px gap.
const JOURNEY_HEIGHT = 280;

// The brand panel's backdrop. Three stops rather than two: the mid stop keeps
// the deep navy from washing straight into the brand blue, which is what makes
// it read as depth instead of as a flat tint.
const PANEL_GRADIENT = ['#03176B', '#0A2585', '#1B3FBF'];

// What the app does, in three lines. Deliberately the real capabilities — live
// tracking, roster-driven rides, the boarding OTP — not marketing adjectives.
const FEATURES = [
  { icon: 'map-marker-radius', text: 'Track your cab live, all the way to your door' },
  { icon: 'calendar-check', text: 'Rides created from your shift roster — no booking needed' },
  { icon: 'shield-check', text: 'Every trip starts with your own verification code' },
];

// Fades and lifts its children in once, on mount. `delay` staggers the panel's
// blocks so it assembles rather than appearing all at once.
//
// THE SAFETY NET IS THE POINT. This starts at opacity 0, which means a frame
// loop that never runs leaves the sign-in screen blank — no fields, no button,
// nothing to do. Animated drives opacity from requestAnimationFrame, and rAF is
// not guaranteed: a background tab throttles it, a restored tab may not resume
// it, and some embedded webviews stall it entirely. So a plain timer force-sets
// the final value shortly after the animation should have finished. Timers and
// frames fail independently, so the odds of both stalling are remote — and if
// the animation did run, setting 1 on a value already at 1 is a no-op.
export function Reveal({ delay = 0, children, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: 520,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    anim.start();
    const failsafe = setTimeout(() => v.setValue(1), delay + 900);
    return () => {
      clearTimeout(failsafe);
      anim.stop();
    };
  }, [v, delay]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// The strip along the bottom of the form side. It exists to finish the column:
// without it the form floats in the middle of a tall empty white field, which is
// what makes a split sign-in look unfinished at full-screen sizes. It also puts
// the one number that helps somebody who CANNOT sign in on the screen where they
// are stuck, rather than behind a login they can't get through.
function AuthFooter({ stacked = false }) {
  return (
    <View style={[styles.footer, stacked && styles.footerStacked]}>
      {/* The helpline comes FIRST when stacked. Two centred lines have no left
          and right any more, so the order is the only ranking left — and the
          number is the useful half to someone who cannot get past this screen. */}
      {stacked ? (
        <>
          <Text style={[styles.footerText, styles.footerTextCentered]} numberOfLines={1}>
            Transport desk {SUPPORT_HELPLINE}
          </Text>
          <Text style={[styles.footerText, styles.footerTextCentered]} numberOfLines={1}>
            © {new Date().getFullYear()} {COMPANY_NAME}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.footerText} numberOfLines={1}>
            © {new Date().getFullYear()} {COMPANY_NAME}
          </Text>
          <Text style={styles.footerText} numberOfLines={1}>
            Transport desk {SUPPORT_HELPLINE}
          </Text>
        </>
      )}
    </View>
  );
}

// The logo, on a white tile. It is the one asset that must never be tinted,
// dimmed or laid over a busy background, so it always gets a clean white plate.
function LogoTile({ size = 76, radiusKey = radius.xl }) {
  return (
    <View style={[styles.logoTile, { width: size, height: size, borderRadius: radiusKey }]}>
      <Image
        source={companyLogo}
        style={{ width: size * 0.66, height: size * 0.66 }}
        resizeMode="contain"
      />
    </View>
  );
}

export default function AuthLayout({ title, subtitle, children }) {
  const { width, height } = useWindowDimensions();
  const split = width >= SPLIT_BREAKPOINT;
  // A 1366×768 laptop is the common case, and at that height the panel's full
  // rhythm runs about 80px past the fold — which quietly hid the third feature
  // line below a scroll almost nobody performs on a sign-in screen. Tightening
  // the vertical spacing (nothing else) brings it back inside the window.
  const short = split && height < 820;
  // ONE CONTINUOUS SCALE, NOT BREAKPOINT TIERS. The form side is capped, so every
  // pixel a bigger monitor adds goes to the brand panel — and type set for a 1366
  // laptop is marooned in a 1920px-wide panel, never mind an ultrawide. Sizing the
  // panel's type and illustration from the window itself keeps the composition
  // right at every width instead of only at the two or three someone thought of.
  //
  // Clamped at both ends: below 1 the panel would shrink its own text just above
  // the split breakpoint, and past 1.35 the headline starts to outrun the map
  // card it sits above.
  const panelScale = split ? Math.min(1.35, Math.max(1, width / 1440)) : 1;
  // The form follows, but at a third of the rate. A sign-in form has an ideal
  // measure — past roughly 500px the fields read as a stretched web page rather
  // than a form — so it firms up rather than tracking the panel.
  const formScale = 1 + (panelScale - 1) / 3;

  // ---- Wide: brand panel + form column ------------------------------------
  if (split) {
    return (
      <KeyboardAvoidingView
        style={styles.splitRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <LinearGradient
          colors={PANEL_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.panel}
        >
          {/* Two oversized, very low-opacity discs. They sit behind everything
              and are what stops a large flat gradient looking like a colour
              swatch — a slow highlight the eye reads without noticing. */}
          <View pointerEvents="none" style={[styles.glow, styles.glowTop]} />
          <View pointerEvents="none" style={[styles.glow, styles.glowBottom]} />

          <ScrollView
            contentContainerStyle={[
              styles.panelInner,
              { maxWidth: 620 * panelScale, paddingHorizontal: 56 * panelScale },
              short && styles.panelInnerShort,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Reveal>
              <View style={styles.brandRow}>
                <LogoTile size={60} radiusKey={radius.lg} />
                <View style={styles.brandRowText}>
                  <Text style={styles.brandName} numberOfLines={1}>
                    {COMPANY_NAME}
                  </Text>
                  <Text style={styles.brandProduct}>Cab Service</Text>
                </View>
              </View>
            </Reveal>

            <Reveal delay={90}>
              <Text
                style={[
                  styles.headline,
                  { fontSize: 38 * panelScale, lineHeight: 47 * panelScale },
                  short && styles.headlineShort,
                ]}
              >
                Your ride to work,{'\n'}already sorted.
              </Text>
              <Text
                style={[
                  styles.subhead,
                  {
                    fontSize: 15 * panelScale,
                    lineHeight: 24 * panelScale,
                    maxWidth: 430 * panelScale,
                  },
                  short && styles.subheadShort,
                ]}
              >
                The company cab desk, your shift roster and the driver on your
                street — in one place.
              </Text>
            </Reveal>

            <Reveal
              delay={180}
              style={[
                styles.journeySlot,
                // The illustration is built from fixed pixel sizes, so it is
                // scaled rather than rebuilt at a second set of dimensions. A
                // transform does not change the layout box, so the margins buy
                // back the height it grows into — half the overflow above, half
                // below. Without them the enlarged card lands on the feature list.
                {
                  transform: [{ scale: panelScale }],
                  marginTop: 32 + JOURNEY_HEIGHT * (panelScale - 1) * 0.5,
                  marginBottom: JOURNEY_HEIGHT * (panelScale - 1) * 0.5,
                },
                short && styles.journeySlotShort,
              ]}
            >
              <RideJourney />
            </Reveal>

            <Reveal delay={280} style={[styles.features, short && styles.featuresShort]}>
              {FEATURES.map((f) => (
                <View key={f.icon} style={styles.featureRow}>
                  <View style={styles.featureIcon}>
                    <MaterialCommunityIcons name={f.icon} size={15} color="#CFE0FF" />
                  </View>
                  <Text
                    style={[
                      styles.featureText,
                      { fontSize: 13.5 * panelScale, lineHeight: 20 * panelScale },
                    ]}
                  >
                    {f.text}
                  </Text>
                </View>
              ))}
            </Reveal>
          </ScrollView>
        </LinearGradient>

        <View style={[styles.formPane, { maxWidth: 640 * formScale }]}>
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formPaneInner}
            showsVerticalScrollIndicator={false}
            // Without this the first tap on Sign In only dismisses the keyboard
            // and the second one presses the button.
            keyboardShouldPersistTaps="handled"
          >
            <Reveal delay={120} style={[styles.formCol, { maxWidth: 420 * formScale }]}>
              <Text style={styles.formTitle}>{title}</Text>
              {subtitle ? <Text style={styles.formSubtitle}>{subtitle}</Text> : null}
              <View style={styles.formBody}>{children}</View>
            </Reveal>
          </ScrollView>
          <AuthFooter />
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ---- Narrow: gradient header, then the form -----------------------------
  return (
    <KeyboardAvoidingView
      style={styles.stackRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.stackScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <LinearGradient
          colors={PANEL_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View pointerEvents="none" style={[styles.glow, styles.glowHeader]} />
          <Reveal style={styles.headerInner}>
            <LogoTile size={64} radiusKey={radius.lg} />
            <Text style={styles.headerBrand} numberOfLines={1}>
              {COMPANY_NAME}
            </Text>
            <Text style={styles.headerTitle}>{title}</Text>
            {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
            {/* A tablet in portrait is below the split breakpoint but has plenty
                of room, so it gets the illustration too. A phone does not: at
                that size the header would push the fields off the first screen,
                and someone on a phone came here to sign in, not to watch. */}
            {width >= 620 ? (
              <View style={styles.headerJourney}>
                <RideJourney />
              </View>
            ) : null}
          </Reveal>
        </LinearGradient>

        {/* Pulled up over the header's bottom edge, so the card overlaps the
            colour instead of sitting in a seam below it. */}
        <Reveal delay={110} style={styles.stackCardWrap}>
          <View style={styles.stackCard}>{children}</View>
        </Reveal>

        {/* Pushed to the foot of the screen by the spacer above it, so a short
            form does not leave a slab of empty background below the card. */}
        <View style={styles.stackSpacer} />
        <AuthFooter stacked />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // ---------------------------------------------------------------- wide
  splitRoot: { flex: 1, flexDirection: 'row', backgroundColor: colors.surface },
  // 1.05 : 1 — the panel takes slightly more than half. A form column much past
  // 520 stops looking like a form and starts looking like a page.
  panel: { flex: 1.05, overflow: 'hidden' },
  panelInner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 56,
    paddingVertical: spacing.xxxl,
    maxWidth: 620,
    width: '100%',
    alignSelf: 'center',
  },
  panelInnerShort: { paddingVertical: spacing.xl },
  glow: { position: 'absolute', borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
  glowTop: { width: 420, height: 420, top: -170, right: -130, opacity: 0.06 },
  glowBottom: { width: 340, height: 340, bottom: -140, left: -110, opacity: 0.05 },
  glowHeader: { width: 300, height: 300, top: -150, right: -90, opacity: 0.07 },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  brandRowText: { flex: 1, minWidth: 0 },
  brandName: {
    color: '#FFFFFF',
    fontFamily: font.semibold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  brandProduct: {
    color: '#A9C4FF',
    fontFamily: font.medium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  logoTile: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },

  headline: {
    color: '#FFFFFF',
    fontFamily: font.bold,
    fontSize: 38,
    lineHeight: 47,
    letterSpacing: -0.6,
    marginTop: spacing.xxxl,
  },
  headlineShort: { fontSize: 33, lineHeight: 41, marginTop: spacing.lg },
  subhead: {
    color: '#C3D5FF',
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 24,
    marginTop: spacing.md,
    maxWidth: 430,
  },
  subheadShort: { marginTop: spacing.sm },

  journeySlot: { marginTop: spacing.xxl },
  // Listed after the computed scale in the style array on purpose: a wide but
  // short window takes both, and the last entry is the one that wins — a short
  // screen has no room for an enlarged illustration whatever its width.
  journeySlotShort: { marginTop: spacing.lg, marginBottom: 0, transform: [{ scale: 1 }] },

  features: { marginTop: spacing.xxl, gap: spacing.md },
  featuresShort: { marginTop: spacing.lg, gap: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    color: '#C3D5FF',
    fontFamily: font.regular,
    fontSize: 13.5,
    flex: 1,
    lineHeight: 20,
  },

  // CAPPED, and that cap is the whole point. As a plain `flex: 1` this pane kept
  // every pixel a wider window gave it, so at 1080p and above the form sat in a
  // widening field of empty white while the brand side stayed the same size.
  // Bounded, the surplus goes to the gradient panel instead — the window fills
  // with the design rather than with nothing. minWidth holds the form readable
  // at the low end, just above the split breakpoint.
  formPane: {
    flex: 1,
    minWidth: 400,
    backgroundColor: colors.surface,
  },
  formScroll: { flex: 1 },
  formPaneInner: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl,
  },
  formCol: { width: '100%' },
  formTitle: {
    color: colors.text,
    fontFamily: font.bold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  formSubtitle: {
    color: colors.muted,
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  formBody: { marginTop: spacing.xl },

  // -------------------------------------------------------------- narrow
  stackRoot: { flex: 1, backgroundColor: colors.background },
  stackScroll: { flexGrow: 1 },
  // Eats whatever height is left over, which is what pins the footer to the
  // bottom on a tall screen without pinning it over the content on a short one.
  stackSpacer: { flex: 1, minHeight: spacing.md },
  header: {
    paddingTop: 52,
    paddingBottom: 56,
    paddingHorizontal: spacing.xl,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
    overflow: 'hidden',
  },
  headerInner: { alignItems: 'center' },
  headerJourney: { marginTop: spacing.xl, alignSelf: 'stretch', alignItems: 'center' },
  headerBrand: {
    color: '#A9C4FF',
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontFamily: font.bold,
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.2,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  headerSubtitle: {
    color: '#C3D5FF',
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: 'center',
    maxWidth: 320,
  },
  stackCardWrap: {
    marginTop: -32,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Side by side needs ~380px of text; a 360px phone has less than that after
  // padding, so the row wrapped into a ragged left/right pair. Centred and
  // stacked is the honest shape at that width.
  footerStacked: {
    flexDirection: 'column',
    // nowrap AND an explicit alignItems, both load-bearing: the base style wraps
    // (which it needs to, side by side), and a wrapping COLUMN packs its lines to
    // the start on the cross axis — which is why the two lines came out
    // left-aligned rather than centred despite the inherited alignItems.
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopColor: 'transparent',
  },
  footerText: { color: colors.muted, fontFamily: font.regular, fontSize: 12 },
  footerTextCentered: { textAlign: 'center' },
  stackCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    ...shadow.lg,
  },
});
