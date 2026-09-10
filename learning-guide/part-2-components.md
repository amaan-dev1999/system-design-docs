# Part 2 — Core Components (Q21–Q45)

[← Part 1](part-1-fundamentals.md) | [Index](README.md) | [Part 3 →](part-3-databases.md)

---

### Q21. Load balancers — the traffic director

**What it is:** A load balancer (LB) sits between clients and a pool of backend servers, distributing incoming requests across them. It's the component that makes horizontal scaling and high availability possible.

**What it gives you:**
- **Horizontal scaling:** spread load so no single server is overwhelmed; add servers to the pool to grow capacity.
- **High availability:** health checks detect dead/unhealthy servers and stop routing to them, so a failure is invisible to users.
- **A single entry point:** clients hit one address; the LB hides the fleet behind it.
- **Operational flexibility:** drain a server for maintenance, do rolling deploys, run canary releases.

**Where LBs live in a real stack (multiple layers):**
1. **DNS/global load balancing** — routes users to the nearest region.
2. **Edge/L7 LB** — TLS termination, path-based routing (e.g., a reverse proxy like Nginx/Envoy or a cloud ALB).
3. **Internal LBs** — distribute traffic between microservices.

**Types by implementation:**
- **Hardware LBs** (F5, Citrix) — high performance, expensive, mostly on-prem legacy.
- **Software LBs** (Nginx, HAProxy, Envoy) — flexible, cheap, ubiquitous.
- **Cloud managed LBs** (AWS ELB/ALB/NLB, GCP LB) — auto-scaling, integrated health checks, the default choice in the cloud.

**Key point:** A load balancer is *itself* a potential SPOF — run it redundantly (managed cloud LBs handle this internally; self-hosted ones need a pair with failover, e.g., via a floating IP / keepalived).

---

### Q22. Load balancing algorithms — how to choose a server

**Round robin:** Cycle through servers in order — request 1 → server A, request 2 → B, request 3 → C, repeat.
- ✅ Simple, even distribution when requests are uniform.
- ❌ Ignores server load and request cost; a server stuck with heavy requests still gets its turn.

**Weighted round robin:** Assign weights so more powerful servers get proportionally more requests (a 16-core box gets 2× the traffic of an 8-core box).
- Good for heterogeneous hardware.

**Least connections:** Route to the server with the fewest active connections.
- ✅ Adapts to real load; great when request durations vary widely.
- ❌ Slightly more state to track.

**Least response time:** Route to the server responding fastest (lowest latency + fewest connections).
- Best for latency-sensitive workloads; requires active measurement.

**IP hash / consistent hash:** Hash a key (client IP, session ID, cache key) to always route the same client/key to the same server.
- ✅ Enables **session stickiness** and **cache locality** (the same user hits the same cache-warm server).
- ❌ Uneven distribution if keys are skewed; complicates scaling (mitigated by consistent hashing).

**Random (with two choices):** Pick two servers at random, send to the less loaded of the two. Surprisingly effective — nearly as good as "least connections" with far less state ("power of two choices").

**How to choose:**
- Uniform, stateless requests → round robin.
- Variable request cost / long-lived connections → least connections.
- Need stickiness or cache affinity → consistent hash.
- Mixed hardware → weighted variants.

---

### Q23. L4 vs L7 load balancing

**Layer 4 (transport layer) load balancing:** Operates on TCP/UDP. It routes based on **IP address and port** without looking at the request contents.
- ✅ **Very fast** — minimal processing, just forwards packets/connections.
- ✅ Protocol-agnostic — works for any TCP/UDP traffic (databases, custom protocols).
- ❌ "Dumb" — can't route by URL, can't inspect or modify HTTP.
- Example: AWS Network Load Balancer (NLB). Handles millions of requests/sec with ultra-low latency.

**Layer 7 (application layer) load balancing:** Operates on HTTP/HTTPS. It **inspects the request content** — URL path, headers, cookies, method.
- ✅ **Smart routing:** send `/api/*` to one pool, `/images/*` to another; route by hostname (virtual hosting); A/B test by header.
- ✅ Can do **TLS termination**, compression, caching, request/response rewriting, WAF.
- ✅ Enables microservice routing, canary deploys by percentage, sticky sessions via cookies.
- ❌ More CPU per request (must parse HTTP); slightly higher latency.
- Example: AWS Application Load Balancer (ALB), Nginx, Envoy.

**When to use which:**
- Need content-based routing, HTTP features, or microservice gateways → **L7**.
- Need raw throughput, non-HTTP protocols, or lowest possible latency → **L4**.
- Real systems often layer them: an L4 LB in front for raw distribution, L7 proxies behind it for smart routing.

---

### Q24. Reverse proxy — the versatile front door

**What it is:** A reverse proxy sits in front of backend servers and forwards client requests to them, returning responses back. Clients think they're talking to one server; really they're talking to the proxy, which hides the backend fleet.

**What it does (often all at once):**
- **TLS/SSL termination** — decrypts HTTPS at the proxy so backends handle plain HTTP (offloads crypto cost, centralizes certificate management).
- **Load balancing** — distributes to backends (a reverse proxy is often *also* the LB).
- **Caching** — serves cached responses without hitting backends.
- **Compression** — gzip/brotli responses to save bandwidth.
- **Request routing** — path/host-based routing to different services.
- **Security** — WAF, rate limiting, hiding backend IPs/topology, blocking bad requests.
- **Static file serving** — serve assets directly, freeing app servers.

