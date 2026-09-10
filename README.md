# System Design Docs

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Formats](https://img.shields.io/badge/format-PDF%20%7C%20DOCX%20%7C%20HTML-14375a)
![Questions](https://img.shields.io/badge/questions-120%2B-059669)
[![Pages](https://img.shields.io/badge/GitHub%20Pages-live-2e5f8a)](https://amaan-dev1999.github.io/system-design-docs/)

A personal collection of system design study material and interview preparation documents, available in multiple formats (PDF, Word, HTML) with reproducible source.

> 🌐 **Live site:** https://amaan-dev1999.github.io/system-design-docs/

## ⬇️ Quick downloads

| Document | View / Download |
|----------|-----------------|
| Interview Guide — Top 20 (HTML) | [Open online](https://amaan-dev1999.github.io/system-design-docs/interview-questions/System-Design-Interviews-Top20.html) |
| Interview Guide — Top 20 (PDF) | [Download](interview-questions/System-Design-Interviews-Top20.pdf) |
| Interview Guide — Top 20 (Word) | [Download](interview-questions/System-Design-Interviews-Top20.docx) |
| Learning Guide — 100 Questions (Word) | [Download](learning-guide/System-Design-Learning.docx) |

## Contents

### 📘 `interview-questions/`
Top 20 popular system design interview questions, each worked through a consistent 7-step framework and reviewed against the **AWS Well-Architected Framework** (6 pillars).

**Framework used for every design:** Functional Requirements → Non-Functional Requirements → Core Entities → API → High-Level Design → Potential Deep Dives → Trade-offs → AWS Well-Architected Assessment.

- `System-Design-Interviews-Top20.pdf` — polished PDF with a clickable table of contents and architecture diagrams.
- `System-Design-Interviews-Top20.docx` — Word version with a table of contents and embedded diagram images.
- `System-Design-Interviews-Top20.html` — HTML version.
- Source: `00-intro.md`, `01-part-a.md` … `04-part-d.md` (content), `diagrams.js` (SVG architecture diagrams), `build-docx.js` / `build-pdf.js` (generators).

**Systems covered:** URL Shortener, Pastebin, Twitter/Feed, Instagram, WhatsApp, Rate Limiter, YouTube, Web Crawler, Notifications, Uber, Dropbox, Ticketmaster, Distributed Cache, Search Autocomplete, Google Maps, Message Queue, Leaderboard, Payment System, Key-Value Store, DoorDash.

### 📗 `learning-guide/`
An in-depth study guide of 100 system design questions and answers covering fundamentals, components, databases, scalability/growth stages, and reliability.

- `System-Design-Learning.docx` — Word version.
- Source: `README.md`, `part-1-fundamentals.md` … `part-5-reliability-advanced.md`, `build-docx.js`.

## Regenerating the documents

Both generators are **zero-dependency** (Node.js built-ins only). The PDF and diagram images additionally use Microsoft Edge (headless) for rendering.

```bash
# Interview questions
cd interview-questions
node build-docx.js   # -> .docx with TOC + embedded diagrams
node build-pdf.js    # -> .html and .pdf with diagrams

# Learning guide
cd learning-guide
node build-docx.js   # -> .docx
```

## License
Released under the [MIT License](LICENSE).

## GitHub Pages
This repo serves a landing page (`index.html`) via GitHub Pages using the **Deploy from a branch** method.
Enable it once: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main` / `/ (root)` → Save**. The site publishes at
https://amaan-dev1999.github.io/system-design-docs/ and rebuilds automatically on every push to `main`.
A `.nojekyll` file is included so all folders and files are served exactly as committed.
