# Part B — Questions 6–10

---

# 6. Rate Limiter

**Problem:** Design a service that limits how many requests a client can make in a time window, protecting backends from abuse and overload.

## 1. Functional Requirements
- **Limit requests** per client (by API key / user / IP) to N per window.
- **Allow or reject** each request (reject with HTTP 429 + `Retry-After`).
- **Configurable rules** per endpoint/tier.
- *Out of scope:* billing, analytics.

## 2. Non-Functional Requirements
- **Very low latency:** it sits in the request path — must add < 1–2 ms.
- **High throughput:** must handle the full traffic of the system it protects (e.g., 1M RPS).
- **Distributed correctness:** the limit must hold across many app servers (a single global count per client).
- **Availability:** if the limiter fails, decide fail-open (allow) vs fail-closed (deny).

## 3. Core Entities
- **Rule:** `clientId`, `limit`, `windowSize`, `scope` (endpoint).
- **Counter/State:** per-client usage state (count + timestamps or tokens).

## 4. The API
```
allow(clientId, endpoint) → { allowed: bool, remaining, retryAfter? }
```
Usually invoked as **middleware** at the API gateway before the request reaches backends.

## 5. High-Level Design
```
Client → API Gateway (rate-limit middleware) → Backend
                     │
                     └→ Central store (Redis) holding per-client counters
```
- Each gateway instance checks/updates the client's counter in a **shared Redis** so the limit is global, not per-instance.
- **Algorithm choice** determines the counter shape (see deep dive). Default: **token bucket** (allows bursts, smooth refill).

## 6. Potential Deep Dives
- **Algorithms:**
  - *Token bucket:* tokens refill at a rate; each request consumes one; allows bursts. **Most common.**
  - *Leaky bucket:* constant output rate; smooths bursts.
  - *Fixed window counter:* simple but has boundary spikes (2× at window edges).
  - *Sliding window log/counter:* accurate, avoids boundary problem; counter variant is efficient.
- **Distributed counting:** store counters in **Redis**; use atomic operations (`INCR`, Lua scripts) to avoid race conditions across gateway instances. TTL the keys to the window.
- **Latency:** co-locate Redis with gateways; consider a **local token bucket** with periodic sync to Redis (approximate but ultra-fast) for extreme scale.
- **Fail-open vs fail-closed:** if Redis is unavailable, **fail-open** (allow) is usual for user-facing APIs (availability > perfect enforcement); fail-closed for security-critical limits.
- **Race conditions:** use atomic Redis Lua scripts so check-and-decrement is a single operation.

## 7. Trade-offs
- **Accuracy vs performance:** exact distributed counting (every request hits Redis) is accurate but adds latency/load; local approximate counting is fast but can slightly overshoot. Choose per requirement.
- **Token vs fixed window:** token bucket allows bursts (usually desirable); fixed window is simplest but spiky.
- **Fail-open vs fail-closed:** availability vs strict enforcement — a deliberate business choice.

## AWS Well-Architected Assessment
- **Operational Excellence:** use API Gateway usage plans / AWS WAF rate rules where possible (managed); CloudWatch on 429 rates and limiter latency.
- **Security:** rate limiting *is* a security control (anti-DDoS, brute-force); combine with WAF; protect the config store with least-privilege.
- **Reliability:** ElastiCache (Redis) multi-AZ; defined fail-open/closed behavior; no SPOF in the limiter path.
- **Performance Efficiency:** in-memory Redis with atomic ops; optional local buckets to shave latency at 1M RPS.
- **Cost Optimization:** rejecting abusive traffic early saves backend/compute cost; managed WAF/limits avoid custom infra.
- **Sustainability:** dropping excess load prevents wasteful downstream compute; efficient in-memory counters.

---

# 7. YouTube / Netflix (Video Streaming)

**Problem:** Design a system to upload, process, store, and stream video to millions of viewers.

