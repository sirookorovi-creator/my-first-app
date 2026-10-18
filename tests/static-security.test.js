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
