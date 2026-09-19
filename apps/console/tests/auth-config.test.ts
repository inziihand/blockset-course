import { describe, expect, test } from 'vitest';
import { resolveFirebaseAuthConfiguration } from '../src/shared/auth/config';

describe('Firebase Auth environment contract', () => {
  test('keeps the platform usable when Firebase is intentionally unconfigured', () => {
    expect(resolveFirebaseAuthConfiguration({})).toEqual({
      state: 'unconfigured',
      missing: [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_APP_ID',
      ],
    });
  });

  test('treats the source template placeholders as unconfigured', () => {
    expect(resolveFirebaseAuthConfiguration({
      VITE_FIREBASE_API_KEY: 'your_firebase_api_key',
      VITE_FIREBASE_AUTH_DOMAIN: 'your-project-id.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'your-project-id',
      VITE_FIREBASE_APP_ID: 'your_firebase_app_id',
    }).state).toBe('unconfigured');
  });

  test('rejects a partially filled Firebase configuration', () => {
    expect(resolveFirebaseAuthConfiguration({ VITE_FIREBASE_API_KEY: 'public-web-key' })).toEqual({
      state: 'invalid',
      missing: ['VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'],
    });
  });

  test('accepts the minimum Firebase Web App configuration without any admin policy', () => {
    expect(resolveFirebaseAuthConfiguration({
      VITE_FIREBASE_API_KEY: 'public-web-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'example',
      VITE_FIREBASE_APP_ID: '1:123:web:abc',
    })).toEqual({
      state: 'configured',
      config: {
        apiKey: 'public-web-key',
        authDomain: 'example.firebaseapp.com',
        projectId: 'example',
        appId: '1:123:web:abc',
      },
    });
  });
});
