# Part A — Questions 1–5

---

# 1. URL Shortener (TinyURL / Bitly)

**Problem:** Design a service that converts a long URL into a short one and redirects users from the short URL to the original.

## 1. Functional Requirements
- **Shorten:** given a long URL, return a unique short URL.
- **Redirect:** given a short URL, redirect (HTTP 302) to the original long URL.
- **Custom alias (optional):** let users pick a custom short code.
- **Expiration (optional):** links can expire at a chosen time.
- *Out of scope:* user accounts, analytics dashboards (mention them, defer them).

## 2. Non-Functional Requirements
- **Read-heavy:** redirects vastly outnumber creations — assume **100:1 read:write**.
- **Scale:** ~100M new URLs/month → ~40 writes/sec; ~4,000 redirects/sec; 5B redirects/month.
- **Low latency:** redirects must feel instant (< 100 ms P99).
- **High availability:** a broken redirect is a broken link — target 99.99%.
- **Durability:** links must not be lost.
- *Estimation:* 100M/month × 12 × 5 years ≈ **6B URLs**; ~500 bytes each ≈ **3 TB** — a single well-provisioned DB can hold this, but we plan for growth.

## 3. Core Entities
- **URL mapping:** `shortCode` (PK), `longUrl`, `createdAt`, `expiresAt`, `ownerId?`.
- **User (optional):** `userId`, for custom aliases/ownership.

## 4. The API
```
POST /urls                → create short URL
  body: { longUrl, customAlias?, expiresAt? }
  returns: { shortUrl }

GET /{shortCode}          → 302 redirect to longUrl
```
The write path (`POST`) is low volume; the read path (`GET /{shortCode}`) is the hot path we scale hardest.

## 5. High-Level Design
```
Client → Load Balancer → App servers ──→ Cache (Redis) ──→ Database (KV / SQL)
                              │
                        Key Generation Service
```
- **Create:** app generates a unique `shortCode`, stores `shortCode → longUrl` in the DB, returns the short URL.
- **Redirect:** app looks up `shortCode` → check cache first → on miss, read DB, populate cache → return 302.
- **The key question — how to generate short codes:** encode a unique number in **base62** (`[a-zA-Z0-9]`). 62^7 ≈ 3.5 trillion codes in 7 chars — plenty. Get the unique number from either a distributed counter/ID generator or a pre-generated key range per server.

## 6. Potential Deep Dives
- **Key generation without collisions:**
  - *Counter + base62:* a global counter (or ranges handed to each server via ZooKeeper/DB) guarantees uniqueness with no collision checks. Simple and scalable.
  - *Hashing (MD5/SHA of URL, take 7 chars):* risks collisions → need a collision check/retry. Also identical URLs collapse (may or may not be desired).
  - **Choice:** counter-based ranges — collision-free and fast.
- **Read scaling:** the redirect path is read-heavy → **cache aggressively** (Redis, LRU). Hot links live in cache; hit rate is very high because access is skewed. Add read replicas and a CDN for the redirect endpoint.
- **Database choice:** a simple key-value lookup by `shortCode` → a KV store (DynamoDB/Cassandra) scales horizontally and is a natural fit; a single SQL DB also works at this scale. Partition by `shortCode`.
- **Custom aliases:** check uniqueness on write (unique constraint / conditional put); reject duplicates.
- **Expiration & cleanup:** store `expiresAt`; a background job (or TTL in the KV store) purges expired links.

## 7. Trade-offs
- **302 vs 301 redirect:** 302 (temporary) lets us keep serving every request (enabling analytics and expiry control) at the cost of not being cached by browsers; 301 (permanent) is cached by browsers (less load) but you lose per-click visibility. Choose **302** for control.
- **Counter vs hashing:** counter is collision-free but needs coordination; hashing is stateless but risks collisions. We chose coordination for correctness.
- **KV vs SQL:** KV scales writes/storage effortlessly but no rich queries; SQL is simpler and fine at this scale. We lean KV for headroom.

