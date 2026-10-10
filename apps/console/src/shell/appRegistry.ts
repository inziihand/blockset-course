import type { IdentityMember } from '../shared/auth/identityClient';
import type { AppAccessMode } from '../shared/api/appLifecycle';
import type { ShellAppDefinition, ShellAppKey } from './types';
import { generatedAppRegistry } from './generatedAppRegistry';

// Registry visibility is not an authorization boundary: future APIs must enforce access.
export const appRegistry: readonly ShellAppDefinition[] = generatedAppRegistry;

export function isLaunchableDefinition(
  app: ShellAppDefinition,
): app is ShellAppDefinition & { load: NonNullable<ShellAppDefinition['load']> } {
  return app.status !== 'planned' && typeof app.load === 'function';
}

export const getLaunchableApps = (apps = appRegistry) => apps.filter(isLaunchableDefinition);

/** Preserve the server's complete App order while keeping unknown local previews stable at the end. */
export function orderAppsByKeys(apps: readonly ShellAppDefinition[], appKeys: readonly string[]) {
  const ranks = new Map(appKeys.map((key, index) => [key, index]));
  return [...apps].sort((left, right) => (
    (ranks.get(left.key) ?? Number.MAX_SAFE_INTEGER)
    - (ranks.get(right.key) ?? Number.MAX_SAFE_INTEGER)
  ));
}

export function canAccessDefinition(
  app: ShellAppDefinition,
  member: IdentityMember | null,
  accessMode?: AppAccessMode,
) {
  if (accessMode === 'disabled') return false;
  if (accessMode === 'public' || (!accessMode && app.access === 'public')) return true;
  if (accessMode === 'all_members') return member?.status === 'active';
  return member?.appAccess.some((access) => access.appKey === app.key && access.allowed) === true;
}

export function getAppDefinition(key: ShellAppKey | null, apps = appRegistry) {
  return key === null ? undefined : apps.find((app) => app.key === key);
}

export function validateAppRegistry(apps: readonly ShellAppDefinition[]) {
  const keys = new Set<string>();
  const paths = new Set<string>();
  for (const app of apps) {
    if (!/^[a-z][a-z0-9-]*$/.test(app.key) || !/^\/apps\/[a-z][a-z0-9-]*$/.test(app.path)) {
      throw new Error('App key/path must use a lowercase slug under /apps/');
    }
    if (keys.has(app.key) || paths.has(app.path)) throw new Error('Duplicate App key/path');
    if (!['enabled', 'preview', 'planned'].includes(app.status)) throw new Error('Invalid App status');
    if (!['public', 'identity'].includes(app.access)) throw new Error('Invalid App access boundary');
    if (!['compact', 'standard', 'responsive'].includes(app.displayMode)) throw new Error('App requires a valid displayMode');
    if (app.headerLayout !== undefined && !['standard', 'merged'].includes(app.headerLayout)) throw new Error('Invalid App headerLayout');
    if (app.keepAlive !== undefined && typeof app.keepAlive !== 'boolean') throw new Error('Invalid App keepAlive policy');
    if (app.status !== 'planned' && typeof app.load !== 'function') throw new Error('Enabled App requires a loader');
    keys.add(app.key);
    paths.add(app.path);
  }
  return apps;
}
