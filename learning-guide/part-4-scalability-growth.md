# Part 4 — Scalability & Growth Stages (Q66–Q85)

[← Part 3](part-3-databases.md) | [Index](README.md) | [Part 5 →](part-5-reliability-advanced.md)

> **This part directly answers your core question:** as users grow, how does the system grow — what do you add at each stage, and what should you *defer* (build only when you actually need it)? Q66–Q71 walk the journey stage by stage; Q72–Q85 cover the techniques you'll reach for along the way.

---

### Q66. Stage 0 — Launch (0 to ~1,000 users)

**Goal at this stage:** *Ship the product and learn from real users.* Nothing else matters. You don't know yet if anyone wants this, so every hour spent on scaling is an hour not spent finding product-market fit.

**The architecture — keep it boringly simple:**
```
[ Users ] → [ Single app server (monolith) ] → [ Managed database ]
```
- One application (a **monolith** — one codebase, one deploy).
- One **managed database** (RDS, Cloud SQL, etc. — let the provider handle backups/patching).
- Possibly on a single VM or a simple PaaS (Heroku, Render, App Runner).

**✅ Add now (cheap, high-leverage, painful to retrofit later):**
- **Version control + CI/CD** (even a basic pipeline).
- **Automated database backups** (the managed DB gives this — just enable it).
- **Basic monitoring & error tracking** (uptime check, Sentry/logging) — you need to know when it's down.
- **A stateless app tier** *as a discipline* (store sessions in the DB/cookie, uploads in object storage) — costs nothing now, unlocks everything later.
- **Managed services** over self-hosting — you have no ops team.

**❌ Defer (this is over-engineering right now):**
- Load balancers, caching layers, read replicas.
- Microservices — the #1 premature-scaling mistake.
- Sharding, message queues, multi-region.
- Kubernetes, service mesh, elaborate infrastructure.

**The mindset:** A single decent server handles thousands of users for many apps. Don't build for a million users you don't have. The cost of over-engineering here is *not shipping* — and most products die from lack of users, not from scaling problems.

---

### Q67. Stage 1 — Early traction (~10,000 users)

**What's changing:** You have real users. Downtime and slow pages now cost you. A single server doing *everything* means the app and database compete for the same CPU/RAM, and one crash takes down everything.

**The architecture — separate the tiers:**
```
[ Users ] → [ CDN (static assets) ]
                 ↓
          [ App server(s) ] → [ Database (separate machine) ]
```

**✅ Add now:**
- **Separate the app server from the database** onto their own machines. This is the **first real architectural step** — now each can be sized, tuned, and restarted independently, and a heavy query won't starve your web tier. Databases and app servers have opposite resource profiles (DB wants RAM/IO, app wants CPU).
- **Add a CDN** for static assets (images, JS, CSS). Cheap, huge latency win, offloads your server. (See [Q25](part-2-components.md).)
- **Real monitoring, logging, and alerting** — dashboards for latency/errors/resource use, alerts when thresholds breach. You can't scale what you can't see.
- **Solid automated backups + a tested restore** (verify you can actually recover).
- **Vertical scaling** as needed — just bump the instance size; it's the cheapest fix and buys lots of runway.

**❌ Defer:**
- **Sharding** — nowhere near needed; one DB (maybe with a read replica soon) is plenty.
- **Microservices** — still a monolith; you don't have the scale or team to justify the complexity.
- **Message queues** — unless you already have obviously-slow work (e.g., video processing); otherwise soon, not yet.
- **Multi-region** — way premature.

**The mindset:** Separate concerns so components fail and scale independently, and get *visibility* (monitoring). You're setting up to grow, not yet building for massive scale.

---

### Q68. Stage 2 — Growth (~100,000 users)

**What's changing:** Traffic (especially **reads**) is now significant. A single app server is both a bottleneck and a SPOF. The database is starting to feel read pressure. You need redundancy and read-scaling.

**The architecture — load-balanced, cached, read-replicated:**
```
                    ┌→ [ App server 1 ]
[Users]→[CDN]→[Load Balancer] → [ App server 2 ] ──┬→ [ Redis cache ]
                    └→ [ App server 3 ]            │
                                                   ├→ [ DB primary (writes) ]
                                                   └→ [ DB read replicas (reads) ]
```

**✅ Add now — the classic "scale reads first" playbook:**
- **Load balancer + multiple stateless app instances.** Removes the app SPOF and scales the app tier horizontally. (Requires the statelessness you set up in Stage 0 — sessions must live in Redis/DB, not app memory.)
- **A caching layer (Redis/Memcached)** for hot reads. This is often the single biggest scaling win — it absorbs a large fraction of read traffic before it ever reaches the DB. (See [Q26](part-2-components.md).)
- **Database read replicas.** Route reads to replicas, writes to the primary. Scales reads and adds DB redundancy. Handle **replication lag** for read-your-writes cases ([Q49](part-3-databases.md)).
- **Move session state out of app memory** into Redis (enables stateless app instances + autoscaling).
- **Autoscaling** for the app tier (scale instances up/down with load).

