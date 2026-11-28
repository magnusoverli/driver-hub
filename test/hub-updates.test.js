import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApi } from '../src/http.js';
import { findUpdate, newer } from '../src/hub-release.js';
import { HubUpdates } from '../src/hub-updates.js';
import { runUpdate, withPin } from '../tools/manage-updates.mjs';

const digest = `sha256:${'1'.repeat(64)}`, previous = `ghcr.io/magnusoverli/driver-hub@sha256:${'2'.repeat(64)}`;
const installed = 'v0.0.18', version = 'v0.0.19', release = {version, digest, notes:'New features', readiness:'ready'};
test('only a newer stable published image with compatible platform and format is actionable', async () => {
  const meta = {tag_name:version, assets:[], body:'Target notes'};
  const manifest = {version, epoch:1, platforms:['linux/amd64'], digest};
  const request = async url => Response.json(url.endsWith('latest') ? meta : manifest);
  assert.ok(newer('v0.10.0','v0.9.99'));
  assert.ok(!newer('v0.10.0-rc.1','v0.9.99'));
  assert.equal(await findUpdate(version,'x64',request),null);
  assert.equal((await findUpdate(installed,'x64',request)).readiness,'publishing');
  meta.assets.push({name:'managed-update.json',state:'uploaded'});
  assert.equal((await findUpdate(installed,'x64',request)).digest,digest);
  assert.equal((await findUpdate(installed,'arm64',request)).readiness,'manual');
  manifest.epoch++;
  assert.equal((await findUpdate(installed,'x64',request)).readiness,'manual');
});
test('update state is admin-only, cached across readers, ignores per user, blocks competing writes', async t => {
  let checks = 0, starts = 0, phase = 'idle';
  const root = await mkdtemp(join(tmpdir(),'hub-updates-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const updates = new HubUpdates({root, version:installed, socket:'fixture', lookup: async()=>{checks++;return release;},
    host:async (_socket,path)=>{if(path==='/update'){starts++;phase='downloading';} return {phase, version};}});
  const server = createApi(null,null,{updates,token:'admin',apiTokens:{role:()=> 'viewer'}});
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  assert.equal((await fetch(base+'/hub-updates',{headers:{Authorization:'Bearer viewer'}})).status,403);
  const [a,b] = await Promise.all([updates.status('a'), updates.status('b',true)]);
  assert.equal(checks,1);assert.deepEqual(a,b);
  await updates.ignore('a',version);
  assert.equal((await updates.status('b')).ignored,'');
  assert.equal((await updates.status('a')).ignored,version);
  await assert.rejects(updates.write(()=>updates.start(version,{})), /operation is in progress/);
  await assert.rejects(updates.start(version,{active:1}), /operation is in progress/);
  assert.equal(starts,0);
  await updates.start(version,{});
  await assert.rejects(updates.write(()=>assert.fail('must not execute')), /retry after restart/);
});
test('verified switch, failure before stopping, rollback and recovery-required outcomes', async () => {
  for(const failure of ['none','download','switch','verify','rollback','changed']){
    const pins=[],states=[],checks=[];
    const job = { version,installed,digest };
    await runUpdate(job,{
      lookup:async()=>({...release,version: failure==='changed'?'v1.0.0':version}),
      previous:async()=>previous, pull:async()=>{if(failure==='download') throw Error();},
      switchTo:async pin=>{pins.push(pin);if(failure==='switch' && pin!==previous)throw Error();},
      verify:async v=>{checks.push(v);if((v===version && failure==='verify') || failure==='rollback')throw Error();}
    },async state=>states.push(state.phase));
    if(['changed','download'].includes(failure)) {assert.deepEqual(pins,[]);assert.equal(states.at(-1),'failed');}
    else if(failure==='none') {assert.equal(pins.length,1);assert.deepEqual(checks,[version]);assert.equal(states.at(-1),'succeeded');}
    else {assert.equal(pins.at(-1),previous);assert.equal(checks.at(-1),installed);
      assert.equal(states.at(-1),failure==='rollback'?'recoveryRequired':'rolledBack');}
  }
});
test('persistent pin preserves site settings rather than replacing Compose or .env',()=>{
  const input='# CA for test cluster\nNODE_EXTRA_CA_CERTS=/site/custom-ca.crt\nDRIVER_HUB_IMAGE=old\n';
  assert.equal(withPin(input,previous),input.replace('=old',`=${previous}`));
  assert.equal(withPin('A=B\n',previous),`A=B\nDRIVER_HUB_IMAGE=${previous}\n`);
  assert.throws(()=>withPin('DRIVER_HUB_IMAGE=a\nDRIVER_HUB_IMAGE=b',previous));
});
