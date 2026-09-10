# Part 3 — Databases & Storage (Q46–Q65)

[← Part 2](part-2-components.md) | [Index](README.md) | [Part 4 →](part-4-scalability-growth.md)

---

### Q46. SQL vs NoSQL — how to actually choose

**SQL (relational) databases** — PostgreSQL, MySQL, SQL Server, Oracle:
- Data in **tables** with a fixed **schema** (rows and typed columns), related by keys.
- **ACID transactions** (strong consistency and correctness).
- **Powerful querying** via SQL — joins, aggregations, ad-hoc queries.
- **Vertical scaling** is the default; horizontal scaling (sharding) is possible but harder.
- ✅ Best for: structured, relational data with complex queries and correctness needs — most business apps, financial data, anything transactional.

**NoSQL databases** — a family, not one thing (see Q47):
- **Flexible / schema-less** data models.
- Designed for **horizontal scaling** and high throughput.
- Often trade strong consistency for availability/latency (BASE, tunable consistency).
- Query power varies; typically optimized for specific **access patterns** rather than ad-hoc queries.
- ✅ Best for: massive scale, flexible/evolving schemas, high write throughput, or a specific access pattern that maps cleanly to a NoSQL model.

**How to decide — ask these questions:**
1. **Is the data relational, with lots of joins?** → SQL.
2. **Do you need multi-record ACID transactions?** (money, inventory) → SQL (or NewSQL).
3. **Is the schema stable or constantly changing?** Stable → SQL; highly variable → document DB.
4. **What's the scale and write pattern?** Extreme write throughput / horizontal scale → NoSQL (e.g., Cassandra).
5. **Do you know your query patterns up front?** NoSQL rewards designing around known access patterns; SQL is more forgiving of unknown/ad-hoc queries.

**The pragmatic truth:**
- **SQL is the right default** for most applications. It's mature, flexible, and "boring" (in the good way). Modern PostgreSQL scales far further than people assume and even supports JSON for flexibility.
- Reach for NoSQL when you have a *specific* reason: proven scale limits, a schema that doesn't fit tables, or an access pattern a NoSQL store nails.
- **Polyglot persistence:** large systems use *both* — SQL for transactional core data, Redis for caching, Elasticsearch for search, Cassandra for time-series, etc. Use the right tool per job.

---

### Q47. The types of NoSQL databases

NoSQL isn't one thing — it's four main families, each suited to different access patterns:

**1. Key-Value stores** — Redis, DynamoDB, Memcached, Riak:
- Data model: a giant hash map — `key → value` (value opaque to the DB).
- ✅ Fastest, simplest; O(1) lookups; trivially scalable.
- ❌ Can only query by key; no complex queries.
- Use for: caching, session storage, user preferences, feature flags, real-time leaderboards (Redis), shopping carts.

**2. Document stores** — MongoDB, Couchbase, DynamoDB (document mode), Firestore:
- Data model: self-describing documents (JSON/BSON), grouped in collections; nested structures allowed.
- ✅ Flexible schema; each document can differ; natural fit for object-oriented data; can query on fields and index them.
- ❌ Joins are limited/awkward; consistency varies.
- Use for: content management, catalogs, user profiles, evolving schemas, when data is naturally document-shaped.

**3. Wide-column (column-family) stores** — Cassandra, HBase, ScyllaDB, Bigtable:
- Data model: rows with dynamic columns grouped into column families; optimized for writing and reading huge volumes across many nodes.
- ✅ **Massive write throughput**, linear horizontal scale, tunable consistency, great for time-series and append-heavy data.
- ❌ Must design tables around specific queries (query-first modeling); no ad-hoc joins; eventual consistency by default.
- Use for: time-series/metrics, IoT sensor data, event logging, messaging history, any write-heavy, huge-scale workload.

**4. Graph databases** — Neo4j, Amazon Neptune, ArangoDB:
- Data model: nodes (entities) + edges (relationships) as first-class citizens.
- ✅ Excellent for **relationship-heavy** queries — traversals ("friends of friends," shortest path) that would be brutal multi-join queries in SQL.
- ❌ Niche; not for high-volume simple lookups.
- Use for: social networks, recommendation engines, fraud detection, knowledge graphs, network/dependency mapping.

**The lesson:** Choose the NoSQL type by **how you read and write** the data. Key-value for simple fast lookups, document for flexible objects, wide-column for write-heavy scale, graph for relationships. The wrong type makes your life miserable regardless of how "scalable" it is.

---

### Q48. Database replication — copies for reads and resilience

**What it is:** Maintaining copies of your data across multiple database nodes. Replication provides **read scaling**, **high availability** (failover), and **geographic distribution** (data near users).

