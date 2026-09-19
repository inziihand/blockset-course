import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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
