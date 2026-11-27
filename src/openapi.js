// One export for the authenticated HTTP endpoint and offline client generation.
const str = { type: 'string' };
const bool = { type: 'boolean' };
const integer = { type: 'integer' };
const uuid = { type: 'string', format: 'uuid' };
const tokenMode = { enum: ['per-device', 'shared'], type: 'string' };
const secret = { type: 'string', writeOnly: true };
const distributionAddress = { type: ['string', 'null'],
  description: 'Hub hostname or IP (optionally with port) that Nomad clients fetch images from. Overridden by DRIVER_HUB_DISTRIBUTION_ADDRESS.' };
const date = { type: 'string', format: 'date-time' };
const anyObject = { type: 'object', additionalProperties: true };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const array = items => ({ type: 'array', items });
const values = (...items) => ({ type: 'string', enum: items });
const role = values('admin', 'viewer');
const browserRequest = { name: 'X-Driver-Hub-Request', in: 'header', required: true, schema: { const: '1' } };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const identity = { driverId: str, version: str };
const settings = { type: 'object', additionalProperties: {
  oneOf: [str, integer, bool, object({ secretRef: str })]
} };
const deviceLabel = { type: ['string', 'null'], maxLength: 80,
  description: 'Operator-facing device name kept by Hub, not by Nomad. Null when unnamed.' };
const allocation = object({ id: str, host: str, desired: str, status: str, jobVersion: integer, taskState: str, restarts: integer, lastEvent: str, logsUrl: str },
  ['id', 'desired', 'status']);
