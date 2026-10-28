import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Read an existing private key file; never print the key or embed it in source.
if (!process.argv[2]) throw new Error('Pass the path to the private tutor key file.');
const key = (await readFile(process.argv[2], 'utf8')).trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Expected a 32-byte base64url access key.');
const source = await readFile(new URL('./tutor-worker.mjs', import.meta.url), 'utf8');
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/tutor-worker.mjs', import.meta.url), source.replace('__ACCESS_HASH__', createHash('sha256').update(key).digest('hex')));
console.log('Built build/tutor-worker.mjs. The bundle contains only the key hash.');