**Leader-Follower (primary-replica, "master-slave"):**
- One **leader** accepts all **writes**; changes stream to one or more **followers** (replicas).
- **Reads** can be served by any follower → scales reads horizontally.
- On leader failure, a follower is **promoted** to leader (failover).
- ✅ Simple, scales reads, provides redundancy. The most common setup.
- ❌ Writes still bottleneck on the single leader; followers may lag (see Q49).
- Use when: read-heavy workloads (most apps).

**Multi-Leader (multi-primary):**
- Multiple nodes accept **writes**, typically one per region; they replicate to each other.
- ✅ Writes can happen locally in each region (low write latency); survives a region outage.
- ❌ **Write conflicts** — the same record edited in two regions simultaneously must be reconciled (last-write-wins, CRDTs, or app-level merge). Complex.
- Use when: multi-region active-active with local writes, offline-capable apps.

**Leaderless (Dynamo-style)** — Cassandra, DynamoDB, Riak:
- **Any** node accepts reads and writes; data is written to multiple nodes; **quorums** ensure consistency.
- **Quorum rule:** with N replicas, if you write to W and read from R nodes, choosing `W + R > N` guarantees a read overlaps the latest write (strong-ish consistency). Tune W/R to trade latency vs consistency.
- ✅ Highly available, no failover needed (no single leader), tunable consistency.
- ❌ More complex reasoning; needs conflict resolution (versioning/vector clocks).
- Use when: extreme availability and scale (AP systems).

**Sync vs async replication:**
- **Synchronous:** leader waits for follower(s) to confirm before acking the write → no data loss on failover, but higher write latency and reduced availability if a follower is slow.
- **Asynchronous:** leader acks immediately, replicates in the background → fast writes, but risk of losing the last few writes if the leader dies before they replicate (and replication lag on reads).
- **Semi-sync:** wait for *at least one* follower — a common compromise.

---

### Q49. Replication lag — the price of async replicas

**What it is:** The delay between a write being committed on the leader and that write appearing on the followers. With asynchronous replication, followers are always a little behind — usually milliseconds, but seconds or more under load or network issues.

**Why it causes user-visible bugs:**
- **Read-after-write inconsistency:** a user posts a comment (write → leader), then the page reloads and reads from a *follower* that hasn't received the comment yet → the user's own comment seems to vanish. Very confusing.
- **Non-monotonic reads:** two consecutive reads hit different followers with different lag → data appears, then disappears ("time travel").
- **Stale reads generally:** any read from a lagging replica may show old data.

**Mitigation techniques:**
1. **Read-your-writes (read-after-write) consistency:** after a user writes, route *their* reads to the leader (or to a replica known to be caught up) for a short window. So users always see their own changes. Often keyed by "read from leader for N seconds after a write" or tracking the write's log position.
2. **Monotonic reads:** pin a given user to the *same* replica (via consistent hashing on user ID) so they never see data go backward.
3. **Bounded staleness:** only route reads to replicas whose lag is below a threshold; drop laggards out of the read pool.
4. **Track replication position (LSN/GTID):** the client remembers the log position of its write; reads wait until a replica has caught up to that position.
5. **Read from leader for critical reads:** for data where staleness is unacceptable, just read from the leader (at the cost of read-scaling for those queries).

**The trade-off:** Async replication gives you fast writes and read scaling but introduces lag. These mitigations restore the consistency guarantees you need *where* you need them, while keeping the scaling benefits elsewhere. Match the guarantee to each read's tolerance for staleness.

---

### Q50. Sharding (horizontal partitioning) — scaling beyond one machine

**What it is:** Splitting a dataset **across multiple databases (shards)**, each holding a *subset* of the data, so that no single machine has to store all the data or handle all the traffic. It's how you scale **writes** and **storage** beyond a single server's limits — the thing replication alone can't do.

**Why you need it:** Replication scales reads (more replicas) but every write still goes through one leader, and every replica stores the *entire* dataset. When writes or total data exceed one machine's capacity, you must **partition** the data itself. Each shard is its own database (often itself replicated for HA).

**Horizontal vs vertical partitioning:**
- **Horizontal partitioning (sharding):** split **rows** across shards. Users A–M on shard 1, N–Z on shard 2. Each shard has the same schema, different rows. This is what "sharding" usually means.
- **Vertical partitioning:** split **columns/tables** across databases. Put the rarely-used, large `bio` and `avatar` columns in one store and hot columns in another; or put the `orders` tables on one DB and `analytics` tables on another. Often a precursor to microservices (each service owns its tables).

**What sharding gives you:**
- ✅ Near-linear scaling of writes, storage, and throughput — add shards to grow.
- ✅ Smaller per-shard datasets → faster queries, faster backups, smaller indexes.

**What it costs (significant complexity):**
- ❌ **Cross-shard queries are hard:** a query spanning shards must fan out to all and merge results (scatter-gather) — slow and complex. Joins across shards are painful.
- ❌ **Cross-shard transactions** need distributed-transaction machinery (2PC/sagas) or are avoided.
- ❌ **Rebalancing** when adding/removing shards moves data around (mitigated by consistent hashing).
- ❌ **Hotspots** if the shard key distributes poorly (Q51).
- ❌ **Operational overhead:** many databases to manage, monitor, back up.

