import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flickscient.monetra',
  appName: 'Monetra',
  webDir: 'native/www',
  android: {
    path: 'android-native',
    allowMixedContent: false,
  },
  plugins: {
    // Route WebView fetch/XHR through Android's native HTTP stack.
    // Clerk's native-mode requests can otherwise fail WebView CORS preflights.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
