# Part 1 — Fundamentals & Core Concepts (Q1–Q20)

[← Back to index](README.md) | Next: [Part 2 — Core Components →](part-2-components.md)

---

### Q1. What is system design, really?

**What it is:** System design is the discipline of deciding *how* the pieces of a software system fit together — the servers, databases, caches, queues, networks — and how data flows between them, so the system meets both its features and its quality targets.

**Two kinds of requirements drive it:**
- **Functional** — what the product does ("users can upload photos").
- **Non-functional (NFRs)** — how well it does it: latency, throughput, availability, durability, security, cost.

**Why it matters:** The same feature list produces wildly different architectures depending on scale. A photo-sharing app for 100 friends is a single server; the same features for 100 million users (Instagram) needs CDNs, object storage, sharded databases, and multiple data centers. The *features* barely changed — the *NFRs* did.

**The core skill:** System design is fundamentally about **trade-offs**. There is no "correct" architecture, only one that's appropriate for a given scale, budget, team size, and set of NFRs. A senior engineer's value is in saying "we could do A or B; A is simpler but caps at X load, B scales further but costs more to operate — given our needs, choose A now and plan for B."

**Analogy:** Designing a system is like city planning. A village needs a dirt road; a metropolis needs highways, traffic lights, and public transit. Building highways for a village wastes money; building dirt roads for a metropolis causes gridlock. The art is matching infrastructure to actual population.

---

### Q2. Functional vs non-functional requirements — why NFRs dominate architecture

**Functional requirements** describe behavior: "a user can place an order," "an admin can issue a refund." You can usually satisfy these with straightforward code regardless of architecture.

**Non-functional requirements** describe qualities:
- **Performance** — "P99 latency under 200 ms"
- **Scalability** — "handle 50K orders/second on Black Friday"
- **Availability** — "99.99% uptime"
- **Durability** — "never lose a paid order"
- **Security & compliance** — "PCI-DSS, data stays in the EU"
- **Cost** — "under $50K/month infrastructure"

**Why NFRs dominate:** Functional requirements tell you *what to build*; NFRs tell you *how to build it*. "Handle 10 orders/day" and "handle 50,000 orders/second" have identical functional requirements but require completely different systems — the second needs load balancers, sharding, queues, and caching that the first would never justify.

**Practical tip:** Always pin down NFRs *before* designing. In an interview or a real project, the first questions should be: How many users? Read-heavy or write-heavy? What latency? How much data? What's the availability target? These numbers determine everything that follows.

---

### Q3. What does scalability actually mean?

**Definition:** Scalability is a system's ability to handle growing load by adding resources, ideally with a roughly **linear** relationship — double the servers, roughly double the capacity.

**Two dimensions of "load":**
- More **requests per second** (traffic growth).
- More **data** (storage growth).
- More **users/tenants** (concurrency and isolation).

**What "scalable" really implies:** You don't have to redesign every time traffic grows. You add capacity. A *non-scalable* system hits a wall — the only fix is a rewrite. A *scalable* system has a growth path baked in.

**The linear ideal vs reality:** Perfect linear scaling is rare because of **coordination overhead** — as you add nodes, they spend more effort coordinating (locks, consensus, replication). This is captured by **Amdahl's Law** (the serial fraction of work limits speedup) and the **Universal Scalability Law** (adding nodes eventually *reduces* throughput due to coherence costs). Practical goal: get as close to linear as the workload allows, and know where the ceiling is.

**Example:** A stateless web tier scales almost linearly — add more identical servers behind a load balancer. A single relational database does *not* scale linearly for writes; past a point, adding read replicas helps reads but writes still funnel to one primary, forcing sharding.

---

### Q4. Vertical vs horizontal scaling — the first big fork

**Vertical scaling (scale up):** Make one machine more powerful — more CPU cores, more RAM, faster disks.
- ✅ **Pros:** Dead simple. No code changes. No distributed-systems complexity. A single 128-core, 2 TB RAM box handles enormous load.
- ❌ **Cons:** Hard ceiling (biggest machine you can buy). Expensive at the top end (price grows faster than performance). Still a **single point of failure** — one box, one outage.

