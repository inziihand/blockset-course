import { resolve } from 'node:path';

const integer = (value, fallback, name, minimum, maximum) => {
  const result = Number(String(value ?? '').trim() || fallback);
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return result;
};

export function resolveVmAgentConfig(environment = process.env) {
  for (const name of ['GOOGLE_SERVICE_ACCOUNT_JSON', 'STRATEXEC_VM_AGENT_SSH_PRIVATE_KEY']) {
    if (environment[name]?.trim()) throw new Error(`${name} is forbidden; VM Agent uses attached identity, OS Login/IAP bootstrap and mTLS.`);
  }
  const insecureLoopback = environment.STRATEXEC_VM_AGENT_INSECURE_LOOPBACK === 'true';
  const host = environment.STRATEXEC_VM_AGENT_HOST?.trim() || '127.0.0.1';
  if (insecureLoopback && !['127.0.0.1', 'localhost'].includes(host)) throw new Error('Insecure VM Agent mode is loopback-only.');
  const tls = {
    certificatePath: environment.STRATEXEC_VM_AGENT_TLS_CERT_PATH?.trim() || '',
    privateKeyPath: environment.STRATEXEC_VM_AGENT_TLS_KEY_PATH?.trim() || '',
    clientCaPath: environment.STRATEXEC_VM_AGENT_CLIENT_CA_PATH?.trim() || '',
  };
  if (!insecureLoopback && Object.values(tls).some((item) => !item)) throw new Error('VM Agent requires server certificate, private key and client CA for mTLS.');
  const runtimeMode = environment.STRATEXEC_VM_AGENT_RUNTIME_MODE?.trim() || 'disabled';
  if (!['disabled', 'docker'].includes(runtimeMode)) throw new Error('VM Agent runtime mode must be disabled or docker.');
  const safetySnapshotPath = resolve(environment.STRATEXEC_VM_AGENT_SAFETY_SNAPSHOT_PATH?.trim()
    || '/var/lib/stratexec/worker-safety.json');
  if (runtimeMode === 'docker' && !environment.STRATEXEC_VM_AGENT_SAFETY_SNAPSHOT_PATH?.trim()) {
    throw new Error('Docker VM Agent requires a host-local Worker safety snapshot path.');
  }
  return {
    host,
    port: integer(environment.STRATEXEC_VM_AGENT_PORT, '8443', 'STRATEXEC_VM_AGENT_PORT', 1, 65535),
    insecureLoopback,
    tls,
    runtimeMode,
    safetySnapshotPath,
    stateRoot: resolve(environment.STRATEXEC_VM_AGENT_STATE_ROOT?.trim() || '/var/lib/stratexec/vm-agent'),
    trustStorePath: resolve(environment.STRATEXEC_VM_AGENT_TRUST_STORE?.trim() || '/var/lib/stratexec/vm-agent-trust.json'),
  };
}
