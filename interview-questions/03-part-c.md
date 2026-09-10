# Part C — Questions 11–15

---

# 11. Google Drive / Dropbox (File Storage & Sync)

**Problem:** Design a cloud file storage service that stores files and syncs them across a user's devices.

## 1. Functional Requirements
- **Upload/download** files.
- **Sync** changes across all of a user's devices.
- **Share** files/folders with other users.
- **Versioning** (keep file history).
- *Out of scope:* real-time collaborative editing.

## 2. Non-Functional Requirements
- **Durability first:** never lose a file (11 nines).
- **Scale:** hundreds of millions of users; exabytes of data; large files.
- **Efficient sync:** upload only what changed, not whole files.
- **Availability & consistency:** a user should see a consistent view of their files.
- *Estimation:* files are large and numerous → object storage; sync efficiency drives the design.

## 3. Core Entities
- **User, File** (`fileId`, `name`, `ownerId`, `size`, `version`), **Chunk** (a piece of a file + hash), **Device**, **Share/Permission**, **FileMetadata/Version**.

## 4. The API
```
POST /files/{id}/chunks     → upload changed chunks (by hash)
GET  /files/{id}            → metadata + chunk list
GET  /chunks/{hash}         → download a chunk
POST /files/{id}/share      → grant access
GET  /changes?since=cursor  → sync: what changed for this user
```

## 5. High-Level Design
```
Client (watcher) → chunk & hash file → upload changed chunks → S3 (chunk store)
                 → update Metadata Service → Metadata DB (files, versions, chunk lists)
Sync: Client polls/subscribes to /changes → pulls new chunks → reassembles file
```
- **Chunking:** files are split into fixed/variable-size **chunks**, each identified by a **content hash**. Only chunks whose hash changed are uploaded (**delta sync**) → massive bandwidth savings.
- **Metadata vs content split:** chunks live in **object storage**; the **metadata DB** tracks files → ordered chunk hashes, versions, and permissions.
- **Sync:** a client watches for local changes and polls a **changes feed** for remote changes, downloading only new chunks.

