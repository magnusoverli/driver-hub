// One export for the authenticated HTTP endpoint and offline client generation.
const str = { type: 'string' };
const bool = { type: 'boolean' };
const integer = { type: 'integer' };
const uuid = { type: 'string', format: 'uuid' };
const tokenMode = { enum: ['per-device', 'shared'], type: 'string' };
const secret = { type: 'string', writeOnly: true };
const date = { type: 'string', format: 'date-time' };
const anyObject = { type: 'object', additionalProperties: true };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const array = items => ({ type: 'array', items });
const values = (...items) => ({ type: 'string', enum: items });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const identity = { driverId: str, version: str };
const settings = { type: 'object', additionalProperties: {
  oneOf: [str, integer, bool, object({ secretRef: str })]
} };
const fieldErrors = array(object({ field: str, code: str }));
const fieldProperties = {
  name: str, type: values('string', 'integer', 'boolean'), required: bool,
  default: { type: ['string', 'integer', 'boolean'] }, env: str, file: str, secret: bool,
  minLength: integer, minimum: integer, maximum: integer
};
const preview = { name: 'dryRun', in: 'query', schema: bool, description: 'Plan without publishing or registering a job.' };
const acquisition = [
  { name: 'Prefer', in: 'header', schema: values('respond-async') },
  { name: 'Idempotency-Key', in: 'header', schema: uuid, description: 'Client-chosen lowercase UUID for asynchronous requests.' }
];
const path = name => ({ name, in: 'path', required: true, schema: ['nodeId', 'id'].includes(name) ? uuid : str });
const releasePath = [path('driverId'), path('version')];
const content = schema => ({ 'application/json': { schema } });
function endpoint(operationId, result, { parameters, body, async = false } = {}) {
  const responses = {
    200: { description: 'Success', content: content(result) },
    default: { description: 'Request failed', content: content(ref('Error')) }
  };
  if (async) responses[202] = { description: 'Track this operation at Location',
    headers: { Location: { schema: str } }, content: content(ref('Operation')) };
  return { operationId, parameters, requestBody: body && { required: true, content: content(body) }, responses };
}

