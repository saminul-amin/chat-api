# Anonymous Chat API

A real-time group chat service built with NestJS, PostgreSQL (Drizzle ORM), Redis, and Socket.io.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS (TypeScript) |
| Database | PostgreSQL + Drizzle ORM |
| Cache / Sessions / Pub-Sub | Redis (ioredis) |
| Real-time | Socket.io |

---

## Prerequisites

- Node.js ≥ 20
- PostgreSQL ≥ 14 (running locally or any managed service)
- Redis ≥ 7 (running locally or any managed service)
- npm ≥ 10

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/saminul-amin/chat-api
cd chat-api
npm install
```

### 2. Start PostgreSQL and Redis

Ensure PostgreSQL and Redis are running. If you have them installed locally, start them with their default settings, or use any managed/cloud service.

Create the database:

```bash
psql -U postgres -c "CREATE DATABASE chat_db;"
```

### 3. Configure environment

```bash
cp .env.example .env
```

The defaults in `.env.example` match standard local PostgreSQL and Redis settings. Edit the values to match your environment if needed.

### 4. Run the database migration

```bash
# Apply the initial schema using psql
psql -U postgres -d chat_db -f drizzle/0000_initial.sql
```

Or connect with any PostgreSQL client and run `drizzle/0000_initial.sql` manually.

### 5. Start the server

```bash
# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

Server listens on `http://localhost:3000` by default.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/chat_db` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

---

## REST API

**Base path:** `/api/v1`  
**Auth:** `Authorization: Bearer <sessionToken>` on all routes except `POST /login`

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/login` | Get or create a user; returns session token |
| GET | `/api/v1/rooms` | List all rooms |
| POST | `/api/v1/rooms` | Create a room |
| GET | `/api/v1/rooms/:id` | Get room details |
| DELETE | `/api/v1/rooms/:id` | Delete a room (creator only) |
| GET | `/api/v1/rooms/:id/messages` | Paginated message history |
| POST | `/api/v1/rooms/:id/messages` | Post a message |

Every response is wrapped in the envelope:

```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": { "code": "SNAKE_CASE", "message": "..." } }
```

---

## WebSocket

Connect to the `/chat` namespace:

```
ws://localhost:3000/chat?token=<sessionToken>&roomId=<roomId>
```

### Server → Client events

| Event | Recipient | Payload |
|---|---|---|
| `room:joined` | Connecting client only | `{ activeUsers: string[] }` |
| `room:user_joined` | All other clients in room | `{ username, activeUsers }` |
| `message:new` | All clients in room | `{ id, username, content, createdAt }` |
| `room:user_left` | All clients in room | `{ username, activeUsers }` |
| `room:deleted` | All clients in room | `{ roomId }` |

### Client → Server events

| Event | Payload | Description |
|---|---|---|
| `room:leave` | _(none)_ | Graceful disconnect |

---

## Database Scripts

```bash
npm run db:generate   
npm run db:migrate    
npm run db:push       
npm run db:studio     
```

