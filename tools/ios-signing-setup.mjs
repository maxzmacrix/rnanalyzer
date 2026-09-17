#!/usr/bin/env node
// One-time iOS signing setup WITHOUT a Mac.
//
// Creates an "Apple Distribution" certificate and an App Store provisioning profile through the
// App Store Connect API and packs the private key + certificate into a password-protected .p12.
// The three values it prints are pasted into the GitHub repository secrets used by .github/workflows/ios.yml.
//
//   node tools/ios-signing-setup.mjs --key "<path to AuthKey_XXXXXXXXXX.p8>" --key-id XXXXXXXXXX --issuer <issuer uuid>
//        [--bundle-id com.macrix.RN-Analyzer] [--team Z2LYJ5597T] [--out Integration/ios-signing]
//        [--renew-profile]             keep the existing certificate (distribution.pem in --out), only recreate the profile
//        [--capabilities HEALTHKIT,...] make sure these capabilities are enabled on the App ID before creating the profile
//
// Needs Node 18+ and openssl (Git for Windows ships one: "C:\Program Files\Git\usr\bin\openssl.exe").
// Nothing is uploaded anywhere except to Apple. Output folder is git-ignored – keep it private.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_PATH = args.key, KEY_ID = (args['key-id'] || '').trim(), ISSUER = (args.issuer || '').trim();
const BUNDLE_ID = args['bundle-id'] || 'com.macrix.RN-Analyzer';
const TEAM = args.team || 'Z2LYJ5597T';
const OUT = resolve(ROOT, args.out || 'Integration/ios-signing');
const PROFILE_NAME = `${BUNDLE_ID} App Store (CI)`;
const RENEW = 'renew-profile' in args;
const CAPS = (args.capabilities || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

if (!KEY_PATH || !KEY_ID || !ISSUER) {
  console.error('usage: node tools/ios-signing-setup.mjs --key <AuthKey.p8> --key-id <10 chars> --issuer <uuid> [--bundle-id ..] [--team ..] [--out ..]');
  process.exit(2);
}
if (!/^[A-Z0-9]{8,12}$/.test(KEY_ID)) fail(`--key-id should be the 10-character Key ID, got "${KEY_ID}"`);
if (!/^[0-9a-f-]{36}$/i.test(ISSUER)) fail(`--issuer should be the 36-character Issuer ID UUID`);
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- openssl
const OPENSSL = findOpenssl();
function findOpenssl() {
  const cands = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  for (const c of cands) { try { execFileSync(c, ['version'], { stdio: 'pipe' }); return c; } catch {} }
  fail('openssl not found – install Git for Windows or add openssl to PATH');
}
function openssl(...a) { return execFileSync(OPENSSL, a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }

// ---------------------------------------------------------------- App Store Connect API (JWT ES256)
const p8 = readFileSync(KEY_PATH, 'utf8');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${sig}`;
}
async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const errs = json?.errors?.map((e) => `${e.status} ${e.code}: ${e.title} – ${e.detail || ''}`).join('\n  ') || text.slice(0, 500);
    throw new Error(`${method} ${path} failed:\n  ${errs}`);
  }
  return json;
}

// ---------------------------------------------------------------- main
(async () => {
  step('Checking App Store Connect API access');
  const certs = await api('GET', 'certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=20');
  const existing = certs.data || [];
  console.log(`  ${existing.length} distribution certificate(s) exist on the team:`);
  for (const c of existing) console.log(`    - ${c.attributes.name} (${c.attributes.certificateType}) expires ${c.attributes.expirationDate?.slice(0, 10)}  id=${c.id}`);

  const keyPem = join(OUT, 'distribution-key.pem'), csrPem = join(OUT, 'distribution.csr');
  const certPem = join(OUT, 'distribution.pem');
  let certId;
  if (RENEW) {
    step('Reusing the existing certificate');
    if (!existsSync(certPem)) fail(`--renew-profile needs ${certPem} from the first run`);
    const serial = openssl('x509', '-in', certPem, '-noout', '-serial').toString().trim().replace(/^serial=/i, '').replace(/^0+/, '').toUpperCase();
    const match = existing.find((c) => String(c.attributes.serialNumber || '').replace(/^0+/, '').toUpperCase() === serial);
    if (!match) fail(`No certificate with serial ${serial} found on the team – was it revoked? Run without --renew-profile to create a new one.`);
    certId = match.id;
    console.log(`  ${match.attributes.name}, serial ${serial}, expires ${match.attributes.expirationDate?.slice(0, 10)}`);
  } else {
    step('Generating RSA key + certificate signing request');
    openssl('genrsa', '-out', keyPem, '2048');
    openssl('req', '-new', '-key', keyPem, '-subj', `/CN=RN Analyzer CI/O=Macrix/C=DE`, '-out', csrPem);
    const csr = readFileSync(csrPem, 'utf8');
    step('Requesting an "Apple Distribution" certificate from Apple');
    let cert;
    try {
      cert = await api('POST', 'certificates', { data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } } });
    } catch (e) {
      console.error(e.message);
      fail('Apple refused to create another distribution certificate. Apple allows at most 3 per team – revoke an unused one at\n' +
           'https://developer.apple.com/account/resources/certificates/list (revoking does NOT affect apps already in the App Store), then run again.');
    }
    certId = cert.data.id;
    const cerPath = join(OUT, 'distribution.cer');
    writeFileSync(cerPath, Buffer.from(cert.data.attributes.certificateContent, 'base64'));
    openssl('x509', '-inform', 'DER', '-in', cerPath, '-out', certPem);
    console.log(`  created ${cert.data.attributes.name}, serial ${cert.data.attributes.serialNumber}, expires ${cert.data.attributes.expirationDate?.slice(0, 10)}`);
  }

  step(`Looking up App ID ${BUNDLE_ID}`);
  let bid = (await api('GET', `bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}`)).data?.find((b) => b.attributes.identifier === BUNDLE_ID);
  if (!bid) {
    console.log('  not registered yet – registering');
    bid = (await api('POST', 'bundleIds', { data: { type: 'bundleIds', attributes: { identifier: BUNDLE_ID, name: 'RN Analyzer', platform: 'IOS' } } })).data;
  }
  console.log(`  App ID resource ${bid.id}`);
  if (CAPS.length) {
    step(`Checking capabilities: ${CAPS.join(', ')}`);
    const have = ((await api('GET', `bundleIds/${bid.id}/bundleIdCapabilities`)).data || []).map((c) => c.attributes.capabilityType);
    console.log(`  enabled now: ${have.join(', ') || '(none)'}`);
    for (const cap of CAPS) {
      if (have.includes(cap)) continue;
      await api('POST', 'bundleIdCapabilities', { data: { type: 'bundleIdCapabilities', attributes: { capabilityType: cap }, relationships: { bundleId: { data: { type: 'bundleIds', id: bid.id } } } } });
      console.log(`  enabled ${cap}`);
    }
  }

  step('Creating App Store provisioning profile');
  const old = (await api('GET', `profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}`)).data || [];
  for (const p of old) { console.log(`  deleting previous profile ${p.id}`); await api('DELETE', `profiles/${p.id}`); }
  const prof = await api('POST', 'profiles', {
    data: {
      type: 'profiles', attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bid.id } }, certificates: { data: [{ type: 'certificates', id: certId }] } },
    },
  });
  const profPath = join(OUT, 'RN-Analyzer-AppStore.mobileprovision');
  writeFileSync(profPath, Buffer.from(prof.data.attributes.profileContent, 'base64'));
  console.log(`  profile "${prof.data.attributes.name}" uuid ${prof.data.attributes.uuid}, expires ${prof.data.attributes.expirationDate?.slice(0, 10)}`);

  if (RENEW) {
    const profB64 = readFileSync(profPath).toString('base64');
    writeFileSync(join(OUT, 'github-secrets-profile.txt'), `IOS_PROFILE_BASE64\n${profB64}\n`);
    console.log(`\nDONE. Certificate and .p12 unchanged – only the profile is new.\nUpdate ONE repository secret on GitHub (https://github.com/maxzmacrix/rnanalyzer/settings/secrets/actions):\n\n  IOS_PROFILE_BASE64  – content of ${join(OUT, 'github-secrets-profile.txt')} (the line below the name)\n`);
    return;
  }

  step('Packing certificate + key into a password-protected .p12');
  const password = crypto.randomBytes(18).toString('base64url');
  const p12Path = join(OUT, 'distribution.p12');
  // 3DES/SHA1 PBE so that macOS `security import` accepts it regardless of OpenSSL version
  openssl('pkcs12', '-export', '-inkey', keyPem, '-in', certPem, '-out', p12Path, '-passout', `pass:${password}`,
    '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1', '-name', 'Apple Distribution (RN Analyzer CI)');

  const secrets = {
    IOS_P12_BASE64: readFileSync(p12Path).toString('base64'),
    IOS_P12_PASSWORD: password,
    IOS_PROFILE_BASE64: readFileSync(profPath).toString('base64'),
  };
  const secretsFile = join(OUT, 'github-secrets.txt');
  writeFileSync(secretsFile, Object.entries(secrets).map(([k, v]) => `${k}\n${v}\n`).join('\n'));

  console.log(`
DONE. Now add these three repository secrets on GitHub
(https://github.com/maxzmacrix/rnanalyzer/settings/secrets/actions → "New repository secret"):

  IOS_P12_BASE64      – content: first block in ${secretsFile}
  IOS_P12_PASSWORD    – content: ${password}
  IOS_PROFILE_BASE64  – content: third block in ${secretsFile}

Then push a tag, e.g.  git tag ios-v2.0.0-b7 && git push origin ios-v2.0.0-b7
Certificate and profile are valid for one year; re-run this script to renew.
Keep the folder ${OUT} private (it is git-ignored).`);
})().catch((e) => fail(e.message));

function step(s) { console.log(`\n▶ ${s}`); }
function fail(msg) { console.error(`\n✖ ${msg}`); process.exit(1); }
