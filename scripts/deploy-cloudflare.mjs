// Run only in trusted CI with CLOUDFLARE_API_TOKEN supplied by GitHub Secrets.
// Values of deployment tokens, chat tokens and application secrets are never logged.
import {randomBytes} from 'node:crypto';
import {readFile, appendFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export class CloudflareError extends Error {
  constructor(status, codes = []) {
    super(`Cloudflare API failed (HTTP ${status}; codes ${codes.join(',') || 'unknown'}).`);
    this.status = status; this.codes = codes;
  }
}

export function cloudflareClient(accountId, token, fetcher = fetch) {
  if (!/^[a-f0-9]{32}$/.test(accountId || '')) throw Error('Invalid Cloudflare account ID.');
  if (!token?.trim()) throw Error('Missing repository secret CLOUDFLARE_API_TOKEN.');
  return async (path, method = 'GET', body) => {
    // The account and destination cannot be changed by an API response.
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('?')) throw Error('Invalid API path.');
    let response;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: {Authorization: `Bearer ${token.trim()}`, 'Content-Type':'application/json'},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})
      });
    } catch { throw Error('Cloudflare API connection failed.'); }
    let data;
    try { data = await response.json(); } catch { throw new CloudflareError(response.status); }
    if (!response.ok || data.success !== true)
      throw new CloudflareError(response.status, (data.errors || []).map(e=>e.code).filter(Number.isInteger));
    return data.result;
  };
}

export async function ensureSubdomain(api, accountId) {
  let result, absent = false;
  try { result = await api('/workers/subdomain'); }
  catch (error) {
    // This is the documented Wrangler error for an unregistered subdomain.
    // Permission errors and service errors must never cause a mutation.
    if (!(error instanceof CloudflareError) || !error.codes.includes(10007) || error.status === 403) throw error;
    absent = true;
  }
  if (absent)
    result = await api('/workers/subdomain', 'PUT', {subdomain:`voxbridge-${accountId.slice(0,12)}`});
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(result?.subdomain || ''))
    throw Error('Cloudflare did not return a valid workers.dev subdomain.');
  return result.subdomain;
}

export async function ensureSecrets(api, workerName, databaseId, generate = ()=>randomBytes(32).toString('hex'), log = ()=>{}) {
  const path = `/workers/scripts/${encodeURIComponent(workerName)}/secrets`;
  const existing = await api(path);
  if (!Array.isArray(existing)) throw Error('Unable to read the existing Worker secrets.');
  const missing = ['LINK_SECRET','RATE_LIMIT_SALT'].filter(name=>!existing.some(s=>s.name === name));
  for (const secret of existing)
    if (['LINK_SECRET','RATE_LIMIT_SALT'].includes(secret.name) && secret.type !== 'secret_text')
      throw Error('A required Worker secret has an unexpected type; restore it before deploying.');
  if (missing.includes('LINK_SECRET')) {
    const data = await api(`/d1/database/${databaseId}/query`, 'POST', {sql:'SELECT COUNT(*) AS count FROM rooms'});
    const count = data?.[0]?.results?.[0]?.count;
    if (!Number.isInteger(count) || count !== 0)
      throw Error('LINK_SECRET is missing but existing conversations may be present. Restore the original secret; it was not replaced.');
  }
  for (const name of missing) {
    const text = generate();
    if (!/^[a-f0-9]{64}$/.test(text)) throw Error('Application secret generation failed.');
    await api(path,'PUT',{name,text,type:'secret_text'});
    log(`Created missing application secret: ${name}.`);
  }
  return missing.length;
}

