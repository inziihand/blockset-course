import { cloudRunServiceDriver } from './cloud-run-service.mjs';
import { vmDockerDriver } from './vm-docker.mjs';

export const deploymentDrivers = new Map([
  [cloudRunServiceDriver.key, cloudRunServiceDriver],
  [vmDockerDriver.key, vmDockerDriver],
]);
