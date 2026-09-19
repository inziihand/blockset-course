import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { firebaseAuthConfiguration } from './config';

const appName = 'stratexec-platform-auth';
let emulatorConnected = false;

function configuredAuth() {
  if (firebaseAuthConfiguration.state !== 'configured') {
    throw new Error('Firebase Authentication 尚未完成設定。');
  }
  const existing = getApps().find((app) => app.name === appName);
  const app = existing ?? initializeApp(firebaseAuthConfiguration.config, appName);
  const auth = getAuth(app);
  const emulatorUrl = firebaseAuthConfiguration.emulatorUrl;
  if (import.meta.env.DEV && emulatorUrl && !emulatorConnected) {
    const target = new URL(emulatorUrl);
    if (target.protocol !== 'http:' || !target.port || target.username || target.password
      || target.pathname !== '/' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
      throw new Error('Firebase Auth Emulator 必須使用本機 HTTP 位址。');
    }
    connectAuthEmulator(auth, target.origin, { disableWarnings: true });
    emulatorConnected = true;
  }
  return auth;
}

export function observeFirebaseAuth(next: (user: User | null) => void, error: (error: Error) => void) {
  return onAuthStateChanged(configuredAuth(), next, error);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(configuredAuth(), provider)).user;
}

export function signOutFirebase() {
  return signOut(configuredAuth());
}

export async function getFirebaseIdToken(forceRefresh = false) {
  const user = configuredAuth().currentUser;
  if (!user) throw new Error('尚未登入 Firebase Authentication。');
  return user.getIdToken(forceRefresh);
}
