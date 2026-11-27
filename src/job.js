import { expect } from './errors.js';
import { nodeEnv, resolveDeploymentInputs } from './deployment-inputs.js';

const second = 1e9; // Nomad JSON durations are nanoseconds.

function bindings(configuration, settings, nodeId, jobId, profile) {
  const { fields, supplied, validation } = resolveDeploymentInputs(configuration, settings, nodeId, profile);
  const override = validation.errors.find(e => e.code === 'site_input_override');
  expect(!override, 'Omit site-managed registration inputs or disable site inheritance', 422, 'site_input_override',
    { field: override?.field });
  expect(!validation.errors.some(e => e.code === 'identity_override'), 'Node ID must remain stable');
  expect(validation.valid, 'Invalid deployment settings', 422, 'invalid_settings', { fields: validation.errors });
  const templates = [];
  const volumes = [];
  const envLines = [];
  for (const field of fields) {
    const value = Object.hasOwn(supplied, field.name) ? supplied[field.name] : field.default;
    if (value === undefined || field.env === nodeEnv) continue;
    let valueTemplate;
    const filter = field.env ? ' | toJSON' : '';
    if (field.secret) {
      // On its discovery pass consul-template returns nil while it registers
      // the Variable dependency. Only evaluate the required key once resolved.
      const scope = field.source === 'site' ? '/device/driver' : '';
      valueTemplate = `{{ with nomadVar "nomad/jobs/${jobId}${scope}" }}{{ .${value.secretRef}${filter} }}{{ end }}`;
    } else {
      valueTemplate = `{{ printf "%s" ${JSON.stringify(String(value))}${filter} }}`;
    }
    if (field.env) {
      envLines.push(`${field.env}=${valueTemplate}`);
    } else {
      const file = `secrets/input-${templates.length}`;
      templates.push({ DestPath: file, EmbeddedTmpl: valueTemplate, ChangeMode: 'restart', ErrMissingKey: true, Perms: '0444' });
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
  const { templates, volumes } = bindings(release.configuration, spec.settings, spec.nodeId, id, spec.videoIPath);
  const arch = release.record.image.platforms.filter(p => p.startsWith('linux/')).map(p => p.split('/')[1]);
  expect(arch.length && arch.every(value => /^[a-z0-9]+$/.test(value)), 'No supported Linux image platform', 422);
  const health = release.configuration.controlHealth;
  const task = {
    Name: 'driver', Driver: 'docker', Config: { image, volumes, force_pull: false },
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
      managed_by: 'driver-hub', hub_schema: '1', spec: JSON.stringify(spec), previous: JSON.stringify(previous),
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
