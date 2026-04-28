CREATE TABLE IF NOT EXISTS "users" (
  "id"         VARCHAR(36)  PRIMARY KEY,
  "username"   VARCHAR(24)  NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "rooms" (
  "id"         VARCHAR(36)  PRIMARY KEY,
  "name"       VARCHAR(32)  NOT NULL UNIQUE,
  "created_by" VARCHAR(24)  NOT NULL,
  "created_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id"         VARCHAR(36)   PRIMARY KEY,
  "room_id"    VARCHAR(36)   NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "username"   VARCHAR(24)   NOT NULL,
  "content"    VARCHAR(1000) NOT NULL,
  "created_at" TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "messages_room_id_created_at_idx"
  ON "messages" ("room_id", "created_at" DESC);
