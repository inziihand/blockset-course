import type {
  StrategyDraft,
  StrategyRecord,
  StoredStrategyDraft,
} from '../types';

export const STRATEGY_SCHEMA_VERSION: 3;

export function isStrategyDraft(value: unknown): value is StrategyDraft;
export function assertStrategyDraft(value: unknown): StrategyDraft;
export function serializeStrategyDraft(value: unknown): StoredStrategyDraft;
export function deserializeStrategyDraft(value: unknown): StrategyDraft;
export function assertStrategyName(value: unknown): string;
export function parseStrategyRecord(id: string, value: unknown): StrategyRecord;