## AWS Well-Architected Assessment
- **Operational Excellence:** Managed services (DynamoDB, ElastiCache, ALB) reduce ops; IaC (CloudFormation/CDK) for reproducibility; CloudWatch dashboards on redirect latency and error rate.
- **Security:** WAF on the edge to block malicious/abusive shorten requests; validate/sanitize input URLs (prevent open-redirect abuse to phishing); TLS everywhere; least-privilege IAM for services.
- **Reliability:** DynamoDB multi-AZ + global tables; ElastiCache with replicas; the redirect path degrades gracefully to DB if cache is down. No SPOF.
- **Performance Efficiency:** CloudFront (CDN) + Redis cache serve most redirects; DynamoDB on-demand scales with traffic; base62 keeps codes compact.
- **Cost Optimization:** DynamoDB on-demand/auto-scaling matches the spiky read load; caching cuts DB read cost dramatically (reads are the volume driver).
- **Sustainability:** Serverless/managed (DynamoDB, Lambda/Fargate) right-sizes automatically; high cache hit rate means fewer compute/DB cycles per request.

---

# 2. Pastebin

**Problem:** Design a service where users paste text (or code) and get a shareable link to view it later.

## 1. Functional Requirements
- **Create paste:** submit text, get a unique URL.
- **Read paste:** view the paste via its URL.
- **Expiration:** pastes can expire (time-based) or be one-time-view.
- **Optional:** custom URL, visibility (public/unlisted).
- *Out of scope:* editing, comments, syntax highlighting (client concern).

## 2. Non-Functional Requirements
- **Read-heavy** (a paste is written once, read many times).
- **Scale:** ~10M new pastes/month; reads 10× writes.
- **Size:** pastes up to a few MB → text is a **blob**, not a DB row field.
- **Low read latency**, high availability, durable storage.
- *Estimation:* average paste ~10 KB; 10M/month × 10 KB ≈ **100 GB/month** → object storage, not a database.

## 3. Core Entities
- **Paste:** `pasteId` (PK), `contentPointer` (object-store key), `createdAt`, `expiresAt`, `visibility`, `viewOnce?`.
- **User (optional).**

## 4. The API
```
POST /pastes            → { content, expiresAt?, visibility? } → { pasteId, url }
GET  /pastes/{pasteId}  → returns the paste content (metadata + text)
```

## 5. High-Level Design
```
Client → LB → App servers ──→ Metadata DB (pasteId → object key, expiry)
                    │
                    └──────→ Object Storage (S3) for the actual text blob
                    └──────→ Cache (Redis) for hot pastes
```
- **Create:** generate `pasteId` (base62 of a unique id), write the **text to object storage** (key = pasteId), write **metadata to the DB**, return URL.
- **Read:** look up metadata (DB/cache) → fetch blob from object storage (or cache) → return.
- **Why split blob vs metadata:** databases are bad at large blobs; object storage is cheap, durable, and CDN-friendly. The DB holds only small, queryable metadata.

## 6. Potential Deep Dives
- **Storage separation:** metadata in a small fast store (DynamoDB/SQL), content in S3. Cache small hot pastes in Redis; serve large/popular ones via CDN.
- **Expiration:** store `expiresAt`; use S3 lifecycle rules + a metadata TTL/cleanup job. For **one-time view**, mark as read (atomic update) then delete/soft-delete on first fetch.
- **ID generation:** same base62 counter approach as the URL shortener.
- **Read scaling:** CDN in front of the read endpoint for public pastes; cache metadata to avoid DB hits.
- **Abuse/limits:** cap paste size; rate-limit creation; scan for malware/secrets if needed.

## 7. Trade-offs
- **Object storage vs DB blob:** object storage wins on cost, durability, and size limits; the trade-off is a second lookup (metadata → blob), mitigated by caching.
- **One-time view consistency:** enforcing "exactly one view" needs an atomic check — a small consistency cost on read.
- **Public caching vs privacy:** CDN caching boosts performance but is only safe for public/unlisted pastes; private pastes bypass the CDN.

## AWS Well-Architected Assessment
- **Operational Excellence:** S3 lifecycle policies automate expiry/cleanup; CloudWatch metrics on create/read rates; IaC for the stack.
- **Security:** encrypt content at rest (S3 SSE) and in transit; signed URLs for private pastes; input size limits and WAF to curb abuse; least-privilege access to the bucket.
- **Reliability:** S3 gives 11-nines durability and multi-AZ; metadata DB multi-AZ; system tolerates cache loss.
- **Performance Efficiency:** CloudFront for popular pastes; Redis for metadata; S3 handles blob scale effortlessly.
- **Cost Optimization:** S3 (cheap storage) + lifecycle tiering (move cold pastes to IA/Glacier) + TTL cleanup avoid paying for dead data; serverless compute scales to zero.
- **Sustainability:** Tiering and auto-expiry delete unused data (less stored bytes); managed services right-size compute.