const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
export async function verifyLive(origin, fetcher = fetch, audio, log = ()=>{}) {
  const send = async (path, options = {}) => {
    let response;
    try { response = await fetcher(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(90000)}); }
    catch { throw Error('Live-site request failed.'); }
    if (!response.ok) throw Error(`Live-site check failed (HTTP ${response.status}).`);
    return response;
  };
  let ready = false;
  for (let attempt=0; attempt<12; attempt++) {
    try {
      const h = await (await send('/api/health')).json();
      if (h.ok && h.aiConfigured && h.securityConfigured && h.aiProvider === 'cloudflare-workers-ai') {ready=true;break;}
    } catch { /* Allow a newly deployed Worker and its bindings to propagate. */ }
    if (attempt<11) await pause(5000);
  }
  if (!ready) throw Error('The deployed API is not ready.');
  const home = await (await send('/')).text();
  if (!home.includes('VOXBRIDGE')) throw Error('The live home page is not VOXBRIDGE.');
  const created = await (await send('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ownerLanguage:'uk',guestLanguage:'en'})})).json();
  if (![created.ownerToken,created.guestToken].every(t=>/^[a-f0-9]{64}$/.test(t || '')))
    throw Error('The deployed site did not create a valid conversation.');
  const base = `/api/session/${created.ownerToken}`;
  try {
    const owner = await (await send(base)).json();
    const guestPath = `/api/session/${created.guestToken}`;
    const guest = await (await send(guestPath)).json();
    if (owner.role !== 'owner' || guest.role !== 'guest' || owner.guestToken !== created.guestToken || guest.guestToken)
      throw Error('Live conversation permissions are incorrect.');
    const outgoing = await (await send(base+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:'Привіт! Як справи?',consent:true})})).json();
    if (outgoing.message?.speaker !== 'owner' || !/hello|hi\b/i.test(outgoing.message?.translated || ''))
      throw Error('Live Ukrainian-to-English translation failed.');
    const form = new FormData();
    form.append('consent','yes');form.append('audio',new Blob([audio],{type:'audio/wav'}),'greeting.wav');
    const incoming = await (await send(guestPath+'/messages',{method:'POST',body:form})).json();
    if (incoming.message?.speaker !== 'guest' || !/hello|how are you/i.test(incoming.message?.original || '') ||
        !/[\u0400-\u04ff]/.test(incoming.message?.translated || ''))
      throw Error('Live English speech recognition or Ukrainian translation failed.');
    const reloaded = await (await send(base)).json();
    if (reloaded.messages?.length !== 2) throw Error('Live messages were not persisted.');
    log('Live checks passed: home, D1, private invitations, both translation directions and synthetic English speech.');
  } finally {
    // Delete only the disposable conversation created by this invocation.
    const deleted = await (await send(base,{method:'DELETE'})).json();
    if (deleted.deleted !== true) throw Error('Could not delete the smoke-test conversation.');
    let response;
    try { response = await fetcher(origin+base,{redirect:'error',signal:AbortSignal.timeout(30000)}); }
    catch { throw Error('Could not verify smoke-test cleanup.'); }
    if (response.status !== 404) throw Error('The smoke-test conversation is still accessible.');
  }
}

async function main() {
  const config = JSON.parse(await readFile('wrangler.jsonc','utf8'));
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(config.name || '')) throw Error('Invalid Worker name.');
  const database = config.d1_databases?.find(d=>d.binding === 'DB');
  if (!/^[a-f0-9-]{36}$/.test(database?.database_id || '')) throw Error('Missing D1 database configuration.');
  const api = cloudflareClient(config.account_id,process.env.CLOUDFLARE_API_TOKEN);
  const subdomain = await ensureSubdomain(api,config.account_id);
  const origin = `https://${config.name}.${subdomain}.workers.dev`;
  for (const args of [['d1','migrations','apply',database.database_name,'--remote'],['deploy']]) {
    const child = spawnSync('node_modules/.bin/wrangler',args,{stdio:'inherit',timeout:300000,
      env:{...process.env,CLOUDFLARE_ACCOUNT_ID:config.account_id,WRANGLER_SEND_METRICS:'false'}});
    if (child.error || child.status !== 0) throw Error('Wrangler deployment failed; inspect the preceding CLI output.');
  }
  await ensureSecrets(api,config.name,database.database_id,undefined,console.log);
  await verifyLive(origin,fetch,await readFile('tests/fixtures/greeting.wav'),console.log);
  console.log(`Verified deployment: ${origin}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY,`## VOXBRIDGE deployed and verified\n\n${origin}\n\nText translation, synthetic English speech, invitations, D1 persistence and test-data cleanup passed.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