const schemas = {
  Site: object({ revision: integer,
    nomad: object({ address: { type: ['string', 'null'] }, namespace: str, datacenters: array(str), tokenConfigured: bool }),
    videoipath: object({ url: { type: ['string', 'null'] }, tokenMode, tokenConfigured: bool,
      assignments: array(object({ nodeId: uuid, tokenFingerprint: str })), availableTokens: { type: ['integer', 'null'] } })
  }),
  Error: object({ error: str, code: str, details: anyObject }, ['error', 'code']),
  Validation: object({ valid: bool, errors: fieldErrors }),
  Declaration: object({
    schemaVersion: { const: 1 }, nodeIdInput: str, videoIPathInputs: object({ url: str, token: str }, []), controlHealth: object({ port: integer, path: str }),
    inputs: array(object(fieldProperties, ['name', 'type', 'required']))
  }, ['schemaVersion', 'inputs']),
  DeployForm: object({ inheritsSite: bool, fields: array(object({
    ...fieldProperties, source: values('operator', 'site', 'identity'), secretRefPattern: str
  }, ['name', 'type', 'required', 'source'])), validation: ref('Validation') }),
  Release: object({
    record: object({
      ...identity, schemaVersion: { const: 1 }, displayName: str, origin: values('customer', 'maintainer'),
      source: object({ commit: str, directory: str }), configuration: object({ file: str, sha256: str }),
      image: object({ digest: str, platforms: array(str), archive: str, archiveSha256: str })
    }, ['driverId', 'version', 'schemaVersion', 'displayName', 'source', 'configuration', 'image']),
    configuration: ref('Declaration')
  }),
  Operation: object({
    id: uuid, kind: values('build', 'retain'), target: object({ ...identity, commit: str }, []), startedAt: date, finishedAt: date,
    state: values('running', 'succeeded', 'failed', 'interrupted'),
    release: object({ ...identity, digest: str }), failure: { allOf: [ref('Error'), object({ status: integer })] }
  }, ['id', 'kind', 'startedAt', 'state']),
  Stage: object({ ...identity, nodeId: uuid, settings, inheritSite: bool }, ['driverId', 'version']),
  Preview: object({
    preview: { const: true }, requested: values('stopped', 'running'), image: str, currentRevision: integer,
    schedulable: bool, placementFailures: array(object({
      group: str, nodesEvaluated: integer, nodesFiltered: integer, nodesExhausted: integer,
      constraints: { type: 'object', additionalProperties: integer }, resources: { type: 'object', additionalProperties: integer }
    }))
  }),
  Submission: object({ nodeId: uuid, revision: integer, evaluationId: str, image: str, replayed: bool, unchanged: bool }, ['nodeId', 'revision']),
  Deployment: object({
    ...identity, nodeId: uuid, settings, revision: integer, image: str, requiresOriginalStopped: bool,
    previousVersion: { type: ['string', 'null'] }, requested: values('stopped', 'running'),
    communication: values('unknown', 'driver-reports-connected', 'check-failed'), approval: { const: 'unknown' },
    communicationEvidence: object({ state: str, reason: str, allocationId: str, observedAt: date }, ['state', 'reason']),
    allocations: array(object({ id: str, host: str, desired: str, status: str, jobVersion: integer, taskState: str, restarts: integer },
      ['id', 'desired', 'status']))
  })
};
const submitted = { oneOf: [ref('Submission'), ref('Preview')] };
const paths = {
  '/site': { get: endpoint('getSiteSettings', ref('Site')) },
  '/site/nomad': { put: endpoint('configureNomad', ref('Site'), { body: object({ revision: integer,
    address: str, token: { type: ['string', 'null'], writeOnly: true }, namespace: str, datacenters: array(str)
  }, ['revision', 'address']) }) },
  '/site/videoipath': { put: endpoint('configureVideoIPath', ref('Site'), { body: object({
    revision: integer, address: str, tokenMode, token: secret, tokens: array(secret)
  }, ['revision', 'address']) }) },
  '/openapi.json': { get: endpoint('getContract', anyObject) },
  '/capabilities': { get: endpoint('getCapabilities', object({
    apiVersion: str, access: values('admin', 'viewer'), buildsEnabled: bool, asyncAcquisition: bool,
    siteSetupEnabled: bool, videoIPathConfigured: bool, nomadConfigured: bool, imageHostConfigured: bool
  })) },
  '/integrations/nomad': { get: endpoint('getNomadConnection', object({
    state: values('not_configured', 'no_leader', 'connected'), namespace: str
  })) },
  '/operations': { get: endpoint('listOperations', object({ operations: array(ref('Operation')) })) },
  '/operations/{id}': { get: endpoint('getOperation', ref('Operation'), { parameters: [path('id')] }) },
  '/releases': { get: endpoint('listReleases', object({ releases: array(object({ ...identity, prerelease: bool })) }),
    { parameters: [{ name: 'prerelease', in: 'query', schema: bool }] }) },
  '/retained': { get: endpoint('listRetained', object({ releases: array(object({ ...identity, displayName: str, digest: str, origin: str })) })) },
  '/updates': { get: endpoint('listUpdates', object({ updates: array(object({ ...identity, nodeId: uuid, availableVersion: str })) })) },
  '/builds': { post: endpoint('buildDriver', ref('Release'), {
    async: true, parameters: acquisition, body: object({ driverId: str, commit: str, directory: str,
      platform: str, configuration: ref('Declaration') }, ['driverId', 'commit', 'directory'])
  }) },
  '/deployments': {
    get: endpoint('listDeployments', object({ deployments: array(object({ ...identity, nodeId: uuid, status: str, revision: integer })) })),
    post: endpoint('stageDeployment', submitted, { parameters: [preview, { name: 'Idempotency-Key', in: 'header',
      schema: uuid, description: 'For a new device only: use this random UUID as its nodeId and safely retry staging.' }], body: ref('Stage') })
  },
  '/deployments/{nodeId}': { get: endpoint('getDeployment', ref('Deployment'), { parameters: [path('nodeId')] }) },
  '/deployments/{nodeId}/history': { get: endpoint('getDeploymentHistory', object({ history: array(object({
    ...identity, jobVersion: integer, revision: integer, image: str, requested: values('running', 'stopped')
  })) }), { parameters: [path('nodeId')] }) },
  '/deployments/{nodeId}/evaluations': { get: endpoint('listEvaluations', object({ evaluations: array(object({
    id: str, status: str, revision: integer, trigger: str, placementFailures: schemas.Preview.properties.placementFailures
  })) }), { parameters: [path('nodeId')] }) }
};
for (const [collection, label] of [['releases', 'Published'], ['retained', 'Retained']]) {
  const resource = `/${collection}/{driverId}/{version}`;
  paths[resource] = { get: endpoint(`get${label}Release`, ref('Release'), { parameters: releasePath }) };
  paths[`${resource}/validate`] = { post: endpoint(`validate${label}Settings`, ref('Validation'), { parameters: releasePath, body: settings }) };
  paths[`${resource}/deploy-form`] = { post: endpoint(`get${label}DeployForm`, ref('DeployForm'), {
    parameters: releasePath, body: object({ inheritSite: bool, nodeId: uuid, settings }, [])
  }) };
}
paths['/retained/{driverId}/{version}'].put = endpoint('retainRelease', ref('Release'), { async: true, parameters: [...releasePath, ...acquisition] });
for (const action of ['start', 'stop', 'update', 'rollback']) {
  const properties = { revision: integer };
  if (action === 'start') properties.originalStopped = bool;
  if (action === 'update') Object.assign(properties, { version: str, settings });
  paths[`/deployments/{nodeId}/${action}`] = { post: endpoint(`${action}Deployment`, submitted, {
    parameters: [path('nodeId'), preview], body: object(properties, action === 'update' ? ['revision', 'version'] : ['revision'])
  }) };
}

export const apiContract = {
  openapi: '3.1.0', info: { title: 'Driver Hub management API', version: '1.0.0' },
  servers: [{ url: '/api/v1' }], security: [{ adminBearer: [] }, {}], paths,
  components: { securitySchemes: { adminBearer: { type: 'http', scheme: 'bearer',
    description: 'Required on a token-configured manager; optional only in loopback development mode.' } }, schemas }
};