**Horizontal scaling (scale out):** Add more machines and spread load across them.
- ✅ **Pros:** Near-unlimited ceiling. Fault tolerant (one node dies, others carry on). Often cheaper (commodity hardware). Enables rolling deploys.
- ❌ **Cons:** Requires **stateless** services, a **load balancer**, and often **data partitioning**. Introduces network calls, partial failures, and consistency challenges.

**The rule of thumb:** *Scale up first, scale out when you must.* Vertical scaling buys you time cheaply and simply while you're small. Move horizontal when you hit the machine ceiling, need redundancy (no SPOF), or need zero-downtime deploys.

**Real numbers:** Modern cloud VMs go up to ~448 vCPUs and ~24 TB RAM. Most applications never need to scale *up* past a mid-size instance before *out* becomes the better play — but for some workloads (a single large in-memory cache, certain databases) vertical scaling remains the pragmatic answer for a long time.

---

### Q5. Latency vs throughput — two different questions

**Latency** = how long *one* request takes. "This API responds in 50 ms." Measured in time, reported at **percentiles** (P50, P95, P99).

**Throughput** = how *many* requests you handle per unit time. "We serve 10,000 requests/second." Measured in operations/second.

**They're independent — you can have any combination:**
- Low latency, low throughput: a single fast server handling a trickle of requests.
- Low latency, high throughput: a well-designed scaled system (the goal).
- High latency, high throughput: a batch/streaming pipeline processing millions of records where each record's journey is slow but volume is huge.
- High latency, low throughput: an overloaded or badly designed system (avoid).

**The restaurant analogy:** Latency is how long *your* meal takes to arrive. Throughput is how many meals the kitchen serves per hour. A kitchen can have high throughput (feeds 500/hour) while your specific dish still takes 30 minutes (high latency).

**Which to optimize?** Usually **latency at high percentiles** for user-facing systems (users feel slowness) and **throughput** for data pipelines. Note the tension: batching improves throughput but adds latency; you often trade one for the other.

**Little's Law (worth knowing):** `Concurrency = Throughput × Latency`. If each request takes 100 ms (0.1 s) and you need 10,000 RPS, you must handle 1,000 requests concurrently. This tells you how many threads/connections/workers you need.

---

### Q6. Why measure P99, not the average?

**The problem with averages:** Averages hide the pain of the slowest requests. Imagine 100 requests: 99 take 10 ms, one takes 3,000 ms. The average is ~40 ms — looks great! But one user waited 3 seconds.

**Percentiles tell the truth:**
- **P50 (median):** half of requests are faster than this. The "typical" experience.
- **P95:** 95% are faster; the slowest 5% are worse.
- **P99:** 99% are faster; captures the "tail."
- **P99.9:** the extreme tail, matters at massive scale.

**Why the tail matters more at scale:** A single web page might make 20 backend calls. If each call has a 1% chance of being slow (P99), the probability that *at least one* of the 20 is slow is `1 − 0.99²⁰ ≈ 18%`. So **the tail latency of a component becomes the typical latency of the page**. This is the famous insight from Google's "The Tail at Scale" paper.

**Who lives in the tail?** Often your *most engaged* users — the ones with the most data, the biggest carts, the longest histories. Their requests hit the slowest code paths. Ignoring P99 means ignoring your best customers.

**Practical rule:** Set SLOs on P99 (or P99.9), not averages. "P99 latency under 200 ms" is a meaningful target; "average latency under 200 ms" can be met while 1% of users suffer.

---

### Q7. Availability and the "nines"

**Definition:** Availability is the percentage of time a system is operational and able to serve requests. Expressed as "nines":