## 6. Potential Deep Dives
- **Delta sync via chunking + dedup:** content-addressed chunks mean identical chunks (across versions or even users) are stored once (**dedup**) and never re-uploaded. Editing 1 MB of a 1 GB file uploads ~1 MB.
- **Conflict resolution:** two devices edit offline → conflict. Strategies: last-write-wins, or keep both as conflicted copies (Dropbox's approach) — never silently lose data. Use version vectors to detect conflicts.
- **Metadata consistency:** the metadata DB is the source of truth for "what the file looks like now"; make metadata updates transactional so a file version is atomic (all its chunks referenced together).
- **Sync efficiency:** a **changes/journal feed** per user (cursor-based) lets clients pull only deltas; use notifications (long-poll/WebSocket) for near-real-time sync.
- **Large file uploads:** resumable, parallel chunk uploads.

## 7. Trade-offs
- **Fixed vs variable-size chunking:** fixed is simple but a byte insertion shifts all chunks (poor dedup); **content-defined (variable) chunking** dedups better across edits but is more complex.
- **LWW vs conflict copies:** LWW is simple but can lose edits; conflict copies preserve data but add user friction. Preserve data.
- **Metadata DB choice:** strong consistency for metadata (SQL/transactional) vs scale — often a transactional metadata store + object storage for scale.

## AWS Well-Architected Assessment
- **Operational Excellence:** S3 for chunks + managed metadata DB; CloudWatch on sync lag and upload success; IaC; automated version cleanup.
- **Security:** per-file encryption at rest; scoped access (pre-signed URLs); robust sharing/permission model; audit access; TLS.
- **Reliability:** S3 11-nines durability + versioning; multi-AZ metadata DB; atomic metadata updates; resumable uploads survive network failures.
- **Performance Efficiency:** delta sync + dedup minimize transfer; CDN for downloads; parallel chunk I/O.
- **Cost Optimization:** dedup stores each chunk once; S3 tiering for cold files/old versions; only-changed-chunk uploads cut bandwidth cost.
- **Sustainability:** dedup + delta sync drastically reduce stored bytes and network transfer; lifecycle-archive old versions.

---

# 12. Ticketmaster (Ticket Booking)

**Problem:** Design a system to browse events and book seats, preventing double-booking under high concurrency (e.g., a hot concert on-sale).

## 1. Functional Requirements
- **Browse events** and view seat availability.
- **Reserve/hold** a seat during checkout.
- **Purchase** the held seat.
- **Release** holds that expire without purchase.
- *Out of scope:* recommendations, dynamic pricing details.

## 2. Non-Functional Requirements
- **Strong consistency for booking:** a seat is sold to **exactly one** buyer (no double-booking) — this is the crux.
- **High concurrency / spiky:** thousands compete for the same seats at on-sale time.
- **Read-heavy browsing** but critical-write booking.
- **Availability** for browsing; correctness for buying.

## 3. Core Entities
- **Event** (`eventId`, `venue`, `datetime`), **Seat** (`seatId`, `eventId`, `status`: available/held/booked), **Reservation/Hold** (`seatId`, `userId`, `expiresAt`), **Booking/Order**, **User**.

## 4. The API
```
GET  /events/{id}/seats          → seat map + availability
POST /events/{id}/holds          → { seatIds } → hold seats (temporary)
POST /bookings                   → confirm purchase of held seats
DELETE /holds/{id}               → release
```

## 5. High-Level Design
```
Browse: Client → LB → Event Service → Cache (seat availability) → Event DB
Book:   Client → Booking Service → (atomic seat hold) → Reservation store → Payment → confirm
                                        │
                                  Hold expiry job (releases unpaid holds)
```
- **Hold-then-purchase:** to avoid taking payment for a seat someone else grabs, first **atomically hold** the seat (status available→held with a TTL), then process payment, then finalize (held→booked). If payment fails or the hold expires, release it.
- **The critical section** is the atomic seat state transition — must prevent two users holding the same seat.

## 6. Potential Deep Dives
- **Preventing double-booking (the core):** the seat hold must be **atomic and strongly consistent**. Options:
  - *DB transaction with row lock / conditional update:* `UPDATE seats SET status='held' WHERE seatId=? AND status='available'` — succeeds for only one user.
  - *Distributed lock (Redis) per seat* for the hold window.
  - Use an ACID database for the seat/booking state — correctness over scale here.
- **Hold expiry:** store `expiresAt`; a background job (or TTL) releases expired holds back to available. Handle the race between expiry and late payment.
- **Handling on-sale spikes:** a **virtual waiting room / queue** admits users gradually so the booking DB isn't overwhelmed; browse traffic served from cache/CDN; only the booking path touches the strongly-consistent store.
- **Read vs write split:** availability views can be slightly stale (cached); the *hold/purchase* path is strongly consistent.
- **Idempotency:** booking requests carry idempotency keys (retries mustn't double-book or double-charge).

## 7. Trade-offs
- **Strong consistency vs scale:** the booking path sacrifices some scalability for correctness (locks/transactions) — the right call; scale the *browse* path separately.
- **Optimistic vs pessimistic locking:** optimistic (conditional update) scales better under low contention; pessimistic (locks) is safer under the extreme contention of a hot on-sale. Often optimistic with retries.
- **Hold TTL length:** longer holds = better UX but seats locked away from others; shorter = more churn. Tune (e.g., 5–10 min).
- **Waiting room:** adds friction but protects the system and ensures fairness.

## AWS Well-Architected Assessment
- **Operational Excellence:** managed ACID DB (Aurora); queue-based waiting room; CloudWatch on hold conflicts, booking latency; game-day tests for on-sales.
- **Security:** authN; idempotent, auditable transactions; PCI-compliant payment handoff; least-privilege; fraud checks.
- **Reliability:** multi-AZ Aurora; the strongly-consistent core prevents double-booking; holds auto-release on failure; idempotency prevents duplicate orders.
- **Performance Efficiency:** cache/CDN for browsing; waiting room throttles write load to the DB's capacity; conditional updates avoid heavy locking where possible.
- **Cost Optimization:** scale the read path cheaply (cache) and reserve strong-consistency resources for the booking path; autoscale for on-sale spikes then scale down.
- **Sustainability:** waiting room smooths spikes (avoid massive over-provisioning); cached browsing reduces DB load; scale to event schedule.

---

# 13. Distributed Cache

**Problem:** Design a distributed in-memory cache (like Redis/Memcached at scale) that many services can share.

## 1. Functional Requirements
- **get(key), set(key, value, ttl), delete(key).**
- **Scale horizontally** across many nodes.
- **Eviction** when memory is full.
- **Optional:** replication for availability.

## 2. Non-Functional Requirements
- **Very low latency** (sub-millisecond).
- **High throughput** (millions of ops/sec).
- **Scalable capacity** (add nodes to grow).
- **Availability:** tolerate node failures.
- **Consistency:** typically eventual/best-effort (it's a cache).

## 3. Core Entities
- **Entry** (`key`, `value`, `ttl`, `lastAccess`), **Node** (a cache server holding a partition), **Ring** (consistent-hash mapping of keys→nodes).

## 4. The API
```
get(key) → value | miss
set(key, value, ttl)
delete(key)
```

## 5. High-Level Design
```
Client (with cache-aware library) → consistent hash → target Node → in-memory store
                                                          │
                                                    Replica node (optional)
```
- **Partitioning via consistent hashing:** keys are distributed across nodes using **consistent hashing** so adding/removing a node remaps only a small fraction of keys (not all).
- **Client-side routing:** clients (or a proxy) hash the key to find the right node → one network hop → in-memory lookup.
- **Eviction (LRU) + TTL** manage memory per node.

## 6. Potential Deep Dives
- **Consistent hashing + virtual nodes:** place nodes on a hash ring; each physical node owns many **virtual nodes** for even distribution and smooth rebalancing when nodes join/leave. This is the key to horizontal scaling without mass remapping.
- **Replication & availability:** replicate each partition to N replicas (leader + followers). On node failure, a replica takes over. Choose sync (consistent, slower) vs async (fast, may lose recent writes) replication.
- **Eviction policies:** LRU (default), LFU, or TTL-based; per-node memory bound. Approximate LRU (sampling) is common for performance.
- **Hot keys:** a single very hot key can overload its node → replicate hot keys to multiple nodes, or add a small client-side local cache (L1) in front.
- **Cache coherence:** on writes to the backing DB, invalidate/update cache (write-through or explicit invalidation); accept eventual consistency.
- **Thundering herd:** request coalescing + TTL jitter + stale-while-revalidate on misses.

## 7. Trade-offs
- **Consistency vs performance:** async replication and eventual consistency give speed/availability; a cache rarely needs strong consistency.
- **Client-side routing vs proxy:** client-side is one fewer hop (faster) but couples clients to topology; a proxy centralizes routing at a small latency cost.
- **Replication cost:** replicas improve availability but cost memory; tune replica count to the availability need.
- **Memory vs hit rate:** more memory = higher hit rate = less backend load; balance cost vs benefit.

## AWS Well-Architected Assessment
- **Operational Excellence:** ElastiCache (managed Redis/Memcached) handles clustering, failover, patching; CloudWatch on hit rate, evictions, latency; IaC.
- **Security:** in-transit/at-rest encryption; VPC isolation; AUTH; least-privilege; not internet-exposed.
- **Reliability:** multi-AZ replicas + automatic failover; consistent hashing limits rebalancing blast radius; clients degrade to DB on miss/outage.
- **Performance Efficiency:** in-memory sub-ms access; consistent hashing for even load; L1 local caches for hot keys.
- **Cost Optimization:** right-size node memory; higher hit rate reduces expensive DB load; reserved nodes for steady baseline.
- **Sustainability:** caching avoids recomputation/DB work (fewer cycles per request); right-sized memory; eviction keeps only useful data.

---

# 14. Search Autocomplete / Typeahead

**Problem:** Design the autocomplete that suggests top queries as a user types, with very low latency.

## 1. Functional Requirements
- **Suggest** top-K completions for a given prefix.
- **Rank** suggestions (by popularity/frequency).
- **Update** suggestions as new queries trend.
- *Out of scope:* full search itself, personalization (mention).

## 2. Non-Functional Requirements
- **Ultra-low latency:** suggestions must appear within ~50–100 ms as the user types.
- **Read-heavy:** every keystroke is a query.
- **Scale:** billions of queries; huge prefix space.
- **Freshness:** trending terms should appear (near-real-time-ish, not instant).

## 3. Core Entities
- **Term/Query** (`text`, `frequency`), **Trie node** (prefix → top suggestions), **PrefixTopK** (precomputed top-K per prefix).

## 4. The API
```
GET /autocomplete?prefix=har&limit=10 → ["harry potter", "hard drive", ...]
```

## 5. High-Level Design
```
Query logs → aggregation (counts) → build Trie / precomputed top-K per prefix
Serving: Client → Autocomplete Service → Trie/top-K store (in-memory) → suggestions
```
- **Trie (prefix tree):** stores terms so that walking the prefix path yields matching completions. To make it fast, **precompute and cache the top-K suggestions at each node**, so a lookup is: walk to the prefix node → return its cached top-K (no scanning subtrees).
- **Two pipelines:** an **offline pipeline** aggregates query frequencies and (re)builds the trie/top-K; an **online serving layer** answers prefix queries from an in-memory structure.

## 6. Potential Deep Dives
- **Precomputed top-K per prefix:** naively, finding top-K under a prefix means traversing the whole subtree per keystroke — too slow. Instead, **store the top-K completions directly on each trie node** (updated offline). Lookup becomes O(prefix length). This is the key latency trick.
- **Building/updating the trie:** aggregate query counts from logs (batch, e.g., hourly/daily via MapReduce/Spark); rebuild or incrementally update the trie; ship the new structure to serving nodes. Trending terms appear after the next build (near-real-time via a faster streaming path if needed).
- **Serving at scale:** keep the trie in memory on serving nodes; **shard by prefix** (e.g., by first letters) across nodes; replicate for read throughput; front with a cache/CDN for the hottest prefixes.
- **Ranking:** frequency-based, optionally time-decayed (recent popularity), optionally personalized/localized.
- **Data size:** the trie can be large → shard and compress; only store top-K per node (not all completions).

## 7. Trade-offs
- **Precompute (storage) vs compute-on-read:** precomputing top-K per node uses more memory/build time but gives the required read latency — the right trade for a read-heavy, latency-critical feature.
- **Freshness vs cost:** rebuilding more often surfaces trends faster but costs more compute; batch (periodic) rebuild is usually enough, with an optional streaming layer for hot trends.
- **Trie vs other structures:** tries give natural prefix matching; alternatives (ternary search trees, FSTs) trade memory vs speed.

## AWS Well-Architected Assessment
- **Operational Excellence:** offline build on EMR/Glue; versioned trie artifacts shipped to serving nodes; CloudWatch on suggestion latency and build success; IaC.
- **Security:** sanitize/filter suggestions (no offensive/PII leakage from query logs); TLS; least-privilege on logs.
- **Reliability:** immutable, versioned trie artifacts (roll back a bad build); replicated serving nodes; cache fallback; multi-AZ.
- **Performance Efficiency:** in-memory precomputed top-K → O(prefix) lookups; prefix sharding; CDN/cache for hot prefixes.
- **Cost Optimization:** batch builds on Spot/EMR; serve from memory (no per-keystroke DB hits); cache hottest prefixes to cut serving cost.
- **Sustainability:** precompute-once/serve-many amortizes compute; batch aggregation on spare capacity; caching avoids repeated work per keystroke.

---

# 15. Google Maps (Geospatial + Routing)

**Problem:** Design core mapping features — render the map, find places, and compute driving routes with ETAs.

## 1. Functional Requirements
- **Render map tiles** for a location/zoom.
- **Search places** (points of interest).
- **Routing:** shortest/fastest path between two points, with ETA.
- **Live traffic** affecting routes/ETA (mention).
- *Out of scope:* street view, indoor maps.

## 2. Non-Functional Requirements
- **Low latency** for tiles and routing.
- **Massive scale:** billions of requests; planet-scale data.
- **Read-heavy** (tiles/routes read far more than the map changes).
- **Freshness** for traffic/ETA.

## 3. Core Entities
- **Tile** (`z/x/y` → image/vector), **Place/POI** (`id`, `location`, `metadata`), **RoadGraph** (nodes = intersections, edges = road segments with weights), **TrafficData** (edge → current speed).

## 4. The API
```
GET /tiles/{z}/{x}/{y}            → map tile
GET /places?q=&near=lat,lng       → place search
GET /route?from=&to=&mode=        → { path, distance, eta }
```

## 5. High-Level Design
```
Tiles:  Client → CDN → Tile store (pre-rendered tiles in object storage)
Places: Client → Place Service → Geospatial index (search by location/name)
Route:  Client → Routing Service → Road Graph (in-memory/partitioned) + Traffic → path + ETA
```
- **Tiles are pre-rendered** at multiple zoom levels and served from a **CDN** (immutable, highly cacheable) — this handles the bulk of read traffic cheaply.
- **Routing** runs a shortest-path algorithm over a **road graph** weighted by distance/time, adjusted by **live traffic**.
- **Place search** uses a **geospatial index** for "near me" and name queries.

## 6. Potential Deep Dives
- **Routing at planet scale:** plain Dijkstra over billions of edges is too slow. Use **graph preprocessing / hierarchical routing** (Contraction Hierarchies, highway hierarchies) — precompute shortcuts so long routes are computed in milliseconds. Partition the graph by region; route within/between partitions.
- **Geospatial indexing:** **geohash / S2 / quadtree** to index places and map regions for fast spatial queries (Q10 shares this idea). Tiles are naturally partitioned by `z/x/y`.
- **Live traffic & ETA:** ingest GPS/probe data → estimate current speed per road segment → update edge weights → routes/ETAs reflect traffic. This is a streaming aggregation pipeline.
- **Tile serving:** pre-render popular tiles; vector tiles allow client-side rendering (less data); CDN caches aggressively.
- **Scale:** everything is read-heavy and cacheable except routing (compute) and traffic (streaming).

## 7. Trade-offs
- **Pre-rendered raster vs vector tiles:** raster is simple and cacheable but heavy and zoom-fixed; vector tiles are smaller and flexible (client renders) but need client compute. Often vector for modern apps.
- **Precomputed routing (Contraction Hierarchies) vs on-demand Dijkstra:** preprocessing costs build time/storage but makes queries fast; essential at scale.
- **ETA accuracy vs freshness cost:** more frequent traffic updates = better ETAs but more streaming compute.
- **Consistency:** map/traffic data is eventually consistent — acceptable.

## AWS Well-Architected Assessment
- **Operational Excellence:** tile pipelines and graph preprocessing automated; traffic streaming via Kinesis/MSK; CloudWatch on route latency and tile hit rate; IaC.
- **Security:** API keys + quotas; protect user location/trip data (PII); TLS; least-privilege to data stores.
- **Reliability:** CDN + object storage for tiles (highly durable/available); partitioned routing service (regional isolation); graceful degradation (stale traffic if the stream lags).
- **Performance Efficiency:** CDN for tiles; contraction hierarchies for fast routing; geospatial indexes; in-memory hot graph partitions.
- **Cost Optimization:** CDN offload for the dominant tile traffic; precomputed routing avoids repeated heavy compute; Spot/batch for preprocessing; tiered storage for rarely-viewed tiles.
- **Sustainability:** massive CDN cache hit rates avoid recompute/transfer; precompute-once routing; vector tiles cut bytes shipped.

---
