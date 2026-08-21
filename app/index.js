import { registerRootComponent } from 'expo';

import App from './App';
import { initHotjar } from './src/analytics/hotjar';

// Session recording, web only. A no-op on iOS/Android, and a no-op on web too
// unless a Hotjar Site ID is configured — which is the default. Called here
// rather than inside a component so the snippet's call queue exists before the
// first render, and exactly once regardless of how often React re-renders.
initHotjar();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
