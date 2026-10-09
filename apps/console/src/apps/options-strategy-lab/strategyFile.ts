import type { StrategyDraft } from './types';
import {
  assertStrategyName,
  deserializeStrategyDraft,
  serializeStrategyDraft,
} from './persistence/strategySchema.js';

const FILE_FORMAT = 'stratexec-options-strategy';
const FILE_VERSION = 1;
const MAX_FILE_BYTES = 256 * 1024;

export type ImportedStrategyFile = {
  name: string;
  strategy: StrategyDraft;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value);

export function stringifyStrategyFile(name: string, strategy: StrategyDraft) {
  return JSON.stringify({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: assertStrategyName(name),
    strategy: serializeStrategyDraft(strategy),
  }, null, 2);
}

export function parseStrategyFile(source: string): ImportedStrategyFile {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new TypeError('策略 JSON 無法解析。');
  }
  if (!isPlainObject(value)
    || Object.keys(value).sort().join(',') !== 'format,name,strategy,version'
    || value.format !== FILE_FORMAT
    || value.version !== FILE_VERSION) {
    throw new TypeError('不是支援的策略檔案。');
  }
  return {
    name: assertStrategyName(value.name),
    strategy: deserializeStrategyDraft(value.strategy),
  };
}

export async function readStrategyFile(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new TypeError('策略檔案不可超過 256 KB。');
  return parseStrategyFile(await file.text());
}

export function downloadStrategyFile(name: string, strategy: StrategyDraft) {
  const json = stringifyStrategyFile(name, strategy);
  const safeName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 80) || '未命名策略';
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}.strategy.json`;
  link.click();
  URL.revokeObjectURL(url);
}
