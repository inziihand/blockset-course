import assert from 'node:assert/strict';
import test from 'node:test';
import { createGcpCloudControlPlane } from '../src/gcp-cloud-control-plane.mjs';

test('uses a least-privilege per-service builder identity and returns an immutable image', async () => {
  const digest = 'a'.repeat(64);
  const calls = [];
  const request = async (input) => {
    calls.push(input);
    if (input.url.includes('/repositories/stratexec') && input.method === 'GET') return { name: 'repositories/stratexec' };
    if (input.url.includes('iam.googleapis.com') && input.method === 'GET') return { name: 'builder' };
    if (input.url.endsWith(':getIamPolicy')) return { version: 1, etag: 'etag', bindings: [] };
    if (input.url.endsWith(':setIamPolicy')) return { bindings: input.data.policy.bindings };
    if (input.url.includes('storage.googleapis.com/upload/')) {
      throw Object.assign(new Error('already uploaded'), { status: 412 });
    }
    if (input.url.includes('cloudbuild.googleapis.com') && input.method === 'POST') {
      const tag = input.data.images[0];
      return { id: 'build-1', status: 'SUCCESS', results: { images: [{ name: tag, digest: `sha256:${digest}` }] } };
    }
    throw new Error(`Unexpected request: ${input.method} ${input.url}`);
  };
  const control = createGcpCloudControlPlane({ request, pollMilliseconds: 1 });
  const result = await control.buildImmutableImage({
    context: {
      jobId: '00000000-0000-4000-8000-000000000000',
      installation: { projectId: 'customer-project' },
      package: { appKey: 'quotes', packageSha256: 'b'.repeat(64) },
    },
    service: { serviceKey: 'quotes-api', serviceName: 'customer-quotes', region: 'asia-east1' },
    source: { archive: Buffer.from('archive'), archiveSha256: 'c'.repeat(64) },
    repository: 'stratexec',
    builderRoles: ['roles/artifactregistry.writer', 'roles/logging.logWriter'],
  });
  const build = calls.find((item) => item.url.includes('cloudbuild.googleapis.com') && item.method === 'POST');
  assert.equal(build.data.serviceAccount, 'projects/customer-project/serviceAccounts/customer-quotes-builder@customer-project.iam.gserviceaccount.com');
  assert.equal(build.data.options.logging, 'CLOUD_LOGGING_ONLY');
  assert.equal(result.imageDigest, digest);
  assert.match(result.image, new RegExp(`@sha256:${digest}$`));
  assert.ok(calls.some((item) => item.url.includes('ifGenerationMatch=0')));
  const policyWrite = calls.find((item) => item.url.endsWith(':setIamPolicy'));
  assert.deepEqual(policyWrite.data.policy.bindings.map((item) => item.role).sort(), [
    'roles/artifactregistry.writer', 'roles/logging.logWriter',
  ]);
});
