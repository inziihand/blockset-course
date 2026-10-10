import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ShellAppKey = string;
export type ShellAppStatus = 'enabled' | 'preview' | 'planned';
/** Whole-window presentation policy, independent of device type or trading capabilities. */
export type ShellAppDisplayMode = 'compact' | 'standard' | 'responsive';

/** Metadata compiled with a frontend App; only Apps without dedicated services may use it. */
export type BundledSourceActivation = {
  displayName: string;
  category: 'sample' | 'application';
  removable: boolean;
  protected: false;
  defaultAccessMode: 'public' | 'all_members' | 'grant_required' | 'admins_only' | 'disabled';
  allowedAccessModes: Array<'public' | 'all_members' | 'grant_required' | 'admins_only' | 'disabled'>;
  entitlements: Array<{ key: string; displayName: string; description?: string | null }>;
  adminAllowed: boolean;
};

export type ShellAppProps = {
  /** Declared in the Registry; the Shell applies it to the complete App window. */
  readonly displayMode: ShellAppDisplayMode;
  onOpenAppMenu: () => void;
  onOpenHome: () => void;
  /** False while an opted-in App is retained off-screen; standalone callers may omit it. */
  readonly active?: boolean;
  /** Fresh per activation; suspension/close cancels local work, never a strategy stop. */
  signal: AbortSignal;
};

export type ShellAppDefinition = {
  key: ShellAppKey;
  /** Version present in the current compiled Console bundle. */
  version?: string;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  status: ShellAppStatus;
  /** Public Apps work without Identity; identity Apps also require server-resolved appAccess. */
  access: 'public' | 'identity';
  displayMode: ShellAppDisplayMode;
  /** Host-owned header density; omitted means the existing two-tier header. */
  headerLayout?: 'standard' | 'merged';
  /** Audited Apps only: preserve local state on navigation and suspend background work. */
  keepAlive?: boolean;
  path: `/apps/${string}`;
  load?: () => Promise<{ default: ComponentType<ShellAppProps> }>;
  /** Allows an admin to register an App already included in this exact Console build. */
  sourceActivation?: BundledSourceActivation;
};
