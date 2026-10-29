import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// The shared access key stays server-only. The private bundle includes a separate
// derived signing credential for short-lived, origin-bound browser tickets.
if (!process.argv[2]) throw new Error('Pass the path to the private tutor key file.');
const key = (await readFile(process.argv[2], 'utf8')).trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Expected a 32-byte base64url access key.');
const source = await readFile(new URL('./tutor-worker.mjs', import.meta.url), 'utf8');
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/tutor-worker.mjs', import.meta.url), source
  .replace('__ACCESS_HASH__', createHash('sha256').update(key).digest('hex'))
  .replace('__SESSION_SIGNING_KEY__', createHash('sha256').update(key + '\0miso-live-session-v1').digest('hex')));
await import('node:fs/promises').then(fs => fs.chmod(new URL('../build/tutor-worker.mjs', import.meta.url), 0o600));
console.log('Built private build/tutor-worker.mjs with a separate session-signing key. Never publish the bundle or print its contents.');