---

# 3. Twitter / News Feed

**Problem:** Design the core of Twitter — post tweets, follow users, and see a timeline of tweets from people you follow.

## 1. Functional Requirements
- **Post a tweet** (text, up to 280 chars, optional media).
- **Follow/unfollow** users.
- **Home timeline:** see recent tweets from followed users, newest first.
- **User timeline:** see a specific user's own tweets.
- *Out of scope (mention/defer):* likes, retweets, search, DMs, trends.

## 2. Non-Functional Requirements
- **Extremely read-heavy** (timeline reads ≫ tweet writes).
- **Scale:** ~300M DAU; ~500M tweets/day (~6K writes/sec, higher peaks); timeline reads ~10× or more.
- **Low latency:** timeline loads < 200 ms.
- **High availability** > consistency: eventual consistency is fine (a tweet appearing a second late is acceptable).
- *Estimation:* 500M tweets/day × 300 bytes ≈ **150 GB/day** of text; media dwarfs this and goes to object storage + CDN.

## 3. Core Entities
- **User:** `userId`, `handle`, `profile`.
- **Tweet:** `tweetId`, `authorId`, `text`, `mediaUrl?`, `createdAt`.
- **Follow:** `followerId → followeeId` (the social graph).
- **Timeline:** a per-user, precomputed list of tweetIds (in the fan-out-on-write model).

## 4. The API
```
POST /tweets                         → { text, media? } → { tweetId }
POST /users/{id}/follow              → follow a user
GET  /feed?cursor=&limit=            → home timeline (paginated)
GET  /users/{id}/tweets?cursor=      → a user's tweets
```

## 5. High-Level Design
```
Write:  Client → LB → Tweet Service → Tweet DB
                          │
                          └→ Fan-out Service → Timeline Cache (per-user lists in Redis)

Read:   Client → LB → Timeline Service → Timeline Cache (Redis) → hydrate from Tweet DB
```
- **The central problem — how to build the home timeline** for 300M users cheaply and fast. Two strategies:
  - **Fan-out on write (push):** when a user tweets, push the tweetId into every follower's precomputed timeline list. **Reads are O(1)** (just read your list) — great for the read-heavy workload.
  - **Fan-out on read (pull):** build the timeline on demand by querying all followees' recent tweets and merging. Cheap writes, expensive reads.
- **Chosen approach:** **hybrid** — fan-out on write for most users; fan-out on read for celebrities (see deep dive).

## 6. Potential Deep Dives
- **The celebrity problem (hot key):** fan-out on write breaks for a user with 100M followers — one tweet = 100M timeline writes (a write storm). **Solution:** don't fan out celebrity tweets; instead, at **read** time, merge the (few) celebrities you follow into your precomputed timeline. This **hybrid** bounds write amplification while keeping normal reads O(1).
- **Timeline storage:** store each user's timeline as a capped list (e.g., latest 800 tweetIds) in Redis; hydrate tweet content from the Tweet DB/cache at read time (store IDs, not full tweets, to save memory).
- **Tweet storage & sharding:** shard tweets by `tweetId` (or `authorId`); use a KV/wide-column store (Cassandra) for write throughput. Media → object storage + CDN.
- **Feed ranking:** chronological is simplest; ranked feeds add an ML scoring step over candidate tweets.
- **Consistency:** eventual — acceptable for feeds. Use async fan-out via a queue (Kafka) to absorb bursts and decouple posting from delivery.

## 7. Trade-offs
- **Push vs pull:** push = fast reads, costly writes (and the celebrity storm); pull = cheap writes, slow reads. Hybrid gets the best of both at the cost of complexity.
- **Store IDs vs full tweets in timelines:** IDs save memory but need a hydration step; full copies are faster to read but expensive and stale-prone. Choose IDs + cache.
- **Consistency vs availability:** we accept eventual consistency to get high availability and low latency — correct for social feeds.

