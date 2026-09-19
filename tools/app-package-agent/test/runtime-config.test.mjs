import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentConfig } from '../src/runtime-config.mjs';

test('binds the source-management agent to loopback with unsigned apply disabled', () => {
  const config = resolveAgentConfig({ STRATEXEC_REPOSITORY_ROOT: 'D:\\work\\platform' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8182);
  assert.equal(config.allowUnsignedApply, false);
});

test('rejects public or generic managed-service bindings', () => {
  assert.throws(() => resolveAgentConfig({ STRATEXEC_APP_PACKAGE_AGENT_HOST: '0.0.0.0' }), /127\.0\.0\.1/);
  assert.throws(() => resolveAgentConfig({ PORT: '8080' }), /refuses generic PORT/);
});
