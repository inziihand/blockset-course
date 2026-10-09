const STRATEGY_ROW_COUNT = 12;
const LEGACY_STRATEGY_ROW_COUNT = 11;
const CHART_MODES = new Set(['pnl', 'payoff', 'delta', 'gamma', 'theta', 'vega', 'rho']);
const CHART_SCALE_MODES = new Set(['auto', 'raw', 'normalized']);
const STRATEGY_KINDS = new Set(['user', 'template']);
const STRATEGY_ACCESS_LEVELS = new Set(['private', 'course']);

export const STRATEGY_SCHEMA_VERSION = 3;
const LEGACY_STRATEGY_SCHEMA_VERSIONS = new Set([1, 2]);
const LEGACY_DRAFT_KEYS = ['schemaVersion', 'strikeSettings', 'rows', 'params', 'entryCost', 'chart'];
const DRAFT_KEYS = [...LEGACY_DRAFT_KEYS, 'underlyingQty'];

const isPlainObject = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value);

const hasExactKeys = (value, expectedKeys) => {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
};

const isFiniteNumberInRange = (value, min, max) =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= min
  && value <= max;

const isTimestamp = (value) => Boolean(value)
  && typeof value.toMillis === 'function'
  && Number.isFinite(value.toMillis());

const isValidPositionRow = (row) =>
  hasExactKeys(row, ['strike', 'callQty', 'putQty'])
  && isFiniteNumberInRange(row.strike, 0.0001, 1_000_000_000)
  && Number.isInteger(row.callQty)
  && row.callQty >= -10_000
  && row.callQty <= 10_000
  && Number.isInteger(row.putQty)
  && row.putQty >= -10_000
  && row.putQty <= 10_000;

const addMissingStrike = (rows, strikeStep) => {
  if (!Array.isArray(rows) || rows.length !== LEGACY_STRATEGY_ROW_COUNT) return rows;
  const step = Math.max(strikeStep, 0.01);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const lowerStrike = Number((first.strike - step).toFixed(4));
  if (lowerStrike > 0) return [{ strike: lowerStrike, callQty: 0, putQty: 0 }, ...rows];
  return [...rows, { strike: Number((last.strike + step).toFixed(4)), callQty: 0, putQty: 0 }];
};

const addMissingStoredStrike = (rows, strikeStep) => {
  if (
    !hasExactKeys(rows, ['strikes', 'callQty', 'putQty'])
    || !Array.isArray(rows.strikes)
    || !Array.isArray(rows.callQty)
    || !Array.isArray(rows.putQty)
    || rows.strikes.length !== LEGACY_STRATEGY_ROW_COUNT
    || rows.callQty.length !== LEGACY_STRATEGY_ROW_COUNT
    || rows.putQty.length !== LEGACY_STRATEGY_ROW_COUNT
  ) return rows;

  const step = Math.max(strikeStep, 0.01);
  const lowerStrike = Number((rows.strikes[0] - step).toFixed(4));
  if (lowerStrike > 0) {
    return {
      strikes: [lowerStrike, ...rows.strikes],
      callQty: [0, ...rows.callQty],
      putQty: [0, ...rows.putQty],
    };
  }
  return {
    strikes: [...rows.strikes, Number((rows.strikes.at(-1) + step).toFixed(4))],
    callQty: [...rows.callQty, 0],
    putQty: [...rows.putQty, 0],
  };
};

const normalizeLegacyDraft = (value) => {
  if (!isPlainObject(value) || !LEGACY_STRATEGY_SCHEMA_VERSIONS.has(value.schemaVersion)) return value;
  const isVersionOne = value.schemaVersion === 1;
  if (!hasExactKeys(value, isVersionOne ? LEGACY_DRAFT_KEYS : DRAFT_KEYS)) return value;

  const underlyingQty = isVersionOne ? 0 : value.underlyingQty;
  const strikeStep = value.strikeSettings?.strikeStep;
  const rows = Array.isArray(value.rows)
    ? addMissingStrike(value.rows, strikeStep)
    : addMissingStoredStrike(value.rows, strikeStep);
  return { ...value, schemaVersion: STRATEGY_SCHEMA_VERSION, underlyingQty, rows };
};

