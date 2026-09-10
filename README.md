# System Design Docs

A personal collection of system design study material and interview preparation documents, available in multiple formats (PDF, Word, HTML) with reproducible source.

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
Personal study material.
