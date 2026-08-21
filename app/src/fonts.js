// ---------------------------------------------------------------------------
// FONTS — Poppins, used for every piece of text in the app.
//
// HOW WEIGHT WORKS HERE. Poppins ships as one file per weight, and expo-font
// registers each file under its own family name ("Poppins_600SemiBold" and so
// on). So a bold heading is `fontFamily: font.bold`, NOT `fontWeight: 'bold'`:
//
//   • On Android a `fontWeight` with no matching family is simply ignored, so
//     the "bold" heading would have rendered regular.
//   • On the web, asking for weight 700 on a face the browser has registered at
//     the default weight makes it paint a synthetic fake-bold — on top of a face
//     that is already bold. Twice-bolded text looks smudged.
//
// theme.js pins `fontWeight: 'normal'` on every type variant for that reason;
// weight is always chosen through this map.
//
// Only the five weights the UI actually uses are loaded — every extra face is
// another file the app waits on at startup.
// ---------------------------------------------------------------------------

// Imported one weight at a time, from the per-weight subpaths. The package's
// root index re-exports all EIGHTEEN faces with a static `require` each, so a
// single `from '@expo-google-fonts/poppins'` drags every italic and every
// unused weight into the bundle — about 2 MB of font nobody ever sees, shipped
// inside the phone binary. `useFonts` comes straight from expo-font, which is
// what the font package re-exports anyway.
import { useFonts } from 'expo-font';
import { Poppins_300Light } from '@expo-google-fonts/poppins/300Light';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';

// The family names, by role. Screens import this from theme.js (`font`).
export const font = {
  light: 'Poppins_300Light',
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
};

const FONT_MAP = {
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
};

// Returns true once it is safe to render text.
//
// A FAILED LOAD IS NOT A DEAD APP. If the font files can't be fetched (an
// offline first run on the web, say) this still returns true so the UI renders
// in the system face rather than sitting on a spinner for ever — the layout is
// identical either way, only the letterforms differ.
export function useAppFonts() {
  const [loaded, error] = useFonts(FONT_MAP);
  return loaded || !!error;
}
