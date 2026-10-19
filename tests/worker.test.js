import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {testable} from '../src/index.js';

class MockDB {
  constructor() { this.rooms=[];this.messages=[];this.limits=new Map();this.schemaReady=true;this.schemaRuns=0; }
  prepare(sql) { return new MockStatement(this,sql); }
  async exec(schemaSQL) {
    for (const table of ['rooms','messages','limits'])
      assert.ok(schemaSQL.includes('CREATE TABLE IF NOT EXISTS '+table), 'Missing D1 table: '+table);
    this.schemaReady=true;
    this.schemaRuns++;
    return {count:5,duration:1};
  }
}
class MockStatement {
  constructor(db,sql) { this.db=db;this.sql=sql.replace(/\s+/g,' ').trim();this.args=[]; }
  bind(...args) { this.args=args;return this; }
  async first() {
    if(this.sql.includes('FROM sqlite_master')) return this.db.schemaReady?{name:'rooms'}:null;
    if(this.sql.includes('FROM rooms WHERE owner_token_hash')) {
      const [owner,guest]=this.args;return this.db.rooms.find(r=>r.owner_token_hash===owner||r.guest_token_hash===guest)||null;
    }
    if(this.sql.startsWith('SELECT COUNT(*)')) {
      return {amount:this.db.messages.filter(m=>m.room_id===this.args[0]).length};
    }
    throw Error('Unhandled first SQL: '+this.sql);
  }
  async all() {
    if(this.sql.includes('FROM messages WHERE room_id')) return {results:this.db.messages.filter(m=>m.room_id===this.args[0])};
    throw Error('Unhandled all SQL: '+this.sql);
  }
  async run() {
    if(this.sql.startsWith('INSERT INTO limits')){
      const [scope,key,day,max]=this.args;const id=[scope,key,day].join('|');const n=this.db.limits.get(id)||0;
      if(n>=max)return {meta:{changes:0}};
      this.db.limits.set(id,n+1);return {meta:{changes:1}};
    }
    if(this.sql.startsWith('INSERT INTO rooms')) {
      const [id,owner_token_hash,guest_token_hash,guest_token_enc,owner_lang,guest_lang,created_at,expires_at]=this.args;
      this.db.rooms.push({id,owner_token_hash,guest_token_hash,guest_token_enc,owner_lang,guest_lang,created_at,expires_at});
      return {meta:{changes:1}};
    }
    if(this.sql.startsWith('INSERT INTO messages')) {
      const [id,room_id,speaker,original_text,translated_text,created_at,checkedRoom,maximum]=this.args;
      if (checkedRoom !== undefined) {
        const count=this.db.messages.filter(m=>m.room_id===checkedRoom).length;
        if(count>=maximum)return {meta:{changes:0}};
      }
      this.db.messages.push({id,room_id,speaker,original_text,translated_text,created_at});return {meta:{changes:1}};
    }
    if(this.sql.startsWith('DELETE FROM rooms')) {
      const id=this.args[0];this.db.rooms=this.db.rooms.filter(r=>r.id!==id);this.db.messages=this.db.messages.filter(m=>m.room_id!==id);return {meta:{changes:1}};
    }
    if(this.sql.startsWith('DELETE FROM limits')) {return {meta:{changes:1}}}
    throw Error('Unhandled run SQL: '+this.sql);
  }
}
const aiCalls=[];
const cloudflareTestAI = {
  async run(model, input) {
    aiCalls.push({model,input});
    if (model === '@cf/openai/whisper-large-v3-turbo') {
      assert.match(input.audio,/^[a-zA-Z0-9+/]+={0,2}$/);
      assert.equal(input.task,'transcribe');
      return {text:'Привіт, як справи?'};
    }
    if (model === '@cf/meta/m2m100-1.2b') {
      assert.ok(input.source_lang && input.target_lang);
      return {translated_text:input.target_lang === 'en'?'Hello, how are you?':'Добре, дякую!'};
    }
    throw new Error('Unexpected Cloudflare AI model '+model);
  }
};
const env = ()=>({
  AI:cloudflareTestAI,
  DB:new MockDB(), RATE_LIMIT_SALT:'test-rate-limit-salt-is-long-secret',
  LINK_SECRET:'test-link-secret-is-long-enough-for-aes',
  ASSETS:{fetch:async()=>new Response('html ok',{status:200})},
  MAX_DAILY_AI_MESSAGES:'25',MAX_DAILY_NEW_ROOMS_PER_IP:'3',MAX_DAILY_MESSAGES_PER_IP:'8',MAX_MESSAGES_PER_ROOM:'20',ROOM_LIFETIME_DAYS:'7'
});
const url = path=>`https://voxbridge.example${path}`;
const request = (path,method='GET',body=undefined,headers=undefined)=>new Request(url(path),{method,body,headers});
const toJSON = (path,body)=>request(path,'POST',JSON.stringify(body),{'content-type':'application/json'});

