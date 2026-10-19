// VOXBRIDGE MVP — Cloudflare Worker + D1, zero runtime dependencies.
// Real transcription and translation are server-side. Tokens are never logged.
const LANGS = Object.freeze({
  en: 'English', uk: 'Ukrainian', es: 'Spanish', fr: 'French', de: 'German',
  pl: 'Polish', pt: 'Portuguese', it: 'Italian', tr: 'Turkish', ar: 'Arabic',
  hi: 'Hindi', ru: 'Russian', ja: 'Japanese'
});
async function encryptGuestToken(token, secret) {
  if (!secret || secret.length < 24) throw Error('Missing LINK_SECRET.');
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv},key,new TextEncoder().encode(token));
  return Array.from([...iv,...new Uint8Array(ciphertext)]).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function decryptGuestToken(hex, secret) {
  if (!secret || secret.length < 24) throw Error('Missing LINK_SECRET.');
  const bytes = Uint8Array.from(hex.match(/.{2}/g).map(x=>parseInt(x,16)));
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12)));
}
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};

const databaseInitialization = new WeakMap();
// For a brand-new Cloudflare D1 database, initialize the schema on first API
// request. No D1 admin token or paid service is needed in Workers Builds.
async function ensureDatabaseSchema(db) {
  let job = databaseInitialization.get(db);
  if (!job) {
    job = (async () => {
      const present = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rooms'").first();
      if (present) return;
      await db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_token_hash TEXT NOT NULL UNIQUE,
  guest_token_hash TEXT NOT NULL UNIQUE,
  guest_token_enc TEXT NOT NULL,
  owner_lang TEXT NOT NULL,
  guest_lang TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_expires ON rooms(expires_at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL CHECK(speaker IN ('owner','guest')),
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id,created_at);
CREATE TABLE IF NOT EXISTS limits (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, day)
);`);
    })().catch(error => {
      databaseInitialization.delete(db);  // Permit retry if D1 has an outage.
      throw error;
    });
    databaseInitialization.set(db, job);
  }
  return job;
}

const NOW = () => Math.floor(Date.now() / 1000);
const DAY = () => new Date().toISOString().slice(0, 10);
const MAX_AUDIO_BYTES = 3_000_000;
const MAX_JSON_BYTES = 4_096;
const MAX_FORM_BYTES = MAX_AUDIO_BYTES + 100_000;
const MAX_TEXT_LENGTH = 500;
const allowedAudioTypes = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav']);

const json = (data, status = 200, additional = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...additional } });
const fail = (message, status = 400) => json({ error: message }, status);
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
const numberSetting = (env, key, fallback, min, max) => {
  const n = Number(env[key]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

async function rateLimit(db, scope, key, max) {
  const result = await db.prepare(`INSERT INTO limits (scope, key, day, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(scope, key, day) DO UPDATE SET count = count + 1 WHERE count < ?`)
    .bind(scope, key, DAY(), max).run();
  return (result.meta?.changes || 0) > 0;
}

async function requestIdentity(request, env) {
  // Cloudflare populates CF-Connecting-IP; use a stable fallback for local testing.
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return sha256(`${env.RATE_LIMIT_SALT}:${ip}`);
}

async function getAuthorizedRoom(token, db) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await sha256(token);
  const room = await db.prepare(`SELECT id, owner_lang, guest_lang, owner_token_hash, guest_token_hash, guest_token_enc,
    created_at, expires_at FROM rooms WHERE owner_token_hash = ? OR guest_token_hash = ? LIMIT 1`)
    .bind(hash, hash).first();
  if (!room || room.expires_at <= NOW()) return null;
  return { room, role: room.owner_token_hash === hash ? 'owner' : 'guest' };
}

const messageInfo = m => ({ id: m.id, speaker: m.speaker, original: m.original_text,
  translated: m.translated_text, createdAt: m.created_at });

class PayloadTooLargeError extends Error {}
async function boundedRequestBody(request, maxBytes) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    throw new PayloadTooLargeError();
  if (!request.body) throw new Error('Missing request body.');
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(new Blob(chunks), {
    headers: {'content-type': request.headers.get('content-type') || ''}
  });
}
async function parseJSON(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json'))
    throw new Error('Expected JSON request.');
  return (await boundedRequestBody(request, MAX_JSON_BYTES)).json();
}

// Workers AI free-tier models run through a Cloudflare binding. No OpenAI billing key.
function encodeAudioBase64(bytes) {
  // Slice on 3-byte boundaries so base64 groups concatenate without padding.
  const step = 24_576;
  let result = '';
  for (let i=0; i<bytes.length; i+=step) {
    result += btoa(String.fromCharCode(...bytes.subarray(i, i+step)));
  }
  return result;
}

async function transcribeAudio(file, language, ai) {
  if (!ai?.run) throw new Error('Cloudflare AI is not configured.');
  let result;
  try {
    result = await ai.run('@cf/openai/whisper-large-v3-turbo', {
      audio: encodeAudioBase64(new Uint8Array(await file.arrayBuffer())),
      task: 'transcribe',
      language
    });
  } catch (error) {
    console.error('Cloudflare speech model failed', error?.name || 'unknown');
    throw new Error('Speech recognition is unavailable or its free quota is exhausted. Try again later.');
  }
  const text = String(result?.text || '').trim();
  if (!text) throw new Error('No speech detected. Try again closer to the microphone.');
  return text.slice(0, MAX_TEXT_LENGTH);
}

async function translateText(text, from, to, ai) {
  if (from === to) return text;
  if (!ai?.run) throw new Error('Cloudflare AI is not configured.');
  let result;
  try {
    result = await ai.run('@cf/meta/m2m100-1.2b', {
      text,
      source_lang: from,
      target_lang: to
    });
  } catch (error) {
    console.error('Cloudflare translation model failed', error?.name || 'unknown');
    throw new Error('Translation is unavailable or its free quota is exhausted. Try again later.');
  }
  const translated = String(result?.translated_text || '').trim();
  if (!translated) throw new Error('Translation failed.');
  return translated.slice(0, 1200);
}

async function createRoom(request, env) {
  let data;
  try { data = await parseJSON(request); }
  catch (e) { return e instanceof PayloadTooLargeError ? fail('Request body is too large.',413) : fail('Invalid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('Invalid JSON.');
  const ownerLang = data.ownerLanguage === undefined ? 'uk' : data.ownerLanguage;
  const guestLang = data.guestLanguage === undefined ? 'en' : data.guestLanguage;
  if (typeof ownerLang !== 'string' || typeof guestLang !== 'string' ||
      !Object.hasOwn(LANGS, ownerLang) || !Object.hasOwn(LANGS, guestLang) || ownerLang === guestLang)
    return fail('Choose two different supported languages.');
  if (!env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT.length < 20 || !env.LINK_SECRET || env.LINK_SECRET.length < 24)
    return fail('Server security settings are incomplete.',503);
  const ip = await requestIdentity(request, env);
  if (!(await rateLimit(env.DB,'new-room',ip,numberSetting(env,'MAX_DAILY_NEW_ROOMS_PER_IP',3,1,100))))
    return fail('Daily room limit reached. Come back tomorrow.',429);
  const id = crypto.randomUUID();
  const owner = randomToken(), guest = randomToken();
  const timestamp = NOW();
  const expiry = timestamp + numberSetting(env,'ROOM_LIFETIME_DAYS',7,1,30)*86400;
  await env.DB.prepare(`INSERT INTO rooms (id, owner_token_hash, guest_token_hash, guest_token_enc, owner_lang, guest_lang, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, await sha256(owner), await sha256(guest), await encryptGuestToken(guest,env.LINK_SECRET), ownerLang, guestLang, timestamp, expiry).run();
  return json({ownerToken:owner, guestToken:guest, expiresAt:expiry}, 201);
}

async function getRoom(token, env) {
  const authorized = await getAuthorizedRoom(token, env.DB);
  if (!authorized) return fail('This conversation is invalid or has expired.',404);
  const {room, role} = authorized;
  const results = await env.DB.prepare(`SELECT id, speaker, original_text, translated_text, created_at
    FROM messages WHERE room_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 50`).bind(room.id).all();
  return json({role, ownerLanguage:room.owner_lang, guestLanguage:room.guest_lang,
    ...(role === 'owner' ? { guestToken: await decryptGuestToken(room.guest_token_enc,env.LINK_SECRET) } : {}),
    expiresAt:room.expires_at, messages:(results.results||[]).map(messageInfo)});
}

async function addMessage(token, request, env) {
  const auth = await getAuthorizedRoom(token,env.DB);
  if (!auth) return fail('This conversation is invalid or has expired.',404);
  if (!env.AI?.run)
    return fail('Cloudflare AI is not configured on this server.',503);
  if (!env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT.length < 20)
    return fail('Server security settings are incomplete.',503);
  // Validate the body before spending a user's daily AI quota.
  const from = auth.role === 'owner' ? auth.room.owner_lang : auth.room.guest_lang;
  const to = auth.role === 'owner' ? auth.room.guest_lang : auth.room.owner_lang;
  let transcript, audioFile = null;
  const ctype = request.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    let data;
    try { data = await parseJSON(request); }
    catch (e) { return e instanceof PayloadTooLargeError ? fail('Request body is too large.',413) : fail('Invalid JSON.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('Invalid JSON.');
    if (data.consent !== true) return fail('You must consent to AI processing before sending.');
    if (typeof data.text !== 'string') return fail('Write a message up to 500 characters.');
    transcript = data.text.trim();
    if (!transcript || transcript.length > MAX_TEXT_LENGTH) return fail('Write a message up to 500 characters.');
  } else if (ctype.includes('multipart/form-data')) {
    let form;
    try { form = await (await boundedRequestBody(request, MAX_FORM_BYTES)).formData(); }
    catch (e) { return e instanceof PayloadTooLargeError ? fail('Audio file is too large.',413) : fail('Could not read audio recording.'); }
    if (form.get('consent') !== 'yes') return fail('You must consent to AI processing before sending.');
    const file = form.get('audio');
    if (!(file instanceof File)) return fail('Audio recording missing.');
    const type = (file.type || '').split(';')[0];
    if (!allowedAudioTypes.has(type)) return fail('Unsupported audio format.');
    if (file.size < 500 || file.size > MAX_AUDIO_BYTES) return fail('Audio must be between 500 bytes and 3 MB.',413);
    audioFile = file;
  } else return fail('Send JSON text or multipart audio.');

  const roomLimit = numberSetting(env,'MAX_MESSAGES_PER_ROOM',20,2,200);
  const total = await env.DB.prepare('SELECT COUNT(*) AS amount FROM messages WHERE room_id = ?').bind(auth.room.id).first();
  if ((total?.amount||0) >= roomLimit)
    return fail('This conversation reached its message limit.',429);
  const ip = await requestIdentity(request, env);
  if (!(await rateLimit(env.DB,'message-ip',ip,numberSetting(env,'MAX_DAILY_MESSAGES_PER_IP',8,1,100))))
    return fail('Daily message limit reached. Try again tomorrow.',429);
  if (!(await rateLimit(env.DB,'global-ai','all',numberSetting(env,'MAX_DAILY_AI_MESSAGES',25,1,10000))))
    return fail('Daily AI budget reached. Try again tomorrow.',429);
  if (audioFile) {
    try { transcript = await transcribeAudio(audioFile,from,env.AI); }
    catch(e) { return fail(e.message,502); }
  }

  let translated;
  try { translated = await translateText(transcript,from,to,env.AI); }
  catch(e) { return fail(e.message,502); }
  const id = crypto.randomUUID(), timestamp=NOW();
  // The earlier count avoids spending AI quota when the room is already full.
  // Recheck inside the INSERT so simultaneous owner/guest sends cannot both
  // cross the room limit after doing their AI work.
  const inserted = await env.DB.prepare(`INSERT INTO messages(id,room_id,speaker,original_text,translated_text,created_at)
    SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM messages WHERE room_id = ?) < ?`)
    .bind(id,auth.room.id,auth.role,transcript,translated,timestamp,auth.room.id,roomLimit).run();
  if (!(inserted.meta?.changes||0)) return fail('This conversation reached its message limit.',429);
  return json({message:{id,speaker:auth.role,original:transcript,translated,createdAt:timestamp}},201);
}

async function deleteRoom(token,env) {
  const auth = await getAuthorizedRoom(token,env.DB);
  if (!auth) return fail('Conversation not found.',404);
  if (auth.role !== 'owner') return fail('Only the creator can delete a conversation.',403);
  await env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(auth.room.id).run();
  return json({deleted:true});
}

function route(url, request, env) {
  const path = url.pathname;
  if (path === '/api/health' && request.method === 'GET')
    return json({ok:true,aiConfigured:Boolean(env.AI?.run), aiProvider:'cloudflare-workers-ai',
      securityConfigured:Boolean(env.RATE_LIMIT_SALT?.length >= 20 && env.LINK_SECRET?.length >= 24)});
  if (path === '/api/rooms' && request.method === 'POST') return createRoom(request,env);
  const match = path.match(/^\/api\/session\/([a-f0-9]{64})(?:\/messages)?$/);
  if (!match) return fail('Route not found.',404);
  const token = match[1];
  if (path.endsWith('/messages') && request.method === 'POST') return addMessage(token,request,env);
  if (!path.endsWith('/messages') && request.method === 'GET') return getRoom(token,env);
  if (!path.endsWith('/messages') && request.method === 'DELETE') return deleteRoom(token,env);
  return fail('Method not allowed.',405);
}

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return fail('Database not configured.',503);
    try {
      await ensureDatabaseSchema(env.DB);
      return await route(url,request,env);
    }
    catch(error) { console.error('Server error', error?.name || 'unknown'); return fail('Unexpected server error.',500); }
  },
  async scheduled(event,env) {
    await ensureDatabaseSchema(env.DB);
    await env.DB.prepare('DELETE FROM rooms WHERE expires_at <= ?').bind(NOW()).run();
    await env.DB.prepare('DELETE FROM limits WHERE day < ?').bind(new Date(Date.now()-2*86400000).toISOString().slice(0,10)).run();
  }
};

export const testable = {sha256, randomToken, numberSetting, translateText, transcribeAudio, rateLimit, encodeAudioBase64, LANGS};
