// ---------------------------------------------------------------------------
// RideJourney — the animated illustration on the sign-in screen's brand panel.
//
// WHAT IT IS. A miniature of the thing this app does: a cab leaves a pickup
// point, drives a route, and arrives at the office — with the status line
// changing underneath exactly as it does on a real ride ("Cab assigned" → "On
// the way" → "Arrived" → "On board"). It is decoration, but it is decoration
// that tells a first-time user what they have signed in to.
//
// HOW IT IS DRAWN. No SVG library is installed, so the route is four plain
// Views laid out absolutely — two vertical bars, two horizontal ones — forming
// a stepped street path. The cab is a fifth View that walks the same corner
// coordinates via one Animated.Value interpolated on both axes, so it turns the
// corners rather than sliding diagonally across them.
//
// ONE clock drives everything: `progress` runs 0 → 1 on a loop, the cab reads it
// for position, and the status label is switched by a listener on the same value
// at the fractions where each leg begins. Two timers would drift apart within a
// minute and show "Arrived" while the cab was still mid-route.
//
// REDUCED MOTION IS HONOURED. Someone who has asked their OS for less animation
// gets the same picture, parked at the end of the route with the final status,
// rather than a loop they cannot turn off.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, font, radius, spacing } from '../theme';

// Animated transforms go over the native bridge on a phone; on the web
// react-native-web has no such bridge and warns if asked for one.
const NATIVE = Platform.OS !== 'web';

// The plan the cab drives, in the illustration's own coordinate space. WIDTH ×
// HEIGHT is the drawing area; the box scales visually with the panel but these
// stay fixed, so the route keeps its shape at every size.
const WIDTH = 292;
const HEIGHT = 176;
const CAB = 36; // the round cab token

// The two fixed ends of the journey. They are NOT the first and last waypoints:
// the cab is a 36px disc and the pins are 26px, so parking one exactly on the
// other hides it. The cab instead starts just clear of the front door and stops
// just short of the office — which also reads better, as pulling away and
// pulling up rather than materialising on top of each marker.
const HOME = { x: 28, y: 150 };
const OFFICE = { x: 262, y: 30 };

// Corners of the route, in order. The cab's centre passes through each in turn.
const PATH = [
  { x: 28, y: 120 },
  { x: 28, y: 80 },
  { x: 140, y: 80 },
  { x: 140, y: 30 },
  { x: 226, y: 30 },
];

// Where along 0 → 1 the cab reaches each corner. Evenly spaced: the legs are
// close enough in length that weighting them by distance is not worth the
// arithmetic, and an even split keeps the corners on tidy quarter beats.
const STOPS = PATH.map((_, i) => i / (PATH.length - 1));

// The status line under the map, and the fraction of the journey each one owns.
// These are the real statuses from data/mockData.js — the point of the panel is
// that it shows this app, not a generic delivery animation.
const STAGES = [
  { at: 0, label: 'Cab assigned', color: '#7FE7C4' },
  { at: 0.18, label: 'On the way', color: '#8FC2FF' },
  { at: 0.82, label: 'Arriving at the office', color: '#FFD79A' },
  { at: 0.99, label: 'Trip completed', color: '#7FE7C4' },
];

// A single leg of the route, drawn as a rounded bar. Vertical legs get width 6,
// horizontal ones height 6; either way `from`/`to` is the moving axis.
function Leg({ x, y, w, h }) {
  return <View style={[styles.leg, { left: x, top: y, width: w, height: h }]} />;
}

