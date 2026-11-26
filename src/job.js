import { expect } from './errors.js';
import { isObject, validateSettings } from './settings.js';

const second = 1e9; // Nomad JSON durations are nanoseconds.
const nodeEnv = 'VIDEOIPATH_NODE_ID';
const keyPattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function bindings(configuration, settings, nodeId, jobId) {
  const supplied = { ...settings };
  for (const identity of configuration.inputs.filter(f => f.env === nodeEnv || f.name === configuration.nodeIdInput)) {
    expect(!identity.secret && identity.type === 'string', 'Invalid node ID declaration', 422);
    expect(!Object.hasOwn(supplied, identity.name) || supplied[identity.name] === nodeId, 'Node ID must remain stable');
    supplied[identity.name] = nodeId;
  }
  const validation = validateSettings(configuration, supplied);
  expect(validation.valid, `Invalid settings: ${validation.errors.map(e => `${e.field}:${e.code}`).join(', ')}`, 422);
  const templates = [];
  const volumes = [];
  const envLines = [];
  for (const field of configuration.inputs) {
    const value = Object.hasOwn(supplied, field.name) ? supplied[field.name] : field.default;
    if (value === undefined || field.env === nodeEnv) continue;
    let expression;
    if (field.secret) {
      expect(keyPattern.test(value.secretRef), 'Deployment secretRef must be a key in the job-scoped Nomad Variable', 422);
      expression = `(nomadVar "nomad/jobs/${jobId}").${value.secretRef}`;
    } else {
      expression = `printf "%s" ${JSON.stringify(String(value))}`;
    }
    if (field.env) {
      expect(!field.env.startsWith('NOMAD_'), 'Cannot override Nomad environment', 422);
      envLines.push(`${field.env}={{ ${expression} | toJSON }}`);
    } else {
      expect(/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(field.file), 'Unsupported container file destination', 422);
      const file = `secrets/input-${templates.length}`;
      templates.push({ DestPath: file, EmbeddedTmpl: `{{ ${expression} }}`, ChangeMode: 'restart', ErrMissingKey: true, Perms: '0444' });
      volumes.push(`${file}:${field.file}:ro`);
    }
  }
  if (envLines.length) {
    templates.push({
      DestPath: 'secrets/driver.env', EmbeddedTmpl: envLines.join('\n'), Envvars: true,
      ChangeMode: 'restart', ErrMissingKey: true, Perms: '0400'
    });
  }
  return { templates, volumes };
}

export function createJob({ spec, previous, running, migrated, image, release, namespace, datacenters }) {
  const id = `driverhub-${spec.nodeId}`;
  expect(isObject(spec.settings), 'Expected a settings object');
  const { templates, volumes } = bindings(release.configuration, spec.settings, spec.nodeId, id);
  const arch = release.record.image.platforms.filter(p => p.startsWith('linux/')).map(p => p.split('/')[1]);
  expect(arch.length && arch.every(value => /^[a-z0-9]+$/.test(value)), 'No supported Linux image platform', 422);
  const health = release.configuration.controlHealth;
  const task = {
    Name: 'driver', Driver: 'docker', Config: { image, volumes, force_pull: true },
    Env: { [nodeEnv]: spec.nodeId }, Templates: templates,
    Resources: { CPU: 500, MemoryMB: 256 }, KillTimeout: 5 * second
  };
  if (health) {
    task.Config.ports = ['control'];
    task.Services = [{
      Name: id, Provider: 'nomad', PortLabel: 'control', Checks: [{
        Name: 'driver-communication', Type: 'http', Path: health.path,
        Interval: 10 * second, Timeout: 2 * second
      }]
    }];
  }
  return {
    ID: id, Name: id, Namespace: namespace, Type: 'service', Datacenters: datacenters,
    Meta: {
      managed_by: 'driver-hub', spec: JSON.stringify(spec), previous: JSON.stringify(previous),
      migrated: String(migrated)
    },
    TaskGroups: [{
      Name: 'device', Count: running ? 1 : 0,
      Constraints: [
        { LTarget: '${attr.kernel.name}', Operand: '=', RTarget: 'linux' },
        { LTarget: '${attr.cpu.arch}', Operand: 'regexp', RTarget: `^(${arch.join('|')})$` }
      ],
      Disconnect: { StopOnClientAfter: 30 * second, Reconcile: 'keep_replacement' },
      Update: { MaxParallel: 1, Canary: 0, HealthCheck: 'task_states', AutoRevert: false },
      Networks: health ? [{ Mode: 'host', DynamicPorts: [{ Label: 'control', To: health.port }] }] : [],
      Tasks: [task]
    }]
  };
}