test('health reports application-secret readiness without exposing secret values',async()=>{
  const e=env();
  const healthy=await (await worker.fetch(request('/api/health'),e)).json();
  assert.equal(healthy.securityConfigured,true);
  delete e.LINK_SECRET;
  const incomplete=await (await worker.fetch(request('/api/health'),e)).json();
  assert.equal(incomplete.securityConfigured,false);
  assert.ok(!JSON.stringify(incomplete).includes(e.RATE_LIMIT_SALT));
});

test('token entropy, deterministic hashes and safe configuration',async()=>{
  assert.match(testable.randomToken(),/^[0-9a-f]{64}$/);
  assert.notEqual(testable.randomToken(),testable.randomToken());
  assert.equal(await testable.sha256('hello'),await testable.sha256('hello'));
  assert.equal(testable.numberSetting({X:'oops'},'X',20,1,50),20);
});

test('create, share, translate both directions, reload, delete, and privacy',async()=>{
  const e=env();
  let res=await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e);
  assert.equal(res.status,201);const created=await res.json();
  assert.match(created.ownerToken,/^[0-9a-f]{64}$/);
  assert.notEqual(created.ownerToken,created.guestToken);
  assert.equal(e.DB.rooms[0].owner_token_hash,await testable.sha256(created.ownerToken));
  assert.ok(!JSON.stringify(e.DB.rooms[0]).includes(created.guestToken));

  res=await worker.fetch(request('/api/session/'+created.ownerToken),e);
  const ownerRoom=await res.json();assert.equal(ownerRoom.role,'owner');
  assert.equal(ownerRoom.guestToken,created.guestToken,'owner must recover share link after reload');
  res=await worker.fetch(request('/api/session/'+created.guestToken),e);
  const guestRoom=await res.json();assert.equal(guestRoom.role,'guest');
  assert.ok(!('guestToken' in guestRoom),'guest must not receive invitation recovery');

  res=await worker.fetch(toJSON(`/api/session/${created.ownerToken}/messages`,{text:'Привіт',consent:true}),e);
  assert.equal(res.status,201);const outgoing=await res.json();
  assert.equal(outgoing.message.translated,'Hello, how are you?');
  assert.equal(outgoing.message.speaker,'owner');
  res=await worker.fetch(toJSON(`/api/session/${created.guestToken}/messages`,{text:'All good!',consent:true}),e);
  assert.equal(res.status,201);const incoming=await res.json();
  assert.equal(incoming.message.translated,'Добре, дякую!');
  assert.equal(incoming.message.speaker,'guest');

  const ownerView=await (await worker.fetch(request('/api/session/'+created.ownerToken),e)).json();
  assert.equal(ownerView.messages.length,2);
  assert.equal(ownerView.messages[1].translated,'Добре, дякую!');
  res=await worker.fetch(request(`/api/session/${created.guestToken}`,'DELETE'),e);
  assert.equal(res.status,403);
  res=await worker.fetch(request(`/api/session/${created.ownerToken}`,'DELETE'),e);
  assert.equal(res.status,200);
  assert.equal(e.DB.messages.length,0);
  res=await worker.fetch(request('/api/session/'+created.ownerToken),e);
  assert.equal(res.status,404);
});

test('audio reaches Cloudflare speech and translation models',async()=>{
  const e=env();const created=await (await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e)).json();
  const form=new FormData();form.append('consent','yes');form.append('audio',new Blob([new Uint8Array(1024)],{type:'audio/webm'}),'sample.webm');
  const res=await worker.fetch(request(`/api/session/${created.ownerToken}/messages`,'POST',form),e);
  assert.equal(res.status,201);
  assert.equal((await res.json()).message.original,'Привіт, як справи?');
  assert.ok(aiCalls.some(c=>c.model==='@cf/openai/whisper-large-v3-turbo'));
  assert.ok(aiCalls.some(c=>c.model==='@cf/meta/m2m100-1.2b'));
});

test('invalid requests, self-service limits, and expired links',async()=>{
  const e=env();
  assert.equal((await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'uk'}),e)).status,400);
  const items=[];for(let i=0;i<3;i++) {
    const res=await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'en',guestLanguage:'pl'}),e);
    assert.equal(res.status,201);items.push(await res.json());
  }
  assert.equal((await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'en',guestLanguage:'pl'}),e)).status,429);
  assert.equal((await worker.fetch(toJSON(`/api/session/${items[0].ownerToken}/messages`,{text:'',consent:true}),e)).status,400);
  assert.equal((await worker.fetch(request('/api/session/'+'0'.repeat(64)),e)).status,404);
  e.DB.rooms[0].expires_at=Math.floor(Date.now()/1000)-1;
  assert.equal((await worker.fetch(request('/api/session/'+items[0].ownerToken),e)).status,404);
});

test('security configuration missing causes explicit error rather than calls',async()=>{
  const e=env();delete e.LINK_SECRET;
  const res=await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e);
  assert.equal(res.status,503);
});


