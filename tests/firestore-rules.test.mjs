import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';

let environment;

before(async () => {
  const rules = await readFile(new URL('../infrastructure/firebase/firestore.rules', import.meta.url), 'utf8');
  environment = await initializeTestEnvironment({
    projectId: 'demo-stratexec-platform',
    firestore: { rules },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, 'members', 'member-a'), {
      uid: 'member-a', email: 'member@example.com', role: 'member', status: 'active', plan: 'free',
    });
    await setDoc(doc(database, 'members', 'member-b'), {
      uid: 'member-b', email: 'other@example.com', role: 'member', status: 'active', plan: 'free',
    });
    await setDoc(doc(database, 'members', 'inactive-member'), {
      uid: 'inactive-member', email: 'inactive@example.com', role: 'member', status: 'disabled', plan: 'free',
    });
    await setDoc(doc(database, 'members', 'member-a', 'appGrants', 'premium-course'), {
      enabled: true,
    });
    await setDoc(doc(database, 'adminAuditLogs', 'audit-1'), { action: 'seed' });
    await setDoc(doc(database, 'appPolicies', 'premium-course'), {
      appKey: 'premium-course', accessMode: 'all_members', adminAllowed: true,
    });
    await setDoc(doc(database, 'appInstallations', 'premium-course'), {
      appKey: 'premium-course', status: 'installed', removable: true,
    });
  });
});

after(async () => environment?.cleanup());

test('platform identity documents are never browser-readable', async () => {
  const owner = environment.authenticatedContext('member-a', {
    email: 'member@example.com', email_verified: true,
  }).firestore();
  await assertFails(getDoc(doc(owner, 'members', 'member-a')));
  await assertFails(getDoc(doc(owner, 'members', 'member-a', 'appGrants', 'premium-course')));
  await assertFails(getDoc(doc(owner, 'appPolicies', 'premium-course')));
  await assertFails(getDoc(doc(owner, 'appInstallations', 'premium-course')));
});

test('admin claims do not bypass the same-origin Identity API', async () => {
  const admin = environment.authenticatedContext('admin-a', { admin: true }).firestore();
  await assertFails(getDoc(doc(admin, 'adminAuditLogs', 'audit-1')));
});

test('unknown App storage is denied by default', async () => {
  const owner = environment.authenticatedContext('member-a').firestore();
  const target = doc(owner, 'apps', 'future-app', 'members', 'member-a', 'drafts', 'draft-1');
  await assertFails(setDoc(target, { value: 'not-reviewed' }));
});

test('unauthenticated access is denied', async () => {
  const guest = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(guest, 'members', 'member-a')));
  assert.ok(true);
});

const strategyDocument = (ownerUid, name = '測試策略') => ({
  name,
  kind: 'user',
  access: 'private',
  ownerUid,
  strategy: {
    schemaVersion: 3,
    strikeSettings: { initialSpot: 100, strikeStep: 5 },
    rows: {
      strikes: Array.from({ length: 12 }, (_, index) => 75 + index * 5),
      callQty: Array(12).fill(0),
      putQty: Array(12).fill(0),
    },
    underlyingQty: 0,
    params: { spot: 100, iv: 0.2, days: 30, carryRate: 0.01 },
    entryCost: 0,
    chart: { modes: ['pnl'], scaleMode: 'auto' },
  },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test('active members can create, list, update and delete only their private strategies', async () => {
  const owner = environment.authenticatedContext('member-a').firestore();
  const target = doc(owner, 'apps', 'options-strategy-lab', 'members', 'member-a', 'strategies', 'strategy-crud');
  await assertSucceeds(setDoc(target, strategyDocument('member-a')));
  await assertSucceeds(getDoc(target));
  await assertSucceeds(getDocs(query(
    collection(owner, 'apps', 'options-strategy-lab', 'members', 'member-a', 'strategies'),
    orderBy('updatedAt', 'desc'),
  )));
  await assertSucceeds(updateDoc(target, { name: '更新策略', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(target));
});

test('strategy rules reject cross-member, inactive and malformed writes', async () => {
  const owner = environment.authenticatedContext('member-a').firestore();
  const other = environment.authenticatedContext('member-b').firestore();
  const inactive = environment.authenticatedContext('inactive-member').firestore();
  const ownerPath = ['apps', 'options-strategy-lab', 'members', 'member-a', 'strategies', 'strategy-private'];
  await assertSucceeds(setDoc(doc(owner, ...ownerPath), strategyDocument('member-a')));
  await assertFails(getDoc(doc(other, ...ownerPath)));
  await assertFails(setDoc(doc(other, ...ownerPath), strategyDocument('member-a')));
  await assertFails(setDoc(
    doc(inactive, 'apps', 'options-strategy-lab', 'members', 'inactive-member', 'strategies', 'strategy-inactive'),
    strategyDocument('inactive-member'),
  ));
  await assertFails(setDoc(
    doc(owner, 'apps', 'options-strategy-lab', 'members', 'member-a', 'strategies', 'strategy-invalid'),
    strategyDocument('member-a', ''),
  ));
});
