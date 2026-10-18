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
);
