import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {testable} from '../src/index.js';

class MockDB {
  constructor() { this.rooms=[];this.messages=[];this.limits=new Map(); }
  prepare(sql) { return new MockStatement(this,sql); }
}
class MockStatement {
  constructor(db,sql) { this.db=db;this.sql=sql.replace(/\s+/g,' ').trim();this.args=[]; }
  bind(...args) { this.args=args;return this; }
  async first() {
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
      const [id,room_id,speaker,original_text,translated_text,created_at]=this.args;
      this.db.messages.push({id,room_id,speaker,original_text,translated_text,created_at});return {meta:{changes:1}};
    }
    if(this.sql.startsWith('DELETE FROM rooms')) {
      const id=this.args[0];this.db.rooms=this.db.rooms.filter(r=>r.id!==id);this.db.messages=this.db.messages.filter(m=>m.room_id!==id);return {meta:{changes:1}};
    }
    if(this.sql.startsWith('DELETE FROM limits')) {return {meta:{changes:1}}}
    throw Error('Unhandled run SQL: '+this.sql);
  }
}
const env = ()=>({
  DB:new MockDB(), RATE_LIMIT_SALT:'test-rate-limit-salt-is-long-secret',
  LINK_SECRET:'test-link-secret-is-long-enough-for-aes',
  OPENAI_API_KEY:'sk-test-not-real',
  ASSETS:{fetch:async()=>new Response('html ok',{status:200})},
  MAX_DAILY_AI_MESSAGES:'25',MAX_DAILY_NEW_ROOMS_PER_IP:'3',MAX_DAILY_MESSAGES_PER_IP:'8',MAX_MESSAGES_PER_ROOM:'20',ROOM_LIFETIME_DAYS:'7'
});
const url = path=>`https://voxbridge.example${path}`;
const request = (path,method='GET',body=undefined,headers=undefined)=>new Request(url(path),{method,body,headers});
const toJSON = (path,body)=>request(path,'POST',JSON.stringify(body),{'content-type':'application/json'});
const originalFetch=globalThis.fetch;
const aiCalls=[];
globalThis.fetch=async (url,options)=>{
  aiCalls.push(String(url));
  if(String(url).endsWith('/audio/transcriptions'))return Response.json({text:'Привіт, як справи?'});
  if(String(url).endsWith('/chat/completions')){
    const prompt=JSON.parse(options.body).messages[0].content;
    return Response.json({choices:[{message:{content:prompt.includes('into English')?'Hello, how are you?':'Добре, дякую!'}}]});
  }
  throw Error('Unexpected fetch '+url);
};

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

test('audio reaches transcription endpoint and translation endpoint',async()=>{
  const e=env();const created=await (await worker.fetch(toJSON('/api/rooms',{ownerLanguage:'uk',guestLanguage:'en'}),e)).json();
  const form=new FormData();form.append('consent','yes');form.append('audio',new Blob([new Uint8Array(1024)],{type:'audio/webm'}),'sample.webm');
  const res=await worker.fetch(request(`/api/session/${created.ownerToken}/messages`,'POST',form),e);
  assert.equal(res.status,201);
  assert.equal((await res.json()).message.original,'Привіт, як справи?');
  assert.ok(aiCalls.some(s=>s.endsWith('audio/transcriptions')));
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
