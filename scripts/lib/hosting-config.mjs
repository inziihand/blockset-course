export function createHostingConfig(
  installation,
  registry,
  { publicDirectory = 'apps/console/dist', selectedServiceKeys = null } = {},
) {
  const services = new Map(registry.services.map((service) => [service.key, service]));
  const selected = selectedServiceKeys ? new Set(selectedServiceKeys) : null;
  const rewrites = [];
  for (const placement of installation.servicePlacements) {
    if (selected && !selected.has(placement.serviceKey)) continue;
    const service = services.get(placement.serviceKey);
    if (!service || placement.selectedTarget !== 'cloud-run-service') continue;
    if (service.deployment.productionReadiness !== 'ready') continue;
    for (const route of service.routes) {
      rewrites.push({
        source: route,
        run: {
          serviceId: placement.serviceName,
          region: placement.region,
          pinTag: true,
        },
      });
    }
  }
  rewrites.push({ source: '**', destination: '/index.html' });
  return {
    hosting: {
      public: publicDirectory,
      ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
      rewrites,
    },
  };
}