**The guidance:** Sharding is powerful but **the most complex scaling step** — treat it as a last resort *after* you've exhausted caching, read replicas, and vertical scaling. When you do shard, the **shard key** choice (next question) makes or breaks it.

---

### Q51. Choosing a shard key — the make-or-break decision

**What a shard key is:** The attribute (column) whose value decides which shard a row lives on. Every query ideally includes it so the system knows which shard to hit.

**What makes a *good* shard key — three goals:**
1. **Even data distribution:** roughly equal data per shard (no shard holds 90% of the data).
2. **Even load distribution:** roughly equal *traffic* per shard (no shard gets 90% of the queries).
3. **Query locality:** related data that's queried together lives on the *same* shard, so most queries hit a single shard (avoiding cross-shard scatter-gather).

**Classic bad choices and why:**
- **Sharding by timestamp/auto-increment ID:** all *new* writes go to the newest shard → that shard is a write **hotspot** while older shards idle. Terrible for write-heavy systems.
- **Sharding by a low-cardinality field** (e.g., country, when 80% of users are in one country): grossly uneven distribution.
- **Sharding by a field that's not in most queries:** forces cross-shard fan-out for common queries.

**Good choices (context-dependent):**
- **Hash of `user_id`:** spreads users evenly across shards; a given user's data lives together (great if most queries are per-user). Common for consumer apps.
- **`tenant_id` (for B2B/multi-tenant):** co-locates all of a tenant's data on one shard, so tenant-scoped queries hit one shard. But watch for a giant "whale" tenant becoming a hotspot.
- **Composite keys** to balance distribution and locality.

**The dreaded resharding problem:** Choosing a shard key is a *long-term commitment* — changing it later means migrating huge amounts of data. Choose carefully, and design for growth (e.g., start with more logical shards than physical machines, so you can split later without rehashing everything — this is why consistent hashing matters).

**Handling hotspots even with a decent key:** For known hot entities (a celebrity user), you can **split** the hot key (append a random suffix to spread its writes across shards) or give it dedicated capacity, plus cache it aggressively.

---

### Q52. Sharding strategies — how keys map to shards

Four common strategies for deciding *which* shard a piece of data goes to:

**1. Range-based sharding:** Partition by ranges of the key. Users A–H → shard 1, I–P → shard 2, Q–Z → shard 3. Or by date ranges.
- ✅ **Efficient range queries** ("all users M–P" or "all orders in March" hit one shard).
- ❌ **Hotspots** — uneven ranges (more names start with 'S' than 'X'); sequential keys (timestamps, auto-increment IDs) pile all new writes on the last shard.
- Use when: range queries dominate and you can pick balanced ranges.

**2. Hash-based sharding:** Apply a hash function to the key and use it (e.g., `hash(key) % N`) to pick a shard.
- ✅ **Even distribution** — randomizes placement, avoiding hotspots.
- ❌ **Kills range queries** (adjacent keys scatter across shards); the naive `% N` approach reshuffles almost *all* data when N changes (adding a shard). 
- Use when: you need even distribution and mostly do point lookups by key.

**3. Consistent hashing:** A smarter hash placement (Q53) where keys and nodes map onto a ring, so adding/removing a shard only remaps a *small fraction* of keys.
- ✅ Even distribution **and** minimal data movement when scaling.
- Use when: shards are added/removed dynamically (most modern distributed stores).

**4. Directory-based (lookup) sharding:** A separate **lookup service/table** maps each key (or key range) to its shard. To find data, you first consult the directory.
- ✅ **Maximum flexibility** — move data between shards freely by updating the directory; can rebalance easily; can use any placement logic.
- ❌ The directory is an extra hop and a potential **SPOF/bottleneck** (must be HA and fast, often cached).
- Use when: you need flexible, dynamic data placement and rebalancing.

**In practice:** Many systems combine these — e.g., hash keys into many "virtual shards" (buckets), then use a directory to map virtual shards to physical machines. This gives even distribution *and* easy rebalancing.

---

### Q53. Consistent hashing — scaling without reshuffling everything

**The problem it solves:** With naive hash sharding (`shard = hash(key) % N`), changing the number of shards N (adding a server, or one dying) changes the modulus, so **almost every key maps to a different shard** — you'd have to move nearly *all* your data. Catastrophic at scale.

**The idea:** Imagine a circular ring representing the hash space (say 0 to 2³²−1). 
1. **Place each node** on the ring by hashing its identifier → each node occupies a point.
2. **Place each key** on the ring by hashing the key.
3. **Assign each key** to the *first node encountered going clockwise* from the key's position.

