export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
};

export type FirebaseAuthConfiguration =
  | { state: 'unconfigured'; missing: readonly string[] }
  | { state: 'invalid'; missing: readonly string[] }
  | { state: 'configured'; config: FirebaseWebConfig; emulatorUrl?: string };

const requiredKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const value = (environment: Record<string, unknown>, key: string) => {
  const raw = environment[key];
  return typeof raw === 'string' ? raw.trim() : '';
};

const placeholderPattern = /^(?:your[_-]|your-project-id(?:\.|$))/i;
const configuredValue = (environment: Record<string, unknown>, key: string) => {
  const candidate = value(environment, key);
  return placeholderPattern.test(candidate) ? '' : candidate;
};

export function resolveFirebaseAuthConfiguration(environment: Record<string, unknown>): FirebaseAuthConfiguration {
  const missing = requiredKeys.filter((key) => !configuredValue(environment, key));
  const supplied = requiredKeys.length - missing.length;
  if (supplied === 0) return { state: 'unconfigured', missing };
  if (missing.length > 0) return { state: 'invalid', missing };

  const config: FirebaseWebConfig = {
    apiKey: configuredValue(environment, 'VITE_FIREBASE_API_KEY'),
    authDomain: configuredValue(environment, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: configuredValue(environment, 'VITE_FIREBASE_PROJECT_ID'),
    appId: configuredValue(environment, 'VITE_FIREBASE_APP_ID'),
  };
  const optional = {
    storageBucket: configuredValue(environment, 'VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: configuredValue(environment, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
    measurementId: configuredValue(environment, 'VITE_FIREBASE_MEASUREMENT_ID'),
  };
  for (const [key, optionalValue] of Object.entries(optional)) {
    if (optionalValue) Object.assign(config, { [key]: optionalValue });
  }
  const emulatorUrl = value(environment, 'VITE_FIREBASE_AUTH_EMULATOR_URL');
  return { state: 'configured', config, ...(emulatorUrl ? { emulatorUrl } : {}) };
}

export const firebaseAuthConfiguration = resolveFirebaseAuthConfiguration(import.meta.env);
