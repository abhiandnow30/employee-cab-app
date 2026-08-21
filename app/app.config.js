// ---------------------------------------------------------------------------
// DYNAMIC EXPO CONFIG
//
// WHY THIS FILE EXISTS. app.json is static JSON: `"process.env.FOO"` inside it is
// a literal seventeen-character string, not the value of FOO. The react-native-maps
// plugin needs the Android Google Maps key at BUILD time, and the one thing that
// must not happen is the key being committed into app.json. So app.json keeps
// everything else (Expo reads it first and hands it to us as `config`), and this
// file fills in the one value that comes from the environment.
//
// Verified, not assumed: `npx expo config --type prebuild` with the plugin value
// written straight into app.json resolved to
//     androidGoogleMapsApiKey: 'process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY'
// i.e. the literal string, which would have been shipped as the API key.
//
// The key itself lives in app/.env as EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (git-ignored)
// and, for CI builds, as an EAS secret. It is restricted by application/package in
// the Google Cloud console rather than treated as secret — see the notes in the
// change summary — because any key shipped in a mobile binary is extractable.
//
// A MISSING KEY IS NOT A BUILD FAILURE. Android shows a blank grey map instead;
// iOS is unaffected because it uses Apple Maps, which needs no key. Warning rather
// than throwing keeps `expo config`, web builds and iOS builds working for anyone
// who hasn't set it up.
// ---------------------------------------------------------------------------

module.exports = ({ config }) => {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  const plugins = (config.plugins || []).map((entry) => {
    if (!Array.isArray(entry) || entry[0] !== 'react-native-maps') return entry;
    const [name, options = {}] = entry;
    return [name, { ...options, androidGoogleMapsApiKey: key }];
  });

  if (!key) {
    console.warn(
      '[app.config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set — the Android map ' +
        'will render blank. iOS (Apple Maps) and web (Leaflet) are unaffected.'
    );
  }

  return { ...config, plugins };
};