export default function RideJourney() {
  const progress = useRef(new Animated.Value(0)).current;
  // The pickup pin's halo, on its own slower clock — it is a "you are here"
  // pulse, not part of the journey.
  const pulse = useRef(new Animated.Value(0)).current;
  const [stage, setStage] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => alive && setReduceMotion(!!on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (on) =>
      setReduceMotion(!!on)
    );
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    // Parked, not looping: the picture still reads, and the last status is the
    // honest one for a cab sitting at the office.
    if (reduceMotion) {
      progress.setValue(1);
      pulse.setValue(0);
      setStage(STAGES.length - 1);
      return undefined;
    }

    progress.setValue(0);
    const drive = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 7000,
          // inOut easing on the whole trip, so the cab pulls away and slows into
          // the office instead of running at one flat speed.
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: NATIVE,
        }),
        // A beat at the office before the loop restarts, so "Trip completed" is
        // readable rather than a flicker.
        Animated.delay(1100),
      ])
    );
    const halo = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: NATIVE,
      })
    );
    drive.start();
    halo.start();

    // The status follows the SAME value the cab does — see the header comment.
    const id = progress.addListener(({ value }) => {
      let next = 0;
      for (let i = 0; i < STAGES.length; i += 1) if (value >= STAGES[i].at) next = i;
      setStage((cur) => (cur === next ? cur : next));
    });

    return () => {
      drive.stop();
      halo.stop();
      progress.removeListener(id);
    };
  }, [reduceMotion, progress, pulse]);

  // One value, two axes. The cab is positioned by its top-left corner, so half
  // the token is taken off each coordinate to put its centre on the route.
  const translateX = progress.interpolate({
    inputRange: STOPS,
    outputRange: PATH.map((p) => p.x - CAB / 2),
  });
  const translateY = progress.interpolate({
    inputRange: STOPS,
    outputRange: PATH.map((p) => p.y - CAB / 2),
  });

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.9] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.5, 0.18, 0] });

  const current = STAGES[stage];

  return (
    <View style={styles.wrap}>
      {/* THE MAP CARD. A solid, slightly lighter panel with a hairline edge —
          deliberately opaque: a see-through card over a gradient is the frosted
          look this design is meant to avoid. */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <MaterialCommunityIcons name="map-marker-path" size={15} color="#A9C4FF" />
          <Text style={styles.cardHeadText}>Live route</Text>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveTagText}>LIVE</Text>
          </View>
        </View>

        <View style={styles.plot}>
          {/* Faint grid, so the plot reads as a map rather than as empty space. */}
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={`h${i}`} style={[styles.gridLine, { top: 14 + i * 40 }]} />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={`v${i}`} style={[styles.gridLineV, { left: 24 + i * 58 }]} />
          ))}

          {/* The route: two vertical legs, two horizontal, meeting at the
              corners the cab turns. */}
          <Leg x={HOME.x - 3} y={PATH[1].y} w={6} h={HOME.y - PATH[1].y + 6} />
          <Leg x={PATH[1].x - 3} y={PATH[1].y - 3} w={PATH[2].x - PATH[1].x + 6} h={6} />
          <Leg x={PATH[2].x - 3} y={PATH[3].y} w={6} h={PATH[2].y - PATH[3].y + 6} />
          <Leg x={PATH[3].x - 3} y={PATH[3].y - 3} w={OFFICE.x - PATH[3].x + 6} h={6} />

          {/* PICKUP. The halo sits behind the pin and is purely ambient, so it
              must not intercept touches on the panel. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.halo,
              {
                left: HOME.x - 26,
                top: HOME.y - 26,
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
              },
            ]}
          />
          <View style={[styles.pin, styles.pinHome, { left: HOME.x - 13, top: HOME.y - 13 }]}>
            <MaterialCommunityIcons name="home-variant" size={14} color={colors.primaryDark} />
          </View>

          {/* OFFICE — a square badge, so the two ends of the route are told
              apart by shape and not only by colour. */}
          <View style={[styles.pin, styles.pinOffice, { left: OFFICE.x - 13, top: OFFICE.y - 13 }]}>
            <MaterialCommunityIcons name="office-building" size={14} color="#FFFFFF" />
          </View>

          {/* THE CAB. */}
          <Animated.View
            style={[styles.cab, { transform: [{ translateX }, { translateY }] }]}
          >
            <MaterialCommunityIcons name="car" size={17} color={colors.primaryDark} />
          </Animated.View>
        </View>

        {/* The status line. Keyed on the stage so React remounts it and the
            entrance transition replays on every change. */}
        <View style={styles.statusRow}>
          <StatusPill key={current.label} color={current.color} label={current.label} />
          <Text style={styles.etaText}>ETA 12 min</Text>
        </View>
      </View>
    </View>
  );
}

// One status, fading and lifting in as it replaces the last.
function StatusPill({ color, label }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    anim.start();
    // Same failsafe as AuthLayout's Reveal: this starts invisible, and a frame
    // loop that never runs would leave the status line permanently blank.
    const failsafe = setTimeout(() => enter.setValue(1), 800);
    return () => {
      clearTimeout(failsafe);
      anim.stop();
    };
  }, [enter]);
  return (
    <Animated.View
      style={[
        styles.statusPill,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
          ],
        },
      ]}
    >
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={styles.statusText}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: WIDTH + spacing.lg * 2,
    borderRadius: radius.xl,
    // Opaque, one step lighter than the gradient behind it. NOT translucent —
    // see the note where it is rendered.
    backgroundColor: '#0A2585',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  cardHeadText: {
    flex: 1,
    color: '#A9C4FF',
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(127,231,196,0.16)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: '#7FE7C4' },
  liveTagText: {
    color: '#7FE7C4',
    fontFamily: font.bold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1,
  },

  plot: { width: WIDTH, height: HEIGHT, alignSelf: 'center' },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  leg: {
    position: 'absolute',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  halo: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: '#7FE7C4',
  },
  pin: {
    position: 'absolute',
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHome: { borderRadius: radius.pill, backgroundColor: '#7FE7C4' },
  pinOffice: {
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  cab: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CAB,
    height: CAB,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.30)',
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  statusText: { color: '#FFFFFF', fontFamily: font.medium, fontSize: 12.5 },
  etaText: { color: '#A9C4FF', fontFamily: font.medium, fontSize: 12 },
});