const observation = {
  communication: values('unknown', 'driver-reports-connected', 'check-failed'), approval: { const: 'unknown' },
  communicationEvidence: object({ state: str, reason: str, allocationId: str, observedAt: date }, ['state', 'reason'])
};
const fieldErrors = array(object({ field: str, code: str }));
const fieldProperties = {
  name: str, type: values('string', 'integer', 'boolean'), required: bool,
  default: { type: ['string', 'integer', 'boolean'] }, env: str, file: str, secret: bool,
  minLength: integer, maxLength: integer, minimum: integer, maximum: integer,
  description: { type: 'string', maxLength: 1000, description: 'What the input is for, shown to operators.' }
};
const preview = { name: 'dryRun', in: 'query', schema: bool, description: 'Plan without publishing or registering a job.' };
const acquisition = [
  { name: 'Prefer', in: 'header', schema: values('respond-async') },
  { name: 'Idempotency-Key', in: 'header', schema: uuid, description: 'Client-chosen lowercase UUID for asynchronous requests.' }
];
const path = name => ({ name, in: 'path', required: true, schema: ['nodeId', 'id'].includes(name) ? uuid : str });
const releasePath = [path('driverId'), path('version')];
const revisionQuery = { name: 'revision', in: 'query', required: true, schema: integer,
  description: 'The revision the client reviewed; a different current revision is refused with 409.' };
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
  Operator: object({ username: str, role, provider: str, mustChangePassword: bool }, ['username', 'role', 'provider']),
  LocalAccount: object({ username: str, role, enabled: bool }),
  ApiToken: object({ id: str, name: str, role, createdAt: date,
    createdBy: { type: ['string', 'null'], description: 'The operator who created it; null when created with a token.' } }),
  ImageDistribution: object({
    state: { ...values('not_configured', 'unavailable', 'starting', 'copying', 'ready', 'failing'),
      description: 'not_configured: no Nomad cluster. unavailable: this manager has no image service package. ' +
        'starting: no copy runs yet. copying: some copies still fetch images. failing: see reason or problems.' },
    reason: str, detail: str,
    source: { type: ['string', 'null'], description: 'Where the copies fetch images from the manager.' },
    images: { type: 'integer', description: 'Images the copies hold: every image staged at least once.' },
    running: { type: 'integer', description: 'Clients where the image service runs.' },
    upToDate: { type: 'integer', description: 'Of those, how many hold every image.' },
    problems: array(object({ host: { type: ['string', 'null'] }, status: str, event: { type: ['string', 'null'] } }))
  }, ['state', 'source', 'images', 'running', 'upToDate', 'problems']),
  EnvironmentSetting: object({ name: str, secret: bool,
    source: { ...values('environment', 'default', 'unset'),
      description: 'Set in the manager\'s environment, using the built-in default, or unset without a default.' },
    value: { type: ['string', 'null'], description: 'The value in effect. Always null for a secret.' } }),
  Site: object({ revision: integer,
    nomad: object({ address: { type: ['string', 'null'] }, distributionAddress, namespace: str, datacenters: array(str), tokenConfigured: bool,
      plainHttp: { type: 'boolean', description: 'Credentials may go to this Nomad over plain HTTP: a trusted network.' } }),
    deployment: object({
      nomadUiOrigin: { type: ['string', 'null'], description: 'HTTPS origin of the Nomad web interface, for log links.' },
      sharedWriters: { type: 'boolean',
        description: 'Other processes may edit Hub\'s Nomad jobs, so Hub never purges a job when a deployment is deleted.' } }),
    manager: object({ buildsEnabled: bool, timings: bool,
      buildsAvailable: { type: 'boolean', description: 'Whether this manager can run source builds at all.' } }),
    videoipath: object({ url: { type: ['string', 'null'] }, tokenMode, tokenConfigured: bool,
      assignments: array(object({ nodeId: uuid, tokenFingerprint: str })), availableTokens: { type: ['integer', 'null'] },
      pool: { ...array(object({ tokenFingerprint: str, nodeId: { type: ['string', 'null'], format: 'uuid' } })),
        description: 'Every per-device token by SHA-256 fingerprint, with the device it is reserved for, if any.' } })
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
      source: object({ commit: str, directory: str }, []), configuration: object({ file: str, sha256: str }),
      image: object({ digest: str, platforms: array(str), archive: str, archiveSha256: str })
    }, ['driverId', 'version', 'schemaVersion', 'displayName', 'configuration', 'image']),
    configuration: ref('Declaration')
  }),
  Operation: object({
    id: uuid, kind: values('build', 'retain'), target: object({ ...identity, commit: str }, []), startedAt: date, finishedAt: date,
    state: values('running', 'succeeded', 'failed', 'interrupted'),
    release: object({ ...identity, digest: str }), failure: { allOf: [ref('Error'), object({ status: integer })] }
  }, ['id', 'kind', 'startedAt', 'state']),
  Stage: object({ ...identity, nodeId: uuid, settings, inheritSite: bool, label: deviceLabel }, ['driverId', 'version']),
  Preview: object({
    preview: { const: true }, requested: values('stopped', 'running'), image: str, currentRevision: integer,
    schedulable: bool, placementFailures: array(object({
      group: str, nodesEvaluated: integer, nodesFiltered: integer, nodesExhausted: integer,
      constraints: { type: 'object', additionalProperties: integer }, resources: { type: 'object', additionalProperties: integer }
    }))
  }),
  Submission: object({ nodeId: uuid, revision: integer, evaluationId: str, image: str, replayed: bool, unchanged: bool }, ['nodeId', 'revision']),
  Deployment: object({
    ...identity, nodeId: uuid, label: deviceLabel, settings, revision: integer, image: str, requiresOriginalStopped: bool,
    inheritsSite: { type: 'boolean',
      description: 'Whether the deployment takes its VideoIPath target and token from the site, as saved at staging.' },
    previousVersion: { type: ['string', 'null'] }, ...observation, requested: values('stopped', 'running'),
    allocations: array(allocation)
  }),
  DeploymentSummary: object({
    ...identity, nodeId: uuid, label: deviceLabel, status: str, revision: integer, requiresOriginalStopped: bool, ...observation,
    requested: { type: ['string', 'null'], enum: ['stopped', 'running', null],
      description: 'Null when Nomad could not report this deployment; see communicationEvidence.reason.' },
    allocation: { oneOf: [allocation, { type: 'null' }], description: 'Newest allocation Nomad wants running, if any.' }
  })
};
const submitted = { oneOf: [ref('Submission'), ref('Preview')] };
const paths = {
  '/auth/login': { post: { ...endpoint('login', ref('Operator'), { parameters: [browserRequest],
    body: object({ username: str, password: secret }) }), security: [] } },
  '/auth/session': { get: { ...endpoint('getSession', ref('Operator')), security: [{ operatorSession: [] }] } },
  '/auth/logout': { post: { ...endpoint('logout', object({ signedOut: bool }), { parameters: [browserRequest] }), security: [] } },
  '/auth/password': { post: { ...endpoint('changeOwnPassword', object({ signedOut: bool }), { parameters: [browserRequest],
    body: object({ currentPassword: secret, newPassword: secret }) }), security: [{ operatorSession: [] }] } },
  '/users': { get: endpoint('listLocalUsers', object({ users: array(ref('LocalAccount')) })),
    post: endpoint('createLocalUser', ref('LocalAccount'), { body: object({ username: str, role, password: secret }) }) },
  '/users/{username}': { patch: endpoint('updateLocalUser', ref('LocalAccount'), { parameters: [path('username')],
    body: object({ password: secret, role, enabled: bool }, []) }),
  delete: { ...endpoint('deleteLocalUser', object({ username: str, deleted: { const: true } }), {
    parameters: [path('username')] }), description: 'Ends the account\'s sessions. Refused for the last enabled ' +
    'administrator (409 last_admin) and for the signed-in operator\'s own account (409 own_account).' } },
  '/site': { get: endpoint('getSiteSettings', ref('Site')) },
  '/site/nomad': { put: endpoint('configureNomad', ref('Site'), { body: object({ revision: integer,
    address: str, distributionAddress, token: { type: ['string', 'null'], writeOnly: true }, namespace: str, datacenters: array(str),
    plainHttp: { type: 'boolean', description: 'Allow sending the token over plain HTTP. Only for trusted networks.' }
  }, ['revision', 'address']) }) },
  '/site/videoipath': { put: endpoint('configureVideoIPath', ref('Site'), { body: object({
    revision: integer, address: str, tokenMode, token: secret, tokens: array(secret)
  }, ['revision', 'address']) }) },
  '/site/deployment': { put: endpoint('configureDeployment', ref('Site'), { body: object({ revision: integer,
    nomadUiOrigin: { type: ['string', 'null'] }, sharedWriters: bool
  }, ['revision']) }) },
  '/site/manager': { put: { ...endpoint('configureManager', ref('Site'), { body: object({ revision: integer,
    buildsEnabled: bool, timings: bool }, ['revision']) }),
  description: 'Turning builds on is refused with 409 builds_unavailable when the manager cannot build.' } },
  '/site/environment': { get: { ...endpoint('getManagerEnvironment', object({ settings: array(ref('EnvironmentSetting')) })),
    description: 'Startup settings the manager reads from its environment. They change only with a restart.' } },
  '/api-tokens': { get: endpoint('listApiTokens', object({ tokens: array(ref('ApiToken')) })),
    post: { ...endpoint('createApiToken', { allOf: [ref('ApiToken'), object({ token: { type: 'string',
      description: 'The bearer token. Returned only here; Hub keeps only its hash.' } })] }, {
      body: object({ name: str, role }) }), description: 'Refused with 409 token_name_taken for a name already in use.' } },
  '/api-tokens/{tokenId}': { delete: endpoint('deleteApiToken', object({ id: str, deleted: { const: true } }), {
    parameters: [path('tokenId')] }) },
  '/site/videoipath/tokens/{fingerprint}': { delete: { ...endpoint('removeVideoIPathToken', ref('Site'), {
    parameters: [path('fingerprint'), revisionQuery] }), description: 'Removes a per-device token from the pool: ' +
    'an unused one, or one reserved for a device whose deployment no longer exists (otherwise 409 token_in_use). ' +
    'Revoke the token in VideoIPath separately.' } },
  '/openapi.json': { get: endpoint('getContract', anyObject) },
  '/capabilities': { get: endpoint('getCapabilities', object({
    apiVersion: str, access: values('admin', 'viewer'), buildsEnabled: bool, asyncAcquisition: bool,
    siteSetupEnabled: bool, videoIPathConfigured: bool, nomadConfigured: bool,
    sharedWriters: { type: 'boolean', description: 'Hub never purges Nomad jobs, so deployments cannot be deleted.' }
  })) },
  '/integrations/images': { get: { ...endpoint('getImageDistribution', ref('ImageDistribution')),
    description: 'The image service Hub runs on every eligible Nomad client, from which drivers pull their images.' } },
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
    get: endpoint('listDeployments', object({ deployments: array(ref('DeploymentSummary')) })),
    post: endpoint('stageDeployment', submitted, { parameters: [preview, { name: 'Idempotency-Key', in: 'header',
      schema: uuid, description: 'For a new device only: use this random UUID as its nodeId and safely retry staging.' }], body: ref('Stage') })
  },
  '/deployments/directory': { get: endpoint('listDeviceDirectory', object({ devices: array(object({
    ...identity, nodeId: uuid, label: deviceLabel
  })) })) },
  '/deployments/{nodeId}/rollout': { get: endpoint('getCurrentRollout', object({ rollout: { oneOf: [
    object({ id: str, status: str, jobVersion: integer }), { type: 'null' }
  ] } }), { parameters: [path('nodeId')] }) },
  '/deployments/{nodeId}': { get: endpoint('getDeployment', ref('Deployment'), { parameters: [path('nodeId')] }),
    delete: { ...endpoint('deleteDeployment', object({ nodeId: uuid, deleted: { const: true },
      registrationVariable: { ...values('removed', 'none', 'failed'),
        description: 'The registration Variable Hub wrote for a site-connected device.' } }), {
      parameters: [path('nodeId'), revisionQuery] }), description: 'Purges the stopped deployment\'s Nomad job and ' +
      'history and its Hub label (409 deployment_running while it is requested to run). The device\'s own secrets ' +
      'Variable and any reserved VideoIPath token stay until removed separately.' } },
  '/deployments/{nodeId}/label': { put: endpoint('labelDeployment', object({ nodeId: uuid, label: deviceLabel }), {
    parameters: [path('nodeId')], body: object({ label: deviceLabel })
  }) },
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
paths['/retained/{driverId}/{version}'].delete = { ...endpoint('removeRetainedRelease', object({ ...identity,
  removed: { const: true }, image: values('removed', 'none') }), { parameters: releasePath }),
description: 'Removes the retained release and its verified image. Refused with 409 release_in_use, listing ' +
  'deployments in details.deployments, while a deployment in the configured namespace runs it or keeps it for rollback.' };
