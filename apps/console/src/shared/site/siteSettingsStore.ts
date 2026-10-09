import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore/lite';
import { firebaseAuthConfiguration } from '../auth/config';
import { defaultSiteSettings, isSiteSettings, type SiteSettings } from './siteSettings';

const firebaseAppName = 'stratexec-platform-auth';

function configuredApp() {
  if (firebaseAuthConfiguration.state !== 'configured') {
    throw new Error('Firebase 尚未完成設定。');
  }
  return getApps().find(app => app.name === firebaseAppName)
    ?? initializeApp(firebaseAuthConfiguration.config, firebaseAppName);
}

function settingsDocument() {
  return doc(getFirestore(configuredApp()), 'siteSettings', 'public');
}

export async function loadPublishedSiteSettings(): Promise<SiteSettings> {
  const snapshot = await getDoc(settingsDocument());
  if (!snapshot.exists()) return defaultSiteSettings;
  const data = snapshot.data();
  const settings = {
    title: data.title,
    subtitle: data.subtitle,
    logoDataUrl: data.logoDataUrl,
    defaultTheme: data.defaultTheme,
    cornerStyle: data.cornerStyle,
  };
  if (!isSiteSettings(settings)) throw new Error('已發布網站設定格式不正確。');
  return settings;
}

export async function publishSiteSettings(settings: SiteSettings): Promise<SiteSettings> {
  if (!isSiteSettings(settings)) throw new Error('網站設定內容不符合格式。');
  const user = getAuth(configuredApp()).currentUser;
  if (!user) throw new Error('請先登入管理員帳號。');
  await setDoc(settingsDocument(), {
    ...settings,
    updatedByUid: user.uid,
    updatedAt: serverTimestamp(),
  });
  return settings;
}
