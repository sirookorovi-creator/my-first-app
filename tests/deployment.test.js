import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudflareError,cloudflareClient,ensureSubdomain,ensureSecrets,verifyLive} from '../scripts/deploy-cloudflare.mjs';
const account='f3dd4d2ecfdd0c89fdb864b0cb4e6dff';
const db='b39140d9-b8a5-4ca0-9cee-73b9c1be26f7';

test('deployment credentials stay on the Cloudflare API and error details do not expose them',async()=>{
  assert.throws(()=>cloudflareClient(account,''),/Missing repository secret/);
  assert.throws(()=>cloudflareClient('invalid','private-token'),/Invalid Cloudflare account/);
  const api=cloudflareClient(account,'private-token',async(url,options)=>{
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`);
    assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer private-token');
    return Response.json({success:false,errors:[{code:10000,message:'private-token'}]},{status:403});
  });
  await assert.rejects(api('/workers/subdomain'),error=>error.status===403&&!error.message.includes('private-token'));
  await assert.rejects(api('//other-host'),/Invalid API path/);
  await assert.rejects(api('/../secrets'),/Invalid API path/);
});

test('subdomain setup preserves existing names and never changes anything after authorization errors',async()=>{
  const calls=[];
  assert.equal(await ensureSubdomain(async(...args)=>{calls.push(args);return {subdomain:'existing-name'};},account),'existing-name');
  assert.equal(calls.length,1);
  const denied=[];
  await assert.rejects(ensureSubdomain(async(...args)=>{denied.push(args);throw new CloudflareError(403,[10000]);},account));
  assert.equal(denied.length,1);
  const malformed=[];
  await assert.rejects(ensureSubdomain(async(...args)=>{malformed.push(args);return {};},account),/valid workers.dev/);
  assert.equal(malformed.length,1);
  const created=[];
  assert.equal(await ensureSubdomain(async(path,method,body)=>{
    created.push({path,method,body});
    if(!method)throw new CloudflareError(404,[10007]);
    return {subdomain:body.subdomain};
  },account),'voxbridge-f3dd4d2ecfdd');
  assert.equal(created[1].method,'PUT');
});

test('deployments preserve existing application secrets and create only missing keys',async()=>{
  const present=[{name:'LINK_SECRET',type:'secret_text'},{name:'RATE_LIMIT_SALT',type:'secret_text'}];
  const calls=[];
  assert.equal(await ensureSecrets(async(...args)=>{calls.push(args);return present;},'voxbridge-mvp',db),0);
  assert.equal(calls.length,1);
  const writes=[];
  assert.equal(await ensureSecrets(async(path,method,body)=>{
    if(!method)return [present[0]];
    writes.push({path,method,body});return {};
  },'voxbridge-mvp',db,()=> 'a'.repeat(64)),1);
  assert.equal(writes[0].body.name,'RATE_LIMIT_SALT');
});

test('a missing link key is not replaced when conversations already exist',async()=>{
  const calls=[];
  await assert.rejects(ensureSecrets(async(path,method,body)=>{
    calls.push({path,method,body});
    if(!method)return [];
    assert.ok(path.endsWith('/query'));return [{results:[{count:1}]}];
  },'voxbridge-mvp',db),/Restore the original secret/);
  assert.ok(!calls.some(c=>c.method==='PUT'));
  let generated=0;const writes=[];
  assert.equal(await ensureSecrets(async(path,method,body)=>{
    if(!method)return [];
    if(path.endsWith('/query'))return [{results:[{count:0}]}];
    writes.push(body);return {};
  },'voxbridge-mvp',db,()=> (++generated===1?'a':'b').repeat(64)),2);
  assert.notEqual(writes[0].text,writes[1].text);
});

function fakeLive(failTranslation=false){
  const owner='a'.repeat(64),guest='b'.repeat(64);let deleted=false,messages=0;
  const calls=[];
  return {calls,fetcher:async(url,options={})=>{
    const path=new URL(url).pathname;calls.push({path,method:options.method||'GET'});
    if(path==='/api/health')return Response.json({ok:true,aiConfigured:true,securityConfigured:true,aiProvider:'cloudflare-workers-ai'});
    if(path==='/')return new Response('<title>VOXBRIDGE</title>');
    if(path==='/api/rooms')return Response.json({ownerToken:owner,guestToken:guest});
    if(options.method==='DELETE'){deleted=true;return Response.json({deleted:true});}
    if(deleted)return Response.json({error:'expired'},{status:404});
    if(path.endsWith('/messages')){
      if(failTranslation)return Response.json({error:'AI unavailable'},{status:502});
      messages++;
      if(options.body instanceof FormData){
        assert.equal(options.body.get('audio').type,'audio/wav');
        return Response.json({message:{speaker:'guest',original:'Hello. How are you today?',translated:'Привіт! Як справи?'}});
      }
      return Response.json({message:{speaker:'owner',translated:'Hello! How are you?'}});
    }
    return Response.json({role:path.endsWith(owner)?'owner':'guest',
      ...(path.endsWith(owner)?{guestToken:guest}:{}),messages:Array.from({length:messages},()=>({}))});
  }};
}
test('live verification exercises invitations, text, audio and persistence, then deletes only its own room',async()=>{
  const site=fakeLive();await verifyLive('https://example.workers.dev',site.fetcher,new Uint8Array(1000));
  assert.equal(site.calls.filter(c=>c.method==='DELETE').length,1);
  assert.equal(site.calls.at(-1).method,'GET');
});
test('live verification still cleans up its disposable room after an AI failure',async()=>{
  const site=fakeLive(true);
  await assert.rejects(verifyLive('https://example.workers.dev',site.fetcher,new Uint8Array(1000)),/HTTP 502/);
  assert.equal(site.calls.filter(c=>c.method==='DELETE').length,1);
});
