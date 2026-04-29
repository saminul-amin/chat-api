# Architecture

## Component Overview

```
                           ┌──────────────────────────────────────┐
                           │           Client (Browser / App)      │
                           └─────────────┬──────────────┬─────────┘
                                         │ HTTP REST     │ WebSocket (/chat)
                                         ▼               ▼
                           ┌──────────────────────────────────────┐
                           │           NestJS Application          │
                           │                                        │
                           │  ┌──────────┐  ┌──────────────────┐  │
                           │  │ REST API │  │  ChatGateway      │  │
                           │  │ /api/v1  │  │  (Socket.io ns)   │  │
                           │  └────┬─────┘  └────────┬─────────┘  │
                           │       │                  │             │
                           │  ┌────▼──────────────────▼──────────┐ │
                           │  │         Service Layer             │ │
                           │  │  AuthService · RoomsService       │ │
                           │  │  MessagesService · SessionService │ │
                           │  └──────┬────────────────┬──────────┘ │
                           └─────────┼────────────────┼────────────┘
                                     │                │
                          ┌──────────▼───┐   ┌────────▼──────────┐
                          │  PostgreSQL   │   │       Redis        │
                          │  (Drizzle ORM)│   │                    │
                          │              │   │  • Sessions (hash)  │
                          │  • users     │   │  • Active users (set│
                          │  • rooms     │   │  • Socket state     │
                          │  • messages  │   │  • Pub/Sub channels │
                          └──────────────┘   └───────────────────┘
```

**Data flow for a REST message post:**

1. Client `POST /api/v1/rooms/:id/messages` with `Authorization: Bearer <token>`  
2. `AuthGuard` validates token against Redis session hash  
3. `MessagesService` trims + validates content, writes row to PostgreSQL via Drizzle  
4. `MessagesService` publishes to Redis channel `chat:room:<roomId>:message`  
5. `ChatGateway.onModuleInit` subscriber (running on every instance) receives the message and emits `message:new` to all sockets in Socket.io room `room:<roomId>`  

**Data flow for WebSocket connection:**

1. Client connects to `/chat?token=<t>&roomId=<r>`  
2. `ChatGateway.handleConnection` validates token against Redis, validates room against PostgreSQL  
3. Socket joins Socket.io room `room:<roomId>`  
4. Username added to Redis set `room:<roomId>:active_users`  
5. Socket metadata (`username`, `roomId`) stored in Redis hash `socket:<socketId>`  
6. `room:joined` sent to the connecting client; `room:user_joined` broadcast to others  

---

## Session Strategy

**Token generation:** `crypto.randomBytes(32).toString('hex')` prefixed with `sess_` — 65-character cryptographically random opaque token. Tokens are not JWTs; they carry no payload.

**Storage:** Each token is stored as a Redis hash:

```
KEY  session:<token>
TTL  86400 seconds (24 hours)
FIELDS  userId, username
```

Lookup is O(1). Expiry is handled entirely by Redis — no cron or cleanup code.

**Rotation:** Every call to `POST /login` mints a new token for the user. Old tokens remain valid until their TTL expires. This is acceptable for the anonymous-user model where there is no logout.

**WebSocket auth:** The gateway reads the token from the `token` query parameter on connection handshake and performs the same Redis lookup. Invalid or expired tokens receive an `error` event and are immediately disconnected.

---

## Redis Pub/Sub — WebSocket Fan-out

When multiple server instances run behind a load balancer, Socket.io's in-process memory does not know about sockets connected to other instances.

**Solution:** `@socket.io/redis-adapter` (configured on the Socket.io server) transparently broadcasts across instances using Redis pub/sub. Additionally, the REST layer publishes domain events directly:

```
REST controller → MessagesService → redis.publish('chat:room:<id>:message', payload)
                                                    ↑
                                         ChatGateway (psubscribe on every instance)
                                         picks this up and emits message:new to
                                         all local sockets in that room
```

For `room:deleted`, the `RoomsController` publishes to `chat:room:deleted`. Every gateway instance receives this and emits `room:deleted` to sockets in that room.

This two-layer approach (socket.io redis adapter for socket-level fan-out + explicit pub/sub for domain events) ensures correct behaviour regardless of which instance receives the REST request.

---

## Active User Tracking

Active users per room are tracked with Redis sets:

```
KEY   room:<roomId>:active_users
TYPE  SET (members = usernames)
```

On connect: `SADD room:<id>:active_users <username>`  
On disconnect / `room:leave`: `SREM room:<id>:active_users <username>`  
On room deletion: `DEL room:<id>:active_users`  

`GET /rooms` and `GET /rooms/:id` call `SCARD` for each room to return the live `activeUsers` count.

Per-socket state (`username`, `roomId`) is stored in Redis hashes:

```
KEY   socket:<socketId>
TYPE  HASH  { username, roomId }
```

This avoids any in-memory JS maps for connection tracking and means connection state survives a gateway restart (though the socket itself would be gone — the Redis cleanup runs on `handleDisconnect`).

---

## Estimated Concurrent User Capacity (Single Instance)

| Resource | Estimate |
|---|---|
| Node.js event loop | ~10 000 open WebSocket connections before CPU becomes the bottleneck |
| Redis round-trips per message | 2 (publish + set read) — sub-millisecond on localhost |
| PostgreSQL writes per message | 1 INSERT — connection pool of 10 handles ~200 msg/s comfortably |
| Memory per Socket.io connection | ~5–10 KB |
| RAM for 5 000 connections | ~50 MB socket overhead |

**Rough estimate: 5 000 – 8 000 concurrent connections on a single 1 vCPU / 512 MB instance**, CPU-bound before memory. At 1 message/second/user across 5 000 users that is 5 000 Redis publishes and 5 000 Postgres inserts per second — the database would be the first bottleneck.

---

## Scaling to 10× Load

1. **Horizontal app scaling** — run N instances behind a load balancer with sticky sessions (or stateless with the redis adapter). The redis adapter already handles this.
2. **PostgreSQL read replicas** — route `GET /messages` queries to read replicas.
3. **Message write queue** — replace direct Postgres INSERT with a write-behind queue (Redis stream or a queue like BullMQ) to absorb spikes.
4. **Redis Cluster** — shard session and active-user keys across a Redis cluster once the single node becomes the bottleneck.
5. **Connection gateway separation** — deploy WebSocket gateways on separate instances with higher file-descriptor limits, separate from REST API instances.
6. **CDN / HTTP caching** — `GET /rooms` and `GET /rooms/:id` could be cached at the edge with short TTLs to reduce origin load.

---

## Known Limitations & Trade-offs

| Limitation | Trade-off |
|---|---|
| No logout / token revocation | Tokens simply expire after 24 h. For anonymous chat this is acceptable; for sensitive apps you would maintain a revocation list in Redis. |
| Username uniqueness is enforced at DB level only | Two rapid concurrent logins for the same username could race. A `SELECT … FOR UPDATE` or `INSERT … ON CONFLICT` pattern would eliminate the gap. |
| Active user set uses the username as the member, not the socket ID | If a user opens two tabs they count once in `activeUsers`. This is intentional (the spec counts users, not connections) but could lead to premature removal if one tab disconnects. A reference-counted approach per username would fix this. |
| No message delivery guarantee for late subscribers | Messages published to Redis before a client connects are not replayed. Clients should use `GET /rooms/:id/messages` to load history on connect. |
| Drizzle migration is manual | `drizzle/0000_initial.sql` is applied manually. A production setup should automate migration on startup or via CI. |
| CORS set to `*` | Appropriate for an anonymous public service; tighten to specific origins before production. |