**Why this is powerful:** When a node is **added**, it only steals the keys between it and the previous node on the ring — just `~1/N` of the keys move, and only from *one* neighbor. When a node is **removed**, only its keys move to the next node clockwise. Everything else stays put. So scaling moves a *small, bounded fraction* of data instead of all of it.

**The uneven-distribution fix — virtual nodes:** With few nodes, the ring placement can be lopsided (one node responsible for a huge arc). The solution: give each physical node **many virtual nodes** (hundreds of points scattered around the ring). This smooths distribution and, bonus, spreads a departing node's load across *many* remaining nodes instead of dumping it all on one neighbor.

**Where it's used:** The backbone of distributed data systems and caches:
- **Distributed databases:** Cassandra, DynamoDB, Riak use it to place partitions.
- **Distributed caches:** so adding/removing a cache node doesn't invalidate the entire cache.
- **Load balancers** with sticky routing.

**Why you must know it:** It's the standard answer to "how do you add/remove nodes from a distributed data store without massive data movement?" — a frequent design question and a genuinely elegant, widely-used technique.

---

### Q54. Denormalization — trading write cost for read speed

**Normalization recap:** In a normalized relational schema, data is split into separate tables with no redundancy (each fact stored once), related by keys. Reading often requires **joins** to reassemble the data. Normalization keeps data consistent (update in one place) but joins can be expensive at scale.

**Denormalization:** Deliberately storing **redundant or pre-joined data** so reads don't need expensive joins or computations. You duplicate some data or precompute results.

**Examples:**
- Store the author's `name` directly in each `post` row (duplicated from the `users` table) so rendering a post list doesn't join to `users`.
- Precompute and store a user's `follower_count` instead of `COUNT(*)`-ing the followers table on every profile view.
- Precompute a user's home feed and store it, rather than assembling it from scratch on each load (fan-out-on-write).

**The trade-off:**
- ✅ **Faster reads** — no joins, no recomputation; critical for read-heavy systems at scale.
- ✅ Can avoid cross-shard joins in a sharded system.
- ❌ **Writes become more complex and expensive** — when the source data changes, you must update *all* the copies (the author renames → update the name in every post? or accept staleness?).
- ❌ **Risk of inconsistency** — copies can drift out of sync if an update is missed.
- ❌ More storage.

**When it's justified:** When **reads vastly outnumber writes** (most consumer apps) and join/computation cost is hurting latency. You accept extra write complexity and some redundancy to make the common case (reads) fast.

**How it's kept consistent:** Update all copies transactionally (if same DB), via events/CDC (Q65) to propagate changes, or accept eventual consistency with periodic reconciliation. Denormalization and eventual consistency often go hand in hand.

**Relationship to caching:** Denormalization is like "baking the cache into the data model" — precomputing the read-optimized shape permanently rather than on-demand.

---

### Q55. Indexes — the fundamental read accelerator

**What it is:** An index is an auxiliary data structure that lets the database find rows **without scanning the whole table**. Most commonly a **B-tree** (balanced tree), which keeps keys sorted for fast lookups, ranges, and ordering. Without an index, finding rows matching `WHERE email = 'x'` requires reading *every* row (a full table scan, O(n)); with an index, it's O(log n).

**How B-tree indexes help:**
- **Equality lookups:** `WHERE id = 42` → jump straight to it.
- **Range queries:** `WHERE age BETWEEN 20 AND 30` → because keys are sorted.
- **Sorting:** `ORDER BY created_at` → read the index in order.
- **Joins:** speed up matching rows across tables.

