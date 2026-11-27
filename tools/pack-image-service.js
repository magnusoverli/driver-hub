// Packs a file system as a gzipped `docker save` archive: the image service that Driver Hub runs
// on every Nomad client. It runs during the container build, which has no Docker daemon, so the
// archive is written directly. Usage: node pack-image-service.js <rootfs> <output directory>
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import tar from 'tar-stream';

const [root, out] = process.argv.slice(2);
if (!root || !out) throw new Error('Usage: node pack-image-service.js <rootfs> <output directory>');
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
if (!arch) throw new Error(`Unsupported build architecture ${process.arch}`);
// A fixed time, so an unchanged file system packs to the same layer.
const mtime = new Date(0);

async function* walk(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const info = await lstat(path);
    yield { path, info };
    // Kernel file systems are mounted at run time; only their empty directories are packed.
    if (info.isDirectory() && !['proc', 'sys', 'dev'].includes(relative(root, path))) yield* walk(path);
  }
}

function entry(pack, header, source) {
  return new Promise((resolve, reject) => {
    const sink = pack.entry(header, error => (error ? reject(error) : resolve()));
    if (source) pipeline(source, sink).catch(reject);
    else sink.end();
  });
}

// Writes a tar stream to a file while hashing it, as a layer's diff ID is the hash of its tar.
async function packTo(file, fill) {
  const pack = tar.pack();
  const hash = createHash('sha256');
  const tap = new PassThrough();
  tap.on('data', chunk => hash.update(chunk));
  const done = pipeline(pack, tap, createWriteStream(file));
  await fill(pack);
  pack.finalize();
  await done;
  return hash.digest('hex');
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const layerFile = join(out, 'layer.tar');
const layer = await packTo(layerFile, async pack => {
  for await (const { path, info } of walk(root)) {
    const header = { name: relative(root, path).replaceAll('\\', '/'), mode: info.mode & 0o7777, mtime,
      uid: info.uid, gid: info.gid };
    if (info.isDirectory()) await entry(pack, { ...header, type: 'directory' });
    else if (info.isSymbolicLink()) await entry(pack, { ...header, type: 'symlink', linkname: await readlink(path) });
    else if (info.isFile()) await entry(pack, { ...header, type: 'file', size: info.size }, createReadStream(path));
  }
});

const tag = `driverhub/image-service:${layer.slice(0, 16)}`;
const config = Buffer.from(JSON.stringify({
  architecture: arch, os: 'linux', created: mtime.toISOString(),
  config: { Cmd: ['node', 'src/image-service.js'], WorkingDir: '/app',
    Env: [`PATH=${process.env.PATH}`, `NODE_VERSION=${process.env.NODE_VERSION ?? ''}`] },
  rootfs: { type: 'layers', diff_ids: [`sha256:${layer}`] }
}));
const configId = createHash('sha256').update(config).digest('hex');
const manifest = Buffer.from(JSON.stringify([{ Config: `${configId}.json`, RepoTags: [tag], Layers: [`${layer}/layer.tar`] }]));

const archive = join(out, 'image-service.tar.gz');
const hash = createHash('sha256');
const outer = tar.pack();
const tap = new PassThrough();
tap.on('data', chunk => hash.update(chunk));
const written = pipeline(outer, createGzip({ level: 9 }), tap, createWriteStream(archive));
await entry(outer, { name: 'manifest.json', size: manifest.length, mtime }, Readable.from([manifest]));
await entry(outer, { name: `${configId}.json`, size: config.length, mtime }, Readable.from([config]));
await entry(outer, { name: `${layer}/`, type: 'directory', mtime });
await entry(outer, { name: `${layer}/layer.tar`, size: (await stat(layerFile)).size, mtime }, createReadStream(layerFile));
outer.finalize();
await written;
await rm(layerFile);

const meta = { tag, arch, sha256: hash.digest('hex'), size: (await stat(archive)).size };
await writeFile(join(out, 'image-service.json'), JSON.stringify(meta));
console.log(`Packed ${tag} for linux/${arch}: ${meta.size} bytes`);
