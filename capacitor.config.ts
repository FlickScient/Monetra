import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flickscient.monetra',
  appName: 'Monetra',
  webDir: 'out',
  bundledWebRuntime: false,
  android: { allowMixedContent: false },
};

export default config;