## AWS Well-Architected Assessment
- **Operational Excellence:** Kafka (MSK) decouples fan-out; CloudWatch/X-Ray trace the write→fan-out→read path; canary deploys for ranking changes.
- **Security:** authN/authZ on all endpoints; rate limiting to stop spam/bots; content moderation hooks; encryption in transit/at rest.
- **Reliability:** async fan-out with a durable queue survives spikes/consumer failures; multi-AZ Cassandra/Redis; degraded mode (pull) if the timeline cache fails.
- **Performance Efficiency:** precomputed timelines make reads O(1); Redis + CDN for media; hybrid fan-out avoids the celebrity bottleneck.
- **Cost Optimization:** storing IDs (not full tweets) in Redis slashes memory cost; async batching of fan-out smooths capacity; tiered storage for old tweets.
- **Sustainability:** avoiding celebrity write-storms (hybrid) saves enormous compute; capped timelines and cold-tiering reduce stored data.

---

# 4. Instagram

**Problem:** Design a photo/video sharing app — upload media, follow users, and view a feed.

## 1. Functional Requirements
- **Upload** photos/videos with captions.
- **Follow** users.
- **Feed:** view recent posts from followed users.
- **View a user's profile/posts.**
- *Out of scope:* stories, DMs, explore/search (mention, defer).

## 2. Non-Functional Requirements
- **Read-heavy;** media-heavy (large payloads).
- **Scale:** ~500M DAU; ~100M posts/day; billions of feed views/day.
- **Low latency** for feed and media load; **high availability**; eventual consistency OK.
- *Estimation:* 100M posts/day × ~2 MB avg media ≈ **200 TB/day** of media → object storage + CDN are mandatory.

## 3. Core Entities
- **User, Post** (`postId`, `authorId`, `mediaUrls`, `caption`, `createdAt`), **Follow**, **Feed** (per-user list of postIds).

## 4. The API
```
POST /media/upload-url     → returns a pre-signed upload URL (client uploads directly to storage)
POST /posts                → { mediaKeys, caption } → { postId }
GET  /feed?cursor=&limit=  → feed of posts
GET  /users/{id}/posts     → a user's posts
```

## 5. High-Level Design
```
Upload: Client → (pre-signed URL) → Object Storage (S3) directly
        Client → Post Service → Post DB → Fan-out → Feed Cache (Redis)
Media:  Object Storage → CDN → Client
Read:   Client → Feed Service → Feed Cache → hydrate Post DB → media via CDN
```
- **Direct-to-storage upload:** the client requests a **pre-signed URL** and uploads the media *directly* to S3, bypassing app servers (huge bandwidth/scaling win). The app only stores metadata.
- **Feed:** same fan-out model as Twitter (hybrid push/pull).
- **Media delivery:** always via **CDN** — this is the dominant traffic and latency factor.

## 6. Potential Deep Dives
- **Media pipeline:** on upload, trigger async processing (generate multiple resolutions/thumbnails, transcode video) via a queue + workers; store variants in S3; serve the right size per device via CDN.
- **Feed generation:** fan-out-on-write with the celebrity exception, identical reasoning to Twitter.
- **CDN & caching:** aggressive CDN caching of immutable media (content-hashed keys); cache feed lists in Redis.
- **Storage tiering:** old media → cheaper storage tiers; hot media stays on CDN edges.
- **Consistency:** eventual for feed; media becomes available after processing completes (show a spinner/placeholder meanwhile).

## 7. Trade-offs
- **Pre-signed direct upload vs proxy upload:** direct upload offloads bandwidth and scales better but exposes storage details (mitigated by scoped, short-lived URLs).
- **Multiple resolutions (storage) vs on-the-fly resize (compute):** pre-generating variants costs storage but gives fast, cacheable delivery; on-the-fly saves storage but adds latency/compute. Pre-generate for the read-heavy case.
- **Eventual consistency:** feed and media availability lag slightly — acceptable for UX.

## AWS Well-Architected Assessment
- **Operational Excellence:** S3 event → Lambda/Fargate transcoding pipeline is fully automated; CloudWatch on pipeline lag; IaC.
- **Security:** short-lived pre-signed URLs; per-user authorization; S3 bucket policies (no public write); encryption at rest/in transit; content moderation.
- **Reliability:** S3 durability; multi-AZ services; async media pipeline retries on failure; feed degrades to pull mode.
- **Performance Efficiency:** CloudFront delivers media from the edge; pre-generated variants; Redis feed cache; direct-to-S3 upload removes an app-tier bottleneck.
- **Cost Optimization:** S3 Intelligent-Tiering for cold media; CDN offload reduces origin cost; serverless transcoding scales to demand.
- **Sustainability:** Tiering/lifecycle deletes/archives cold media; right-sized variants avoid shipping oversized images; edge caching cuts repeated transfer.

---

