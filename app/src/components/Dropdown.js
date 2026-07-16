// ---------------------------------------------------------------------------
// Dropdown — a reusable "pick one from a list" control (built on Paper's Menu).
//   • compact  (default) → a small button, for tight spaces like table cells
//                          (used in the Self Roster grid)
//   • !compact           → a full-width form FIELD: value on the left, chevron
//                          on the right, aligned like a text input
//                          (used on the Adhoc / Feedback forms)
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Menu, Button, Text } from 'react-native-paper';
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
}) {
  const [visible, setVisible] = useState(false);
  const hasValue = value != null && value !== '';
  const shown = hasValue ? format(value) : placeholder;

  // The tappable element the menu attaches to.
  const anchor = compact ? (
    <Button
      mode="outlined"
      compact
      icon="chevron-down"
      disabled={disabled}
      contentStyle={styles.compactContent} // icon on the right
      onPress={() => setVisible(true)}
    >
      {shown}
    </Button>
  ) : (
    <Pressable
      style={[styles.field, disabled && styles.fieldDisabled]}
      onPress={() => !disabled && setVisible(true)}
    >
      <Text
        numberOfLines={1}
        style={[styles.fieldText, !hasValue && styles.placeholderText]}
      >
        {shown}
      </Text>
      <MaterialCommunityIcons name="chevron-down" size={22} color={colors.muted} />
    </Pressable>
  );

  return (
    <View style={compact ? undefined : styles.fullWidth}>
      <Menu
        visible={visible}
        onDismiss={() => setVisible(false)}
        anchor={anchor}
        // Let the menu be at least as wide as a typical field.
        contentStyle={compact ? undefined : styles.menuContent}
      >
        {options.map((opt) => (
          <Menu.Item
            key={String(opt)}
            title={format(opt)}
            onPress={() => {
              onSelect(opt);
              setVisible(false);
            }}
          />
        ))}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  compactContent: { flexDirection: 'row-reverse' },
  fullWidth: { alignSelf: 'stretch' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#B7C2D0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  fieldDisabled: { opacity: 0.5 },
  fieldText: { flex: 1, fontSize: 15, color: colors.text },
  placeholderText: { color: colors.muted },
  menuContent: { minWidth: 220 },
});
