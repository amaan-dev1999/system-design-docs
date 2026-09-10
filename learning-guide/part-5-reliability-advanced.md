# Part 5 — Reliability, Availability & Advanced Topics (Q86–Q100)

[← Part 4](part-4-scalability-growth.md) | [Index](README.md)

---

### Q86. Circuit breaker — stop hammering a failing dependency

**The problem:** Service A calls Service B. B becomes slow or unresponsive. A keeps calling B, and each call **waits for a timeout** (say 30 s) before failing. A's threads pile up waiting on B, A's own resources exhaust, and A becomes unresponsive too — the failure **cascades**. One failing service drags down everything that depends on it.

**The circuit breaker pattern** (named after electrical breakers) wraps calls to a dependency and monitors failures, operating as a state machine with three states:

- **Closed (normal):** requests flow through to B. The breaker counts failures. If failures exceed a threshold (e.g., 50% of the last N calls fail), it **trips** to Open.
- **Open (tripped):** requests **fail immediately** without calling B at all — no waiting for timeouts. This is the key: **fail fast** instead of failing slow. Return a fallback ([graceful degradation, Q81](part-4-scalability-growth.md)) or a quick error. This gives B breathing room to recover and stops A from wasting resources.
- **Half-Open (testing):** after a cooldown, the breaker lets a *few* trial requests through. If they succeed, B has recovered → close the breaker (resume normal flow). If they fail, → back to Open for another cooldown.

**What it prevents:** **Cascading failures.** By failing fast when a dependency is unhealthy, it stops the pileup of blocked requests, contains the blast radius, and lets the struggling dependency recover instead of being hammered while it's down.

