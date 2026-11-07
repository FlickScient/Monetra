import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flickscient.monetra',
  appName: 'Monetra',
  webDir: 'native/www',
  android: {
    path: 'android-native',
    allowMixedContent: false,
  },
};

export default config;
