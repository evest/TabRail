// Generates the RSA keypair that pins the extension ID (Phase B's allowed_origins depends on it).
// The public key goes into public/manifest.json "key"; the private key stays in .keys/ (gitignored).
// Refuses to overwrite an existing key unless --force is passed.
import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'public', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

export function extensionIdFromKey(b64) {
  const hash = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

if (manifest.key && !process.argv.includes('--force')) {
  console.log('manifest already has a key; extension ID:', extensionIdFromKey(manifest.key));
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
mkdirSync(join(root, '.keys'), { recursive: true });
const pemPath = join(root, '.keys', 'tabrail.pem');
if (existsSync(pemPath) && !process.argv.includes('--force')) throw new Error(`${pemPath} exists`);
writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
manifest.key = pub;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('extension ID:', extensionIdFromKey(pub));