**❌ Defer:**
- **Sharding the write DB** — you're scaling *reads* now; the single primary still handles writes fine. Sharding is complex; avoid until writes actually saturate the primary.
- **Microservices** — a well-structured monolith still serves you well; extract only if a clear seam demands it.
- **Multi-region** — not yet, unless you have a real global-latency or compliance requirement.

**The mindset:** Most systems are read-heavy, so **scale reads first** — load balancer + cache + read replicas covers an enormous amount of growth cheaply, without the complexity of sharding or microservices. This stage buys a *lot* of runway.

---

### Q69. Stage 3 — Scale (~1,000,000 users)

**What's changing:** Reads are handled (cache + replicas), but now **writes** and **background work** strain the single primary DB, and the monolith may be getting unwieldy for the team. Slow synchronous operations hurt latency.

**The architecture — add asynchrony and protect the DB:**
```
[Users]→[CDN]→[LB]→[App fleet]──┬→[Redis cache]
                                ├→[DB primary]→[read replicas]
                                ├→[Connection pooler (PgBouncer)]
                                ├→[Message queue]→[Worker fleet]→[DB]
                                └→[Search index (Elasticsearch)]
```

**✅ Add now:**
- **Message queues + background workers** for async work — emails, notifications, image/video processing, report generation, analytics events. Moves slow work off the request path (lower latency) and levels load ([Q31](part-2-components.md), [Q34](part-2-components.md)).
- **Database connection pooling** (PgBouncer/ProxySQL) — with a big app fleet you'll hit DB connection limits before query limits ([Q57](part-3-databases.md)). Often an urgent fix around here.
- **More aggressive, multi-tier caching** — add local (L1) caches, cache more query results, add stampede protection ([Q29](part-2-components.md)).
- **A dedicated search index** if you have search — DB `LIKE` won't cut it anymore ([Q42](part-2-components.md)).
- **Begin splitting the monolith at clear seams** *if* team size or scaling needs justify it — extract the one or two components that genuinely need independent scaling/deployment (e.g., a heavy media-processing service). Not a big-bang rewrite.
- **Read-your-writes handling** and mature replica routing.

**❌ Defer (still, if you can):**
- **Full database sharding** — *if* caching + read replicas + a beefy primary still handle writes, hold off. Sharding is the most complex step; delay until writes truly saturate the primary. (Vertical-scale the primary as a stopgap.)
- **Multi-region** — only if latency/compliance/availability genuinely demands it.
- **Full microservices decomposition** — extract selectively, don't shatter everything.

**The mindset:** Offload slow work asynchronously and protect the database. Async processing + connection pooling + heavier caching buys major headroom and defers the pain of sharding.

---

### Q70. Stage 4 — Large scale (~10,000,000+ users)

**What's changing:** The **single write database is now the ceiling** — one primary can't absorb the write volume or store all the data, no matter how big the box. The monolith slows independent teams. This is where the "big system" patterns finally earn their complexity.

**The architecture — sharded, service-oriented, event-driven:**
```
[Users]→[CDN]→[API Gateway]→[Microservices]
                                ├→ each service owns its DB (sharded)
                                ├→ Redis clusters
                                ├→ Kafka (event backbone)
                                ├→ CDC pipelines → search / warehouse / caches
                                └→ full observability (tracing, SLOs)
```