# 5. WhatsApp / Chat System

**Problem:** Design a real-time 1:1 (and group) messaging system with delivery/read receipts and presence.

## 1. Functional Requirements
- **Send/receive messages** in real time (1:1 and small groups).
- **Delivery & read receipts** (sent / delivered / read).
- **Presence** (online/last-seen).
- **Message history** (persist and sync across devices).
- *Out of scope:* calls, encryption details (mention E2E), media specifics.

## 2. Non-Functional Requirements
- **Real-time / low latency:** messages delivered in < 500 ms.
- **Scale:** ~2B users; tens of billions of messages/day; hundreds of millions of concurrent connections.
- **Reliability:** messages must not be lost; **at-least-once delivery** with dedup → effectively exactly-once for the user.
- **Ordering:** messages within a conversation appear in order.
- **High availability.**

## 3. Core Entities
- **User, Device, Message** (`messageId`, `chatId`, `senderId`, `content`, `createdAt`, `status`), **Chat/Conversation**, **Connection** (which server holds a user's live socket).

## 4. The API (mostly over a persistent connection)
```
WebSocket: connect, send(message), receive(message), ack(delivered/read), typing, presence
REST:      GET /chats/{id}/messages?cursor=   (history/sync)
```

## 5. High-Level Design
```
Client ⇄ (WebSocket) ⇄ Chat Servers (hold live connections)
                              │
                              ├→ Session Registry (user → which chat server)  [Redis]
                              ├→ Message Store (per-chat history)  [Cassandra]
                              └→ Pub/Sub backbone (route between chat servers) [Kafka/Redis]
```
- **Persistent connections:** clients hold a **WebSocket** to a chat server; the server can push messages instantly.
- **Routing between servers:** user A (on server 1) messages user B (on server 2). Server 1 looks up B's server in the **session registry** and forwards via the **pub/sub backbone**; B's server pushes it down B's socket.
- **Offline delivery:** if B is offline, persist the message; deliver (and mark delivered) when B reconnects.

## 6. Potential Deep Dives
- **Connection management at scale:** millions of concurrent sockets → many chat servers, each holding tens/hundreds of thousands of connections. A **session registry** (Redis) maps `userId → serverId`. Use a load balancer that supports long-lived connections.
- **Delivery guarantees:** persist the message *before* acking the sender; use **message IDs + client dedup** for at-least-once → exactly-once UX; track status transitions (sent→delivered→read) with acks.
- **Ordering:** assign per-chat sequence numbers (or timestamps + tiebreaker); store and read in order. Kafka partition per chat preserves order.
- **Groups:** fan out to each member's connection/server; for large groups, this is a mini fan-out problem.
- **Presence:** heartbeat over the socket updates a presence store (Redis with TTL); "last seen" = last heartbeat. Presence is best-effort (eventual).
- **Message store:** wide-column store (Cassandra) partitioned by `chatId`, clustered by time — perfect for "recent messages in a chat."

## 7. Trade-offs
- **WebSocket (stateful) vs polling:** WebSockets give true real-time and efficiency but make servers stateful (harder to scale/balance, need a session registry). Worth it for chat.
- **At-least-once + dedup vs exactly-once:** true exactly-once delivery is very hard; at-least-once + idempotent client dedup is the pragmatic standard.
- **Presence accuracy vs cost:** precise presence is chatty/expensive; we accept eventual, best-effort presence.
- **Store-and-forward:** persisting every message guarantees delivery but adds write load — necessary for reliability.

## AWS Well-Architected Assessment
- **Operational Excellence:** managed WebSocket (API Gateway WebSocket) or ECS-managed socket fleet; MSK for the backbone; dashboards on connection count, delivery latency, and queue lag.
- **Security:** end-to-end encryption for message content; TLS for transport; authN on connect; abuse/spam controls; least-privilege access to stores.
- **Reliability:** persist-before-ack guarantees no loss; multi-AZ Cassandra/Redis/Kafka; reconnect logic + offline queue; no SPOF in routing.
- **Performance Efficiency:** pub/sub backbone routes efficiently between servers; Redis session registry for O(1) lookups; partitioned message store for fast history reads.
- **Cost Optimization:** connection servers right-sized to concurrent sockets; batching/compression of messages; tiered storage for old history.
- **Sustainability:** efficient long-lived connections vs constant polling saves huge network/compute; cold message history archived; autoscaling connection fleet to actual load.

---
