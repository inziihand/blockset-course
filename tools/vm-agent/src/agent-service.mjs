import { randomUUID } from 'node:crypto';
import { DesiredStateError } from './desired-state.mjs';
import { assertVmSafetyPreflight, VmSafetyError } from './safety-preflight.mjs';

export class VmAgentOperationError extends Error {
  constructor(message, { status = 409, indeterminate = false } = {}) {
    super(message);
    this.name = 'VmAgentOperationError';
    this.status = status;
    this.indeterminate = indeterminate;
  }
}

const safeError = (error) => String(error?.message ?? 'VM operation failed.')
  .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500);

export function createUnavailableVmRuntime() {
  return Object.freeze({
    mode: 'disabled',
    async inspect() { throw new VmAgentOperationError('VM container runtime driver is disabled.', { status: 501 }); },
    async prepareBindings() { throw new VmAgentOperationError('VM container runtime driver is disabled.', { status: 501 }); },
    async stage() { throw new VmAgentOperationError('VM container runtime driver is disabled.', { status: 501 }); },
    async activate() { throw new VmAgentOperationError('VM container runtime driver is disabled.', { status: 501 }); },
    async reconcile() { return { outcome: 'unknown', layers: { vm: 'unknown', agent: 'ready', worker: 'unknown', strategy: 'disabled' } }; },
  });
}

function publicState(state, runtimeMode) {
  return {
    schemaVersion: 1,
    generation: state.generation,
    status: state.status,
    current: state.current ? {
      serviceKey: state.current.desiredState.serviceKey,
      revision: state.current.desiredState.revision,
      imageDigest: state.current.desiredState.image.digest.slice(7),
      image: state.current.desiredState.image.uri,
      appliedAt: state.current.appliedAt,
      layers: state.current.layers,
      tradingEnabled: false,
    } : null,
    previousRevision: state.previous?.desiredState?.revision ?? null,
    lastError: state.lastError,
    runtimeMode,
    events: (state.events ?? []).map((event) => ({ ...event })),
  };
}

export function createVmAgentService({ verifier, store, runtime, now = () => new Date() }) {
  if (!verifier || !store || !runtime) throw new Error('VM Agent service dependencies are incomplete.');
  const event = (state, type, details = {}) => ({
    ...state,
    events: [...(state.events ?? []), { eventId: randomUUID(), type, at: now().toISOString(), ...details }],
  });
  return Object.freeze({
    async status() { return publicState(await store.read(), runtime.mode); },
    async apply(envelope) {
      const desired = verifier.verify(envelope);
      let state = await store.read();
      if (desired.generation <= state.generation) throw new DesiredStateError('Desired state generation must increase monotonically.', 409);
      state = await store.write(event({ ...state, status: 'preflight', lastError: null }, 'desired-state.accepted', {
        generation: desired.generation, operation: desired.operation, revision: desired.revision,
      }));
      let externalWriteStarted = false;
      try {
        const snapshot = await runtime.inspect(desired);
        const preflight = assertVmSafetyPreflight(desired, snapshot, now());
        state = await store.write(event(state, 'preflight.passed', { checkedAt: preflight.checkedAt }));
        await runtime.prepareBindings(desired);
        const staged = await runtime.stage(desired);
        externalWriteStarted = true;
        if (staged?.imageDigest !== desired.image.digest.slice(7)) throw new VmAgentOperationError('Staged image digest does not match desired state.', { indeterminate: true });
        const activated = await runtime.activate(desired, staged);
        if (activated?.revision !== desired.revision) throw new VmAgentOperationError('Runtime revision does not match desired state.', { indeterminate: true });
        const layers = {
          vm: activated.layers?.vm ?? 'ready', agent: 'ready', worker: activated.layers?.worker ?? 'ready',
          strategy: 'disabled',
        };
        state = event({
          ...state,
          generation: desired.generation,
          status: 'ready',
          previous: state.current,
          current: { desiredState: desired, appliedAt: now().toISOString(), layers, runtimeEvidence: activated },
          lastError: null,
        }, desired.operation === 'rollback' ? 'runtime.rolled-back' : 'runtime.activated', { revision: desired.revision });
        return publicState(await store.write(state), runtime.mode);
      } catch (error) {
        const blockers = error instanceof VmSafetyError ? error.blockers : [];
        const unknown = externalWriteStarted || error?.indeterminate === true;
        state = event({ ...state, status: unknown ? 'unknown' : 'blocked', lastError: safeError(error) }, 'runtime.failed', {
          outcome: unknown ? 'unknown' : 'blocked', blockers,
        });
        await store.write(state);
        if (error instanceof DesiredStateError || error instanceof VmSafetyError || error instanceof VmAgentOperationError) throw error;
        throw new VmAgentOperationError(safeError(error), { indeterminate: unknown });
      }
    },
    async reconcile() {
      let state = await store.read();
      const result = await runtime.reconcile(state.current?.desiredState ?? null);
      if (!['succeeded', 'failed', 'unknown', 'absent'].includes(result?.outcome)) {
        throw new VmAgentOperationError('VM runtime reconciliation returned an invalid outcome.', { indeterminate: true, status: 502 });
      }
      const status = result.outcome === 'succeeded' ? 'ready' : result.outcome === 'absent' ? 'blocked' : result.outcome;
      state = event({ ...state, status, lastError: result.message ?? null }, 'runtime.reconciled', { outcome: result.outcome });
      if (state.current && result.layers) state.current = { ...state.current, layers: { ...result.layers, strategy: result.layers.strategy ?? 'disabled' } };
      return publicState(await store.write(state), runtime.mode);
    },
  });
}
