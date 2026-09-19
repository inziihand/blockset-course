export const cloudRunServiceDriver = Object.freeze({
  key: 'cloud-run-service',
  applySupport: 'implemented',
  executor: 'scripts/deployment/executors/cloud-run-service.ps1',
  validate({ service, placement }) {
    const blockers = [];
    if (service.deployment.workloadClass !== 'request-http') {
      blockers.push('Cloud Run Service driver only accepts request-http workloads.');
    }
    if (!service.deployment.cloudRun) {
      blockers.push('Service is missing deployment.cloudRun settings.');
    }
    if (service.deployment.artifact?.dockerfile !== `${service.deployment.artifact?.context}/Dockerfile`) {
      blockers.push('Cloud Run executor requires Dockerfile at the root of its declared build context.');
    }
    if (!placement.region || !placement.serviceName) {
      blockers.push('Cloud Run placement requires region and serviceName.');
    }
    return blockers;
  },
});