## 1. Functional Requirements
- **Upload** videos.
- **Process/transcode** into multiple resolutions/formats.
- **Stream/playback** with adaptive quality.
- **Browse/search** (mention, defer).
- *Out of scope:* recommendations, comments.

## 2. Non-Functional Requirements
- **Extremely read-heavy** (views ≫ uploads); massive bandwidth.
- **Scale:** billions of views/day; petabytes of storage.
- **Low startup latency & smooth playback** (no buffering).
- **High availability & durability.**
- *Estimation:* video is the dominant cost — a single 1080p hour ≈ several GB × multiple renditions; global delivery mandates a CDN.

## 3. Core Entities
- **Video** (`videoId`, `uploaderId`, `title`, `status`, `renditions[]`), **User**, **Rendition** (resolution → storage key + manifest), **ViewEvent** (analytics).

## 4. The API
```
POST /videos/upload-url    → pre-signed upload URL
POST /videos               → { uploadKey, title } → { videoId } (kicks off processing)
GET  /videos/{id}/manifest → adaptive streaming manifest (HLS/DASH)
GET  /videos/{id}          → metadata
```

## 5. High-Level Design
```
Upload:   Client → pre-signed URL → S3 (raw)
          S3 event → Transcoding Pipeline (workers) → renditions → S3 (processed)
Metadata: Video Service → Metadata DB
Playback: Client → Manifest → CDN → video chunks (from S3 origin, cached at edge)
```
- **Direct-to-S3 upload** (pre-signed), same as Instagram.
- **Transcoding pipeline:** split video into segments, transcode to multiple bitrates/resolutions in parallel (queue + worker fleet), package as **HLS/DASH** (chunked with a manifest).
- **Adaptive bitrate streaming:** the client fetches a manifest and picks the best rendition for its bandwidth, switching dynamically; chunks are served from the **CDN**.

## 6. Potential Deep Dives
- **Transcoding at scale:** segment-level parallelism (split → transcode chunks concurrently → merge/package); a DAG/workflow orchestrator manages steps and retries; autoscale workers with the upload queue.
- **Adaptive streaming (HLS/DASH):** video is stored as small chunks per bitrate; the manifest lists them; the player switches bitrate per network conditions → smooth playback.
- **CDN is central:** chunks are immutable and highly cacheable; edge caching handles the enormous read bandwidth and keeps startup latency low. Pre-position popular content at edges.
- **Storage tiering:** hot videos on fast tiers/CDN; cold/long-tail in cheaper storage.
- **Resumable uploads:** chunked, resumable uploads for large files/flaky networks.

## 7. Trade-offs
- **Pre-generate all renditions (storage) vs on-the-fly:** pre-generating costs storage but gives instant, cacheable playback; on-the-fly saves storage but adds latency. For read-heavy streaming, **pre-generate**.
- **HLS vs DASH:** device compatibility vs openness; often support both.
- **CDN cost vs performance:** CDN is expensive but non-negotiable for global smooth playback.

## AWS Well-Architected Assessment
- **Operational Excellence:** MediaConvert / Step Functions orchestrate transcoding; CloudWatch on pipeline throughput and rebuffer rates; IaC.
- **Security:** signed CDN URLs / DRM for premium content; encryption at rest/in transit; scoped upload URLs; least-privilege pipeline roles.
- **Reliability:** S3 durability; pipeline retries; multi-region CDN (CloudFront) with origin failover; no SPOF.
- **Performance Efficiency:** CloudFront edge delivery + adaptive bitrate; parallel transcoding; right-sized worker instances (GPU/compute-optimized).
- **Cost Optimization:** Spot instances for transcoding; S3 tiering for cold video; CDN offload cuts origin egress; transcode only needed renditions.
- **Sustainability:** efficient codecs (AV1/H.265) reduce bytes shipped; Spot + autoscaling use spare capacity; edge caching avoids repeated origin transfer.

---

# 8. Web Crawler

