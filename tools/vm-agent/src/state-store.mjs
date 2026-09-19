import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const empty = () => ({ schemaVersion: 1, generation: 0, current: null, previous: null, status: 'idle', lastError: null, events: [] });

export function createVmAgentStateStore({ stateRoot, maxEvents = 250 }) {
  const path = join(stateRoot, 'vm-agent-state.json');
  return Object.freeze({
    async read() {
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error?.code === 'ENOENT') return empty(); throw error; }
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const next = { ...state, events: (state.events ?? []).slice(-maxEvents) };
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, path);
      return structuredClone(next);
    },
  });
}
