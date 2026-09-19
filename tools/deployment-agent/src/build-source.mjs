import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import archiver from 'archiver';

const excludedDirectories = new Set(['.git', '.stratexec', 'node_modules', 'dist', 'coverage', '__pycache__']);
const forbiddenFiles = /(^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx))$/i;

export class BuildSourceError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'BuildSourceError';
    this.status = status;
  }
}

function inside(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function collectFiles(root, current = root, output = []) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = resolve(current, entry.name);
    const path = relative(root, absolute).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) throw new BuildSourceError(`Build context contains a symbolic link: ${path}.`);
    if (entry.isDirectory()) await collectFiles(root, absolute, output);
    else if (entry.isFile()) {
      if (forbiddenFiles.test(path) && path !== '.env.example' && !path.endsWith('/.env.example')) {
        throw new BuildSourceError(`Build context contains a forbidden credential file: ${path}.`);
      }
      output.push({ absolute, path });
    }
  }
  return output;
}

async function archiveFiles(files, maximumBytes) {
  const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 }, portable: true });
  const chunks = [];
  let size = 0;
  const completed = new Promise((resolvePromise, reject) => {
    archive.on('data', (chunk) => {
      size += chunk.byteLength;
      if (size > maximumBytes) archive.abort();
      else chunks.push(chunk);
    });
    archive.on('warning', reject);
    archive.on('error', reject);
    archive.on('end', resolvePromise);
  });
  for (const file of files) {
    const stat = await lstat(file.absolute);
    archive.append(await readFile(file.absolute), {
      name: file.path,
      date: new Date(0),
      mode: stat.mode & 0o777,
    });
  }
  await archive.finalize();
  await completed;
  if (size > maximumBytes) throw new BuildSourceError(`Build source exceeds ${maximumBytes} bytes.`, 413);
  return Buffer.concat(chunks);
}

export function createBuildSourceProvider({ repositoryRoot, maximumBytes = 67_108_864 } = {}) {
  if (!repositoryRoot) throw new Error('Build source provider requires repositoryRoot.');
  const root = resolve(repositoryRoot);
  return {
    async prepare(service) {
      const context = resolve(root, service.artifact?.context ?? '');
      const dockerfile = resolve(root, service.artifact?.dockerfile ?? '');
      if (!inside(root, context) || !inside(context, dockerfile)
        || relative(context, dockerfile).replaceAll('\\', '/') !== 'Dockerfile') {
        throw new BuildSourceError('Build context and Dockerfile must stay inside the declared service root.');
      }
      const files = await collectFiles(context);
      if (!files.some((file) => file.path === 'Dockerfile')) throw new BuildSourceError('Build context is missing Dockerfile.');
      const archive = await archiveFiles(files, maximumBytes);
      return {
        archive,
        archiveSha256: createHash('sha256').update(archive).digest('hex'),
        fileCount: files.length,
      };
    },
  };
}
