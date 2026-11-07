import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.Norie.music',
  appName: 'Norie Music',
  webDir: 'dist',
  server: {
    // In development you can point to your dev server:
    // url: 'http://192.168.1.10:5173',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },
};

export default config;