const imported = endpoint('importLocalRelease', ref('Release'), { parameters: releasePath });
imported.description = 'Administrator only. Verify and retain a local OCI release without publishing or deploying it. Identical retries are idempotent.';
imported.requestBody = { required: true, content: { 'multipart/form-data': {
  schema: object({ metadata: object({ displayName: str, source: object({ commit: str, directory: str }, []),
    configuration: ref('Declaration') }, []), image: { type: 'string', format: 'binary', description: 'Gzipped OCI image-layout tar, up to 2 GiB.' } }, ['image']),
  encoding: { metadata: { contentType: 'application/json' }, image: { contentType: 'application/gzip' } }
} } };
for (const [status, description] of [[200, 'Already retained with identical content'], [201, 'New release retained']]) {
  imported.responses[status] = { description, headers: { Location: { schema: str } }, content: content(ref('Release')) };
}
paths['/imports/{driverId}/{version}'] = { put: imported };
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
  servers: [{ url: '/api/v1' }], security: [{ adminBearer: [] }, { operatorSession: [] }], paths,
  components: { securitySchemes: { adminBearer: { type: 'http', scheme: 'bearer',
    description: 'An API token created by an administrator, or the emergency DRIVER_HUB_ADMIN_TOKEN.' },
    operatorSession: { type: 'apiKey', in: 'cookie', name: '__Host-driverhub_session',
      description: 'Sign in via /auth/login. Include X-Driver-Hub-Request: 1 on all non-GET session requests.' } }, schemas }
};

// Service tokens do not need this header; cookie-authenticated clients do.
for (const methods of Object.values(paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (method === 'get' || operation.parameters?.some(p => p.name === browserRequest.name)) continue;
    operation.parameters = [...(operation.parameters ?? []), { ...browserRequest, required: false,
      description: 'Required when using an operator session cookie.' }];
  }
}