**Reverse proxy vs forward proxy:**
- **Forward proxy** represents the *client* — it sits in front of clients and forwards *their* outbound requests (e.g., a corporate proxy filtering employee internet access). The server doesn't know the real client.
- **Reverse proxy** represents the *server* — it sits in front of servers and receives inbound requests on their behalf. The client doesn't know the real backend.

**Common software:** Nginx, HAProxy, Envoy, Traefik, Caddy. In the cloud, ALB/CloudFront fill this role.

---

### Q25. CDN — bringing content close to users

**What it is:** A Content Delivery Network is a globally distributed fleet of edge servers (Points of Presence, "PoPs") that cache your content in cities around the world, so users are served from a location physically near them instead of your distant origin server.

**Why it's high-impact:**
- **Latency:** a user in Tokyo hitting an edge in Tokyo (~10 ms) instead of your origin in Virginia (~150 ms round trip) — a 15× improvement on network time.
- **Origin offload:** if the CDN serves 90% of requests from cache, your origin sees only 10% of traffic — massive capacity relief.
- **Bandwidth cost:** CDN egress is often cheaper than origin egress, and you transfer far less from origin.
- **DDoS absorption & security:** the CDN's massive distributed capacity absorbs volumetric attacks; most CDNs bundle WAF and bot mitigation.
- **Availability:** the CDN keeps serving cached content even if your origin has a hiccup.

**What to serve from a CDN:**
- **Static assets** — images, video, CSS, JS, fonts, downloads. (The classic use.)
- **Cacheable API responses** — with appropriate `Cache-Control` headers.
- **Even dynamic content** via edge compute (Cloudflare Workers, Lambda@Edge) and techniques like ESI.

**Key mechanics:**
- **Cache-Control / TTL** headers tell the CDN how long to cache.
- **Cache invalidation / purge** to push updates.
- **Cache key** (URL + selected headers/query params) determines what counts as "the same" object.
- **Origin shield** — an intermediate cache layer that further reduces origin hits.

**When to add it:** Almost immediately for any app with static assets or a global audience. It's cheap, low-risk, and one of the highest-ROI scaling moves available. Examples: Cloudflare, Akamai, Fastly, CloudFront.

---

### Q26. Caching — the highest-ROI performance tool

**What it is:** Caching stores the results of expensive operations (DB queries, computations, API calls) in fast storage (usually memory) so subsequent requests can reuse them instead of recomputing.

**Why it's so powerful — two reasons:**
1. **Speed:** memory is ~1,000× faster than disk and ~1,000,000× faster than a cross-region call. Serving from cache turns a 50 ms DB query into a 1 ms lookup.
2. **The 80/20 access pattern:** real workloads are highly skewed — a small fraction of data is requested far more than the rest (a few viral tweets, popular products, hot users). Caching that small hot set absorbs a huge fraction of total traffic. Caching 20% of data can serve 80%+ of requests.

**Where caching happens (multiple layers, closest-to-user first):**
1. **Browser cache** — the user's own device (free, fastest).
2. **CDN / edge cache** — near the user.
3. **Reverse proxy cache** — at your front door (Nginx, Varnish).
4. **Application cache** — in-process (local) memory.
5. **Distributed cache** — shared Redis/Memcached cluster.
6. **Database cache** — buffer pool, query cache.

**What caching buys you at scale:** It's often the difference between needing 5 database servers vs 50. By absorbing reads, cache protects your most expensive, hardest-to-scale tier (the database).