test('invalid and oversized requests do not consume billable AI quota', async () => {
  const e = env();
  e.MAX_DAILY_AI_MESSAGES = '1';
  e.MAX_DAILY_MESSAGES_PER_IP = '1';
  const created = await (await worker.fetch(toJSON('/api/rooms', {ownerLanguage:'uk', guestLanguage:'en'}), e)).json();
  const endpoint = '/api/session/' + created.ownerToken + '/messages';

  assert.equal((await worker.fetch(toJSON(endpoint, {text:'hello', consent:false}), e)).status, 400);
  assert.equal((await worker.fetch(toJSON(endpoint, {text:'x'.repeat(501), consent:true}), e)).status, 400);
  assert.equal((await worker.fetch(toJSON(endpoint, null), e)).status, 400);
  assert.equal((await worker.fetch(request(endpoint,'POST','x'.repeat(10_000),{'content-type':'application/json'}), e)).status, 413);

  const large = new FormData();
  large.append('consent','yes');
  large.append('audio',new Blob([new Uint8Array(3_200_000)], {type:'audio/webm'}), 'huge.webm');
  assert.equal((await worker.fetch(request(endpoint,'POST',large), e)).status, 413);

  assert.equal((await worker.fetch(toJSON(endpoint, {text:'Привіт', consent:true}), e)).status, 201);
  assert.equal((await worker.fetch(toJSON(endpoint, {text:'Привіт ще раз', consent:true}), e)).status, 429);
});

test('new-room API rejects invalid JSON types and oversized bodies cleanly', async () => {
  const e = env();
  assert.equal((await worker.fetch(toJSON('/api/rooms',null), e)).status, 400);
  assert.equal((await worker.fetch(toJSON('/api/rooms',[]), e)).status, 400);
  assert.equal((await worker.fetch(request('/api/rooms','POST','x'.repeat(20_000),{'content-type':'application/json'}),e)).status, 413);
  assert.equal((await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}), e)).status, 201);
});

test('no paid OpenAI key needed, AI binding is required', async () => {
  const e=env();
  delete e.AI;
  const response=await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e);
  assert.equal(response.status,201);
  const data=await response.json();
  const message=await worker.fetch(toJSON('/api/session/'+data.ownerToken+'/messages',{text:'Hello',consent:true}),e);
  assert.equal(message.status,503);
  assert.match((await message.json()).error,/Cloudflare AI/);
});

test('new D1 database initializes its schema without paid tokens or manual SQL', async () => {
  const e = env();
  e.DB.schemaReady = false;
  const created = await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e);
  assert.equal(created.status,201);
  assert.equal(e.DB.schemaReady,true);
  assert.equal(e.DB.schemaRuns,1);
  const again = await worker.fetch(request('/api/health'),e);
  assert.equal(again.status,200);
  assert.equal(e.DB.schemaRuns,1);
  const health=await again.json();
  assert.equal(health.aiProvider,'cloudflare-workers-ai');
});


test('base64 conversion preserves audio bytes across chunk boundaries', () => {
  for (const size of [1,2,3,24_575,24_576,24_577,49_152,3_000_000]) {
    const original = new Uint8Array(size);
    for (let i=0;i<size;i++) original[i] = (i*17+131) & 255;
    const encoded = testable.encodeAudioBase64(original);
    assert.equal(encoded,Buffer.from(original).toString('base64'), 'Audio corruption at '+size+' bytes');
  }
});


test('room language fields accept only explicit supported string codes', async () => {
  for (const lang of ['constructor','toString','__proto__','prototype',123,[],['uk'],{},null,'xx']) {
    const e=env();
    const res=await worker.fetch(toJSON('/api/rooms',{ownerLanguage:lang,guestLanguage:'en'}),e);
    assert.equal(res.status,400,'Should reject invalid language: '+JSON.stringify(lang));
    assert.equal(e.DB.rooms.length,0,'Invalid language must not create a room');
    assert.equal(e.DB.limits.size,0,'Invalid language must not spend room quota');
  }
  const e=env();
  const result=await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e);
  assert.equal(result.status,201);
});

test('simultaneous sends cannot exceed the per-room message limit', async () => {
  const e=env();e.MAX_MESSAGES_PER_ROOM='20';
  const created=await (await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e)).json();
  const roomId=e.DB.rooms[0].id;
  for(let i=0;i<19;i++)e.DB.messages.push({id:`old-${i}`,room_id:roomId,speaker:'owner',original_text:'x',translated_text:'y',created_at:i});

  let translations=0,release;
  const bothReady=new Promise(resolve=>{release=resolve});
  e.AI={run:async()=>{translations++;if(translations===2)release();await bothReady;return {translated_text:'Hello'};}};
  const endpoint=`/api/session/${created.ownerToken}/messages`;
  const responses=await Promise.all([
    worker.fetch(toJSON(endpoint,{text:'Перше',consent:true}),e),
    worker.fetch(toJSON(endpoint,{text:'Друге',consent:true}),e)
  ]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,429]);
  assert.equal(e.DB.messages.filter(m=>m.room_id===roomId).length,20);
});
