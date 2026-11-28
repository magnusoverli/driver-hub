// Real recreation, persistent pin, health and rollback against an isolated local project.
// Does not touch a deployed Hub, sign in to GitHub, fetch images, or contact Nomad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostTools, runUpdate } from '../tools/manage-updates.mjs';

test('Compose updates and rolls back preserving data, custom mount and unrelated service', {
  skip: !process.env.DRIVER_HUB_TEST_MANAGED_COMPOSE, timeout: 180000
}, async t => {
  const exec = promisify(execFile), base = 'node:26', project = `hub-update-test-${randomUUID()}`;
  const dir = await mkdtemp(join(tmpdir(), project)), file = join(dir,'compose.yaml');
  const candidate = `${project}:candidate`, envFile = join(dir,'.env'), installed = 'v9.0.0', version = 'v9.0.1';
  const docker = async (...args) => (await exec('docker', args, {cwd:dir,timeout:60000})).stdout.trim();
  const compose = (...args) => docker('compose','-p',project,'-f',file,...args);
  const digest = `sha256:${'a'.repeat(64)}`;
  t.after(async () => {
    try { await compose('down','-v'); } finally {
      await docker('image','rm',candidate).catch(()=>{});
      await rm(dir,{recursive:true,force:true});
    }
  });
  await docker('tag',base,candidate);
  // Make the real HTTP readiness probe depend on both preserved mounts.
  await writeFile(join(dir,'ca-marker'),'site-only');
  await writeFile(join(dir,'server.js'),`const {readFileSync}=require('fs');
    require('http').createServer((req,res)=>{
      if(readFileSync('/ca-marker','utf8')!=='site-only'||readFileSync('/data/keep','utf8')!=='kept')return res.end('not ready');
      res.end(req.url==='/'?'<!doctype html>':JSON.stringify({version:process.env.PIN===${JSON.stringify(candidate)}?'${version}':'${installed}'}))
    }).listen(8080)`);
  await writeFile(file,`services:
  manager:
    image: \${DRIVER_HUB_IMAGE}
    labels:
      org.opencontainers.image.version: ${installed}
    environment:
      PIN: \${DRIVER_HUB_IMAGE}
    volumes: [data:/data, ./ca-marker:/ca-marker:ro, ./server.js:/server.js:ro]
    command: [node, /server.js]
  host-route:
    image: \${DRIVER_HUB_IMAGE}
    labels:
      org.opencontainers.image.version: ${installed}
    command: [sleep, infinity]
  other:
    image: ${base}
    command: [sleep, infinity]
volumes:
  data: {}
`);
  await writeFile(envFile,`SITE_SETTING=custom\nDRIVER_HUB_IMAGE=${base}\n`);
  await compose('up','-d','--pull','never');
  await compose('exec','-T','manager','sh','-c','printf kept > /data/keep');
  const other=await compose('ps','-q','other');
  const tools=hostTools({directory:dir,project,files:[file]},'node');
  const old=await tools.previous(installed,candidate);
  await tools.verify(installed);
  for(const fail of [false,true]){
    const states=[];
    await runUpdate({installed,version,digest},{
      lookup:async()=>({version,digest,readiness:'ready'}), previous:async()=>old, pull:async()=>{},
      switchTo:pin=>tools.switchTo(pin===old?old:candidate),
      verify:async v=>{await tools.verify(v);if(v===version && fail)throw Error('Failed acceptance');}
    },async state=>states.push(state.phase));
    assert.equal(states.at(-1),fail?'rolledBack':'succeeded');
    assert.equal(await compose('ps','-q','other'),other);
    assert.equal(await readFile(envFile,'utf8'),`SITE_SETTING=custom\nDRIVER_HUB_IMAGE=${fail?old:candidate}\n`);
  }
});