export function isStrategyDraft(value) {
  if (!hasExactKeys(value, DRAFT_KEYS)) return false;

  if (value.schemaVersion !== STRATEGY_SCHEMA_VERSION) return false;
  if (!hasExactKeys(value.strikeSettings, ['initialSpot', 'strikeStep'])) return false;
  if (!isFiniteNumberInRange(value.strikeSettings.initialSpot, 0.0001, 1_000_000_000)) return false;
  if (!isFiniteNumberInRange(value.strikeSettings.strikeStep, 0.01, 100_000_000)) return false;
  if (!Array.isArray(value.rows) || value.rows.length !== STRATEGY_ROW_COUNT) return false;
  if (!value.rows.every(isValidPositionRow)) return false;
  if (!Number.isInteger(value.underlyingQty) || value.underlyingQty < -10_000 || value.underlyingQty > 10_000) return false;

  if (!hasExactKeys(value.params, ['spot', 'iv', 'days', 'carryRate'])) return false;
  if (!isFiniteNumberInRange(value.params.spot, 0.0001, 1_000_000_000)) return false;
  if (!isFiniteNumberInRange(value.params.iv, 0.0001, 5)) return false;
  if (!Number.isInteger(value.params.days) || value.params.days < 0 || value.params.days > 365) return false;
  if (!isFiniteNumberInRange(value.params.carryRate, -1, 1)) return false;
  if (!isFiniteNumberInRange(value.entryCost, -1_000_000_000_000, 1_000_000_000_000)) return false;

  if (!hasExactKeys(value.chart, ['modes', 'scaleMode'])) return false;
  if (!Array.isArray(value.chart.modes) || value.chart.modes.length < 1 || value.chart.modes.length > 7) return false;
  if (!value.chart.modes.every((mode) => CHART_MODES.has(mode))) return false;
  if (new Set(value.chart.modes).size !== value.chart.modes.length) return false;
  return CHART_SCALE_MODES.has(value.chart.scaleMode);
}

export function assertStrategyDraft(value) {
  const normalized = normalizeLegacyDraft(value);
  if (!isStrategyDraft(normalized)) {
    throw new TypeError('策略資料格式不正確或超出允許範圍。');
  }
  return normalized;
}

export function serializeStrategyDraft(value) {
  const strategy = assertStrategyDraft(value);
  return {
    ...strategy,
    rows: {
      strikes: strategy.rows.map((row) => row.strike),
      callQty: strategy.rows.map((row) => row.callQty),
      putQty: strategy.rows.map((row) => row.putQty),
    },
  };
}

export function deserializeStrategyDraft(value) {
  const normalized = normalizeLegacyDraft(value);
  if (!hasExactKeys(normalized, DRAFT_KEYS)) throw new TypeError('策略文件格式不正確。');
  if (!hasExactKeys(normalized.rows, ['strikes', 'callQty', 'putQty'])) {
    throw new TypeError('策略部位矩陣格式不正確。');
  }
  if (
    !Array.isArray(normalized.rows.strikes)
    || !Array.isArray(normalized.rows.callQty)
    || !Array.isArray(normalized.rows.putQty)
    || normalized.rows.strikes.length !== STRATEGY_ROW_COUNT
    || normalized.rows.callQty.length !== STRATEGY_ROW_COUNT
    || normalized.rows.putQty.length !== STRATEGY_ROW_COUNT
  ) throw new TypeError('策略部位矩陣必須包含 12 列。');

  return assertStrategyDraft({
    ...normalized,
    rows: normalized.rows.strikes.map((strike, index) => ({
      strike,
      callQty: normalized.rows.callQty[index],
      putQty: normalized.rows.putQty[index],
    })),
  });
}

export function assertStrategyName(value) {
  if (typeof value !== 'string') throw new TypeError('策略名稱必須是文字。');
  const normalizedName = value.trim();
  if (normalizedName.length < 1 || normalizedName.length > 120) {
    throw new TypeError('策略名稱必須介於 1 到 120 個字元。');
  }
  return normalizedName;
}

export function parseStrategyRecord(id, value) {
  if (!hasExactKeys(value, [
    'name',
    'kind',
    'access',
    'ownerUid',
    'strategy',
    'createdAt',
    'updatedAt',
  ])) throw new TypeError(`策略 ${id} 的文件欄位不正確。`);

  const name = assertStrategyName(value.name);
  if (!STRATEGY_KINDS.has(value.kind)) throw new TypeError(`策略 ${id} 的種類不正確。`);
  if (!STRATEGY_ACCESS_LEVELS.has(value.access)) throw new TypeError(`策略 ${id} 的存取層級不正確。`);
  if (value.ownerUid !== null && (typeof value.ownerUid !== 'string' || value.ownerUid.length < 1 || value.ownerUid.length > 128)) {
    throw new TypeError(`策略 ${id} 的擁有者不正確。`);
  }
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    throw new TypeError(`策略 ${id} 的時間欄位不正確。`);
  }

  const strategy = deserializeStrategyDraft(value.strategy);
  if (value.kind === 'user' && (value.access !== 'private' || value.ownerUid === null)) {
    throw new TypeError(`個人策略 ${id} 的權限欄位不正確。`);
  }
  if (value.kind === 'template' && (value.access !== 'course' || value.ownerUid !== null)) {
    throw new TypeError(`策略模板 ${id} 的權限欄位不正確。`);
  }

  return {
    id,
    name,
    kind: value.kind,
    access: value.access,
    ownerUid: value.ownerUid,
    strategy,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
