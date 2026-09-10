# System Design Learning — 100 Questions (In-Depth Edition)

A deep-dive study guide. Each answer explains the **what**, **why**, **how**, **concrete numbers/examples**, **trade-offs**, and **when to use / when to avoid** — so you learn the reasoning, not just definitions.

## Contents
1. [Part 1 — Fundamentals & Core Concepts](part-1-fundamentals.md) (Q1–Q20)
2. [Part 2 — Core Components](part-2-components.md) (Q21–Q45)
3. [Part 3 — Databases & Storage](part-3-databases.md) (Q46–Q65)
4. [Part 4 — Scalability & Growth Stages](part-4-scalability-growth.md) (Q66–Q85)
5. [Part 5 — Reliability, Availability & Advanced](part-5-reliability-advanced.md) (Q86–Q100)

## How to study this guide
- **Read in order.** Later parts assume the vocabulary from earlier ones.
- **Focus on trade-offs, not definitions.** Interviewers and real systems reward "it depends, here's why," not memorized labels.
- **Do the math.** Every answer that involves scale includes numbers — redo them yourself with different inputs.
- **Part 4 is the heart of your "how does the system grow" question** — it walks stage-by-stage from 0 to 100M+ users with explicit "add now vs. defer" guidance.

## The one meta-principle
> Start simple. Measure relentlessly. Add complexity **only** when data proves a real bottleneck. Premature scaling is as harmful as ignoring scale.

## Quick Growth Cheat Sheet

| Users | Add now | Defer (maybe later) |
|-------|---------|---------------------|
| 0–1K | Single app + managed DB, backups, basic monitoring | LB, cache, sharding, services |
| 10K | Separate app/DB tiers, CDN, real monitoring/alerting | Queues, sharding, multi-region |
| 100K | Load balancer + stateless instances, Redis cache, read replicas | Sharding, microservices, multi-region |
| 1M | Message queues, connection pooling, search index, begin monolith split | Full sharding (if replicas suffice), multi-region |
| 10M | Shard DB, microservices, API gateway, CDC pipelines, tracing/SLOs | Only truly-global features |
| 100M+ | Multi-region active-active, geo-DNS, regional failover, edge, cell-based | — |
