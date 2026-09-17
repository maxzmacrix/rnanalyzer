#!/usr/bin/env node
// One-time Android release keystore WITHOUT Android Studio / Java.
//
// Creates a self-signed signing key (valid 30 years) as a PKCS#12 keystore with openssl and prints the values
// for the GitHub repository secrets used by .github/workflows/android.yml:
//   ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS
//
//   node tools/android-keystore-setup.mjs [--out Integration/android-signing] [--alias rnanalyzer]
//
// KEEP THE KEYSTORE. Google Play and Android itself only accept updates signed with the same key –
// a lost keystore means a new app listing. The output folder is git-ignored.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, args.out || 'Integration/android-signing');
const ALIAS = args.alias || 'rnanalyzer';
mkdirSync(OUT, { recursive: true });

const OPENSSL = (() => {
  for (const c of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']) {
    try { execFileSync(c, ['version'], { stdio: 'pipe' }); return c; } catch {}
  }
  console.error('openssl not found – install Git for Windows or add openssl to PATH'); process.exit(1);
})();
const openssl = (...a) => execFileSync(OPENSSL, a, { stdio: ['ignore', 'pipe', 'pipe'] });

const p12 = join(OUT, 'release.p12');
if (existsSync(p12)) { console.error(`✖ ${p12} already exists – refusing to overwrite a release key. Move it away first if you really want a new one.`); process.exit(1); }

const password = crypto.randomBytes(18).toString('base64url');
const keyPem = join(OUT, 'release-key.pem'), certPem = join(OUT, 'release-cert.pem');
openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '10950',
  '-subj', '/CN=RN Analyzer/O=RN Vision GmbH/C=DE', '-keyout', keyPem, '-out', certPem);
openssl('pkcs12', '-export', '-inkey', keyPem, '-in', certPem, '-out', p12, '-name', ALIAS, '-passout', `pass:${password}`,
  '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1');
const fp = openssl('x509', '-in', certPem, '-noout', '-fingerprint', '-sha256').toString().trim();

const secrets = { ANDROID_KEYSTORE_BASE64: readFileSync(p12).toString('base64'), ANDROID_KEYSTORE_PASSWORD: password, ANDROID_KEY_ALIAS: ALIAS };
const secretsFile = join(OUT, 'github-secrets-android.txt');
writeFileSync(secretsFile, Object.entries(secrets).map(([k, v]) => `${k}\n${v}\n`).join('\n'));

console.log(`
DONE. Keystore: ${p12}
Certificate ${fp}

Add these three repository secrets on GitHub
(https://github.com/maxzmacrix/rnanalyzer/settings/secrets/actions → "New repository secret"):

  ANDROID_KEYSTORE_BASE64    – first block in ${secretsFile}
  ANDROID_KEYSTORE_PASSWORD  – ${password}
  ANDROID_KEY_ALIAS          – ${ALIAS}

Then push a tag, e.g.  git tag android-v2.0.0-b1 && git push origin android-v2.0.0-b1
Back up the folder ${OUT} somewhere safe (password manager / company vault).`);
