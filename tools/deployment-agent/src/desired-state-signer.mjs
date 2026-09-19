import { createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function createExternalEd25519DesiredStateSigner({ keyId, privateKeyPath, readFileImpl = readFile }) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(keyId ?? '') || !privateKeyPath) throw new Error('Desired-state signer key ID and external private-key path are required.');
  const key = createPrivateKey(await readFileImpl(privateKeyPath));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Desired-state signer must use Ed25519.');
  return Object.freeze({
    keyId,
    async sign(desiredState) {
      const payload = Buffer.from(`stratexec-vm-desired-state-v1\0${canonicalJson(desiredState)}`);
      return {
        desiredState,
        signature: { algorithm: 'Ed25519', keyId, value: sign(null, payload, key).toString('base64') },
      };
    },
  });
}