| Availability | Downtime/year | Downtime/month | Downtime/week |
|-------------|---------------|----------------|---------------|
| 99% ("two nines") | 3.65 days | 7.2 hours | 1.68 hours |
| 99.9% ("three nines") | 8.77 hours | 43.8 min | 10.1 min |
| 99.99% ("four nines") | 52.6 min | 4.38 min | 1.01 min |
| 99.999% ("five nines") | 5.26 min | 26.3 sec | 6.05 sec |

**The exponential cost of each nine:** Going from 99% to 99.9% might mean adding a standby server and health checks. Going from 99.9% to 99.99% means multi-AZ redundancy, automated failover, and no single points of failure. Going to 99.999% means multi-region, sophisticated automation, and enormous operational maturity. **Each nine can multiply cost and complexity by 3–10×.**

**How availability compounds:** If your system depends on 3 components in series (all must work), each at 99.9%, total availability is `0.999³ ≈ 99.7%` — *worse* than any single component. This is why reducing dependencies and adding redundancy (parallel paths) matters.

**Practical advice:** Don't chase nines for their own sake. A internal analytics dashboard might be fine at 99%; a payment system needs 99.99%+. Match the target to the *business cost of downtime*. Over-provisioning availability wastes money; under-provisioning loses customers.

---

### Q8. The CAP theorem — the most (mis)quoted idea in distributed systems

**The statement:** In a distributed data store, when a **network Partition** occurs (nodes can't talk to each other), you must choose between:
- **Consistency (C):** every read returns the most recent write (or an error).
- **Availability (A):** every request gets a (non-error) response, but it might be stale.

You **cannot have both** during a partition. You get **CP** or **AP**.

**The crucial nuance everyone misses:** CAP only forces a choice *during a partition*. When the network is healthy (the normal case), you can have both consistency and availability. So "CA systems" don't really exist in distributed contexts — partitions are a fact of life, so you're always effectively choosing CP or AP for partition scenarios.

**CP systems** (choose consistency, sacrifice availability during partitions):
- Examples: HBase, ZooKeeper, etcd, traditional RDBMS with synchronous replication.
- Behavior: if a node can't confirm it has the latest data, it refuses to answer rather than serve stale data.
- Use when: correctness is non-negotiable — bank ledgers, inventory, configuration/coordination.

**AP systems** (choose availability, tolerate stale reads during partitions):
- Examples: Cassandra, DynamoDB, Riak, CouchDB.
- Behavior: every node answers with its best-known data, reconciling later (eventual consistency).
- Use when: availability and low latency matter more than perfect freshness — social feeds, product catalogs, shopping carts (which can merge later).

**Practical framing:** Don't think "my system is CP or AP" globally. Think per-feature. A single product might store payments in a CP store and the "likes" counter in an AP store.

---

### Q9. PACELC — CAP's more honest sibling

**The problem with CAP:** It only describes behavior *during partitions*, which are rare. It says nothing about the trade-offs you make every single day when the network is fine.

**PACELC fills the gap:**
> **If** there's a **P**artition, choose between **A**vailability and **C**onsistency (that's CAP). **E**lse (normal operation), choose between **L**atency and **C**onsistency.

**Why the "else" matters:** Even with a perfectly healthy network, strong consistency costs latency. To guarantee a read sees the latest write, you must coordinate across replicas (wait for a quorum, or read from the leader). That coordination adds milliseconds. If you relax consistency (read from any nearby replica), you get lower latency but possibly stale data.

**Classifying real systems:**
- **DynamoDB, Cassandra:** PA/EL — prioritize availability during partitions, latency otherwise. (Tunable.)
- **Traditional RDBMS / Spanner:** PC/EC — prioritize consistency always, accepting higher latency and reduced availability during partitions.
- **MongoDB (default):** PA/EC-ish depending on config.

**Why this is the more useful model:** In practice, the everyday choice between latency and consistency affects your users far more often than partition behavior. PACELC forces you to acknowledge that trade-off explicitly.

---

### Q10. Consistency models — a spectrum, not a binary

Consistency isn't "on or off." It's a spectrum of guarantees about **when and in what order** writes become visible to readers. From strongest to weakest:

**Strong (linearizable) consistency:** Every read sees the most recent write, as if there's a single copy of the data and operations happen instantaneously in a global order. Easiest to reason about; most expensive (coordination, latency). Example: a bank balance.

**Sequential consistency:** All nodes see operations in the same order, but that order need not match real-time. Slightly weaker than linearizable.

**Causal consistency:** Operations that are *causally related* (B depends on A) are seen by everyone in that order; unrelated operations may be seen in different orders. Example: you must see the original comment before you see a reply to it, but two unrelated comments can appear in any order. A sweet spot for many collaborative apps.

**Read-your-writes consistency:** A user always sees their *own* writes immediately, even if others see them later. Example: you post a tweet and it instantly appears on *your* timeline. Often implemented by routing a user's reads to the leader (or their own region) right after a write.

**Monotonic reads:** Once you've seen a value, you never see an *older* value on subsequent reads (no "time travel" backward). Prevents the jarring experience of data appearing then vanishing.

**Eventual consistency:** If writes stop, all replicas *eventually* converge to the same value. No timing guarantee. Cheapest, most available. Example: DNS propagation, view counts, "likes."

**The design rule:** Pick the **weakest model your use case can tolerate**. Weaker = cheaper, faster, more available. Money needs strong; a "likes" counter is fine with eventual. Most real systems mix models per feature.

---

### Q11. ACID vs BASE — two philosophies of data

**ACID** (classic relational databases):
- **Atomicity:** a transaction is all-or-nothing. Transfer $100: both the debit and credit happen, or neither does.
- **Consistency:** transactions move the DB from one valid state to another, respecting all constraints (foreign keys, uniqueness).
- **Isolation:** concurrent transactions don't interfere; results are as if they ran sequentially (governed by isolation levels).
- **Durability:** once committed, data survives crashes (persisted to disk / WAL).

ACID favors **correctness**. It's the right default whenever wrong data is expensive: money, inventory, bookings.

**BASE** (many NoSQL / distributed systems):
- **Basically Available:** the system always responds (maybe with stale or approximate data).
- **Soft state:** state may change over time even without input, due to eventual convergence.
- **Eventual consistency:** replicas converge eventually, not immediately.

BASE favors **availability and scale**. It's the right choice when you need massive scale and can tolerate slight staleness: social feeds, activity streams, catalogs.

**The trade-off, plainly:** ACID gives you correctness guarantees at the cost of coordination (which limits scale and availability). BASE gives you scale and availability at the cost of relaxed guarantees (which push complexity into your application, e.g., conflict resolution).

**Not good vs evil:** These are endpoints of a trade-off. Modern systems increasingly offer *tunable* consistency (DynamoDB, Cosmos DB) so you can pick per-operation. And "NewSQL" systems (Spanner, CockroachDB) try to give ACID *at* scale — at the cost of latency and operational complexity.

---

### Q12. Bottlenecks — the science of the slowest link

**Definition:** A bottleneck is the single component that limits the throughput of the whole system — the narrowest point in the pipe. Overall capacity can never exceed the bottleneck's capacity, no matter how much you scale everything else.

**Common bottlenecks, in rough order of frequency:**
1. **Database** — connection limits, slow queries, lock contention, disk I/O. The #1 culprit in most systems.
2. **A single-threaded or under-provisioned service.**
3. **Network bandwidth** — especially for media-heavy or cross-region traffic.
4. **Disk I/O** — random reads/writes on spinning disks or saturated SSDs.
5. **Locks / shared state** — contention serializes work that should be parallel.
6. **External dependencies** — a slow third-party API.

**How to find one (always measure, never guess):**
- **Metrics** — watch utilization and saturation per component (CPU, memory, disk queue, connection pool usage).
- **Distributed tracing** — see where time actually goes across a request's journey.
- **Load testing** — push synthetic load and watch what saturates first.

**The key insight (Theory of Constraints):** Optimizing anything *other than* the bottleneck yields **zero** improvement in overall throughput — you just make a non-limiting part faster while the queue at the bottleneck stays the same. Always find and fix the actual constraint first. Then the bottleneck *moves* to the next weakest link, and you repeat.