**✅ Add now:**
- **Shard the primary database** ([Q50](part-3-databases.md)–[Q53](part-3-databases.md)). This is *the* headline change — partition writes/data across shards to scale beyond one machine. Choose the shard key carefully. This is why you kept things simple earlier: sharding is complex and you only take it on when truly forced.
- **Microservices** for the domains that need independent scaling/deployment/team ownership. Each owns its own data ([Q38](part-2-components.md)).
- **API gateway** — centralize auth, rate limiting, routing across services ([Q35](part-2-components.md)).
- **Event backbone (Kafka) + CDC pipelines** — decouple services and keep derived stores (search, warehouse, caches, read models) in sync with sources of truth ([Q65](part-3-databases.md)).
- **Mature observability** — distributed **tracing** (essential once requests span services), **SLOs/error budgets**, RED/USE metrics ([Q94](part-5-reliability-advanced.md)–[Q96](part-5-reliability-advanced.md)).
- **Data warehouse / analytics pipeline** separate from OLTP ([Q84](#q84-what-is-a-data-warehouse-and-when-do-you-add-one)).

**❌ Defer:**
- **Only truly-global features you don't yet need** — e.g., full multi-region active-active if a single region (multi-AZ) still meets latency/availability targets. Add multi-region when global latency, availability, or data-residency genuinely require it.

**The mindset:** Now complexity is justified by real constraints. Sharding, microservices, and event pipelines solve concrete problems you actually have — not hypothetical ones. Invest in observability heavily; debugging distributed systems blind is nearly impossible.

---

### Q71. Stage 5 — Global / hyperscale (~100,000,000+ users)

**What's changing:** You're serving users worldwide and need low latency *everywhere*, resilience to **entire-region** failures, and often **data-residency** compliance (GDPR: EU data stays in the EU). A single region — however scaled — can't give a user in Sydney the same latency as one in New York, and it's a regional-outage SPOF.

**The architecture — multi-region, active-active, edge-optimized:**
```
[Users worldwide]
   → [Anycast DNS / Geo-routing] → nearest region
   → [Edge / CDN + edge compute]
        ↓
   ┌─ Region US ─┐  ┌─ Region EU ─┐  ┌─ Region APAC ─┐
   │ full stack  │  │ full stack  │  │ full stack     │
   │ + local data│  │ + local data│  │ + local data   │
   └─────────────┘  └─────────────┘  └────────────────┘
        ↕ cross-region replication (async) ↕
```

**✅ Add now:**
- **Multi-region active-active** — full stacks in multiple geographies, all serving live traffic. Survives a whole region going down; each user hits the nearest region.
- **Geo-DNS / global load balancing** — route each user to their closest/healthiest region ([Q40](part-2-components.md)).
- **Cross-region data replication** with a deliberate consistency strategy (often per-region primaries + async cross-region replication; some data eventually consistent, critical data via consensus like Spanner/CockroachDB).
- **Regional failover automation** — detect a region failure and shift its traffic to others, tested regularly ([Q91](part-5-reliability-advanced.md)).
- **Edge computing** — run latency-sensitive logic at CDN edge (Cloudflare Workers, Lambda@Edge).
- **Cell-based architecture** — partition into isolated cells to limit blast radius ([Q98](part-5-reliability-advanced.md)).

**⚠️ Consider carefully:**
- Multi-region is **expensive and complex** — data consistency across regions, higher infra cost, hard testing/operations. Only justified at genuine global scale or for strict availability/compliance needs. Many very successful companies run largely from one region (multi-AZ) far longer than you'd expect.

**The mindset:** Optimize for global latency and survive regional disasters — but recognize this is the most costly, complex tier. Adopt it because requirements (global users, availability, compliance) demand it, not for prestige.

---

### Q72. What's the general principle for *when* to add a component?

**The rule:** Add a component when a **measured** bottleneck or a **concrete** reliability/organizational need demands it — **never preemptively** because "we might need it."

**Why not add things early "just in case"?** Every component has ongoing costs:
- **Operational cost:** something new to deploy, monitor, patch, back up, and debug at 3 AM.
- **New failure modes:** each component can fail and interact badly with others (a cache adds stampede risk, a queue adds ordering/duplication issues).
- **Cognitive load:** more for every engineer to understand.
- **Slower development:** distributed complexity slows feature work.

**The natural evolution order** (each step buys time before the next is needed):
```
Monolith + one DB
   → Separate app & DB tiers
      → Load balancer + multiple app instances
         → Cache + read replicas (scale reads)
            → Message queues + connection pooling (async, protect DB)
               → Sharding + microservices (scale writes, team autonomy)
                  → Multi-region (global scale, resilience)
```

**How to know it's time:** Let **metrics** tell you. "DB CPU is pegged at 90% and P99 read latency is climbing" → add caching/replicas. "The primary can't keep up with writes even after caching" → consider sharding. "This one module needs to scale 10× independently and a separate team owns it" → extract a service. The trigger is *evidence*, not fashion or resume-building.

**The meta-lesson:** Great architects are as good at knowing **what to leave out** (and when) as what to put in. Premature complexity is a leading cause of failed systems and slow teams.

---

### Q73. What should you almost always add *early*? (cheap, high-value)

These have low cost, high payoff, and are **painful to retrofit** — so do them early:

- **Monitoring, logging, and alerting.** You cannot operate or scale what you can't see. Track latency (percentiles), error rates, throughput, and resource use from day one. Add error tracking (Sentry) and an uptime check. This is non-negotiable.
- **Automated backups — with a *tested* restore.** Cheap insurance against catastrophe. An untested backup is not a backup. Data loss can kill a company; backups are trivially cheap by comparison.
- **A CDN** for static assets. Cheap, dramatic latency improvement, offloads your origin. Low risk, high reward.
- **Statelessness in the app tier.** Store sessions in Redis/DB, uploads in object storage. Costs nothing early and unlocks load balancing, autoscaling, and painless deploys later. Retrofitting statefulness out of an app is painful.
- **Version control + CI/CD.** Reliable, repeatable deploys and easy rollback.
- **Infrastructure as code** (even lightly) — reproducible environments.
- **Sensible security basics** — HTTPS everywhere, secrets management, input validation, least-privilege access. Cheap early, expensive to bolt on after a breach.

**Why early:** These are foundational and *cross-cutting* — they make every later stage easier and safer. They're the "eat your vegetables" of system design: unglamorous, but they prevent disasters and enable smooth scaling.

---

### Q74. What should you almost always *defer*? (premature at small scale)

These are powerful but heavy — adding them before you need them slows you down and often gets undone:

- **Microservices.** The #1 premature-scaling mistake. They add network complexity, distributed debugging, data-consistency headaches, and operational overhead. At small scale you get all the pain and none of the benefit (a "distributed monolith"). Start with a (well-structured) monolith; extract services when team size or scaling needs justify it.
- **Database sharding.** The most complex data step. Caching, read replicas, and vertical scaling handle enormous growth first. Shard only when writes/data genuinely exceed one primary. Premature sharding cripples you with cross-shard query pain you didn't need.
- **Multi-region deployment.** Expensive and complex (cross-region consistency, cost, testing). Only for true global scale, strict availability, or data-residency compliance. Many big companies run from one region far longer than expected.
- **Service mesh** (Istio/Linkerd). Great for *many* services; pure overhead for a few. Adopt when you actually have a fleet of services and inconsistent networking/security is real pain.
- **CQRS and event sourcing.** Powerful for specific problems (diverging read/write needs, audit-critical domains) but heavy and complex. Don't apply by default — a materialized view or plain caching usually suffices.
- **Kubernetes / elaborate orchestration** — if a simpler PaaS or managed containers meet your needs, don't take on K8s complexity prematurely.

**The principle:** These solve *specific* problems that appear at *specific* scales. Adopting them before you have the problem is speculative complexity — it slows development, and the guesses you bake in are often wrong and costly to reverse. Wait for the concrete need.

---

### Q75. How do you scale reads vs writes differently?

Reads and writes have very different scaling characteristics — and most systems are **read-heavy** (often 10:1 to 1000:1 read:write), so you attack reads first.

**Scaling READS (generally easier — do these first):**
- **Caching** (Redis, CDN, local) — absorb reads before they hit the DB. Highest ROI.
- **Read replicas** — spread reads across many copies of the data.
- **CDN / edge caching** — serve reads from near the user.
- **Denormalization / materialized views** — precompute read-optimized shapes to avoid expensive joins.
- Reads scale well because you can freely *copy* data (replicas, caches) — copies don't conflict.

**Scaling WRITES (harder — needed later, at bigger scale):**
- **Sharding** — partition data so writes spread across many primaries (the main tool). Complex.
- **Async processing / queues** — buffer and level write bursts; batch writes.
- **Write batching / coalescing** — combine many small writes into fewer larger ones (e.g., write-behind caching for counters).
- **Write-optimized stores** — LSM-tree databases (Cassandra) designed for high write throughput.
- **CQRS** — separate the write path so it can scale independently.
- Writes are harder because every copy must be *kept consistent* — you can't just replicate your way out; writes to the same data can conflict.

**The practical sequence:** Exhaust read-scaling (cache → replicas → denormalize) *before* taking on write-scaling complexity (sharding). Since reads dominate, this order defers the hardest work (sharding) as long as possible. When you *do* hit write limits, sharding is usually the answer.

---

### Q76. Autoscaling — matching capacity to demand automatically

**What it is:** Automatically adjusting the number of running instances (or their size) based on current or predicted demand, so you have enough capacity for load without paying for idle servers off-peak.

**Types:**
- **Reactive (metric-based):** scale on real-time metrics crossing thresholds — CPU %, request rate, queue depth, memory, or latency. "Add an instance when average CPU > 70%; remove one when < 30%." The most common form.
- **Scheduled:** scale ahead of *known* patterns — e.g., scale up at 8 AM before business hours, down at night; scale up before a known sale. Avoids waiting for reactive lag.
- **Predictive:** use ML/forecasting to anticipate load and pre-provision (AWS Predictive Scaling). Useful for smoothing spikes that reactive scaling reacts to too slowly.

**What it gives you:**
- ✅ **Cost efficiency** — pay for what you use; shed capacity when idle.
- ✅ **Handles spikes** — absorb traffic surges without manual intervention.
- ✅ **Resilience** — replace unhealthy instances automatically.

**Prerequisites and gotchas:**
- **Requires stateless instances** — autoscaling adds/removes instances freely, which only works if any instance is disposable (state lives in Redis/DB/object storage). Another reason statelessness ([Q15](part-1-fundamentals.md)) is foundational.
- **Fast startup** — if instances take 5 minutes to boot, reactive scaling is too slow for sudden spikes → keep **headroom** (buffer capacity) or use predictive/scheduled scaling, or pre-warmed pools.
- **Scale-up lag** — there's always a delay between "load rises" and "new capacity ready." Don't run at 95% utilization expecting instant relief.
- **Downstream limits** — scaling the app tier can overwhelm the DB (connection limits!) — autoscaling app servers doesn't scale the database ([Q57](part-3-databases.md)).
- **Thrashing** — set cooldowns / hysteresis so it doesn't rapidly add/remove instances around a threshold.
- **Metric choice** — CPU isn't always the right signal; queue depth or latency may better reflect real load (especially for I/O-bound or async workloads).

---

### Q77. Scaling stateless vs stateful components

The single biggest factor in how easily something scales is whether it holds **state**.

**Stateless components (app servers, API services, workers):**
- Any instance is interchangeable — no local data that matters.
- **Scaling = trivial:** add/remove identical instances behind a load balancer; autoscaling "just works"; a dead instance is instantly replaceable.
- This is why the discipline is to **keep the compute tier stateless** and push state elsewhere.

**Stateful components (databases, caches, message brokers, stateful stream processors):**
- Hold data that *must* persist and stay consistent.
- **Scaling = hard:** you can't just add a node and forget it — you must **move/rebalance data**, keep replicas **consistent**, handle **partitioning** and **failover**, and avoid data loss.
- Techniques are specialized: **replication** (copies for reads/HA), **sharding** (partition data), **consistent hashing** (rebalance with minimal movement), **quorums** (consistency across nodes).

**The core strategy:**
1. **Maximize the stateless portion** — make as much of the system as possible stateless so it scales the easy way.
2. **Concentrate state** into a *small number* of purpose-built, carefully-managed stateful systems (your databases, cache clusters), and scale *those* deliberately with the specialized techniques above.

**Why this matters:** People sometimes try to scale a stateful system as if it were stateless (e.g., just spinning up more DB instances) and get data inconsistency or corruption. Recognizing which components are stateful — and that they need *different, harder* scaling approaches — is essential. The art is minimizing how much state you have to scale the hard way.

---

### Q78. Hotspots (hot partitions / hot keys) — when load concentrates

**What it is:** When traffic or data concentrates disproportionately on **one** shard, partition, or key, overwhelming that single node while the others sit nearly idle. Your *average* load looks fine, but one node is on fire.

**Common causes:**
- **Celebrity problem:** one user (a celebrity with 100M followers, or a whale B2B tenant) generates vastly more load than others → their shard is swamped.
- **Trending item:** a viral post, a flash-sale product — everyone hits the same key at once.
- **Bad shard key:** sharding by timestamp/sequential ID sends all new writes to the newest shard ([Q51](part-3-databases.md)).
- **Naturally skewed data:** a low-cardinality or Zipf-distributed key.

**How to detect it:** Per-shard/per-key metrics (not just averages). Watch for one partition with far higher CPU/QPS/latency than its peers. Averages hide hotspots — you must look at the distribution.

**How to handle it:**
- **Better shard key** — choose one that distributes load evenly ([Q51](part-3-databases.md)).
- **Key splitting / salting** — for a known hot key, append a random suffix (`hotkey_1`, `hotkey_2`, …) to spread its writes across multiple shards; aggregate on read. Trades read complexity for write distribution.
- **Cache the hot item aggressively** — a viral post read a million times should be served from cache, not the DB. Caching is the classic fix for read hotspots.
- **Dedicated capacity** — give known hot entities (celebrity accounts) their own shard/replicas.
- **Read replicas for the hot shard** — spread its read load.
- **Request coalescing** — collapse concurrent identical requests ([Q29](part-2-components.md)).

**Why it matters:** Hotspots are *the* reason "we sharded but it's still slow." Even distribution is the whole point of sharding, and skewed real-world access patterns constantly threaten it. Handling hotspots (especially the celebrity/viral case) is a very common design-interview topic and real-world challenge.

---

### Q79. Load shedding — surviving overload by dropping work

**What it is:** Deliberately **rejecting or dropping** some requests when the system is overloaded, to protect its ability to serve the *rest*. The philosophy: **it's better to serve 90% of requests well than to let 100% degrade into failure** (or crash entirely).

**Why it's necessary:** Without load shedding, an overloaded system doesn't gracefully slow down — it collapses. Queues grow unbounded, memory fills, latency for *everyone* skyrockets ([Q20](part-1-fundamentals.md) — queuing explodes near 100% utilization), timeouts cascade, and often the whole system goes down. Shedding excess load keeps the system within its capacity so it stays healthy for the requests it *does* accept.

**How it works:**
- **Detect overload** — via queue depth, latency, CPU, or concurrency limits exceeding a threshold.
- **Reject excess** — return a fast `503 Service Unavailable` (with `Retry-After`) instead of accepting work you can't handle. Failing *fast* is far better than failing *slow* (a quick rejection frees resources; a slow timeout ties them up).
- **Prioritize** — shed *low-value* traffic first: drop non-critical requests (analytics, recommendations, prefetch) before critical ones (checkout, login). Keep the core user journey working.

**Related techniques:**
- **Admission control / concurrency limits** — cap how many requests are processed at once; queue or reject beyond that.
- **Rate limiting** ([Q36](part-2-components.md)) — a *proactive* per-client cap; load shedding is a *reactive* system-wide protection when overloaded.
- **Priority queues** — process high-priority work first under stress.
- **Backpressure** ([Q80](#q80-what-is-backpressure)) — the mechanism that *signals* upstream to slow down.

**The mindset:** Design for graceful behavior under overload, not just the happy path. Real systems face traffic spikes, DDoS, and dependency slowdowns; load shedding is a survival mechanism that turns "total outage" into "temporarily reduced capacity." Pair with graceful degradation ([Q81](#q81-what-is-graceful-degradation)).

---

### Q80. Backpressure — letting slow consumers slow down producers

**What it is:** A feedback mechanism where a component that's overwhelmed **signals upstream** to slow down the rate of incoming work, preventing the buildup of unbounded queues and cascading failure. It's flow control: matching production rate to consumption capacity.

**The problem it solves:** If a fast producer sends work to a slow consumer with no backpressure, the work piles up — in memory, in queues — growing without bound until the consumer runs out of memory and crashes, often taking the system with it. Backpressure makes the producer *feel* the consumer's slowness and ease off.

**How it manifests:**
- **Bounded queues:** when a queue is full, producers **block** (wait) or are rejected, rather than the queue growing forever. The fullness *is* the backpressure signal.
- **TCP flow control:** the classic example — the receiver advertises a window size; the sender can't send faster than the receiver can accept.
- **Reactive Streams** (e.g., Project Reactor, RxJava, Akka Streams): consumers explicitly *request* N items; producers send at most that many — demand-driven flow.
- **Blocking / semaphores:** limiting in-flight work with a bounded permit pool.
- **HTTP 429/503 + Retry-After:** telling clients to back off.

**Backpressure vs load shedding:**
- **Backpressure** = "slow down" (throttle the source; work is delayed, not necessarily dropped). Best when the producer *can* slow down (internal pipelines, streaming).
- **Load shedding** = "drop this" (reject work you can't handle). Best when you *can't* slow the source (external users) and must protect yourself.
- They complement each other: backpressure propagates slowness upstream; where it can't (the very front, facing users), you shed load.

**Why it matters:** Without backpressure, a single slow component causes **memory blowups and cascading failures** across the whole pipeline. With it, the system degrades gracefully — throughput drops to match the bottleneck, but nothing crashes. It's essential for stable streaming/data-pipeline and microservice systems.

---

### Q81. Graceful degradation — failing softly, not totally

**What it is:** Designing the system so that when a component fails or is overloaded, it **loses some functionality** rather than failing **completely**. The core experience keeps working; non-essential features degrade or disappear. "Partial service beats no service."

**Examples:**
- **Recommendations down?** Show a generic "popular items" list instead of personalized recommendations — the user still shops. Don't error out the whole page.
- **Search slow/down?** Serve cached or slightly stale results, or a simplified search, rather than an error.
- **Personalization service failing?** Render the page with default (non-personalized) content.
- **A downstream is timing out?** Serve stale cached data ("stale-while-error") instead of failing.
- **Photo service degraded?** Show placeholders; let the rest of the feed load.
- **Under extreme load?** Temporarily disable expensive non-critical features (the "features flags to shed load" pattern) to preserve core functionality.

**How it's implemented:**
- **Fallbacks:** every call to a non-critical dependency has a fallback (default value, cached value, simplified behavior) when it fails.
- **Circuit breakers** ([Q86](part-5-reliability-advanced.md)): when a dependency is failing, stop calling it and use the fallback immediately (fail fast).
- **Feature flags:** toggle off expensive/non-essential features under stress.
- **Prioritization:** identify which features are *core* (must work) vs *nice-to-have* (can degrade), and protect the core.
- **Timeouts + defaults:** never let a slow non-critical dependency block the critical path — time out fast and proceed with a default.

**Why it matters:** Users tolerate *reduced* functionality far better than *outages*. A shopping site that shows generic recommendations still makes sales; one that returns a 500 loses the customer. Graceful degradation, combined with load shedding ([Q79](#q79-what-is-load-shedding)) and circuit breakers, turns "hard failures" into "soft, barely-noticed hiccups." It's a hallmark of resilient, well-designed systems: assume dependencies *will* fail, and design each feature to fail soft.

---

### Q82. How does caching strategy evolve as the system grows?

Caching isn't a one-time addition — it *deepens* and moves *closer to the user* as you scale:

**Small (Stage 0–1):** Often **no cache**, or a simple **in-process (local) cache** for a few hot values. The DB handles the load fine. Don't add cache infrastructure you don't need.

**Growing (Stage 2):** Add a **distributed cache (Redis/Memcached)** for shared hot data — session storage, hot query results, computed values. This is the big "scale reads" moment. Adopt **cache-aside** ([Q27](part-2-components.md)) as the default pattern.

**Larger (Stage 3):** **Multi-tier caching** — L1 local (in-process, microsecond) + L2 distributed (shared) ([Q30](part-2-components.md)). Add **stampede protection** (request coalescing, TTL jitter, stale-while-revalidate — [Q29](part-2-components.md)) because now a hot-key expiry can crush the DB. Add **cache warming** for known-hot data after deploys/flushes. Tune eviction (LRU + TTL) and monitor hit rates.

**Global (Stage 4–5):** **Edge/CDN caching per region** — cache dynamic-ish content close to users worldwide, not just static assets. **Regional cache clusters.** Sophisticated invalidation strategies across regions. Edge compute for personalized-but-cacheable content.

**The through-line — caching moves closer to the user over time:**
```
DB buffer cache → app local cache → distributed cache → reverse-proxy cache → CDN/edge cache → browser cache
```
Each layer closer to the user is faster and offloads everything behind it. As you scale, you push caching outward (toward the user) and make it smarter (multi-tier, stampede-proof, region-aware).

**Constant principles regardless of stage:**
- **Cache the hot set** (the 80/20 — a little cache absorbs a lot of traffic).
- **Bound staleness** with TTLs; invalidate on writes where freshness matters.
- **Protect against stampedes** once keys get hot.
- **Monitor hit rate** — a low hit rate means the cache isn't helping (wrong keys, too-short TTL, too-small cache).

---

### Q83. How do you scale a database, step by step?

Scale the database in this order — each step is cheaper/simpler than the next, so exhaust earlier steps before advancing:

**1. Optimize queries & add indexes.** The cheapest win. Find slow queries (`EXPLAIN`, slow-query log), add the right **indexes** ([Q55](part-3-databases.md)), fix N+1 queries, rewrite bad queries. Often turns a crisis into a non-issue with zero new infrastructure. *Always do this first.*

**2. Cache hot reads.** Put Redis in front for frequently-read data ([Q26](part-2-components.md)). Absorbs a huge fraction of read load before it reaches the DB. Highest ROI infrastructure add.

**3. Add read replicas.** Route reads to replicas, writes to the primary ([Q48](part-3-databases.md)). Scales reads horizontally and adds redundancy. Handle replication lag ([Q49](part-3-databases.md)).

**4. Vertical scaling.** Just get a bigger DB machine (more RAM/CPU/faster disks). Simple, no code changes, buys significant runway. Cheaper (in engineering time) than sharding — do this before sharding.

**5. Vertical partitioning / functional separation.** Split different *tables* or domains onto different databases (e.g., move analytics tables, or the `orders` domain, to a separate DB). Reduces load on any one DB and is a stepping stone toward service-owned data.

**6. Sharding (horizontal partitioning).** The last and most complex step ([Q50](part-3-databases.md)–[Q53](part-3-databases.md)). Partition rows across multiple DBs to scale writes/data beyond one machine. Only when writes truly saturate a vertically-scaled primary and the earlier steps are exhausted.

**Also consider along the way:**
- **Connection pooling** ([Q57](part-3-databases.md)) — often needed once the app fleet grows, independent of the above.
- **Denormalization / materialized views** ([Q54](part-3-databases.md), [Q59](part-3-databases.md)) — reduce expensive joins/aggregations.
- **A different database for a specific workload** — e.g., move time-series to Cassandra, search to Elasticsearch, offloading the relational DB (polyglot persistence).
- **Archiving old data** — move cold data out of the hot DB to keep it lean.

**The principle:** Follow the cheap-to-expensive order. Most systems never need to reach step 6 — caching, replicas, and vertical scaling handle enormous scale. Reserve sharding's complexity for when you genuinely have no simpler option.

---

### Q84. What is a data warehouse, and when do you add one?

**What it is:** A database optimized for **analytics** (OLAP) over huge volumes of historical data — complex aggregations, reporting, business intelligence, dashboards — kept **separate** from your transactional (OLTP) production database. Examples: Snowflake, Google BigQuery, Amazon Redshift, Databricks.

**Why it's separate from your production DB:** Analytical queries ("total revenue by product category by month over 3 years") scan *millions to billions* of rows. Running these on your **OLTP** database would:
- Hog resources and **slow down or lock** the live application (users' requests compete with a giant analytics scan).
- Be **slow anyway** — OLTP databases are row-oriented, optimized for many small transactions, not big scans/aggregations.

A data warehouse is **column-oriented** (reads only the columns a query needs, compresses well) and built for massive scans and aggregations — the opposite optimization from OLTP ([Q85](#q85-what-is-the-difference-between-oltp-and-olap)).

**How data gets there:** Via **ETL/ELT pipelines** or **CDC** ([Q65](part-3-databases.md)) — data is extracted from production databases (and other sources: logs, third-party APIs, events), transformed, and loaded into the warehouse, typically in batches (nightly) or streaming (near-real-time). This keeps heavy analytics entirely off the production system.

**When to add one:**
- When **analytics/reporting queries start hurting** production DB performance (the classic trigger — "the nightly report is slowing down the app").
- When you need **cross-source reporting** (combine data from multiple databases/services/external sources for a unified view).
- When business/data teams need to run **ad-hoc analytical queries** without touching (or risking) production.
- Typically around Stage 3–4, once you have meaningful data volume and analytics needs.

**Related concepts:** A **data lake** stores raw, unstructured/semi-structured data cheaply (often object storage) for flexible later processing; a **lakehouse** blends lake and warehouse. For dashboards, you might also use **materialized views** ([Q59](part-3-databases.md)) as a lighter-weight step before a full warehouse.

**The principle:** Never run heavy analytics on your OLTP database at scale. Separate the workloads — transactional serving vs analytical crunching — because they need opposite optimizations.

---

### Q85. What's the difference between OLTP and OLAP?

Two fundamentally different database workloads, needing **opposite** optimizations:

**OLTP — Online Transaction Processing** (your production/application database):
- **Workload:** many **small, fast** reads and writes — "insert this order," "fetch this user," "update this balance."
- **Access pattern:** operates on a **few rows** at a time, by key; high concurrency; low latency per operation.
- **Storage:** typically **row-oriented** (a whole row stored together) — efficient to read/write entire records.
- **Optimized for:** transaction throughput, low latency, data integrity (ACID), high concurrency.
- **Examples:** PostgreSQL, MySQL, SQL Server, Oracle — powering the live app.
- **Data volume per query:** small.

**OLAP — Online Analytical Processing** (your data warehouse):
- **Workload:** few **large, complex** read-only queries — "average order value by region by quarter across all history."
- **Access pattern:** scans and **aggregates millions/billions of rows**, few concurrent users, latency of seconds-to-minutes is acceptable.
- **Storage:** typically **column-oriented** (each column stored together) — so a query touching 3 of 50 columns reads only those 3, and columns compress extremely well (similar values together).
- **Optimized for:** scanning/aggregating huge datasets, analytical throughput.
- **Examples:** Snowflake, BigQuery, Redshift, ClickHouse.
- **Data volume per query:** enormous.

**Why row vs column orientation matters (the key insight):**
- **OLTP (row store):** "give me everything about order #123" → all its fields are stored together → one efficient read. But "sum the `amount` column across 100M orders" would read every full row (wasteful).
- **OLAP (column store):** "sum the `amount` across 100M rows" → read *only* the `amount` column, tightly packed and compressed → blazing fast. But fetching one full row means gathering from many separate column files (inefficient) — which is fine, because OLAP rarely does that.

**Why you separate them:** Their optimizations are mutually exclusive — you can't be great at both single-row transactions *and* billion-row aggregations in one store/layout. So you run OLTP for the live app and pipe data into a separate OLAP warehouse ([Q84](#q84-what-is-a-data-warehouse-and-when-do-you-add-one)) for analytics. Mixing them (heavy analytics on your OLTP DB) is a classic scaling mistake that degrades the user-facing system.

---

[← Part 3](part-3-databases.md) | [Index](README.md) | [Part 5 →](part-5-reliability-advanced.md)