**Problem:** Design a system that crawls the web — fetching pages, extracting links, and storing content for indexing.

## 1. Functional Requirements
- **Crawl** pages starting from seed URLs, following links.
- **Store** fetched content for downstream processing (indexing).
- **Respect politeness** (robots.txt, rate per domain).
- **Avoid duplicates** (don't re-crawl the same content endlessly).
- *Out of scope:* the search index/ranking itself.

## 2. Non-Functional Requirements
- **Massive scale:** billions of pages; must be highly parallel.
- **Politeness:** don't overload any single domain.
- **Freshness:** re-crawl important pages periodically.
- **Fault tolerance:** resume after failures; no lost work.
- **Extensibility:** handle different content types.

## 3. Core Entities
- **URL** (`url`, `status`, `lastCrawled`, `priority`, `domain`), **Page/Content** (raw HTML blob), **Domain** (politeness state), **URL Frontier** (the queue of URLs to crawl).

## 4. The API (mostly internal)
```
addSeed(urls)
frontier.next() → nextUrl (respecting politeness)
store(url, content)
```

## 5. High-Level Design
```
Seed URLs → URL Frontier (prioritized, politeness-aware queues)
                 │
                 ▼
          Fetcher workers → fetch page → Content Store (S3)
                 │                          │
                 ▼                          ▼
          Parser (extract links)     Dedup (seen-URL + content hash)
                 │
                 └→ new URLs → back into Frontier
```
- **The URL Frontier** is the heart: a set of queues that decide *what to crawl next*, balancing **priority** (importance/freshness) and **politeness** (per-domain rate limits).
- **Fetch → parse → extract links → dedup → enqueue** is the core loop, run by a large worker fleet.

## 6. Potential Deep Dives
- **URL Frontier design:** two-level queues — front queues for **priority**, back queues for **politeness** (one per domain, with a delay), so each domain is crawled at a polite rate while high-priority URLs go first.
- **Deduplication:** track seen URLs (a huge set → Bloom filter + backing store) and **content hashes** (detect identical pages at different URLs) to avoid redundant work/storage.
- **Politeness:** obey `robots.txt` (cache per domain); enforce a min delay between hits to the same host; identify with a user-agent.
- **Distributed coordination:** partition the frontier by domain across workers (a domain is handled by one worker to enforce politeness); use a durable queue so crashes don't lose URLs.
- **Traps & limits:** detect crawler traps (infinite calendars, dynamic URLs), cap depth/size, handle redirects and errors.
- **Freshness:** re-crawl by priority/change-rate (news often, static rarely).

## 7. Trade-offs
- **Politeness vs speed:** per-domain rate limits slow crawling but are mandatory to be a good citizen; parallelize *across* domains instead.
- **BFS vs priority:** pure BFS is simple; priority crawling fetches important pages first but needs scoring.
- **Bloom filter dedup:** memory-efficient but has false positives (may skip a few new URLs) — acceptable trade for scale.

## AWS Well-Architected Assessment
- **Operational Excellence:** SQS-based frontier; autoscaling Fargate/EC2 fetchers; CloudWatch on crawl rate, error rate, queue depth; IaC.
- **Security:** sandbox parsing (untrusted content); egress controls; respect robots.txt (ethical/legal); least-privilege to S3.
- **Reliability:** durable queues (SQS) so no URL is lost on crash; idempotent fetch/store; retries with backoff; checkpointed frontier.
- **Performance Efficiency:** massive horizontal parallelism across domains; Bloom-filter dedup; content stored in S3.
- **Cost Optimization:** Spot instances for fetchers; dedup avoids re-fetching/re-storing; tiered storage for raw HTML.
- **Sustainability:** dedup + politeness reduce wasted fetches/bandwidth; Spot uses spare capacity; crawl-frequency tuned to change rate avoids needless re-crawls.

---

# 9. Notification System

**Problem:** Design a system that sends notifications to users across multiple channels (push, SMS, email).

## 1. Functional Requirements
- **Send notifications** via push, SMS, and email.
- **Multiple triggers:** other services request a notification for a user.
- **User preferences:** channel opt-in/opt-out, quiet hours.
- **Reliability:** don't lose notifications; avoid duplicates.
- *Out of scope:* rich templating UI, analytics dashboards.

## 2. Non-Functional Requirements
- **High throughput:** millions–billions/day, bursty.
- **Reliability:** at-least-once delivery + dedup.
- **Low latency** for time-sensitive alerts.
- **Extensible:** add channels/providers easily.
- **Availability.**

## 3. Core Entities
- **Notification** (`id`, `userId`, `channel`, `payload`, `status`), **User Preferences**, **Template**, **Provider** (APNs/FCM/Twilio/SES adapters).

## 4. The API
```
POST /notifications  → { userId, type, data, channels? } → { notificationId }
GET  /notifications/{id}/status
PUT  /users/{id}/preferences
```

## 5. High-Level Design
```
Services → Notification API → Queue (Kafka/SQS) → Dispatcher workers
                                                      │
                     ┌────────────────────────────────┼───────────────────┐
                     ▼                                 ▼                     ▼
               Push adapter (FCM/APNs)         SMS adapter (Twilio)   Email adapter (SES)
                     │                                 │                     │
                     └──────────── Provider APIs ──────┴─────────────────────┘
```
- **Ingest → queue → dispatch:** requests are validated and enqueued (buffering + reliability), then dispatcher workers apply **user preferences**, render **templates**, and route to the right **channel adapter**.
- **Adapters** abstract each provider so new channels/providers plug in cleanly.

## 6. Potential Deep Dives
- **Reliability & dedup:** durable queue; **idempotency keys** so the same logical notification isn't sent twice (client/service retries + at-least-once queue = need dedup); dead-letter queue for repeated failures.
- **Fan-out & throughput:** partition the queue for parallelism; rate-limit per provider (they have their own limits); batch where providers allow.
- **User preferences & quiet hours:** check opt-outs/quiet hours before sending; schedule delayed sends.
- **Prioritization:** separate queues for high-priority (OTP, security) vs bulk (marketing) so urgent ones aren't stuck behind a marketing blast.
- **Provider failover:** if one SMS provider fails, fail over to a backup; track delivery receipts/callbacks to confirm delivery.
- **Templating:** server-side templates with localization.

## 7. Trade-offs
- **At-least-once + dedup vs exactly-once:** exactly-once is impractical across third-party providers; at-least-once + idempotency is the standard.
- **Sync vs async:** async (queue) decouples callers, absorbs bursts, and enables retries — at the cost of immediate delivery confirmation (use status callbacks).
- **Priority queues vs single queue:** separate queues add complexity but protect urgent traffic.

## AWS Well-Architected Assessment
- **Operational Excellence:** SNS/SES + SQS provide managed building blocks; CloudWatch on delivery success/latency per channel; DLQs monitored; IaC.
- **Security:** protect PII (phone/email) with encryption; least-privilege to provider credentials (Secrets Manager); consent/opt-out enforcement (compliance).
- **Reliability:** durable queues + retries + DLQ; provider failover; idempotent delivery; multi-AZ.
- **Performance Efficiency:** partitioned queues for parallel dispatch; batching; priority lanes for urgent messages.
- **Cost Optimization:** batching and preference filtering avoid needless (paid) SMS/email sends; SQS/SNS scale to demand; suppress bounces.
- **Sustainability:** filtering unwanted/opted-out sends reduces wasted work and provider load; autoscaling dispatchers to actual volume.

---

# 10. Uber / Ride-Sharing

**Problem:** Design the core of a ride-hailing app — match riders to nearby drivers and track the trip.

## 1. Functional Requirements
- **Riders request a ride** (pickup + destination).
- **Match** the rider to a nearby available driver.
- **Real-time location** tracking during the trip.
- **Trip lifecycle:** request → matched → in-progress → completed.
- *Out of scope:* payments (see Q18), ratings, surge pricing details.

## 2. Non-Functional Requirements
- **Low latency matching** (seconds) and real-time location updates.
- **Scale:** millions of drivers/riders; high-frequency location pings (every few seconds).
- **High availability** (a city outage = lost revenue and stranded users).
- **Consistency:** a driver must be matched to **one** rider at a time (no double-booking).
- **Geospatial** queries at scale.

## 3. Core Entities
- **Rider, Driver** (`driverId`, `location`, `status`), **Trip** (`tripId`, `riderId`, `driverId`, `status`, `route`), **Location** (frequent updates).

## 4. The API
```
POST /rides              → { pickup, destination } → { tripId, status }
POST /drivers/location   → { driverId, lat, lng } (frequent updates)
WebSocket                → live trip/location updates to rider & driver
```

## 5. High-Level Design
```
Driver app → Location Service → Geospatial index (Redis Geo / quadtree)  [driver locations]
Rider app  → Ride/Matching Service → query nearby drivers → offer → Trip Service → Trip DB
Both       ⇄ WebSocket gateway ⇄ real-time updates
```
- **Location ingestion:** drivers stream location; stored in a **geospatial index** optimized for "find drivers near (lat,lng)".
- **Matching:** on a ride request, query nearby available drivers, rank (ETA/distance), offer to the best; on accept, create the **Trip** and lock that driver.
- **Real-time updates** flow over WebSockets to both parties.

## 6. Potential Deep Dives
- **Geospatial indexing:** use **geohash / quadtree / S2 cells** (or Redis GEO) to index driver locations so "nearby" queries are fast. Geohash buckets nearby points into shared prefixes → efficient range lookups. Rebalance cell size by density (dense cities vs rural).
- **High-frequency location writes:** millions of drivers pinging every few seconds = huge write volume → keep current location in an **in-memory store** (Redis), not a disk DB; persist trip routes separately/asynchronously.
- **Matching consistency:** when offering a driver, **atomically** mark them "reserved" so two riders can't grab the same driver (Redis lock / conditional update). Handle decline/timeout → offer next driver.
- **Scaling by geography:** partition by city/region (natural sharding) — location data and matching are inherently local, so shard by geo cell/region.
- **Real-time connections:** WebSocket gateway with a session registry (like the chat system) to push updates.

## 7. Trade-offs
- **In-memory vs durable location store:** in-memory (Redis) gives the needed write throughput/low latency; the trade is durability (fine — current location is ephemeral; trips are persisted).
- **Geohash precision:** finer cells = more precise but more buckets to query at borders; coarser = fewer queries but less precise. Tune per density.
- **Matching optimality vs speed:** the globally optimal match is expensive; a fast "good enough nearest" match wins for UX.
- **Consistency for matching (strong) vs everything else (eventual):** strong only where it matters (driver reservation).

## AWS Well-Architected Assessment
- **Operational Excellence:** ElastiCache (Redis Geo), managed WebSocket/API Gateway; CloudWatch on match latency and location ingest rate; regional deployments; IaC.
- **Security:** authN on all apps; protect precise location (PII) with encryption + strict access; least-privilege; audit trip data access.
- **Reliability:** multi-AZ Redis with replicas; regional isolation limits blast radius; trip state persisted durably; reconnect handling for sockets.
- **Performance Efficiency:** in-memory geo index for fast nearby queries; geo-sharding keeps queries local; WebSockets for real-time push.
- **Cost Optimization:** in-memory only for hot/current location (small, ephemeral); async persistence; autoscale by regional demand (rush-hour peaks).
- **Sustainability:** geo-partitioning avoids global scans; efficient location updates (deltas/throttled pings) cut network/compute; scale to demand.

---