**Example:** Your API is slow. You add more API servers — no change. Why? The bottleneck was the database, which all API servers share. Adding API servers just adds more clients hammering the same DB. The fix was caching or read replicas, not more app servers.

---

### Q13. Single points of failure (SPOF)

**Definition:** A SPOF is any component whose failure brings down the entire system because there's no backup to take over. One database, one load balancer, one region, one shared cache.

**Why they're insidious:** Systems often work perfectly in testing and normal operation — the SPOF only reveals itself during a failure, usually at the worst time. "It's been fine for two years" is not evidence of no SPOF; it's evidence the failure hasn't happened *yet*.

**How to eliminate SPOFs — add redundancy at every layer:**
- **DNS:** use multiple providers / anycast.
- **Load balancers:** run at least two, with failover (or a managed LB that's internally redundant).
- **App servers:** multiple stateless instances across availability zones.
- **Database:** primary + replicas with automated failover; or multi-primary.
- **Cache:** clustered/replicated, and the app must survive a cache outage (degrade to DB).
- **Availability Zones / Regions:** spread across physically isolated locations.

**The test:** For each component, ask "if this single thing dies right now, does the system stay up?" If the answer is no, it's a SPOF. Then decide whether the risk justifies the cost of redundancy — sometimes for a small internal tool, a SPOF is an acceptable, conscious choice.

**Hidden SPOFs to watch for:** Shared configuration services, a single message broker, DNS, certificate authorities, a single deployment pipeline, and — famously — *the person who's the only one who understands the system.*

---

### Q14. Redundancy — the foundation of high availability

**Definition:** Redundancy means having spare capacity or duplicate components ready to take over when something fails. It's the primary tool for eliminating SPOFs and hitting high availability.

**Configurations:**

**Active-active:** All replicas serve live traffic simultaneously. If one fails, the others simply absorb its share.
- ✅ No wasted capacity, instant failover, load is spread.
- ❌ Requires the system to handle concurrent writes/state everywhere (harder consistency).
- Example: multiple stateless web servers behind a load balancer.

**Active-passive (standby):** One or more replicas sit idle (or read-only), ready to be promoted when the primary fails.
- ✅ Simpler consistency (only one active writer).
- ❌ Wasted capacity (standby idles), and failover takes time (detection + promotion).
- Example: a primary database with a hot standby replica.

**N+1 / N+2 redundancy:** Provision enough spare capacity to survive one (N+1) or two (N+2) simultaneous failures. If you need 4 servers to handle peak load, run 5 (N+1) so one can die without degradation.

**Geographic redundancy:** Duplicate across availability zones (same region, isolated infrastructure) and regions (different geography) to survive datacenter or regional outages.

**The cost reality:** Redundancy means paying for capacity you hope never to use. That's the price of availability — insurance. The question is always: does the cost of the redundancy outweigh the cost of the outage it prevents? For a payment system, yes. For a hobby project, no.

---

### Q15. Stateless vs stateful services — the single most important scaling decision

**Stateless service:** Keeps no client-specific data between requests. Every request contains everything needed to process it (or references shared external state). Any instance can handle any request interchangeably.
- ✅ **Trivially horizontally scalable** — just add more identical instances.
- ✅ Any instance can die and be replaced with no data loss.
- ✅ Load balancing is simple (send requests anywhere).
- ✅ Rolling deploys and autoscaling "just work."

**Stateful service:** Holds data locally between requests — in-memory sessions, cached user data, connection state, in-progress computation.
- ❌ Requests must return to the *same* instance (sticky sessions) or state must be replicated across instances.
- ❌ Losing an instance loses its state.
- ❌ Scaling requires moving/rebalancing state.

**The golden pattern:** Make your application tier **stateless** and push all state into **shared, purpose-built stores**:
- Session data → Redis or a database.
- User uploads → object storage (S3).
- Cached data → distributed cache.
- Long computations → a database or queue with checkpoints.

**Why this is *the* enabler:** Almost every horizontal-scaling technique — load balancing, autoscaling, rolling deploys, self-healing — depends on instances being interchangeable. The moment a server holds irreplaceable state, you lose that. So the discipline is: *keep the compute tier stateless; concentrate and manage state deliberately in a few systems built for it.*

**Necessary exceptions:** Some things are inherently stateful — databases, caches, and stateful stream processors. You don't make *those* stateless; you scale them with their own specialized techniques (replication, sharding, consistent hashing).

---

### Q16. Idempotency — the property that makes retries safe

**Definition:** An operation is idempotent if performing it multiple times has the same effect as performing it once. `x = 5` is idempotent (setting it again changes nothing). `x = x + 1` is *not* (each call changes the result).

**Why it's critical in distributed systems:** Networks are unreliable. A client sends a request, the server processes it, but the *response* is lost. The client, seeing no response, **retries**. Now the operation runs twice. Without idempotency, that means a double charge, a duplicate order, a doubled balance.

**HTTP methods and idempotency:**
- `GET`, `PUT`, `DELETE` are *defined* to be idempotent. `GET` reads (no change). `PUT` sets a resource to a state (repeating is harmless). `DELETE` removes it (deleting again = still gone).
- `POST` is *not* idempotent by default — it typically creates a new resource each time.

**How to make operations idempotent:**
- **Idempotency keys:** the client generates a unique key per logical operation and sends it with the request. The server records processed keys; if it sees a duplicate key, it returns the original result instead of reprocessing. (Stripe's API works exactly this way for payments.)
- **Natural idempotency:** design operations as "set to state X" rather than "apply delta." "Set status = shipped" is safe to repeat; "increment shipped count" is not.
- **Deduplication:** unique constraints in the database reject duplicate inserts.

**The takeaway:** Any operation that might be retried — which, in a distributed system, is *all of them* — should be designed to be idempotent or protected by an idempotency key. This is one of the most practically important patterns in real systems.

---

### Q17. Back-of-the-envelope estimation — sizing before building

**What it is:** Quick, rough math to estimate the scale of a system *before* designing it, so your architecture matches reality. You're aiming for the right order of magnitude, not precision.

**The standard quantities to estimate:**
- **QPS (queries/second):** from daily active users and actions per user.
- **Storage:** from data size per item × item count × retention × replication.
- **Bandwidth:** from payload size × QPS.
- **Memory (for caching):** from the size of the hot data set you want to cache.

**Worked example — a Twitter-like feed:**
- Assume 300M daily active users (DAU), each opening the app 5×/day → 1.5B feed reads/day.
- `1.5B / 86,400 s ≈ 17,000 reads/sec` average.
- Peak is typically 2–3× average → **~50,000 reads/sec peak.**
- Writes (tweets): say each user posts 0.2×/day → 60M tweets/day → ~700 writes/sec average, ~2,000 peak.
- **Read:write ratio ≈ 25:1** → this is a read-heavy system → caching and read replicas will be central.
- Storage: 60M tweets/day × 300 bytes × 365 days ≈ **6.5 TB/year** (text only; media dwarfs this and goes to object storage).

**Why do this:** These numbers immediately tell you the shape of the system. 50K reads/sec says "you need caching and horizontal scaling." 25:1 read:write says "optimize reads hard." 6.5 TB/year of text says "a single DB handles the text for years, but media needs object storage + CDN."

**Handy constants:**
- 1 day ≈ 86,400 seconds (round to 100K for mental math).
- 1 million/day ≈ 12/second.
- Peak ≈ 2–3× average for consumer apps.

---

### Q18. The latency numbers every engineer should know

Understanding relative speeds lets you reason about where time goes and what's worth optimizing. Approximate modern values:

| Operation | Time | Relative |
|-----------|------|----------|
| L1 cache reference | ~1 ns | 1× |
| L2 cache reference | ~4 ns | 4× |
| Main memory (RAM) reference | ~100 ns | 100× |
| Read 1 MB sequentially from RAM | ~3 µs | — |
| SSD random read | ~16 µs | — |
| Read 1 MB from SSD | ~50 µs | — |
| Round trip within a datacenter | ~500 µs | — |
| Read 1 MB from disk (HDD) | ~1–2 ms | — |
| Disk seek (HDD) | ~5–10 ms | — |
| Round trip across a continent (e.g., CA→NL) | ~150 ms | — |

**The key mental jumps:**
- **Memory is ~100× faster than SSD, ~1,000,000× faster than a cross-continent network round trip.** This is *why caching in memory is so powerful* and *why cross-region calls are so costly*.
- **A network round trip within a datacenter (~0.5 ms) is cheap; across the world (~150 ms) is expensive.** This drives CDNs, edge computing, and regional data placement.
- **Sequential access beats random access** on both disk and memory — this shapes database storage engines (log-structured, B-trees) and why batching helps.

**How to use them:** When you sketch a design, add up the round trips. A request that makes 3 sequential cross-region calls already costs ~450 ms before any processing — likely violating a 200 ms SLO. That tells you to parallelize the calls, cache, or move data closer.

---

### Q19. Coupling and cohesion — how to draw boundaries

**Coupling:** How dependent components are on each other's internal details.
- **Tight coupling:** changing one component forces changes in others. A shared database that many services read/write directly is tightly coupled — a schema change breaks everyone.
- **Loose coupling:** components interact through stable, minimal interfaces (APIs, events, messages). You can change one's internals freely.
- **Goal: loose coupling.** It lets teams work and deploy independently and limits the blast radius of changes.

**Cohesion:** How focused a single component is on one well-defined responsibility.
- **High cohesion:** everything in a module belongs together and serves one purpose (a `PaymentService` that only handles payments).
- **Low cohesion:** a grab-bag "utils" or "manager" class that does unrelated things.
- **Goal: high cohesion.** It makes components easier to understand, test, and reuse.

**The mantra:** *Loose coupling, high cohesion.* Together they define good boundaries — whether between classes, modules, or microservices.

**Why it matters for system design:** These principles determine *where to split a system into services*. A good service boundary has high internal cohesion (owns one business capability end-to-end) and loose coupling to others (communicates via well-defined APIs/events, owns its own data). Getting this wrong produces a "distributed monolith" — the operational pain of microservices with none of the independence, because everything is still tightly coupled through shared databases or chatty synchronous calls.

---

### Q20. Latency vs response time vs the queue

These terms are often used loosely; distinguishing them sharpens your thinking.

**Response time:** What the *client* actually experiences end-to-end — network transit + waiting in queues + service (processing) time. This is what users feel and what you should ultimately optimize.

**Service time:** The time the server spends *actively processing* the request (CPU, DB calls, etc.), excluding waiting.

**Queuing delay (wait time):** How long a request sits in a queue *before* processing begins, because the server is busy with other requests.

**The critical insight — queuing dominates under load:** As a system approaches its capacity (utilization → 100%), queuing delay explodes *non-linearly*. From queuing theory, wait time is roughly proportional to `utilization / (1 − utilization)`:
- At 50% utilization, wait ≈ 1× service time.
- At 90% utilization, wait ≈ 9× service time.
- At 99% utilization, wait ≈ 99× service time.

This is why systems that seem "fine at 70% CPU" fall off a cliff at 90% — the *service time* didn't change, but *queuing delay* skyrocketed, wrecking response time and especially P99.

**Practical implications:**
- Keep utilization with headroom (often target ~60–70%) so a traffic spike doesn't push you into the exponential zone.
- Response time = network + queue + service. To reduce it, attack whichever dominates: network (CDN/edge), queue (add capacity, load-shed), or service (optimize code/queries).
- This is also why **P99 latency degrades first** as load rises — the tail feels queuing before the median does.

---

[← Back to index](README.md) | Next: [Part 2 — Core Components →](part-2-components.md)
