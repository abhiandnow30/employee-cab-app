// ---------------------------------------------------------------------------
// Dropdown — a reusable "pick one from a list" control (built on Paper's Menu).
//   • compact  (default) → a rounded pill anchor, for tight spaces like table
//                          cells (used in the Self Roster grid). Supports an
//                          optional leadingIcon + hover highlight (web).
//   • !compact           → a full-width form FIELD: value on the left, chevron
//                          on the right, aligned like a text input.
//
// Optional grouping: pass `groupBy(option) => 'Morning' | null` and `groupOrder`
// to render labelled sections inside the menu (used for time-of-day buckets).
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Menu, Text, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme';

export default function Dropdown({
  value,
  options,
  onSelect,
  compact = true,
  format = (v) => String(v),
  placeholder = 'Select',
  disabled = false,
  leadingIcon,
  groupBy,
  groupOrder,
  status, // 'error' | 'success' | undefined — tints the (non-compact) field border
}) {
  const [visible, setVisible] = useState(false);
  const hasValue = value != null && value !== '';
  const shown = hasValue ? format(value) : placeholder;

  const open = () => !disabled && setVisible(true);

  // The tappable element the menu attaches to.
  const anchor = compact ? (
    <Pressable
      onPress={open}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, expanded: visible }}
      accessibilityLabel={`${placeholder}: ${hasValue ? shown : 'not selected'}`}
      style={({ hovered, focused }) => [
        styles.compactAnchor,
        hasValue && styles.compactAnchorFilled,
        (hovered || focused) && !disabled && styles.compactAnchorHover,
        disabled && styles.disabled,
      ]}
    >
      {leadingIcon ? (
        <MaterialCommunityIcons
          name={leadingIcon}
          size={16}
          color={hasValue ? colors.primary : colors.muted}
          style={styles.leading}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.compactText, hasValue ? styles.compactTextFilled : styles.placeholderText]}
      >
        {shown}
      </Text>
      <MaterialCommunityIcons name="chevron-down" size={18} color={colors.muted} />
    </Pressable>
  ) : (
    <Pressable
      style={({ hovered, focused }) => [
        styles.field,
        status === 'error' && styles.fieldError,
        status === 'success' && styles.fieldSuccess,
        (hovered || focused) && !disabled && styles.fieldHover,
        disabled && styles.disabled,
      ]}
      onPress={open}
      accessibilityRole="button"
      accessibilityState={{ disabled, expanded: visible }}
    >
      {leadingIcon ? (
        <MaterialCommunityIcons name={leadingIcon} size={18} color={colors.muted} style={styles.leading} />
      ) : null}
      <Text numberOfLines={1} style={[styles.fieldText, !hasValue && styles.placeholderText]}>
        {shown}
      </Text>
      {status === 'success' ? (
        <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} style={styles.trailingStatus} />
      ) : null}
      <MaterialCommunityIcons name="chevron-down" size={22} color={colors.muted} />
    </Pressable>
  );

  // Build the menu body — optionally split into labelled groups.
  function renderItem(opt) {
    const selected = hasValue && String(value) === String(opt);
    return (
      <Menu.Item
        key={String(opt)}
        title={format(opt)}
        trailingIcon={selected ? 'check' : undefined}
        titleStyle={selected ? styles.itemSelected : undefined}
        onPress={() => {
          onSelect(opt);
          setVisible(false);
        }}
      />
    );
  }

  function renderBody() {
    if (!groupBy) return options.map(renderItem);
    const buckets = {};
    const ungrouped = [];
    options.forEach((o) => {
      const g = groupBy(o);
      if (!g) ungrouped.push(o);
      else (buckets[g] = buckets[g] || []).push(o);
    });
    const order = groupOrder || Object.keys(buckets);
    const nodes = ungrouped.map(renderItem);
    order.forEach((g, i) => {
      if (!buckets[g]?.length) return;
      if (nodes.length) nodes.push(<Divider key={`d-${g}`} style={styles.groupDivider} />);
      nodes.push(
        <Text key={`h-${g}`} style={styles.groupHeader}>
          {g}
        </Text>
      );
      buckets[g].forEach((o) => nodes.push(renderItem(o)));
    });
    return nodes;
  }

  return (
    <View style={compact ? styles.compactWrap : styles.fullWidth}>
      <Menu
        visible={visible}
        onDismiss={() => setVisible(false)}
        anchor={anchor}
        contentStyle={styles.menuContent}
      >
        {renderBody()}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  compactWrap: { alignSelf: 'stretch' },
  fullWidth: { alignSelf: 'stretch' },
  compactAnchor: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 130,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  compactAnchorFilled: { borderColor: colors.primary, backgroundColor: '#F0F6FF' },
  compactAnchorHover: { borderColor: colors.primaryLight, backgroundColor: '#F5F9FF' },
  compactText: { flex: 1, fontSize: 14 },
  compactTextFilled: { color: colors.primary, fontWeight: '600' },
  leading: { marginRight: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  fieldError: { borderColor: colors.danger, backgroundColor: '#FEF3F3' },
  fieldSuccess: { borderColor: colors.success },
  fieldHover: { borderColor: colors.primaryLight },
  trailingStatus: { marginRight: 6 },
  disabled: { opacity: 0.45 },
  fieldText: { flex: 1, fontSize: 15, color: colors.text },
  placeholderText: { color: colors.muted },
  menuContent: { minWidth: 200, borderRadius: 12, paddingVertical: 4 },
  groupHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
  },
  groupDivider: { marginTop: 4 },
  itemSelected: { color: colors.primary, fontWeight: '700' },
});
