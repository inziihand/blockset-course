import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ShellAppKey = string;
export type ShellAppStatus = 'enabled' | 'preview' | 'planned';
/** Whole-window presentation policy, independent of device type or trading capabilities. */
export type ShellAppDisplayMode = 'compact' | 'responsive';

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
};
