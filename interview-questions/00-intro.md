# System Design Interviews — Top 20 Questions

A structured, interview-ready workbook. Every design follows the **same 7-step framework** and closes with an **AWS Well-Architected Framework** assessment across all **6 pillars**.

---

## The 7-Step Design Framework (and *why* each step exists)

Interviewers care less about the "right answer" and more about a **structured, requirements-driven thought process**. This framework keeps you organized and demonstrates senior-level judgment. Follow it in order for every problem.

### Step 1 — Functional Requirements
**What:** The concrete features the system must provide ("users can shorten a URL and be redirected").
**Why:** Scopes the problem. Interview time is limited, so you agree on the *core* features to design (and explicitly defer the rest). Prevents building the wrong thing. Always state what's **in scope** and **out of scope**.

### Step 2 — Non-Functional Requirements (NFRs)
**What:** The qualities the system must have — scale (users/QPS), latency, availability, consistency, durability, read/write ratio.
**Why:** NFRs *drive the architecture* far more than features do. "1K users" and "100M users" have identical features but completely different designs. This is where you do **back-of-the-envelope estimation** (QPS, storage, bandwidth) to size the system.

### Step 3 — Core Entities
**What:** The main data objects and their relationships (User, URL, Tweet, Order…).
**Why:** Establishes the vocabulary and the data model foundation. It bridges requirements and API/schema, and surfaces relationships that later inform the database choice and partitioning.

### Step 4 — The API
**What:** The contract between clients and the system — endpoints, methods, inputs, outputs.
**Why:** Defines the system's boundary and how each functional requirement is fulfilled. Designing the API early forces clarity on exactly what the system does, and naturally reveals read vs write paths (which you then scale differently).

### Step 5 — High-Level Design
**What:** The major components (clients, load balancer, services, databases, caches, queues) and how data flows between them, usually as a diagram.
**Why:** This is the heart of the interview — the architecture that satisfies the requirements. Start simple (the minimum that works), then evolve. Show the request path for each core API.

### Step 6 — Potential Deep Dives
**What:** Focused exploration of the hardest/most interesting parts (the bottleneck, the hot partition, the consistency challenge, the scaling limit).
**Why:** Demonstrates depth. Interviewers probe here to separate memorized answers from real understanding. This is where you handle scale, edge cases, and failure modes.

### Step 7 — Trade-offs
**What:** The conscious choices you made and their alternatives (SQL vs NoSQL, strong vs eventual consistency, sync vs async).
**Why:** Senior engineering *is* trade-off analysis. There's no perfect design — showing you understand what you gained and gave up, and *why it fits the requirements*, is the strongest signal you can send.

---

## AWS Well-Architected Framework — the 6 Pillars

Each design closes with a Well-Architected review. The framework is AWS's set of best practices for building secure, reliable, efficient, cost-effective, and sustainable systems. The **6 pillars**:

1. **Operational Excellence** — run and monitor systems to deliver value; automate, use infrastructure as code, make small reversible changes, observe everything, and learn from failures.
2. **Security** — protect data and systems: strong identity/least-privilege access, encryption in transit and at rest, detective controls, and incident response.
3. **Reliability** — recover from failures and meet demand: no single points of failure, automated recovery, horizontal scaling, and defined RPO/RTO.
4. **Performance Efficiency** — use resources efficiently as demand evolves: right-size, pick the right services, cache, and monitor.
5. **Cost Optimization** — avoid unnecessary spend: match supply to demand, use appropriate pricing models, and measure cost against value.
6. **Sustainability** — minimize environmental impact: efficient resource use, right-sizing, serverless/managed services, and efficient regions.

**Why assess against it:** It turns "looks good" into a rigorous, multi-dimensional review, and forces explicit trade-offs between pillars (e.g., higher reliability often costs more) — exactly the judgment senior roles demand.

---

## The 20 Questions

| # | System | Primary challenge it teaches |
|---|--------|------------------------------|
| 1 | URL Shortener (TinyURL) | Key generation, read-heavy scaling, caching |
| 2 | Pastebin | Blob storage, expiry, read scaling |
| 3 | Twitter / News Feed | Fan-out, feed generation, the celebrity problem |
| 4 | Instagram | Media storage, feed, CDN |
| 5 | WhatsApp / Chat | Real-time messaging, presence, delivery guarantees |
| 6 | Rate Limiter | Algorithms, distributed counters, low latency |
| 7 | YouTube / Netflix | Video upload, transcoding, streaming, CDN |
| 8 | Web Crawler | Large-scale crawling, politeness, dedup |
| 9 | Notification System | Multi-channel fan-out, reliability, dedup |
| 10 | Uber / Ride-Sharing | Geospatial matching, real-time location |
| 11 | Google Drive / Dropbox | File sync, chunking, conflict resolution |
| 12 | Ticketmaster | Reservations, concurrency, preventing double-booking |
| 13 | Distributed Cache | Consistent hashing, eviction, replication |
| 14 | Search Autocomplete | Trie, prefix queries, ranking, low latency |
| 15 | Google Maps | Geospatial data, routing, tiles |
| 16 | Distributed Message Queue | Durability, ordering, delivery semantics |
| 17 | Leaderboard | Sorted sets, real-time ranking at scale |
| 18 | Payment System | Idempotency, consistency, exactly-once, audit |
| 19 | Key-Value Store | Partitioning, replication, quorums (Dynamo) |
| 20 | DoorDash / Food Delivery | Three-sided marketplace, geospatial, logistics |

Each write-up is self-contained. Read any in isolation, or all in sequence to build broad coverage.
