// ---------------------------------------------------------------------------
// Dropdown — a small reusable "pick one from a list" control.
// Built on React Native Paper's Menu. Shows the current value as a button;
// tapping it opens a menu of options.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { View } from 'react-native';
import { Menu, Button } from 'react-native-paper';

// Props:
//   value     — the currently selected option
//   options   — array of options to choose from
//   onSelect  — called with the chosen option
//   format    — optional (opt) => string for how to DISPLAY an option
//   placeholder — text shown when no value is selected yet
export default function Dropdown({
  value,
  options,
  onSelect,
  compact = true,
  format = (v) => String(v),
  placeholder = 'Select',
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Menu
      visible={visible}
      onDismiss={() => setVisible(false)}
      anchor={
        <Button
          mode="outlined"
          compact={compact}
          icon="chevron-down"
          contentStyle={{ flexDirection: 'row-reverse' }} // icon on the right
          onPress={() => setVisible(true)}
        >
          {value != null && value !== '' ? format(value) : placeholder}
        </Button>
      }
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
  );
}
