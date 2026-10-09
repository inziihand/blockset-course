export type PositionRow = {
  strike: number;
  callQty: number;
  putQty: number;
};

export type ModelParams = {
  spot: number;
  iv: number;
  days: number;
  carryRate: number;
};

export type Greeks = {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  intrinsic: number;
  timeValue: number;
};

export type StrikeSettings = {
  initialSpot: number;
  strikeStep: number;
};

export type ChartMode = 'pnl' | 'payoff' | 'delta' | 'gamma' | 'theta' | 'vega' | 'rho';

export type ChartScaleMode = 'auto' | 'raw' | 'normalized';

export type StrategyDraft = {
  schemaVersion: 3;
  strikeSettings: StrikeSettings;
  rows: PositionRow[];
  underlyingQty: number;
  params: ModelParams;
  entryCost: number;
  chart: {
    modes: ChartMode[];
    scaleMode: ChartScaleMode;
  };
};

export type StoredStrategyDraft = Omit<StrategyDraft, 'rows'> & {
  rows: {
    strikes: number[];
    callQty: number[];
    putQty: number[];
  };
};

export type StrategyRecordKind = 'user' | 'template';

export type StrategyAccess = 'private' | 'course';

export type StrategyRecord = {
  id: string;
  name: string;
  kind: StrategyRecordKind;
  access: StrategyAccess;
  ownerUid: string | null;
  strategy: StrategyDraft;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
};

export type UserStrategyRecord = StrategyRecord & {
  kind: 'user';
  access: 'private';
  ownerUid: string;
};

export type StrategyTemplateRecord = StrategyRecord & {
  kind: 'template';
  access: 'course';
  ownerUid: null;
};

export type StrategyTemplateDefinition = {
  key: StrategyTemplateKey;
  label: string;
  kind: 'template';
  access: 'course';
};

export type StrategyTemplateKey =
  | 'longCall'
  | 'longPut'
  | 'longStraddle'
  | 'longStrangle'
  | 'shortStrangle'
  | 'bullCallSpread'
  | 'bearPutSpread'
  | 'ironCondor'
  | 'longButterfly';
