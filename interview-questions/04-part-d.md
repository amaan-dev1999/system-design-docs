# Part D — Questions 16–20

---

# 16. Distributed Message Queue (Kafka-like)

**Problem:** Design a durable, scalable message queue/streaming platform that decouples producers from consumers.

## 1. Functional Requirements
- **Produce** messages to a topic.
- **Consume** messages from a topic (one or many independent consumers).
- **Durability:** messages persist and aren't lost.
- **Ordering** (at least within a partition).
- *Out of scope:* stream processing/SQL layer.

## 2. Non-Functional Requirements
- **High throughput:** millions of messages/sec.
- **Durability:** persisted, replicated; survive broker failure.
- **Scalability:** add brokers/partitions to grow.
- **Delivery semantics:** at-least-once (configurable toward exactly-once).
- **Low latency** for real-time consumers.

## 3. Core Entities
- **Topic** (a named stream), **Partition** (ordered, append-only log; unit of parallelism), **Message/Record** (`offset`, `key`, `value`, `timestamp`), **Broker** (server holding partitions), **Consumer Group** (set of consumers sharing a subscription), **Offset** (a consumer's position).

## 4. The API
```
produce(topic, key, value)          → appended to a partition
subscribe(topic, consumerGroup)
poll() → records
commit(offset)                      → mark progress
```

## 5. High-Level Design
```
Producers → (partition by key) → Brokers [Partition = append-only log on disk]
                                     │  replicated to follower brokers
Consumers (in groups) → poll partitions → track offsets
```
- **The log abstraction:** each partition is an **append-only, ordered log** persisted to disk. Producers append; consumers read sequentially by **offset**. Retention keeps messages for a configured time (enabling replay).
- **Partitioning** gives parallelism and ordering-within-partition; **consumer groups** split partitions among consumers (queue-like) while different groups each get all messages (pub/sub).
- **Replication** across brokers gives durability and failover.

## 6. Potential Deep Dives
- **Durability & replication:** each partition has a **leader** + follower replicas. Producers write to the leader; followers replicate. A write is acknowledged after reaching the leader (and optionally a quorum of replicas — tunable `acks`). On leader failure, a follower is promoted (in-sync replica set).
- **Ordering:** guaranteed **within a partition** only. To keep related messages ordered, produce them with the same **key** (same key → same partition). Global ordering across partitions isn't provided (it would kill scalability).
- **Delivery semantics:** at-least-once (consumer commits offset after processing → crash before commit = reprocessing); exactly-once via idempotent producers + transactional writes. Consumers should be **idempotent**.
- **High throughput tricks:** sequential disk I/O (append-only log is fast), zero-copy transfer, batching, and compression.
- **Scaling:** add partitions for more parallelism (but repartitioning changes key→partition mapping); add brokers to spread partitions. Offsets stored durably (in a special topic).
- **Backpressure/retention:** consumers read at their own pace; slow consumers just lag (bounded by retention), not block producers.

## 7. Trade-offs
- **Ordering vs scalability:** ordering only within a partition is the price of horizontal scale; global ordering would serialize everything.
- **Latency vs durability (acks):** `acks=all` (wait for replicas) is durable but slower; `acks=1` is faster but can lose data on leader failure.
- **At-least-once vs exactly-once:** exactly-once adds overhead/complexity; at-least-once + idempotent consumers is the common pragmatic choice.
- **Retention (storage) vs replay ability:** longer retention enables replay/new consumers but costs disk.

## AWS Well-Architected Assessment
- **Operational Excellence:** managed MSK/Kinesis reduces broker ops; CloudWatch on consumer lag, throughput, under-replicated partitions; IaC.
- **Security:** TLS + SASL/IAM auth; encryption at rest; ACLs per topic; VPC isolation; least-privilege.
- **Reliability:** replication across AZs + ISR; leader failover; durable persisted offsets; no message loss with `acks=all`.
- **Performance Efficiency:** partition-level parallelism; sequential I/O + batching; scale partitions/brokers to load.
- **Cost Optimization:** right-size retention and partitions; tiered storage for older log segments; scale brokers to throughput.
- **Sustainability:** efficient sequential I/O and batching; retention tuned to need (avoid storing unused data); autoscale to real throughput.

---

# 17. Leaderboard / Ranking System

**Problem:** Design a real-time leaderboard showing top players (and a player's rank) for a game with millions of players.

## 1. Functional Requirements
- **Update a player's score.**
- **Get top-K** players.
- **Get a player's rank** (and nearby players).
- **Time-based boards** (daily/weekly) (mention).
- *Out of scope:* anti-cheat, matchmaking.

## 2. Non-Functional Requirements
- **Low latency** reads/writes (real-time updates).
- **Scale:** millions of players; frequent score updates.
- **Accuracy:** ranks should be correct/consistent.
- **High availability.**

## 3. Core Entities
- **Player** (`playerId`, `name`), **Score** (`playerId`, `score`, `updatedAt`), **Leaderboard** (a ranked set, possibly per-time-window/region).

## 4. The API
```
POST /scores            → { playerId, score } (update)
GET  /leaderboard/top?k= → top-K players
GET  /leaderboard/rank/{playerId} → rank + surrounding players
```

## 5. High-Level Design
```
Client → Leaderboard Service → Redis Sorted Set (ZADD/ZREVRANGE/ZRANK)
                                     │
                                     └→ Durable DB (source of truth for scores)
```
- **Redis Sorted Set (ZSET)** is the ideal primitive: it keeps members ordered by score with O(log N) inserts and O(log N + K) range reads.
  - `ZADD board score player` → update score.
  - `ZREVRANGE board 0 K-1` → top-K.
  - `ZREVRANK board player` → a player's rank.
- Persist scores to a **durable DB** as the source of truth; Redis serves the fast ranking.

## 6. Potential Deep Dives
- **Why sorted sets:** they solve top-K and rank queries in log time — a relational `ORDER BY score` + `COUNT` for rank is O(N) and far too slow at scale. This data-structure choice *is* the design.
- **Scaling beyond one node:** a huge leaderboard may exceed one Redis node.
  - *Sharding:* partition players across shards, keep per-shard top-K, and merge for the global top-K. Global exact **rank** across shards is harder → approximate (bucketed) rank, or a two-level structure.
  - *Replication* for read scaling/availability.
- **Time-based boards:** separate sorted sets per window (daily/weekly) with TTL; roll over at boundaries.
- **Consistency & durability:** Redis is fast but volatile → write scores to a durable store too; on Redis failure, rebuild the sorted set from the DB.
- **Hot updates:** extremely frequent updates for top players → batching/throttling; Redis handles high write rates well.
- **Rank of a specific player at massive scale:** exact rank is expensive when sharded → use **percentile/bucketed rank** approximations for "you're in the top 5%".

## 7. Trade-offs
- **Redis (in-memory) vs durable DB alone:** Redis gives the needed latency but is volatile → pair with a durable store (extra write). Correct trade for real-time ranking.
- **Exact vs approximate rank at scale:** exact global rank across shards is costly; approximate rank is fast and usually good enough.
- **Single node (simple, exact) vs sharded (scalable, approximate):** choose based on player count.

## AWS Well-Architected Assessment
- **Operational Excellence:** ElastiCache (Redis) managed; CloudWatch on update/read latency; DB as recoverable source of truth; IaC.
- **Security:** authN on score submission (prevent spoofing); server-side score validation (anti-cheat hook); TLS; least-privilege.
- **Reliability:** Redis multi-AZ replicas; rebuild sorted set from durable DB after failure; no single point of data loss.
- **Performance Efficiency:** sorted sets for O(log N) ops; sharding for scale; replicas for read throughput.
- **Cost Optimization:** in-memory only for the ranking structure (compact); durable DB for cold storage; right-size Redis; TTL time-based boards.
- **Sustainability:** efficient data structures avoid O(N) scans; autoscale to player activity; expire old boards.

---

# 18. Payment System / Digital Wallet

**Problem:** Design a system to process payments and manage account balances correctly, with no lost or duplicated money.

## 1. Functional Requirements
- **Make a payment / transfer** between accounts.
- **Maintain balances** accurately.
- **Transaction history / ledger.**
- **Idempotent** payment requests (safe retries).
- *Out of scope:* fraud ML, currency conversion details.

## 2. Non-Functional Requirements
- **Strong consistency & correctness:** money must never be lost, created, or double-spent — the absolute priority.
- **Durability & auditability:** every transaction permanently recorded.
- **Exactly-once effect** (via idempotency).
- **Availability**, but **correctness > availability** here.
- **Security/compliance** (PCI-DSS).

## 3. Core Entities
- **Account** (`accountId`, `balance`), **Transaction** (`txnId`, `from`, `to`, `amount`, `status`, `idempotencyKey`), **Ledger Entry** (immutable double-entry records), **Payment** (external gateway interaction).

## 4. The API
```
POST /payments   → { fromAccount, toAccount, amount, idempotencyKey } → { txnId, status }
GET  /payments/{txnId}
GET  /accounts/{id}/transactions
```

## 5. High-Level Design
```
Client → Payment Service → (idempotency check) → ACID DB (accounts + double-entry ledger)
                               │
                               └→ External Payment Gateway (for card/bank rails)
                               └→ Event stream (async: notifications, analytics, reconciliation)
```
- **ACID transactions** update balances and write **ledger** entries atomically (debit one account, credit another — double-entry) so the books always balance.
- **Idempotency keys** ensure a retried request doesn't process twice.
- **Double-entry ledger** (immutable append-only records) is the auditable source of truth; balances can be derived/validated from it.

## 6. Potential Deep Dives
- **Idempotency (critical):** the client sends a unique `idempotencyKey`; the server records processed keys and returns the original result on retry → **exactly-once effect** despite network retries. Prevents double charges.
- **Consistency for balances:** use an **ACID database** with transactions (and appropriate isolation) so concurrent transfers can't overspend. For distributed accounts/services, avoid unsafe dual writes — use the **Saga pattern** with compensating actions, or a transactional outbox, for cross-service payments.
- **Double-entry ledger:** every transaction writes balanced debit/credit entries; the ledger is **append-only and immutable** (never update/delete) → full audit trail and easy reconciliation.
- **External gateway integration:** calling card networks/banks is asynchronous and can fail/time out → track payment state machine (pending→authorized→captured→settled/failed); reconcile with the provider; retry safely (idempotent).
- **Exactly-once with external systems:** combine idempotency keys, a state machine, and reconciliation jobs to detect/heal discrepancies.
- **Security/compliance:** never store raw card data (tokenize via PCI-compliant vault); encrypt everything; strict access controls and audit logs.

## 7. Trade-offs
- **Consistency vs availability/scale:** payments choose **strong consistency** (ACID) over scale — correctness is non-negotiable. Scale reads (history) separately.
- **Sync vs async settlement:** authorize synchronously for UX; settle asynchronously (with reconciliation) since external rails are slow.
- **Saga vs 2PC for distributed payments:** 2PC's locking hurts availability; sagas (eventual consistency + compensation) are preferred, at the cost of more complex failure handling.
- **Ledger immutability (storage) vs simplicity:** an append-only ledger costs storage but is essential for auditability/correctness.

## AWS Well-Architected Assessment
- **Operational Excellence:** ACID DB (Aurora); reconciliation jobs; detailed audit logging; CloudWatch alarms on failed/stuck payments; game days; IaC.
- **Security:** PCI-DSS scope minimization (tokenization/vault); encryption at rest/in transit; strict least-privilege + separation of duties; immutable audit logs; secrets in Secrets Manager. **Highest-priority pillar here.**
- **Reliability:** multi-AZ Aurora; idempotency prevents duplicates; sagas + reconciliation heal partial failures; durable ledger; defined RPO≈0.
- **Performance Efficiency:** strong-consistency core kept lean; async offload of non-critical work (notifications, analytics); scale the read/history path with replicas/cache.
- **Cost Optimization:** reserve strong-consistency resources only for the money path; async/batch the rest; right-size; avoid over-scaling the low-QPS write core.
- **Sustainability:** efficient transactional core (no wasteful polling); async batching; right-sized durable storage; archive old ledger data to cold tiers.

---

# 19. Key-Value Store (DynamoDB / Cassandra-like)

**Problem:** Design a distributed, highly available key-value store that scales horizontally.

## 1. Functional Requirements
- **put(key, value), get(key), delete(key).**
- **Horizontal scalability** (add nodes for capacity/throughput).
- **High availability** (survive node/AZ failures).
- **Tunable consistency.**

## 2. Non-Functional Requirements
- **High availability** (often AP — always writable).
- **Scalability:** near-linear with nodes.
- **Low latency** at scale.
- **Durability:** replicated, no data loss.
- **Partition tolerance** (it's distributed).

## 3. Core Entities
- **Key/Value pair**, **Node** (owns partitions), **Partition** (key range/hash bucket), **Replica** (copy of a partition), **Ring** (consistent-hash topology), **Version** (vector clock / timestamp).

## 4. The API
```
put(key, value, [consistencyLevel])
get(key, [consistencyLevel]) → value(s)
delete(key)
```

## 5. High-Level Design
```
Client → (coordinator node) → consistent hash(key) → N replica nodes
                                   write to W replicas / read from R replicas (quorum)
```
- **Partitioning via consistent hashing** distributes keys across nodes with minimal remapping when nodes change (virtual nodes for balance).
- **Replication:** each key is stored on **N** nodes (the next N on the ring). 
- **Tunable consistency via quorums:** a write succeeds on **W** replicas, a read queries **R** replicas; if **W + R > N**, reads see the latest write (strong-ish). Tune W/R for latency vs consistency.
- **Leaderless** design (Dynamo-style): any replica can take writes → high availability.

## 6. Potential Deep Dives
- **Consistent hashing + virtual nodes:** even key distribution and smooth rebalancing when nodes join/leave (only ~1/N keys move). Foundational for horizontal scale.
- **Replication & quorums (N/W/R):** `W + R > N` → strong consistency; `W + R ≤ N` → faster but eventually consistent. E.g., N=3, W=2, R=2 balances both. Availability: writes succeed as long as W replicas are up.
- **Conflict resolution:** with leaderless writes, concurrent updates conflict → detect with **vector clocks** (or version numbers); resolve by last-write-wins or application merge (e.g., merge shopping carts). Read-repair and anti-entropy (Merkle trees) reconcile divergent replicas.
- **Handling failures:** **hinted handoff** — if a replica is down, another node temporarily stores the write and forwards it later, preserving availability and durability.
- **Storage engine:** LSM-tree (memtable + SSTables + commit log) for high write throughput (Cassandra) — sequential writes, background compaction.
- **Gossip protocol:** nodes share membership/health info peer-to-peer (no central coordinator) → decentralized, no SPOF.

## 7. Trade-offs
- **Consistency vs availability/latency (CAP/PACELC):** tunable via N/W/R — the core trade. AP by default (available, eventually consistent); can lean CP with higher quorums.
- **Leaderless (highly available, conflict resolution needed) vs leader-based (simpler consistency, failover downtime).**
- **LWW (simple, may lose writes) vs vector clocks (accurate, complex).**
- **Read-repair/anti-entropy overhead** vs consistency — background reconciliation costs resources.

## AWS Well-Architected Assessment
- **Operational Excellence:** DynamoDB (fully managed) removes most ops; CloudWatch on latency, throttling, replication; IaC. (Cassandra self-managed = more ops via Keyspaces alternative.)
- **Security:** encryption at rest/in transit; fine-grained IAM; VPC endpoints; least-privilege.
- **Reliability:** replication across AZs/regions (global tables); leaderless design + hinted handoff = high availability; no SPOF (gossip, no central master); tunable durability.
- **Performance Efficiency:** consistent hashing for even load; LSM for write-heavy workloads; quorum tuning for latency; single-digit-ms reads.
- **Cost Optimization:** on-demand/auto-scaling capacity; tiered storage; tune replication factor to durability needs; avoid over-replication.
- **Sustainability:** near-linear scaling avoids over-provisioning; efficient LSM writes; autoscale to demand; multi-tenant managed service improves utilization.

---

# 20. DoorDash / Food Delivery

**Problem:** Design a food-delivery platform connecting customers, restaurants, and delivery drivers.

## 1. Functional Requirements
- **Browse restaurants/menus** near the customer.
- **Place an order.**
- **Restaurant accepts & prepares.**
- **Match a driver** to pick up and deliver.
- **Real-time tracking** of the order/driver.
- *Out of scope:* payments (Q18), reviews.

## 2. Non-Functional Requirements
- **Three-sided marketplace** (customers, restaurants, drivers) — all real-time.
- **Geospatial:** nearby restaurants and driver matching.
- **Low latency** browsing + real-time tracking.
- **Reliability:** orders must not be lost; consistent order state.
- **Scale:** millions of orders/day, spiky (meal times).

## 3. Core Entities
- **Customer, Restaurant** (`id`, `location`, `menu`, `status`), **Order** (`orderId`, `items`, `status`, `customerId`, `restaurantId`, `driverId`), **Driver** (`id`, `location`, `status`), **Delivery** (pickup→dropoff).

## 4. The API
```
GET  /restaurants?near=lat,lng      → nearby restaurants
POST /orders                        → { restaurantId, items } → { orderId }
PATCH /orders/{id}/status           → restaurant/driver update state
POST /drivers/location              → driver location pings
WebSocket                           → live order/driver tracking
```

## 5. High-Level Design
```
Browse:   Client → Restaurant Service → Geospatial index (nearby) + Menu DB (+ cache/CDN)
Order:    Client → Order Service → Order DB (state machine) → notify restaurant
Dispatch: Order → Dispatch/Matching Service → Driver location index → assign driver
Track:    All parties ⇄ WebSocket gateway ⇄ live location/status updates
```
- **Order as a state machine:** placed → accepted → preparing → ready → picked-up → delivered. The **Order Service** owns this lifecycle reliably.
- **Geospatial** powers both nearby-restaurant browsing and driver matching (like Uber, Q10).
- **Real-time tracking** over WebSockets to customer, restaurant, and driver.
- **Async events** (Kafka) coordinate the three parties and downstream work (notifications, ETAs, analytics).

## 6. Potential Deep Dives
- **Driver matching & dispatch:** find available drivers near the restaurant (geospatial index), optimize assignment (proximity, current load, batching multiple orders on one route). This is a real-time optimization problem; start with nearest-available, evolve to batched routing.
- **Order state consistency:** the order lifecycle must be reliable and consistent across three parties → an authoritative Order Service with a clear state machine; use events to propagate transitions; idempotent updates (retries mustn't skip/duplicate states).
- **Geospatial at scale:** geohash/quadtree for restaurants (mostly static) and drivers (high-frequency updates → in-memory like Uber). Shard by region/city (natural geo-partitioning).
- **ETA prediction:** combine prep time + driver travel time (traffic) → ML/heuristics; update in real time.
- **Spiky load:** lunch/dinner peaks → autoscale; queue order events to absorb bursts; cache menus/restaurant data (CDN) since browsing dominates reads.
- **Real-time connections:** WebSocket gateway + session registry (like chat, Q5).

## 7. Trade-offs
- **Strong consistency for order state vs eventual for tracking:** order lifecycle needs consistency (don't lose/duplicate orders); live location can be eventually consistent/best-effort.
- **Matching optimality vs latency:** globally optimal dispatch (batching, routing) is expensive; a fast nearest-driver match is responsive — evolve from simple to optimized.
- **Monolith vs microservices:** three-sided domain naturally splits (restaurant, order, dispatch, driver services) — but adds distributed complexity; justified at this scale.
- **Caching menus (stale risk) vs freshness:** cache heavily for browse performance, invalidate on menu/price changes.

## AWS Well-Architected Assessment
- **Operational Excellence:** microservices with clear ownership; Kafka/MSK for event coordination; CloudWatch on order latency, match time, delivery SLAs; IaC; regional deploys.
- **Security:** authN/authZ per party (customer/restaurant/driver); protect location/PII; least-privilege; secure payment handoff (Q18); audit order changes.
- **Reliability:** durable Order DB + event log; idempotent state transitions; multi-AZ; regional isolation limits outage blast radius; graceful degradation (stale ETAs if traffic stream lags).
- **Performance Efficiency:** geospatial indexes; in-memory driver locations; CDN/cache for menus; async events for coordination; WebSockets for tracking.
- **Cost Optimization:** autoscale to meal-time peaks then down; cache-heavy browse path; in-memory only for ephemeral driver location; Spot for batch/analytics.
- **Sustainability:** geo-partitioning avoids global scans; batched deliveries cut driver miles; autoscaling to demand peaks; caching reduces recompute; efficient location pings.

---

## Closing note

Every design above used the same discipline: **clarify requirements → size the system → model the data → define the API → design the architecture → deep-dive the hard parts → own the trade-offs → validate against the AWS Well-Architected pillars.** In an interview, this *process* — not any single "right" diagram — is what demonstrates senior-level system design skill. Adapt the depth to the time available, and always tie decisions back to the stated requirements.
