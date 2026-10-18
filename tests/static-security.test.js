import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('beta static assets send anti-indexing and security headers', () => {
  assert.match(headers, /^\/\*/m);
  for (const header of [
    'Referrer-Policy: no-referrer',
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'X-Robots-Tag: noindex',
    "script-src 'self'",
    "frame-ancestors 'none'"
  ]) assert.ok(headers.includes(header), 'Missing security policy: '+header);
  assert.ok(!headers.includes('unsafe-eval'));
  assert.match(robots, /Disallow: \/\s*$/m);
  assert.match(html, /\/app\.js/);
});

test('first-launch schema remains synchronized with SQL migration', () => {
  const source = readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const migration = readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8');
  const embedded = source.match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(embedded, 'Missing safe one-time D1 schema bootstrap');
  const normalize = value => value.replace(/\s+/g,' ').replace(/\s*([(),;=])\s*/g,'$1').trim();
  assert.equal(normalize(embedded[1]), normalize(migration));
});

test('chat polling stays within the free Workers request budget', () => {
  const script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(script,/setInterval\(refreshIfVisible,30000\)/);
  assert.doesNotMatch(script,/setInterval\(refreshIfVisible,8000\)/);
});

test('owner instructions match the automated zero-payment deployment path', () => {
  const ukrainian = readFileSync(new URL('../README-UK.md',import.meta.url),'utf8');
  const deployment = readFileSync(new URL('../DEPLOY-UK.md',import.meta.url),'utf8');
  for (const text of [ukrainian,deployment]) {
    assert.match(text,/CLOUDFLARE_API_TOKEN/);
    assert.doesNotMatch(text,/OPENAI_API_KEY` (?:потрібен|required)/);
  }
  assert.doesNotMatch(ukrainian,/секрети.*CLOUDFLARE_ACCOUNT_ID/s);
  assert.match(ukrainian,/створить лише відсутні/);
  assert.match(deployment,/Створює відсутні випадкові `LINK_SECRET` та `RATE_LIMIT_SALT`/);
});
