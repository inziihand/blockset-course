export function createGcpSecretResolver({ request }) {
  if (!request) throw new Error('GCP secret resolver requires an authenticated request function.');
  return Object.freeze({
    async access(resource) {
      if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/secrets\/[a-z][a-z0-9-]*\/versions\/[1-9][0-9]*$/.test(resource ?? '')) {
        throw new Error('Secret reference must identify a concrete Secret Manager version.');
      }
      const result = await request({ method: 'GET', url: `https://secretmanager.googleapis.com/v1/${resource}:access` });
      const encoded = result?.payload?.data;
      if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('Secret Manager returned an invalid payload.');
      return Buffer.from(encoded, 'base64');
    },
  });
}
