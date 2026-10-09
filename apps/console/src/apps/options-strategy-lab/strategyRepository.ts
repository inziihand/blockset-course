import type { StrategyDraft, UserStrategyRecord } from './types';
import { getApps, initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore/lite';
import { firebaseAuthConfiguration } from '../../shared/auth/config';
import {
  assertStrategyName,
  parseStrategyRecord,
  serializeStrategyDraft,
} from './persistence/strategySchema.js';

const firebaseAppName = 'stratexec-platform-auth';

function configuredFirestore() {
  if (firebaseAuthConfiguration.state !== 'configured') {
    throw new Error('Firebase 尚未完成設定。');
  }
  const existing = getApps().find((app) => app.name === firebaseAppName);
  const app = existing ?? initializeApp(firebaseAuthConfiguration.config, firebaseAppName);
  return getFirestore(app);
}

const strategiesCollection = (uid: string) => collection(
  configuredFirestore(),
  'apps',
  'options-strategy-lab',
  'members',
  uid,
  'strategies',
);

const strategyDocument = (uid: string, id: string) => doc(strategiesCollection(uid), id);

export async function getUserStrategies(uid: string) {
  const snapshot = await getDocs(query(strategiesCollection(uid), orderBy('updatedAt', 'desc')));
  return snapshot.docs.map((document) => {
    const record = parseStrategyRecord(document.id, document.data());
    if (record.kind !== 'user' || record.access !== 'private' || record.ownerUid !== uid) {
      throw new TypeError(`策略 ${document.id} 的擁有者不正確。`);
    }
    return record as UserStrategyRecord;
  });
}

export async function saveStrategy(uid: string, name: string, strategy: StrategyDraft) {
  const id = crypto.randomUUID();
  await setDoc(strategyDocument(uid, id), {
    name: assertStrategyName(name),
    kind: 'user',
    access: 'private',
    ownerUid: uid,
    strategy: serializeStrategyDraft(strategy),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

export async function updateUserStrategy(uid: string, id: string, name: string, strategy: StrategyDraft) {
  await updateDoc(strategyDocument(uid, id), {
    name: assertStrategyName(name),
    strategy: serializeStrategyDraft(strategy),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteUserStrategy(uid: string, id: string) {
  await deleteDoc(strategyDocument(uid, id));
}