**The trade-off (indexes aren't free):**
- ✅ Dramatically faster reads on indexed columns.
- ❌ **Slower writes** — every INSERT/UPDATE/DELETE must also update every affected index. More indexes = slower writes.
- ❌ **More storage** — each index is a separate structure on disk.
- ❌ Over-indexing wastes space and write performance for indexes the query planner never uses.

**The discipline:** Index the columns you frequently **filter, sort, or join on** — especially in `WHERE`, `JOIN`, and `ORDER BY` clauses. Don't index everything. Use the database's `EXPLAIN`/query planner to verify indexes are actually used, and remove unused ones.

**Advanced index types (know they exist):**
- **Composite (multi-column) index:** indexes `(a, b, c)` together — great for queries filtering on those columns in that prefix order (left-to-right rule).
- **Covering index:** includes all columns a query needs, so the DB answers entirely from the index without touching the table.
- **Hash index:** O(1) equality lookups, but no range queries.
- **Full-text / inverted index:** for text search (Q42).
- **Geospatial (R-tree), bitmap** indexes for specialized needs.

**The payoff:** Adding the right index is frequently the single biggest, cheapest performance win in a system — turning a multi-second scan into a millisecond lookup. Always check for missing indexes before assuming you need bigger hardware or sharding.

---

### Q56. Primary vs secondary indexes

**Primary index (clustered index):**
- Built on the **primary key**; in a clustered index, it *determines the physical order* of the rows on disk (the table *is* the index, sorted by PK). MySQL/InnoDB works this way.
- There's **one per table** (data can only be physically sorted one way).
- ✅ Extremely fast primary-key lookups and range scans on the PK; the row data is right there in the leaf nodes.
- Implication: choose a PK that's compact and preferably monotonic-ish for insert performance (random UUIDs as clustered PKs can hurt due to page splits — a real gotcha).

**Secondary index (non-clustered index):**
- Built on **other column(s)**. It stores the indexed column values plus a **pointer** to the actual row (in InnoDB, the pointer is the primary key).
- You can have **many** per table.
- ✅ Speeds up queries on non-PK columns.
- ❌ Each adds write overhead and storage; a lookup may require a **second step**: find the PK via the secondary index, then fetch the row via the clustered index ("bookmark lookup"), unless the index is *covering*.

**In distributed/sharded systems — the hard part:**
- **Local secondary index:** each shard indexes only its own data. A query on the index that doesn't include the shard key must **fan out to all shards** (scatter-gather) — slow.
- **Global secondary index:** a separate index spanning all shards, so you can query by the indexed attribute directly — but keeping it consistent with the sharded data is **expensive** (cross-shard updates) and often **eventually consistent** (DynamoDB's GSIs, for example).

**Takeaway:** Primary index = one, defines physical layout, fast PK access. Secondary indexes = many, enable alternate lookups at a write/storage cost. In sharded systems, secondary indexes force a choice between slow scatter-gather (local) and costly/eventually-consistent global indexes — a key design consideration.

---

### Q57. Connection pooling — a hidden but critical bottleneck

**The problem:** Establishing a new database connection is **expensive** — it involves a TCP handshake, TLS negotiation, authentication, and session setup, often taking milliseconds (an eternity relative to a query). Opening a fresh connection per request would waste huge amounts of time and resources. Worse, databases have a **hard limit** on concurrent connections (e.g., PostgreSQL defaults to ~100), and each connection consumes memory on the DB server.

**What a connection pool does:** Maintains a set of **pre-opened, reusable** connections. When the app needs to query, it **borrows** a connection from the pool, uses it, and **returns** it (rather than closing it). Connections are reused across many requests.
- ✅ Eliminates per-request connection setup cost → lower latency.
- ✅ **Bounds** the number of DB connections → protects the DB from being overwhelmed.
- ✅ Smooths bursts (requests queue for a connection rather than spawning unlimited connections).

**The scaling gotcha — connection explosion:** This is a classic production failure. Say each app instance has a pool of 20 connections. Scale to 100 app instances → 2,000 connections demanded from a DB that allows 100. The DB refuses connections or falls over. Horizontal scaling of the *app tier* can overwhelm the *database's* connection capacity.

**The solution — an external connection pooler:** Put a pooler like **PgBouncer** (PostgreSQL) or **ProxySQL** (MySQL) *between* the app fleet and the database. Thousands of app connections multiplex onto a small number of actual DB connections (transaction-level pooling reuses a DB connection for each transaction, not each client). This decouples app-tier scaling from DB connection limits.

**Key tuning parameters:**
- **Pool size:** too small → requests wait; too large → overwhelm the DB. (Little's Law helps size it.)
- **Max lifetime / idle timeout:** recycle connections to avoid stale/leaked ones.
- **Wait timeout:** how long to wait for a free connection before erroring.

**Why it matters:** Connection limits are a surprisingly common ceiling that people hit *before* actual query performance becomes the problem. Knowing to add a pooler is a mark of real-world experience.

---

### Q58. Write-Ahead Log (WAL) — the foundation of durability

**What it is:** Before a database applies a change to its actual data files, it first **appends a record of that change to a log** on disk (the write-ahead log, aka transaction log / redo log / commit log). Only after the log entry is safely persisted is the transaction considered committed. The rule is literally "write to the log *ahead* of writing to the data."

**Why it exists — durability and crash recovery:**
- **Durability (the D in ACID):** if the server crashes right after commit, the change is safe in the log even if the in-memory data pages hadn't been flushed to the data files yet. On restart, the DB **replays** the log to reconstruct all committed changes ("redo"). Uncommitted changes are rolled back ("undo").
- **Performance paradox — it's actually faster:** appending to a log is a **sequential** disk write (fast), whereas updating data pages scattered across the disk is **random** I/O (slow). By writing the log immediately and flushing the (random) data pages **lazily** in the background, the DB gets both durability *and* speed. This is a core trick of database engines.

**What else the WAL enables (its second life):**
- **Replication:** followers stay in sync by consuming and replaying the leader's WAL (this *is* how streaming replication works). The log is the change stream.
- **Change Data Capture (CDC):** external systems tail the WAL to capture every change and stream it to caches, search indexes, and data warehouses (Q65). Tools like Debezium read the WAL.
- **Point-in-time recovery (PITR):** replay the WAL up to a specific moment to restore the DB to any past state.

**The broader pattern — log-structured everything:** The "append to an immutable log first" idea is everywhere in system design: Kafka *is* a distributed log; **event sourcing** stores the log as the source of truth; LSM-tree storage engines (Cassandra, RocksDB) buffer writes in a log/memtable and flush sequentially. Sequential writes are fast and logs are simple to reason about — a recurring, powerful pattern.

---

### Q59. Materialized views — precomputed query results

**Regular view vs materialized view:**
- A **regular view** is a saved query — a virtual table. Every time you query it, the underlying query **runs fresh**. No storage, always current, but no performance benefit (it's just query reuse/abstraction).
- A **materialized view** **stores the computed result** on disk like a real table. Querying it is fast (just reads stored rows), but the data is a **snapshot** that must be **refreshed** to stay current.

**Why use one:** For **expensive queries that run frequently** — heavy aggregations, joins across large tables, complex analytics. Instead of recomputing the same costly result on every request, compute it once, store it, and serve reads instantly.

**Examples:**
- A dashboard showing "total sales per region per day" — aggregating millions of order rows. Materialize it; refresh hourly.
- A "top 10 trending products" list — expensive to compute, read constantly.
- Precomputed report tables for BI.

**The trade-off:**
- ✅ **Fast reads** of otherwise-expensive results; offloads the heavy query from the read path.
- ❌ **Stale data** between refreshes (bounded by refresh frequency).
- ❌ **Refresh cost** — recomputing consumes resources; frequent refreshes on huge data can be heavy.
- ❌ **Storage** for the stored result.

**Refresh strategies:**
- **Scheduled (periodic):** refresh every N minutes/hours — simple, bounded staleness.
- **On-demand:** refresh when explicitly triggered.
- **Incremental / fast refresh:** update only the changed portions (supported by some DBs), far cheaper than full recompute.
- **Refresh on write / continuous:** driven by changes (approaching CQRS territory).

**Where it fits the bigger picture:** Materialized views are essentially a **database-managed cache of query results**, and a stepping stone toward **CQRS** (Q63), where you maintain separate read-optimized models. Use them when the same expensive read runs far more often than the underlying data changes.

---

### Q60. Eventual consistency in practice — when "stale for a moment" is fine

**Recap:** Eventual consistency means that after a write, replicas **converge** to the same value *over time* — reads may briefly return stale data, but if writes stop, everyone eventually agrees. It's the consistency model that enables high availability and low latency in distributed/replicated systems (AP in CAP terms).

**Where it's perfectly acceptable (and used everywhere):**
- **Social media likes/reactions:** if your like count shows 1,204 vs 1,205 for a second, nobody cares or notices.
- **View counts, analytics:** approximate and delayed is fine.
- **News feeds / timelines:** seeing a post a second or two late is invisible.
- **Product catalogs, search results:** a just-added product taking a moment to appear is acceptable.
- **DNS:** the classic eventually-consistent system — changes propagate over minutes.
- **Follower/friend counts, notification badges.**

**Where it is NOT acceptable (need strong consistency):**
- **Financial transactions / account balances:** you cannot let two ATMs both see "balance = $100" and each withdraw it.
- **Inventory / seat booking:** overselling the last item or double-booking a seat is a real business problem.
- **Authentication / permissions:** a revoked access token must be revoked *now*, not eventually.
- **Uniqueness constraints:** two users can't both grab the same username.

**The practical design approach — mix per feature:** Don't pick one consistency model for the whole system. For **each** piece of data, ask: *"What's the worst that happens if a read is stale for a second?"*
- Catastrophic (money, inventory) → strong consistency (single leader, transactions, quorum).
- Harmless (likes, feeds) → eventual consistency (replicas, caching, async).

This lets you get the availability/performance benefits of eventual consistency where it's safe, while paying the cost of strong consistency only where it's truly needed. Getting this mapping right is a hallmark of good distributed-system design.

---

### Q61. Distributed transactions & two-phase commit (2PC)

**The problem:** A single business operation sometimes must update **multiple** databases or services *atomically* — all succeed or all fail. Example: an e-commerce checkout that must (1) charge the payment service, (2) decrement inventory, and (3) create an order — across three separate services/databases. A local ACID transaction can't span them.

**Two-Phase Commit (2PC) — the classic solution:** A **coordinator** orchestrates all participants in two phases:
1. **Prepare (voting) phase:** the coordinator asks every participant, "Can you commit this?" Each does the work tentatively, locks the resources, writes to its log, and replies **yes** (ready) or **no** (abort).
2. **Commit phase:** if *all* voted yes, the coordinator tells everyone to **commit**; if *any* voted no (or timed out), it tells everyone to **abort/rollback**.

This guarantees **atomicity** across systems — either all commit or all roll back.

**Why 2PC is problematic at scale:**
- ❌ **Blocking:** participants hold **locks** on their resources from "prepare" until the final commit/abort. If the coordinator is slow or crashes after prepare, participants are stuck holding locks, blocked, unable to proceed — hurting availability and throughput.
- ❌ **Coordinator is a SPOF:** if it dies at the wrong moment, participants don't know whether to commit or abort ("in-doubt" transactions requiring manual/complex recovery).
- ❌ **Latency:** two round trips to all participants, plus disk logging at each — slow.
- ❌ **Doesn't scale / poor availability:** the more participants, the higher the chance one is slow/down, blocking everyone. It sacrifices availability (CP).

**When it's still used:** Within tightly-coupled systems that genuinely need cross-resource atomicity and can tolerate the cost — e.g., distributed relational databases, some financial systems, XA transactions. But in large-scale microservice architectures, its blocking/availability cost is usually unacceptable.

**The modern alternative:** Because of these downsides, distributed systems typically **avoid** 2PC and instead use the **Saga pattern** (Q62) — trading strict atomicity for availability and eventual consistency via compensating actions.

---

### Q62. The Saga pattern — distributed transactions without locking

**What it is:** A way to maintain data consistency across multiple services **without** a distributed transaction (no 2PC, no cross-service locks). A saga breaks the operation into a **sequence of local transactions**, one per service. Each local transaction commits independently. If a later step **fails**, the saga runs **compensating transactions** to *undo* the completed steps — semantically reversing them.

**Example — travel booking (book flight + hotel + car):**
1. Book flight ✅ (local transaction commits)
2. Book hotel ✅
3. Book car ❌ **fails** (no cars available)
4. **Compensate:** cancel hotel (undo step 2), cancel flight (undo step 1)

The end state is consistent (nothing booked), reached not by rollback of a single transaction but by explicit *compensating* actions. Note compensation is *semantic*, not literal — a "cancel booking" may leave a cancellation record; it doesn't pretend the booking never happened.

**Two ways to coordinate a saga:**
- **Choreography (event-driven):** each service listens for events and reacts, emitting the next event. No central controller — services collaborate via events. ✅ Loosely coupled, no SPOF. ❌ Hard to follow the overall flow ("where's the logic?"), risk of cyclic complexity as it grows.
- **Orchestration (central coordinator):** a **saga orchestrator** explicitly tells each service what to do and handles failures/compensation. ✅ Clear, centralized flow logic; easier to monitor and debug. ❌ The orchestrator is a component to build/maintain (tools like Temporal, Camunda, AWS Step Functions help). Preferred for complex sagas.

**Trade-offs vs 2PC:**
- ✅ **No locks held across services** → high availability and scalability.
- ✅ Each step commits independently → no blocking.
- ❌ **Eventual consistency**, not atomic isolation — there are intermediate states where some steps are done and others aren't (e.g., flight booked but hotel not yet). Other observers might briefly see this.
- ❌ **You must design compensating transactions** for every step (and handle the case where compensation itself fails — needs retries/idempotency).
- ❌ More application complexity.

**When to use:** Long-running or cross-service business processes in microservice architectures where 2PC's blocking is unacceptable — order fulfillment, booking, multi-step onboarding. It's the de facto standard for distributed "transactions" in modern systems. Pair with **idempotency** (Q16) so retries of steps/compensations are safe.

---

### Q63. CQRS — separating reads from writes

**What it stands for:** Command Query Responsibility Segregation. The core idea: **separate the model you use for writes (commands) from the model you use for reads (queries)** — potentially into different data stores, each optimized for its job.

**The traditional approach vs CQRS:**
- **Traditional:** one model/schema handles both reads and writes. Simple, but the schema is a compromise — normalized for writes yet awkward/slow for complex reads, and read and write load compete on the same store.
- **CQRS:** 
  - **Write side (command model):** optimized for correctness and writes — normalized, transactional (the source of truth).
  - **Read side (query model):** one or more **denormalized, read-optimized** views (even different databases: a document store for one view, a search index for another), each shaped exactly for specific queries.
  - Changes flow from the write side to the read side, usually **asynchronously** via events → the read models are **eventually consistent**.

**What it buys you:**
- ✅ **Independent scaling** of reads vs writes (read side often needs far more capacity — scale it separately).
- ✅ **Read models tailored per use case** — no compromise schema; each query is fast.
- ✅ Works naturally with **event sourcing** (Q64) and event-driven architectures.
- ✅ Can use different storage tech per side (polyglot).

**What it costs:**
- ❌ **Significant complexity** — two models to keep in sync, plus the sync mechanism.
- ❌ **Eventual consistency** between write and read sides (a write may not appear in a read for a moment) — the UI must handle this.
- ❌ More moving parts, more to operate and debug.

**When to use it:** Only when read and write needs **genuinely diverge** — e.g., a system with complex, high-volume reads that a single model can't serve efficiently, or vastly different read vs write scaling. **Don't** apply CQRS by default; for most CRUD apps it's over-engineering. A materialized view (Q59) is often a lighter-weight way to get read optimization without full CQRS.

---

### Q64. Event sourcing — the log as the source of truth

**The conventional approach:** Databases store **current state**. When something changes, you **overwrite** the old value. You know the account balance is $50, but not *how* it got there — the history is lost (unless you added audit logging).

**Event sourcing flips this:** Instead of storing current state, you store the **full, immutable, ordered sequence of events** that happened. The events *are* the source of truth. Current state is **derived** by replaying (folding) the events from the beginning.
- Instead of `balance = 50`, you store: `Deposited $100`, `Withdrew $30`, `Withdrew $20`. Replaying these yields `balance = 50`.

**What it gives you:**
- ✅ **Complete audit trail** — every change, with full context, forever. Invaluable for finance, compliance, debugging ("how did we get to this state?").
- ✅ **Time travel** — reconstruct the state at *any* past point by replaying events up to then.
- ✅ **Rebuild/derive new read models** — since you have every event, you can build brand-new projections (views) from history whenever needs change (pairs perfectly with CQRS).
- ✅ **Natural fit for event-driven systems** — events are already the currency.
- ✅ Debugging & fixing: replay events (with a bug fixed) to correct derived state.

**What it costs:**
- ❌ **Complexity** — a big mental and implementation shift; not how most developers think.
- ❌ **Replay cost / snapshots** — replaying millions of events to get current state is slow, so you periodically save **snapshots** (state at event N) and replay only events after the snapshot.
- ❌ **Event schema evolution** — events are immutable and stored forever; changing their structure over time (versioning old events) is genuinely hard.
- ❌ **Querying current state** requires projections (you can't just `SELECT` current state directly) — hence it's usually paired with CQRS to build queryable read models.

**When to use it:** When the **history itself is valuable** — financial ledgers, audit-critical domains, systems needing temporal queries or strong traceability, or complex domains benefiting from an event-driven model. **Overkill** for simple CRUD. Often introduced for a specific subdomain, not the whole system.

**Relationship to WAL/Kafka:** It's the same "append-only log is truth" idea as the WAL (Q58) and Kafka (Q33), applied at the *domain/business* level rather than the storage level.

---

### Q65. Change Data Capture (CDC) — streaming changes out of the database

**The problem it solves:** You have a primary database (source of truth), but you also need that data in *other* systems — a **cache** (to invalidate/update), a **search index** (Elasticsearch), a **data warehouse** (for analytics), other microservices, or a read model. How do you keep them in sync **without** slowing down or complicating your application?

**The naive (bad) approach — dual writes:** Have the app write to the DB *and* to the cache/search/etc. in application code. This is fragile: if one write succeeds and another fails (crash, network blip), the systems **drift out of sync**, and there's no easy atomicity across them. Dual writes are a well-known anti-pattern.

**The CDC approach:** CDC **captures row-level changes** (inserts, updates, deletes) directly from the database's **transaction log (WAL)** and streams them as a change event stream to downstream consumers.
- Because it reads the WAL (which the DB writes anyway for durability/replication), the **source application doesn't change** and isn't slowed — it just does its normal DB writes.
- Every committed change becomes an event, in commit order, with old and/or new values.
- Downstream consumers (cache updaters, search indexers, warehouse loaders) subscribe to this stream and update themselves.

**Why it's the clean solution:**
- ✅ **No dual writes** — one write to the DB, changes fan out automatically. The DB transaction is the single atomic action.
- ✅ **Decoupled** — the source app is unaware of consumers; add new consumers anytime.
- ✅ **Reliable & ordered** — captures every change in order (nothing missed); consumers can replay.
- ✅ **Near real-time** — changes propagate within milliseconds/seconds.
- ✅ Enables **eventually-consistent derived data** (search indexes, caches, read models, analytics) kept faithfully in sync.

**How it's implemented:**
- **Log-based CDC (preferred):** tools tail the DB's WAL/binlog. **Debezium** is the popular open-source choice, typically streaming changes into **Kafka**, from which any number of consumers read. (Cloud: AWS DMS, GCP Datastream.)
- (Older, worse methods: polling a `updated_at` column, or trigger-based capture — more overhead and can miss deletes.)

**Where it fits the big picture:** CDC is the standard mechanism to **fan data out of a primary database** into caches, search, warehouses, and other services — the plumbing behind keeping denormalized/derived stores (Q54), search indexes (Q42), and CQRS read models (Q63) in sync with the source of truth. It's a foundational pattern in modern data architectures.

---

[← Part 2](part-2-components.md) | [Index](README.md) | [Part 4 →](part-4-scalability-growth.md)