**Best practices:**
- Combine with **timeouts** ([Q89](#q89-what-is-a-timeout-and-why-is-it-critical)) (fail fast even in Closed state) and **fallbacks** (what to return when Open).
- Tune thresholds and cooldowns to your traffic.
- Emit metrics on breaker state (an Open breaker is an alert-worthy signal).
- Libraries: Resilience4j, Polly, Hystrix (legacy); service meshes ([Q37](part-2-components.md)) provide it at the infrastructure layer.

**The mindset:** In distributed systems, dependencies *will* fail. The circuit breaker assumes this and contains the damage — a cornerstone resilience pattern.

---

### Q87. Retries — necessary, but dangerous without care

**Why retry:** Many failures are **transient** — a brief network blip, a momentary timeout, a temporarily overloaded server, a leader election in progress. Simply retrying often succeeds, hiding the glitch from the user. Retries are essential for resilience.

**Why retries are dangerous — the retry storm:** If a service is struggling (overloaded), and every client **retries** on failure, you *multiply* the load on the already-struggling service exactly when it can least handle it. A small hiccup becomes a full outage as retries pile on. This is a **retry storm** (or "retry amplification") — a classic way a minor incident cascades into a major one. Worse, retries can stack across layers (client retries × service retries × ...) multiplying load exponentially.

**How to retry safely:**
1. **Exponential backoff** ([Q88](#q88-what-is-exponential-backoff-with-jitter)) — wait longer between each attempt (1s, 2s, 4s…) instead of hammering immediately. Relieves pressure on the struggling service.
2. **Jitter** ([Q88](#q88-what-is-exponential-backoff-with-jitter)) — randomize the backoff so many clients don't retry in perfect sync (which would create synchronized load spikes).
3. **Retry budget / cap** — limit total retries (e.g., max 3 attempts) and/or cap retries as a *percentage* of traffic, so retries can never dominate load.
4. **Only retry idempotent, retryable operations** — retrying a non-idempotent write can double-charge/duplicate ([Q16](part-1-fundamentals.md)). Use idempotency keys. And only retry *retryable* errors (a 500 or timeout), **not** a 400/validation error — retrying those is pointless and wasteful.
5. **Combine with circuit breakers** — when the breaker is Open, don't retry at all; fail fast.
6. **Avoid retrying at every layer** — decide *where* retries happen; layered retries multiply dangerously.

**The mindset:** Retries are a double-edged sword — indispensable for handling transient faults, catastrophic if naive. "Retry with exponential backoff + jitter + a budget, only for idempotent operations, and stop when the circuit is open" is the safe recipe.

---

### Q88. Exponential backoff with jitter

**Exponential backoff:** When retrying a failed operation, **increase the wait time exponentially** between attempts rather than retrying at a fixed, immediate interval:
- Attempt 1 fails → wait ~1 s
- Attempt 2 fails → wait ~2 s
- Attempt 3 fails → wait ~4 s
- Attempt 4 fails → wait ~8 s … (often capped at a maximum, e.g., 30 s)

**Why exponential:** A struggling service needs *time* to recover. Immediate, constant retries keep hammering it, prolonging the outage. Backing off exponentially rapidly reduces the retry pressure, giving the service room to recover while still eventually retrying.

**The remaining problem — synchronized retries (thundering herd):** Imagine 10,000 clients all hit an error at the same instant (e.g., a service blipped). With pure exponential backoff, they *all* wait exactly 1 s, then *all* retry at the same moment → a synchronized spike that re-overwhelms the recovering service. Then they all wait 2 s and spike again. The herd stays in lockstep.

**The fix — jitter (randomization):** Add randomness to each wait time so retries **spread out** instead of clustering. Instead of exactly 2 s, wait a random duration in a range around it. Now the 10,000 retries are smeared across time rather than hitting all at once — smooth load instead of spikes.

**Common jitter strategies (from AWS's well-known article):**
- **Full jitter:** `wait = random(0, base * 2^attempt)` — pick a random time between 0 and the backoff ceiling. Spreads retries the most; generally recommended.
- **Equal jitter:** `wait = (base * 2^attempt)/2 + random(0, (base * 2^attempt)/2)` — half fixed, half random.
- **Decorrelated jitter:** each wait is based partly on the previous wait, randomized — good properties for spreading load.

**The takeaway:** *Exponential backoff* prevents hammering; *jitter* prevents synchronized spikes. Together they're the **standard, correct way to retry** in distributed systems — used by virtually every mature SDK and client library. Backoff without jitter still causes herd spikes; always add jitter.

---

### Q89. Timeouts — the most fundamental resilience setting

**What it is:** A limit on how long you'll wait for an operation (a network call, a query, a lock) before giving up and treating it as failed. Every network boundary should have one.

**Why it's critical:** Without a timeout, a call to a hung dependency waits **forever** (or until the OS/TCP eventually gives up, which can be minutes). That's catastrophic:
- The waiting thread/connection is **tied up** doing nothing.
- Under load, all threads/connections get stuck waiting on the slow dependency.
- The service **exhausts its resources** and becomes unresponsive itself.
- The failure **cascades** upstream — everyone waiting on you now hangs too.

A slow dependency without timeouts is *more* dangerous than a fast-failing one, because it silently consumes resources everywhere. **"Fail fast" beats "hang forever."**

**Where to set timeouts:** *Every* boundary — HTTP calls, RPC/gRPC calls, database queries, cache lookups, lock acquisition, connection establishment. A missing timeout anywhere is a latent outage waiting to happen.

**Timeout budgets (crucial in call chains):** In a chain A → B → C → D, timeouts must be **budgeted** so inner calls time out *before* outer ones. If A gives B 10 s, B must give C *less* (say 8 s), C gives D less still (6 s). Otherwise B is still waiting on C after A has already given up on B — wasted work on a request nobody's waiting for anymore. Propagate a **deadline** ("this request must complete by time T") down the chain so each hop knows how much time remains.

**Setting good timeout values:**
- Base them on the dependency's actual latency distribution — e.g., a bit above P99, not an arbitrary round number.
- Too short → false failures (killing requests that would've succeeded), wasted retries.
- Too long → resources tied up, slow failure detection.
- Different operations need different timeouts (a cache lookup: milliseconds; a report generation: much longer).

**Combine with:** **Retries** ([Q87](#q87-what-are-retries-and-why-can-they-be-dangerous)) (retry after a timeout, with backoff) and **circuit breakers** ([Q86](#q86-what-is-a-circuit-breaker)) (stop calling a consistently-timing-out dependency). Timeouts + retries + circuit breakers form the core trio of call-level resilience.

---

### Q90. Health checks — telling the system what's alive

**What it is:** A periodic probe that lets orchestrators (load balancers, Kubernetes, service discovery) determine whether an instance is healthy and should receive traffic. Unhealthy instances are removed from rotation (and often restarted), so failures are handled automatically.

**Two distinct kinds (a critical distinction):**
- **Liveness probe:** "Is the process alive / not deadlocked?" If it *fails*, the orchestrator **restarts** the instance. Answers "should I kill and replace this?"
- **Readiness probe:** "Is the instance *ready* to serve requests right now?" If it fails, the orchestrator **removes it from the load balancer** (stops sending traffic) but does **not** kill it — it may just be warming up, loading data, or temporarily unable to reach a dependency. Answers "should I send traffic here?"

Confusing these causes real bugs: e.g., using a liveness check that fails when a *downstream* is down → the orchestrator restarts healthy instances in a loop, making things worse. A downstream outage should fail *readiness* (stop traffic), not *liveness* (restart).

**Shallow vs deep health checks:**
- **Shallow:** "Is the process responding on its port?" (e.g., returns `200 OK`). Cheap, but can report healthy while the app is actually broken (can't reach its DB).
- **Deep:** verifies real dependencies — "Can I reach the database? Is the cache responsive? Are critical resources OK?" More accurate, but risky: if a *shared* dependency (like the DB) is down, deep checks can mark *every* instance unhealthy at once → the LB has nowhere to route → total outage. So deep checks need care (e.g., distinguish "I'm broken" from "a shared dependency is down that removing me won't fix").

**Best practices:**
- Use **liveness** for "am I fundamentally broken (deadlocked)?" and **readiness** for "can I serve right now?"
- Include a brief **startup** grace period (or startup probe) so slow-booting apps aren't killed before they're ready.
- Make readiness reflect the ability to actually serve (dependencies available, warmed up), but avoid failing *all* instances simultaneously for a shared-dependency blip.
- **Graceful shutdown:** on termination, fail readiness first (drain traffic) *then* stop, so in-flight requests complete.

**Why it matters:** Health checks are what make **automated failover and self-healing** work — the mechanism by which load balancers route around dead instances ([Q21](part-2-components.md)) and orchestrators replace failed ones, without human intervention.

---

### Q91. Failover vs failback

**Failover:** The process of **automatically switching to a redundant/standby component** when the primary fails, so the system keeps running. Examples:
- A database **primary** dies → a **replica is promoted** to primary ([Q48](part-3-databases.md)).
- A **region** goes down → traffic shifts to another region ([Q71](part-4-scalability-growth.md)).
- An instance fails its health check → the LB routes to healthy instances ([Q90](#q90-what-is-a-health-check)).

Failover is the payoff of all your **redundancy** ([Q14](part-1-fundamentals.md)) — redundancy provides the backup; failover is the act of switching to it. Speed matters: failover time (detection + switching) is downtime, so it should be fast and, ideally, automatic.

**Failback:** The process of **returning to the original (now-recovered) component** after it's healthy again. E.g., the original primary DB recovers → you promote it back (or make it primary again) and demote the temporary one.
- Failback is often **more delicate** than failover: you must ensure the recovered component is fully caught up (data re-synced) before switching back, and the switch itself causes a brief disruption. Many teams **don't rush** failback — they run on the failover target until a planned maintenance window, since the failover target is presumably working fine.

**Critical practice — TEST your failover (chaos testing):** The most important and most-neglected point. **Untested failover usually doesn't work when you actually need it** — the standby was misconfigured, replication was broken, DNS didn't update, the promotion script had a bug, permissions were wrong. Failover that's never exercised is a *false* sense of safety. So:
- **Regularly drill failover** — deliberately kill the primary and confirm the standby takes over correctly.
- **Practice regional failover** — periodically fail over an entire region.
- This is a core motivation for **chaos engineering** ([Q93](#q93-what-is-chaos-engineering)).

**Related concepts:**
- **RTO/RPO** ([Q92](#q92-what-are-rpo-and-rto)) quantify your failover/recovery targets.
- **Automatic vs manual failover:** automatic is faster (no human in the loop) but risks **split-brain** (two nodes both think they're primary — needs fencing/quorum to prevent); manual is safer against split-brain but slower.

---

### Q92. RPO and RTO — the two numbers that define disaster recovery

These two metrics quantify your disaster-recovery requirements and drive your backup/replication/failover design.

**RPO — Recovery Point Objective:** The **maximum acceptable amount of data loss**, measured in **time**. "How much recent data can we afford to lose?"
- RPO = 5 minutes → you can lose at most the last 5 minutes of data → you must back up / replicate **at least** every 5 minutes.
- RPO = 0 → you can lose *nothing* → requires **synchronous replication** (every write copied before acknowledging) — expensive, higher latency.
- RPO = 24 hours → nightly backups suffice — cheap.
- **RPO drives backup/replication *frequency* and *method*.**

**RTO — Recovery Time Objective:** The **maximum acceptable downtime** to recover after a failure, measured in **time**. "How long can we be down?"
- RTO = 1 minute → you need **automated, hot-standby failover** — no time for humans.
- RTO = 4 hours → you might have time to spin up infrastructure and restore from backup manually.
- RTO = 0 → requires fully redundant, always-running hot systems (active-active).
- **RTO drives failover *automation* and *architecture*.**

**A picture (timeline around a failure):**
```
   ...normal operation...  [last backup/replicated point]  ...  [FAILURE]  ...  [recovered & serving]
                            └──────── RPO ────────┘                    └──── RTO ────┘
                            (data lost = work since last safe point)   (downtime until recovered)
```
- **RPO** looks *backward* from the failure: how much data (in time) is lost.
- **RTO** looks *forward* from the failure: how long until you're running again.

**The cost trade-off:** Tighter objectives (lower RPO/RTO) cost exponentially more:
- Near-zero RPO → synchronous cross-region replication (expensive, adds latency).
- Near-zero RTO → hot standby / active-active (paying for duplicate running infrastructure).
- Loose objectives → nightly backups + manual restore (cheap, but hours of loss/downtime).

**How to set them:** From **business impact**, not gut feeling. A payment system: RPO and RTO near zero (any loss/downtime = lost money + trust). An internal analytics dashboard: RPO of hours, RTO of a day may be fine. Match spend to the actual cost of downtime and data loss for *that* system. Different components can have different RPO/RTO.

---

### Q93. Chaos engineering — proving resilience by breaking things on purpose

**What it is:** The practice of **deliberately injecting failures** into a system (often in production) to verify it withstands them — *before* a real incident does. Pioneered by Netflix with **Chaos Monkey**, which randomly terminates production instances during business hours to ensure the system tolerates instance loss.

**The core philosophy:** *You don't actually know your system is resilient until you've proven it under real failure conditions.* Redundancy, failover, retries, circuit breakers — all the resilience mechanisms — are just *theories* until tested. Systems are full of hidden assumptions and untested failure paths. Chaos engineering surfaces these weaknesses **on your terms** (controlled, during work hours, with engineers watching) rather than discovering them at 3 AM during a real outage.

**What you inject:**
- **Kill instances / processes** (Chaos Monkey) — does traffic reroute? Do replacements spin up?
- **Kill an entire zone or region** (Chaos Kong) — does regional failover work?
- **Inject latency** into network calls — do timeouts and circuit breakers kick in? Does backpressure hold?
- **Simulate dependency failures** — a database, cache, or downstream service goes down — does graceful degradation work?
- **Network partitions, packet loss, DNS failures, resource exhaustion** (CPU/memory/disk).
- **Clock skew, expired certificates** — subtle real-world failure modes.

**How to do it responsibly:**
1. **Form a hypothesis:** "If we kill an instance, traffic reroutes with no user impact." (Define the expected steady-state behavior.)
2. **Start small & controlled:** begin in staging or with a tiny production blast radius.
3. **Have a stop button:** be able to abort the experiment instantly.
4. **Monitor closely:** watch metrics/SLOs during the experiment.
5. **Minimize blast radius**, then gradually expand confidence.
6. **Learn and fix:** every weakness found is fixed, then re-tested.

**Why it matters:** It transforms resilience from *hope* ("failover should work") to *evidence* ("failover works — we test it weekly"). It's especially the way to validate **failover** ([Q91](#q91-what-is-failover-vs-failback)), redundancy, and graceful degradation, which are exactly the things that silently rot and fail when finally needed. Tools: Chaos Monkey / Simian Army, Gremlin, AWS Fault Injection Simulator, LitmusChaos.

---

### Q94. Observability and its three pillars

**What it is:** Observability is the ability to **understand a system's internal state from its external outputs** — to answer *arbitrary* questions about what's happening (and why) *without* shipping new code to add instrumentation. It's more than monitoring: monitoring tells you *whether* something is wrong (known failure modes, predefined dashboards/alerts); observability lets you explore *why* it's wrong, including for problems you never anticipated ("unknown unknowns"). Essential once systems are distributed and failures are novel and emergent.

**The three pillars:**

**1. Metrics — the "what" (aggregated numbers over time):**
- Numeric time-series: request rate, error rate, latency percentiles, CPU/memory, queue depth, cache hit rate.
- ✅ Cheap to store (aggregated), great for dashboards, trends, and **alerting** ("error rate > 1%").
- ❌ Aggregated → lack per-request detail; can tell you *that* latency spiked, not *which* requests or *why*.
- Tools: Prometheus, Grafana, Datadog, CloudWatch.

**2. Logs — the "details" (discrete event records):**
- Timestamped records of individual events: "user 123 placed order 456," errors with stack traces, audit trails.
- ✅ Rich, specific detail about individual events; invaluable for debugging specifics.
- ❌ High volume (expensive to store/search at scale); noisy; hard to see the big picture from raw logs.
- Best practice: **structured logging** (JSON with consistent fields) so logs are searchable/filterable, and include a **correlation/trace ID** to tie logs to a request.
- Tools: ELK/Elastic stack, Loki, Splunk, CloudWatch Logs.

**3. Traces — the "where" (end-to-end request flow across services):**
- A **distributed trace** follows a single request as it hops across multiple services, recording the time spent in each ("spans"). Shows the full path and where time went.
- ✅ Essential in **microservices** — reveals *which* service in a chain is slow or failing, and how services depend on each other. Answers "where did this request spend its 800 ms?"
- ❌ Requires instrumentation and context propagation (passing trace IDs across calls); sampling needed at high volume.
- Tools: Jaeger, Zipkin, Tempo, OpenTelemetry (the emerging standard for all three pillars).

**How they work together:** A metric alert fires (error rate up) → you find affected requests via **traces** (which service is failing) → you dig into the specific **logs** for that service/request to find the root cause. Metrics detect, traces localize, logs explain.

**Why invest early:** Debugging a distributed system without observability is nearly impossible — you're blind. Correlate the three with a shared **trace/request ID** so you can pivot between them. Instrument from the start; retrofitting observability during an incident is painful.

---

### Q95. RED and USE — two complementary monitoring frameworks

Two well-known methods that tell you *what* to measure, so you're not guessing which metrics matter.

**RED — for services / request-driven systems** (the *user-facing* view):
- **Rate** — requests per second the service is handling.
- **Errors** — number/rate of failed requests.
- **Duration** — distribution of request latencies (percentiles: P50/P90/P99).

RED answers **"are users being served well?"** These three, tracked per service/endpoint, tell you if a service is healthy from the *consumer's* perspective. Rising errors or duration, or abnormal rate (spike or drop), signals a problem users feel. Great default dashboard for every microservice.

**USE — for resources** (the *infrastructure* view):
- **Utilization** — % of time the resource is busy (CPU %, memory used, disk busy %).
- **Saturation** — how much extra work is *queued/waiting* because the resource is full (run queue length, swap usage, connection-pool wait). Saturation often predicts trouble before utilization hits 100%.
- **Errors** — error events for that resource (disk errors, dropped packets, failed allocations).

USE answers **"which resource is the bottleneck?"** Applied to every resource (CPUs, memory, disks, network interfaces, connection pools), it pinpoints *what* is constrained. (From Brendan Gregg.)

**How they complement each other:**
- **RED** = the *symptom* view — "users are experiencing high latency/errors" (top-down, from the service).
- **USE** = the *cause* view — "the database's disk is saturated / the connection pool is exhausted" (bottom-up, from resources).
- Workflow: RED tells you *something is wrong and users are affected*; USE helps you find *which resource is causing it*. Together they cover both "is the service healthy?" and "why is it unhealthy?"

**Practical use:** Put a **RED dashboard** on every service and a **USE dashboard** on every resource tier. Between them you cover the vast majority of operational monitoring needs without drowning in arbitrary metrics. (A related framework: Google SRE's **Four Golden Signals** = latency, traffic, errors, saturation — essentially RED + saturation.)

---

### Q96. SLA, SLO, SLI — measuring and promising reliability

Three related terms (often confused) that turn "reliability" into something concrete and measurable.

**SLI — Service Level Indicator:** A **measured metric** of some aspect of service quality. It's the actual number.
- Examples: "% of requests served in under 200 ms," "% of requests that succeed (non-5xx)," "% uptime."
- The SLI is what you *measure*. It should reflect the *user experience* (e.g., request success rate and latency), not internal trivia.

**SLO — Service Level Objective:** Your **internal target** for an SLI — the goal you aim to meet.
- Examples: "99.9% of requests succeed," "99% of requests complete under 200 ms," "99.95% monthly uptime."
- The SLO is the *threshold* that defines "good enough." It's a business/engineering decision about how reliable the service *should* be. You set SLOs, then track your SLIs against them.

**SLA — Service Level Agreement:** A **contractual promise** to customers about service levels, usually with **financial penalties** (refunds/credits) if breached.
- Example: "We guarantee 99.9% uptime; if we fall below, you get a 10% credit."
- The SLA is *external* and *legally/commercially binding*. Not all services have SLAs, but internal services should still have SLOs.

**The relationship & a key practice:**
```
SLI (what you measure)  →  SLO (your internal target)  →  SLA (your external promise)
```
- **Set SLOs *stricter* than SLAs.** If you promise customers 99.9% (SLA), target 99.95% internally (SLO). This buffer means you get alerted and fix problems *before* you breach the contractual SLA. Never set your internal goal equal to your external promise.

**The Error Budget — the most useful concept here:**
- If your SLO is 99.9% availability, then **0.1% is your "error budget"** — the amount of failure you're *allowed* per period (~43 minutes/month).
- The error budget reframes reliability as a *resource to spend*:
  - **Budget remaining?** You can take risks — ship features faster, do risky deploys, run chaos experiments.
  - **Budget exhausted (too many incidents)?** Freeze risky changes; focus on reliability until you're back within SLO.
- This elegantly **balances reliability vs feature velocity** — the eternal tension between dev (ship fast) and ops (stay stable). Instead of arguing, both sides agree on the SLO and let the error budget arbitrate. (Core to Google's SRE practice.)

**Why it matters:** SLIs/SLOs make reliability *objective and data-driven* rather than a vague aspiration. They tell you what "reliable enough" means, when to invest in reliability vs features, and — via alerting on **error-budget burn rate** — when to worry. Set alerts on burn rate, not just raw thresholds.

---

### Q97. Horizontal vs vertical partitioning (in practice)

Two ways to split data — they solve *different* problems and are often used together. (Complements sharding, [Q50](part-3-databases.md).)

**Horizontal partitioning (= sharding):** Split the **rows** of a table across multiple databases/nodes; each holds the *same columns* but a *different subset of rows*.
- Users 1–1M on shard A, 1M–2M on shard B, etc.
- **Solves:** too much *data volume* or *write/throughput* for one machine. Each shard handles a slice of the rows and traffic.
- **Scales:** total data size and write throughput (add shards → more capacity).
- **Challenge:** cross-shard queries/joins, shard-key choice, rebalancing, hotspots ([Q51](part-3-databases.md)–[Q53](part-3-databases.md), [Q78](part-4-scalability-growth.md)).

**Vertical partitioning:** Split the **columns** (or whole tables) across different databases/stores; each holds a *different subset of columns/tables* for the *same* entities.
- E.g., keep hot, frequently-accessed columns (`user_id`, `name`, `email`) in one store, and cold/large columns (`bio`, `profile_photo`, `preferences_blob`) in another. Or split by domain: `orders` tables on one DB, `inventory` tables on another.
- **Solves:** different columns/tables having different access patterns, sizes, or scaling needs; separating hot from cold data; isolating domains.
- **Scales:** by reducing the size/load of each store and letting each be optimized/scaled independently.
- **Often a stepping stone to microservices** — vertically partitioning by domain (each service owns its own tables/database) is exactly the "database per service" pattern ([Q38](part-2-components.md)).

**A memory aid:**
- **Horizontal** = cut the table with a **horizontal line** → groups of *rows* go to different places.
- **Vertical** = cut the table with a **vertical line** → groups of *columns/tables* go to different places.

**Used together at scale:** A large system might vertically partition by domain (orders DB, users DB, inventory DB — each owned by a service), *and* horizontally shard the ones that individually outgrow a single machine (the users DB is itself sharded across 20 nodes). They're orthogonal tools addressing different scaling dimensions (data *width/domain* vs data *volume*).

---

### Q98. Cell-based (bulkhead) architecture — limiting the blast radius

**The concept:** Partition the entire system into multiple **isolated, self-contained "cells,"** each a complete, independent stack (compute + data + dependencies) that serves a **subset of users/traffic**. Cells don't share state and are isolated from each other, so a failure — or a bad deploy, or a poison-pill request — in one cell **cannot spread** to the others. It affects only that cell's slice of users.

**The name "bulkhead"** comes from ships: a hull is divided into watertight compartments (bulkheads) so that if one is breached and floods, the others stay dry and the ship stays afloat. Cells are software bulkheads — contain the flooding.

**Why it's powerful — blast radius reduction:** In a monolithic (single-cell) system, a catastrophic failure (a bug, a resource exhaustion, a corrupt cache, a bad config push) can take down **100%** of users. With, say, 10 cells, that same failure takes down at most **~10%** — the affected cell — while the other 90% keep working. You trade a small chance of *total* outage for a higher chance of *partial* outage. For high-availability systems, that's a great trade.

**Additional benefits:**
- **Safer deployments:** roll out a change to **one cell first** (a "canary cell"); if it breaks, only that cell's users are affected. Then progressively roll to more cells ([Q99](#q99-what-is-blue-green-vs-canary-deployment)). 
- **Scaling:** add capacity by adding *cells* (a well-understood, repeatable unit) rather than scaling one giant shared system.
- **Fault isolation:** a "noisy neighbor" or a resource-hogging tenant in one cell can't degrade others.
- **Predictable capacity:** each cell has a known capacity; you scale by cell count.

**Costs & challenges:**
- **Routing complexity:** you need a routing layer to consistently map each user/request to its cell (and keep them there).
- **Operational overhead:** many cells to deploy, monitor, and manage (automation is essential).
- **Cross-cell operations** (e.g., a user in cell 3 interacting with one in cell 7) are harder — cells work best when users are naturally partitionable.
- **Resource overhead:** some duplication of infrastructure per cell.

**When to use it:** At **very large scale** where extreme availability is required and the cost of a *total* outage is unacceptable. Used by AWS and other hyperscalers for their most critical services. **Advanced** — it's a Stage-5 ([Q71](part-4-scalability-growth.md)), hyperscale pattern; overkill for most systems, but the *principle* of bulkheading (isolating failures) applies more broadly (e.g., separate thread pools per dependency so one slow dependency can't exhaust all threads).

---

### Q99. Blue-green vs canary deployment — shipping changes safely

Both are strategies to deploy new versions with **minimal risk and easy rollback**, avoiding the danger of a "big-bang" deploy that swaps everything at once (where a bad release breaks everyone with no quick way back).

**Blue-Green Deployment:**
- Maintain **two identical production environments**: **Blue** (current, live) and **Green** (new version).
- Deploy and fully test the new version on **Green** while **Blue** still serves all live traffic.
- When Green is verified, **switch all traffic** from Blue to Green at once (e.g., flip the load balancer / DNS).
- **Green is now live**; keep Blue idle as an instant rollback target.
- ✅ **Instant switchover** and **instant rollback** (just switch back to Blue if Green misbehaves). Zero-downtime. Clean separation (you test Green fully before any user hits it).
- ❌ **Expensive** — you run *two full environments* (double the infrastructure during deploys). And the cutover is **all-or-nothing** — if Green has a subtle bug that only shows under real traffic, *all* users hit it at once (though rollback is fast).

**Canary Deployment:**
- Roll out the new version to a **small percentage** of traffic/servers first (the "canary" — named after canaries in coal mines that warned of danger).
- **Monitor** the canary's metrics (errors, latency, business KPIs) closely. 
- If healthy, **gradually increase** the percentage (5% → 25% → 50% → 100%), watching at each step.
- If problems appear, **route traffic away** from the canary (roll back) — only the small canary slice was affected.
- ✅ **Limits blast radius** — a bad release impacts only a small fraction of users, not everyone. **Catches issues early** under real production traffic. Gradual, data-driven confidence.
- ❌ **Slower** (progressive rollout takes time). More complex (needs fine-grained traffic control + good monitoring/automation to compare canary vs baseline). Two versions run **simultaneously**, which requires backward compatibility (esp. for database schema changes).

**How to choose:**
- **Blue-green** when you want a **clean, instant cutover and rollback**, can afford duplicate environments, and prefer testing the new version fully *before* any real traffic hits it. Great for changes hard to partially roll out.
- **Canary** when you want to **limit the blast radius** and validate under *real* traffic gradually — ideal for high-traffic services where "test in staging" can't catch everything, and you want to fail small.
- They're **not mutually exclusive** — you can do blue-green *with* a canary phase (shift a small % to Green first, then the rest).

**Related strategies:**
- **Rolling deployment:** update instances in batches (a few at a time) until all are on the new version — no duplicate environment, but rollback is slower and mixed versions run during the roll.
- **Feature flags:** deploy code "dark" (disabled) and enable features gradually/independently of deploys — decouples *deploy* from *release*, enabling instant on/off and per-user targeting.

**The common goal:** All of these reduce deployment risk. Both beat big-bang deploys because they either (a) let you switch back instantly (blue-green) or (b) limit how many users a bad release can hurt (canary/rolling). Combined with good monitoring and automated rollback, they make frequent, safe deployment possible.

---

### Q100. The single most important principle of system design

**The principle:** **Design for your *actual* requirements, make trade-offs explicit, and evolve the system as those requirements change.** There is no universally "correct" or "best" architecture — only architectures that are *appropriate* for a specific scale, budget, team, and set of non-functional requirements.

**Everything in this guide reduces to this. Unpacking it:**

**1. There is no "best," only "appropriate."** The right design for 1,000 users (a single server) is *wrong* for 100 million, and the design for 100 million (multi-region, sharded, microservices) is *absurdly wrong* for 1,000. Anyone who gives you a fixed "correct" architecture without asking about your requirements is doing it wrong. The answer is always **"it depends"** — and *what it depends on* is the requirements and trade-offs.

**2. Everything is a trade-off.** Strong consistency ↔ availability/latency ([CAP](part-1-fundamentals.md)). Read speed ↔ write speed/complexity (denormalization, indexes). Simplicity ↔ scalability. Cost ↔ reliability (redundancy). More reliability ↔ slower feature delivery (error budgets). A senior engineer doesn't seek a magic answer with no downsides — they identify the trade-offs, weigh them *against the actual requirements*, and choose consciously. **Make the trade-offs explicit** so everyone understands what's being gained and given up.

**3. Start simple; add complexity only when data demands it.** This is the recurring theme of Part 4. Begin with the simplest thing that works (a monolith + one database). **Measure relentlessly** (observability, [Q94](#q94-what-is-observability-and-its-three-pillars)). Add each component — cache, replicas, queues, shards, services, regions — only when a **measured bottleneck** or a **concrete need** requires it ([Q72](part-4-scalability-growth.md)). Let evidence, not fashion or resume-building, drive every addition.

**4. Premature scaling is as harmful as ignoring scale.** Two symmetric failure modes:
- **Ignoring scale:** building something that collapses the moment it succeeds (no path to grow).
- **Premature scaling / over-engineering:** building a complex distributed system for users you don't have — wasting time, money, and velocity, and drowning a small team in operational complexity, often *causing* the failure to reach scale in the first place. **The more common and more insidious mistake.** Most products die from *lack of users*, not from scaling problems.

**5. Knowing what to leave out is as important as knowing what to put in.** The mark of experience isn't listing every fancy component — it's the judgment to say "we don't need that *yet*," to defer complexity, and to keep the system as simple as the requirements allow. Simplicity is a feature: simpler systems are easier to understand, operate, debug, and evolve.

**The distilled mantra:**
> **Understand the requirements. Make trade-offs explicit. Start simple. Measure. Scale when the data says to — not before. Know what to leave out.**

Master *this* mindset, and the individual patterns (caching, sharding, queues, circuit breakers, and the other 99 answers) become tools you deploy with judgment — rather than a checklist you apply blindly. That judgment — matching the solution to the real problem — *is* system design.

---

[← Part 4](part-4-scalability-growth.md) | [Index](README.md)

## 🎉 You've reached the end

**How to keep learning:**
- **Apply it:** design real systems using these building blocks — URL shortener, Twitter/feed, chat, rate limiter, TinyURL, Uber, Netflix, a payment system. For each: start with requirements → back-of-envelope estimates → high-level design → deep-dive on bottlenecks → discuss trade-offs.
- **Reason about trade-offs**, don't memorize. For any choice, be able to say *why*, what you're giving up, and when you'd choose differently.
- **Revisit Part 4** whenever you think about growth — it maps every technique to the stage where it earns its place.
- **Remember the meta-lesson ([Q100](#q100-what-is-the-most-important-overall-principle-of-system-design)):** start simple, measure, and add complexity only when the data demands it.