**The catch (there's always one):** *"There are only two hard things in computer science: cache invalidation and naming things."* Keeping cached data consistent with the source of truth is the central challenge — covered in the next questions.

---

### Q27. Caching strategies — how data gets in and out

**Cache-aside (lazy loading)** — the most common pattern:
1. App checks the cache.
2. **Hit** → return cached value.
3. **Miss** → read from DB, write it into the cache, return it.
- ✅ Only requested data is cached (memory-efficient); cache failure doesn't break reads (just slower).
- ❌ First request always misses (cold cache); risk of stale data if the DB changes without invalidation.

**Read-through:** The app talks only to the cache; the *cache* loads from the DB on a miss (via a provider/library).
- ✅ Simpler app code (cache handles loading).
- ❌ Same cold-start miss; couples cache to DB schema.

**Write-through:** On a write, update the cache **and** the DB synchronously before returning.
- ✅ Cache is always consistent with DB; reads never stale.
- ❌ Every write pays the cost of writing both; caches data that may never be read.

**Write-behind (write-back):** Write to the cache immediately, return, and flush to the DB **asynchronously** later (often batched).
- ✅ Very fast writes; can batch/coalesce DB writes (great for high write volume like counters).
- ❌ Risk of **data loss** if the cache dies before flushing; more complex; DB temporarily inconsistent.

**Write-around:** Writes go straight to the DB, bypassing the cache; cache is populated only on read (cache-aside on reads).
- ✅ Avoids flooding the cache with write-heavy data that's rarely read.
- ❌ Recently written data misses on first read.

**The practical default:** **Cache-aside for reads + explicit invalidation (or short TTL) on writes.** Reach for write-through when you can't tolerate stale reads, and write-behind for extreme write throughput on tolerant data (counters, metrics).

---

### Q28. Cache eviction policies — what to remove when full

A cache has finite memory. When it fills, an **eviction policy** decides what to discard.

**LRU (Least Recently Used):** Evict the item that hasn't been accessed for the longest time.
- ✅ Matches typical access patterns (recently used = likely to be used again — "temporal locality"). The most common default.
- ❌ A one-time scan of many items can evict genuinely hot data ("cache pollution").

**LFU (Least Frequently Used):** Evict the item accessed the *fewest* times.
- ✅ Keeps consistently popular items even if not touched recently.
- ❌ New items look "infrequent" and get evicted too soon; needs aging to forget old popularity. (Redis offers LFU with decay.)

**FIFO (First In, First Out):** Evict the oldest-inserted item regardless of usage.
- ✅ Trivial to implement.
- ❌ Ignores access patterns; can evict hot data. Rarely ideal.

**TTL (Time To Live):** Not strictly an eviction policy but a companion — each item expires after a set duration.
- ✅ Bounds staleness; guarantees data refreshes periodically.
- Combine with LRU/LFU: TTL bounds *correctness*, LRU/LFU bounds *memory*.

**Random / MRU / segmented LRU (SLRU) / ARC:** Specialized policies. ARC (Adaptive Replacement Cache) balances recency and frequency automatically.

**Practical guidance:** Start with **LRU + TTL** — it covers the vast majority of cases. Use LFU when popularity is stable and long-lived. Always set a TTL to bound how stale data can get, even in an LRU cache.

---

### Q29. Cache stampede (thundering herd) — and how to prevent it

**The problem:** A very popular key expires (or the cache restarts cold). Suddenly, thousands of concurrent requests all miss simultaneously and **all hammer the database at once** to recompute the same value. The DB, sized for cached traffic, gets crushed — sometimes taking down the whole system. This is a "cache stampede" or "thundering herd."

**Why it's dangerous:** Your DB might comfortably handle the 1% of traffic that normally misses. But when a hot key expires, that 1% becomes a synchronized spike of redundant identical queries.

**Prevention techniques:**

1. **Request coalescing / mutex locking (single-flight):** When a key misses, only the *first* request acquires a lock and recomputes; concurrent requests wait for that result instead of also querying the DB. Reduces N redundant queries to 1.

2. **Stale-while-revalidate:** Serve the *stale* value immediately while a background task refreshes it. Users never see a miss; the DB gets one refresh query, not thousands. (Widely used in HTTP caching and CDNs.)

3. **TTL jitter (randomization):** Instead of every item expiring at exactly the same TTL, add randomness (e.g., 300 s ± 30 s). This prevents mass simultaneous expiration of items that were cached together.

4. **Early/probabilistic recomputation:** Refresh a hot key *before* it expires, with probability increasing as expiry approaches (the "XFetch" algorithm), so it's renewed without ever fully missing.

5. **Cache warming / pre-population:** Proactively load known-hot keys before traffic hits (e.g., after a deploy or cache flush).

**Practical combo:** Request coalescing + TTL jitter + stale-while-revalidate handles the vast majority of stampede risk.

---

### Q30. Local cache vs distributed cache

**Local (in-process) cache:** Data cached inside the application process's own memory (e.g., a Caffeine/Guava cache in a Java app, or a simple in-memory map).
- ✅ **Fastest possible** — no network hop, nanosecond access.
- ✅ No extra infrastructure.
- ❌ **Not shared** — each app instance has its own copy, so they can diverge (instance A has fresh data, instance B has stale).
- ❌ Limited to one machine's memory.
- ❌ Lost on restart/deploy; cold start per instance.
- ❌ Invalidation across instances is hard.

**Distributed cache:** A separate clustered cache service (Redis, Memcached) shared by all app instances over the network.
- ✅ **Shared and consistent** — all instances see the same cached data.
- ✅ Large capacity (scale the cache cluster independently).
- ✅ Survives app restarts/deploys.
- ✅ Central invalidation.
- ❌ Adds a network hop (~0.5 ms) — still far faster than a DB.
- ❌ Extra infrastructure to operate; itself needs HA (replication, clustering).

**The best-of-both: multi-tier caching (L1 + L2):**
- **L1** = local in-process cache for the very hottest keys (microsecond access), with a short TTL to bound divergence.
- **L2** = distributed Redis for shared state and larger capacity.
- Flow: check L1 → miss → check L2 → miss → hit DB → populate both.

This combines local speed with distributed consistency and is common in high-scale systems. The short L1 TTL keeps cross-instance inconsistency small and bounded.

---

### Q31. Message queues — decoupling with asynchrony

**What it is:** A message queue lets a **producer** drop a message onto a queue and move on; one or more **consumers** pick it up and process it later. Producer and consumer never talk directly and don't need to be available at the same time.

**The four big benefits:**
1. **Decoupling:** the producer doesn't know or care who processes the message or how long it takes. You can change/scale consumers independently.
2. **Load leveling (buffering):** if 10,000 requests arrive in a burst but consumers process 1,000/sec, the queue absorbs the spike and consumers work through it steadily. The queue acts as a shock absorber, protecting downstream systems.
3. **Reliability:** messages persist in the queue until successfully processed. If a consumer crashes mid-work, the message becomes available again (at-least-once delivery). Work isn't lost.
4. **Independent scaling & responsiveness:** the web request returns immediately after enqueueing ("we're processing your order"), while slow work happens in the background — better perceived latency.

**Classic use cases:**
- Sending emails / push notifications / SMS.
- Image/video processing (thumbnails, transcoding).
- Order fulfillment pipelines.
- Analytics event ingestion.
- Any slow, retryable, non-blocking work.

**Key concepts:**
- **Acknowledgment (ack):** consumer confirms successful processing; unacked messages get redelivered.
- **Dead-letter queue (DLQ):** messages that repeatedly fail land here for inspection instead of blocking the queue forever.
- **Visibility timeout:** how long a message is hidden after a consumer picks it up (so others don't process it simultaneously).

**Examples:** RabbitMQ, AWS SQS, ActiveMQ. (Kafka/Pulsar are log-based — see Q33.)

---

### Q32. Message queue vs publish/subscribe

**Point-to-point (queue):** A message is delivered to **exactly one** consumer. Multiple consumers can read from the same queue, but each message goes to only one of them — this distributes work (competing consumers pattern).
- Use for: **task distribution.** "Process this order" should be handled once, by one worker. Adding workers speeds up processing.
- Example: SQS, RabbitMQ work queues.

**Publish/subscribe (pub/sub):** A message (event) is delivered to **all** interested subscribers. One publish → many independent recipients, each getting its own copy.
- Use for: **event fan-out / notifications.** One "order placed" event triggers many independent reactions: update inventory, send confirmation email, notify analytics, update the recommendation model — each a separate subscriber.
- Example: SNS, Redis Pub/Sub, Kafka topics with multiple consumer groups.

**The mental model:**
- Queue = "someone, do this task." (1 message → 1 worker)
- Pub/Sub = "everyone who cares, here's what happened." (1 event → N subscribers)

**Combined in practice:** Kafka elegantly does both. A **topic** is the stream; each **consumer group** gets all messages (pub/sub across groups), but *within* a group, messages are split across consumers (queue-like work distribution). This gives you fan-out to different teams/services *and* parallelism within each.

**Why it matters architecturally:** Pub/Sub is the backbone of **event-driven architecture** — services emit events without knowing who consumes them, achieving extreme loose coupling. New consumers can be added without touching producers.

---

### Q33. Kafka — the distributed log, and why it's different

**What it is:** Kafka is a distributed, durable, append-only **commit log**, not a traditional queue. Producers append messages to **topics**; topics are split into **partitions** (for parallelism and ordering); messages are stored on disk and **retained** for a configured time (hours, days, or forever).

**How it differs from a traditional queue:**
| Aspect | Traditional queue (RabbitMQ/SQS) | Kafka |
|--------|----------------------------------|-------|
| After consumption | Message deleted | Message **retained** (replayable) |
| Consumers | Compete for messages | Each consumer group reads independently, tracks its own offset |
| Ordering | Limited | Ordered **within a partition** |
| Throughput | High | **Very high** (millions/sec) via partitioning + sequential disk I/O |
| Replay | No | **Yes** — rewind to any offset |
| Model | Queue or pub/sub | Both, plus a storage layer |

**Why retention + offsets is a game-changer:**
- **Replay:** a new service can process the entire history from the beginning; a buggy consumer can be fixed and re-run over past data.
- **Multiple independent consumers:** analytics, search indexing, and notifications can each read the *same* stream at their own pace without interfering.
- **Event sourcing & CDC:** the log *is* the source of truth; other stores are derived from it.

**Core concepts:**
- **Partition:** the unit of parallelism and ordering. More partitions = more consumer parallelism. Ordering is guaranteed only *within* a partition (choose partition key wisely — e.g., by `user_id` to keep a user's events ordered).
- **Offset:** each consumer group's bookmark into the log.
- **Replication:** partitions are replicated across brokers for durability.

**When to use Kafka vs a simple queue:**
- **Kafka:** high-throughput event streaming, log/metrics pipelines, event sourcing, multiple consumers of the same data, need for replay. (Pulsar is a similar alternative.)
- **Simple queue (SQS/RabbitMQ):** straightforward task offloading, lower volume, simpler ops, no replay needed. Don't reach for Kafka's complexity if a basic queue suffices.

---

### Q34. Asynchronous processing — decoupling work from requests

**What it is:** Handling work *outside* the synchronous request/response cycle. Instead of making the user wait for slow work to finish, you acknowledge the request immediately and process the work in the background.

**Synchronous vs asynchronous:**
- **Sync:** user uploads a video → request blocks while the video transcodes (minutes!) → finally responds. Terrible UX; ties up a server thread the whole time.
- **Async:** user uploads → you save the file, enqueue a "transcode" job, and immediately respond "upload received, processing." A background worker transcodes; the user is notified when done (webhook, polling, push).

**When to use async:**
- **Slow operations:** transcoding, report generation, bulk imports, ML inference.
- **Delay-tolerant work:** emails, notifications, analytics — nobody needs these *instantly* in-request.
- **Spiky load:** enqueue during spikes, process at a steady rate (load leveling).
- **Third-party calls:** don't let a slow external API block your response.
- **Fan-out work:** one action triggers many downstream tasks.

**What you gain:** Lower perceived latency, better resource utilization (threads aren't blocked waiting), resilience (retry failed jobs without failing the user request), and the ability to smooth load.

**What it costs (complexity):**
- **Eventual results:** the answer isn't ready when the request returns — you need a way to deliver it (status endpoint, webhook, WebSocket, email).
- **Status tracking:** users ask "is it done?" — you need job state (pending/processing/done/failed).
- **Failure handling:** retries, dead-letter queues, idempotency (a job might run twice).
- **Ordering & consistency:** background work completing out of order can surprise users.

**Typical implementation:** A message queue (Q31) + a pool of worker processes + a job-status store. This is one of the most common and important patterns for scaling real systems.

---

### Q35. API gateway — the front door for microservices

**What it is:** A single entry point that sits in front of a fleet of backend/microservices, receiving all client requests and routing them to the right service. It centralizes cross-cutting concerns so individual services don't each reimplement them.

**What it handles:**
- **Routing:** map `/users/*` → user service, `/orders/*` → order service.
- **Authentication & authorization:** validate tokens/API keys once, at the edge, before requests reach services.
- **Rate limiting & throttling:** protect backends from abuse and overload.
- **Request/response transformation:** protocol translation (REST↔gRPC), versioning, header manipulation.
- **Request aggregation:** combine calls to several services into one response (reduces client round trips — related to the BFF pattern).
- **Caching:** cache common responses at the gateway.
- **Observability:** centralized logging, metrics, tracing injection.
- **SSL termination.**

**Why it matters:** Without a gateway, every service must independently implement auth, rate limiting, logging, etc. — duplicated, inconsistent, error-prone. And clients would need to know the address and protocol of every service. The gateway abstracts the backend topology: clients see one stable API while services evolve behind it.

**API gateway vs load balancer:**
- A **load balancer** distributes traffic across *identical* instances of a service (L4/L7, focused on balancing).
- An **API gateway** routes to *different* services and adds application-level features (auth, rate limiting, aggregation). It's higher-level and often *uses* load balancing underneath.

**Caution:** The gateway can become a SPOF and a bottleneck — run it redundantly and keep its per-request logic lean. Examples: Kong, AWS API Gateway, Apigee, Envoy-based gateways.

**Related: Backend-for-Frontend (BFF):** a dedicated gateway per client type (mobile, web) that tailors responses to each client's needs.

---

### Q36. Rate limiting — protecting the system from overload and abuse

**What it is:** Restricting how many requests a client can make in a time window. It protects against abuse (scrapers, brute-force), accidental overload (a buggy client in a loop), and ensures fair usage across tenants.

**The main algorithms:**

**Token bucket:** A bucket holds up to N tokens, refilled at a steady rate (e.g., 10 tokens/sec, capacity 100). Each request consumes a token; if the bucket is empty, the request is rejected.
- ✅ **Allows bursts** up to the bucket size, then settles to the refill rate. Flexible and widely used (AWS, Stripe).

**Leaky bucket:** Requests enter a queue (bucket) and are processed at a fixed, constant rate; overflow is dropped.
- ✅ **Smooths** traffic into a steady output rate (good for protecting a downstream that needs constant load).
- ❌ Doesn't allow bursts; adds queuing latency.

**Fixed window counter:** Count requests per fixed window (e.g., 100 per minute, reset each minute).
- ✅ Trivial to implement.
- ❌ **Boundary problem:** a client can send 100 at 11:00:59 and 100 at 11:01:00 — 200 in ~1 second, double the intended limit.

**Sliding window log:** Store timestamps of each request; count those within the trailing window. Accurate but memory-heavy.

**Sliding window counter:** A hybrid that weights the previous and current fixed windows to approximate a true sliding window — accurate *and* efficient. A common production choice.

**Where to enforce it:** At the edge/API gateway (first line of defense), and sometimes per-service. In distributed systems, the counter must be **shared** (e.g., in Redis) so all gateway instances enforce a single global limit per client.

**Practical dimensions:** Limit per API key, per user, per IP, per endpoint. Return `429 Too Many Requests` with a `Retry-After` header. Combine with quotas (daily/monthly caps) for tiered plans.

**Default recommendation:** **Token bucket** for general APIs (allows reasonable bursts), backed by Redis for distributed enforcement.

---

### Q37. Service mesh — managing service-to-service communication

**What it is:** An infrastructure layer that handles communication *between* microservices, implemented via **sidecar proxies** — a small proxy (e.g., Envoy) deployed alongside each service instance. All traffic in/out of a service flows through its sidecar, which enforces policy without the service code knowing.

**What it provides (out of the application's code):**
- **Traffic management:** load balancing, retries, timeouts, circuit breaking, canary/blue-green routing, traffic splitting.
- **Security:** automatic **mutual TLS (mTLS)** between all services (encryption + identity), authorization policies.
- **Observability:** uniform metrics, distributed tracing, and logging for *all* inter-service calls — for free, consistently.
- **Reliability:** fault injection for testing, rate limiting, health checking.

**The architecture:** A **data plane** (the sidecars handling actual traffic) + a **control plane** (central config/policy management, e.g., Istio's control plane) that pushes rules to all sidecars.

**Why it exists:** In a large microservice system, every service needs retries, timeouts, mTLS, tracing, etc. Implementing these in each service (in every language) is repetitive and inconsistent. A mesh moves this into a uniform infrastructure layer, so it's consistent and language-agnostic, and platform teams control it centrally.

**The trade-off:**
- ✅ Powerful, consistent networking/security/observability without touching app code.
- ❌ **Significant complexity** — another distributed system to operate, extra latency per hop (sidecar proxy), resource overhead (a proxy per instance), and a steep learning curve.

**When to adopt:** When you have *many* microservices (dozens+) and the pain of inconsistent networking/security/observability outweighs the operational cost. **Overkill for a handful of services** — start simpler (libraries, gateway). Examples: Istio, Linkerd, Consul Connect.

---

### Q38. Monolith vs microservices — the big architectural choice

**Monolith:** The entire application is one deployable unit — all features, one codebase, one process, usually one database.
- ✅ **Simple to develop early:** one repo, easy local setup, straightforward debugging (one process, real function calls).
- ✅ **Simple to deploy:** one artifact.
- ✅ **Fast internal calls:** in-process, no network.
- ✅ **Easy transactions:** one database, ACID across the whole app.
- ❌ **Scaling is coarse:** must scale the whole app even if only one feature is hot.
- ❌ **Deploy risk:** one change redeploys everything; one bug can crash the whole app.
- ❌ **Team friction at scale:** many developers stepping on one codebase; tech stack locked in.

**Microservices:** The application is split into many small, independent services, each owning one business capability, its own database, and deployed independently.
- ✅ **Independent scaling:** scale only the hot services.
- ✅ **Independent deployment:** teams ship on their own schedule; smaller blast radius.
- ✅ **Team autonomy:** each team owns its service and tech stack.
- ✅ **Fault isolation:** one service failing needn't crash others (with proper isolation).
- ❌ **Distributed-systems complexity:** network calls fail, latency adds up, debugging spans services (need tracing).
- ❌ **Data consistency is hard:** no cross-service ACID; need sagas/eventual consistency.
- ❌ **Operational overhead:** many deployments, service discovery, monitoring, more infrastructure.

**The pragmatic guidance:** **Start with a monolith.** Most successful systems (including early Amazon, Netflix, Shopify) began monolithic. Extract microservices *later*, when specific pain appears: a module needs independent scaling, a team needs deployment autonomy, or a component needs isolation. Splitting too early creates a "distributed monolith" — all the pain, none of the benefits.

**A useful middle ground:** the **modular monolith** — one deployable, but with strong internal module boundaries (clear interfaces, no cross-module DB access), so you *can* extract services later along those seams.

---

### Q39. Proxy vs reverse proxy (deeper)

Both are intermediaries that forward requests, but they represent opposite sides and serve opposite purposes.

**Forward proxy (usually just "proxy"):** Sits **in front of clients** and forwards their outbound requests to servers on the internet. It represents/acts on behalf of the *client*.
- **Who's hidden:** the client (the destination server sees the proxy's IP, not the client's).
- **Use cases:** corporate internet filtering/monitoring, bypassing geo-restrictions, client-side caching, anonymity (VPN-like), controlling/logging outbound access.
- **Direction:** many internal clients → one proxy → the internet.

**Reverse proxy:** Sits **in front of servers** and forwards inbound requests to them. It represents/acts on behalf of the *server*.
- **Who's hidden:** the backend servers (the client sees the proxy, not the real servers or their topology).
- **Use cases:** load balancing, TLS termination, caching, compression, security/WAF, request routing (everything in Q24).
- **Direction:** the internet → one reverse proxy → many backend servers.

**The mnemonic:** *Forward proxy protects/serves the **client**; reverse proxy protects/serves the **server**.* Same technology (an intermediary), opposite orientation and beneficiary.

**Real example:** Your company's web filter that blocks certain sites = forward proxy. Cloudflare/Nginx in front of a website = reverse proxy.

---

### Q40. DNS — name resolution *and* a routing tool

**The basics:** DNS (Domain Name System) translates human-readable names (`example.com`) into IP addresses (`93.184.216.34`). It's a hierarchical, distributed, heavily-cached system: root servers → TLD servers (`.com`) → authoritative servers (for `example.com`).

**The resolution flow (simplified):**
1. Browser checks its cache, then the OS, then the configured resolver (often your ISP or `8.8.8.8`).
2. The resolver, if it doesn't have it cached, walks the hierarchy: root → TLD → authoritative.
3. The IP is returned and cached at each level per the record's **TTL**.

**DNS as a system-design tool (not just lookup):**
- **Load balancing (DNS round robin):** return multiple IPs for one name; clients pick one, spreading load. Crude (no health awareness) but simple.
- **Geo-DNS / latency-based routing:** return the IP of the **nearest** (or lowest-latency) region to the user — the first layer of global load balancing. A user in Europe gets the EU IP; a user in Asia gets the Asia IP.
- **Weighted routing:** send X% of traffic to one endpoint, Y% to another — useful for canary rollouts or gradual migrations.
- **Failover:** health-checked DNS can stop returning the IP of a dead region/endpoint (e.g., AWS Route 53 health checks).

**The big caveat — DNS caching makes changes slow:** Because records are cached everywhere for their TTL (and some resolvers ignore low TTLs), DNS changes can take minutes to hours to fully propagate. So **DNS is a poor tool for fast failover** on its own — use low TTLs plus other mechanisms (anycast, load balancer failover) for quick recovery.

**Anycast:** A single IP advertised from many locations; the network routes each user to the nearest one. Used by CDNs and DNS providers for both performance and DDoS resilience. Combines the benefits of geo-routing at the network layer.

---

### Q41. Object storage — where big blobs belong

**What it is:** A storage system for **unstructured data as "objects"** (a blob + metadata + a unique key), accessed over HTTP APIs. Examples: Amazon S3, Google Cloud Storage, Azure Blob Storage, MinIO.

**Key characteristics:**
- **Virtually unlimited scale:** store petabytes; no capacity planning.
- **Extreme durability:** S3 advertises 99.999999999% ("11 nines") durability via automatic replication across devices/facilities — your data is effectively never lost.
- **Flat namespace:** objects live in "buckets" with key names (the "folders" are just key prefixes).
- **HTTP access:** each object has a URL; integrates naturally with CDNs.
- **Cheap:** much cheaper per GB than block/file storage or databases.
- **Tiered pricing:** hot, infrequent-access, and archival (Glacier) tiers trade retrieval time for cost.

**What it's NOT good for:**
- **No in-place edits:** you replace the whole object, not part of it.
- **No low-latency random access** like a filesystem or database.
- **No transactions or querying by content** (though S3 Select and data lake tools add limited query).
- Not for frequently-mutated structured data — that's a database's job.

**When to use it:**
- **User uploads:** images, videos, documents, audio.
- **Static website assets** (served via CDN).
- **Backups, snapshots, logs, archives.**
- **Big data / data lakes:** raw datasets for analytics.
- **Storing large fields out of the database:** put the blob in object storage, store only its URL/key in the DB.

**The golden rule:** **Never store large binary blobs in a relational database.** It bloats the DB, slows backups, wastes expensive storage, and hurts performance. Put the blob in object storage and keep a reference (URL/key) in the DB. Serve the blob directly from object storage + CDN.

---

### Q42. Search index — why not just query the database?

**The problem with DB search:** Relational databases are optimized for structured queries on indexed columns, not for **full-text search**. A `WHERE description LIKE '%wireless headphones%'` forces a full table scan (can't use a normal B-tree index for leading-wildcard matches), is slow, and can't rank results by relevance, handle typos, stem words ("run" ↔ "running"), or do fuzzy matching.

**What a search engine does:** A dedicated search index (Elasticsearch/OpenSearch, Solr, Meilisearch, Typesense) builds an **inverted index** — a map from each *term* to the list of documents containing it. So "headphones" instantly points to all matching documents, sorted by a relevance score (TF-IDF / BM25).

**What you get:**
- **Fast full-text search** at scale (sub-second over millions of docs).
- **Relevance ranking** (best matches first).
- **Typo tolerance / fuzzy matching** ("hedphones" → "headphones").
- **Stemming, synonyms, language analysis.**
- **Faceted search & filters** ("brand: Sony, price: <$100") and aggregations.
- **Autocomplete / suggestions.**

**How it fits the architecture:** The search index is a **secondary, derived store** — *not* the source of truth. Your primary database remains authoritative. You keep the index in sync via an async pipeline:
- Write to DB → emit an event / CDC (change data capture) → update the search index.
- This is eventually consistent (a new item may take a moment to become searchable) — usually fine for search.

**Bonus use — log & observability analytics:** The same technology (the "ELK/Elastic stack") powers log search and dashboards (Elasticsearch + Logstash/Beats + Kibana), because logs are exactly the kind of high-volume text you want to search and aggregate.

**When to add it:** When search is a real feature and DB `LIKE` queries are too slow or too limited — typically around the stage where you have meaningful data volume and users expect Google-quality search.

---

### Q43. WebSockets — real-time, bidirectional communication

**The problem it solves:** Standard HTTP is **request/response** and client-initiated — the server can't push data to the client on its own. For real-time features (chat, live scores, notifications), the client would have to constantly *ask* "anything new?" (polling), which is wasteful and laggy.

**What WebSocket is:** A protocol that establishes a **persistent, full-duplex** (two-way) connection over a single long-lived TCP connection. After an initial HTTP "upgrade" handshake, both client and server can send messages to each other **anytime**, with low overhead (no repeated HTTP headers).

**When to use it:**
- **Chat / messaging** (the canonical example).
- **Live notifications & presence** ("user is typing," "online now").
- **Collaborative editing** (Google Docs-style live cursors/edits).
- **Live dashboards, stock tickers, sports scores.**
- **Multiplayer games.**
- Anything needing **low-latency, server-initiated, frequent** updates.

**The scaling challenge — connections are stateful:**
- Each open WebSocket is a **persistent connection** held on a specific server → the connection is **stateful**, which complicates the "keep everything stateless" ideal.
- **Load balancing:** you need sticky routing or connection-aware LBs; a reconnect might land on a different server.
- **Fan-out across servers:** if user A (connected to server 1) messages user B (connected to server 2), you need a way to route between servers — typically a **pub/sub backplane** (e.g., Redis Pub/Sub or Kafka) so any server can deliver to any connected client.
- **Connection limits:** each server can hold only so many connections (tens of thousands); at millions of concurrent users you need many connection servers + careful memory management.

**Alternatives to consider:** If you only need *server → client* updates (not full duplex), **Server-Sent Events (SSE)** is simpler (see Q44). If updates are infrequent, long-polling may suffice.

---

### Q44. Polling vs long-polling vs SSE vs WebSockets

Four ways to get "real-time-ish" data, from simplest to most capable:

**1. Short polling:** The client repeatedly asks the server "anything new?" on a fixed interval (e.g., every 5 s).
- ✅ Dead simple; works everywhere; stateless.
- ❌ Wasteful (most requests return "nothing new"); adds load; laggy (up to the interval).
- Use when: updates are infrequent and a few seconds of delay is fine, and you want maximum simplicity.

**2. Long polling:** The client asks; the server **holds the request open** until it has data (or a timeout), then responds; the client immediately re-asks.
- ✅ Near-real-time; far fewer wasted requests than short polling; works over plain HTTP (no special protocol).
- ❌ Still one request per message; holds server connections open; more complex than short polling.
- Use when: you need near-real-time but can't/won't use WebSockets (e.g., restrictive proxies).

**3. Server-Sent Events (SSE):** A **one-way** (server → client) stream over a single long-lived HTTP connection. The server pushes events as they occur; the browser's `EventSource` auto-reconnects.
- ✅ Simple, built on HTTP, auto-reconnect, efficient for server-push; great for feeds/notifications.
- ❌ **One-directional** (client can't send over the same channel — uses normal HTTP for that); limited to text; browser connection limits per domain.
- Use when: you need server → client push but not client → server streaming (notifications, live feeds, progress updates, dashboards).

**4. WebSockets:** **Full-duplex**, persistent, low-overhead two-way channel (Q43).
- ✅ True bidirectional real-time; lowest per-message overhead; ideal for interactive apps.
- ❌ Stateful connections complicate scaling/load balancing; more infrastructure; overkill if you only need one direction.
- Use when: you need frequent, low-latency, **two-way** communication (chat, gaming, collaboration).

**How to choose:** Start with the *simplest option that meets the need*. Infrequent updates → polling. Server-push only → SSE. Interactive two-way → WebSockets. Don't reach for WebSockets' operational complexity when SSE or long-polling would do.

---

### Q45. Job schedulers & cron systems — running work on time

**What it is:** A component that runs tasks **on a schedule** (every night at 2 AM, every 5 minutes) or **at a future time** (send this reminder in 3 days). It's how systems do recurring maintenance and deferred work.

**Common scheduled work:**
- Nightly reports, billing runs, invoice generation.
- Data cleanup, archiving old records, cache warming.
- Sending scheduled/reminder emails and notifications.
- Periodic syncs with external systems.
- Recomputing aggregates, rebuilding indexes, ML model retraining.

**Single-machine scheduling — `cron`:** The classic Unix `cron` daemon runs commands on a schedule defined by cron expressions. Fine for a single server, but:
- ❌ It's a **SPOF** (that one machine dies → jobs don't run).
- ❌ In a horizontally scaled fleet, if cron runs on *every* instance, the job runs *N times* (duplicate billing!).

**Distributed scheduling — the real challenge:** With many instances, you must ensure a scheduled job runs **exactly once** across the fleet. Techniques:
- **Leader election / distributed lock:** only the instance holding the lock (via ZooKeeper, etcd, Redis, or a DB row lock) runs the job.
- **Dedicated scheduler service:** a central, HA scheduler triggers jobs (which are then executed by workers via a queue).
- **Idempotent jobs:** design jobs so accidental double-execution is harmless (belt-and-suspenders).

**Beyond cron — workflow/orchestration engines:** For complex, multi-step, dependent, long-running, or retryable workflows, use dedicated tools:
- **Apache Airflow** — DAG-based data pipelines (ETL).
- **Temporal / Cadence** — durable, fault-tolerant workflows (survive crashes, resume where they left off).
- **Quartz** (Java), **Sidekiq/Celery** (with beat schedulers) for app-level jobs.
- **Cloud native:** AWS EventBridge Scheduler + Lambda/Step Functions, GCP Cloud Scheduler.

**Key requirements for a production scheduler:** exactly-once (or idempotent) execution, retries with backoff on failure, monitoring/alerting on missed or failed jobs, and visibility into job history. A silently-failing nightly job is a classic production incident.

---

[← Part 1](part-1-fundamentals.md) | [Index](README.md) | [Part 3 →](part-3-databases.md)
