// Architecture diagram generator (zero dependencies).
// Produces clean SVG diagrams from a simple {flow, extras} spec.
// Used by both the PDF build (inline SVG) and the DOCX build (rasterized to PNG via Edge).

const BOX_W = 160;
const BOX_H = 56;
const GAP_X = 44;
const MARGIN = 30;
const ROW1_Y = 40;
const GAP_Y = 70;

// Per-system specs. Every extra.from must be a node present in `flow`.
const SPECS = {
  1: { flow: ["Client", "Load Balancer", "App Servers", "Cache (Redis)", "DB (Key-Value)"], extras: [{ from: "App Servers", to: "Key Gen Service" }] },
  2: { flow: ["Client", "Load Balancer", "App Servers", "Metadata DB"], extras: [{ from: "App Servers", to: "Object Store (S3)" }, { from: "App Servers", to: "Cache (Redis)" }] },
  3: { flow: ["Client", "Load Balancer", "Timeline Service", "Timeline Cache (Redis)", "Tweet DB"], extras: [{ from: "Timeline Service", to: "Fan-out (Kafka)" }] },
  4: { flow: ["Client", "Load Balancer", "Post Service", "Feed Cache (Redis)", "Post DB"], extras: [{ from: "Client", to: "Object Store (S3)" }, { from: "Client", to: "CDN" }] },
  5: { flow: ["Client", "WebSocket Gateway", "Chat Servers", "Message Store (Cassandra)"], extras: [{ from: "Chat Servers", to: "Session Registry (Redis)" }, { from: "Chat Servers", to: "Pub/Sub (Kafka)" }] },
  6: { flow: ["Client", "API Gateway (limiter)", "Backend"], extras: [{ from: "API Gateway (limiter)", to: "Counter Store (Redis)" }] },
  7: { flow: ["Client", "Upload Store (S3)", "Transcoding Workers", "Processed Store (S3)", "CDN"], extras: [{ from: "Client", to: "Metadata DB" }] },
  8: { flow: ["Seed URLs", "URL Frontier", "Fetcher Workers", "Parser", "Content Store (S3)"], extras: [{ from: "Parser", to: "Dedup (Bloom)" }, { from: "Parser", to: "URL Frontier" }] },
  9: { flow: ["Services", "Notification API", "Queue (Kafka)", "Dispatcher Workers", "Channel Adapters"], extras: [{ from: "Channel Adapters", to: "Providers (FCM/SES/Twilio)" }] },
  10: { flow: ["Driver App", "Location Service", "Geo Index (Redis)", "Matching Service", "Trip DB"], extras: [{ from: "Matching Service", to: "Rider App" }] },
  11: { flow: ["Client (watcher)", "Metadata Service", "Metadata DB"], extras: [{ from: "Client (watcher)", to: "Chunk Store (S3)" }, { from: "Metadata Service", to: "Changes Feed" }] },
  12: { flow: ["Client", "Booking Service", "Seat Hold (atomic)", "Bookings DB (ACID)"], extras: [{ from: "Client", to: "Waiting Room" }, { from: "Booking Service", to: "Payment Gateway" }] },
  13: { flow: ["Client", "Consistent-Hash Router", "Cache Node", "Replica Node"], extras: [{ from: "Client", to: "Backing DB" }] },
  14: { flow: ["Client", "Autocomplete Service", "Trie / Top-K Store"], extras: [{ from: "Trie / Top-K Store", to: "Query Aggregation (offline)" }] },
  15: { flow: ["Client", "CDN", "Tile Store (S3)"], extras: [{ from: "Client", to: "Routing Service" }, { from: "Client", to: "Place Search" }] },
  16: { flow: ["Producers", "Brokers (Partitions)", "Consumer Groups"], extras: [{ from: "Brokers (Partitions)", to: "Replica Brokers" }] },
  17: { flow: ["Client", "Leaderboard Service", "Redis Sorted Set"], extras: [{ from: "Leaderboard Service", to: "Durable DB (scores)" }] },
  18: { flow: ["Client", "Payment Service", "Idempotency Check", "ACID DB + Ledger"], extras: [{ from: "Payment Service", to: "Payment Gateway" }, { from: "Payment Service", to: "Event Stream" }] },
  19: { flow: ["Client", "Coordinator Node", "Replica Nodes (N)"], extras: [{ from: "Coordinator Node", to: "Hash Ring" }] },
  20: { flow: ["Customer", "Order Service", "Order DB", "Dispatch Service", "Driver Index (Redis)"], extras: [{ from: "Order Service", to: "Events (Kafka)" }, { from: "Customer", to: "Restaurant Service" }] },
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Color-code boxes by role via keyword matching.
function colorFor(label, isFirst) {
  const l = label.toLowerCase();
  if (isFirst || /^(client|customer|producer|services|seed|driver app|rider app|user)/.test(l))
    return "#2563eb"; // client / entry - blue
  if (/kafka|queue|sqs|pub\/sub|event|stream/.test(l)) return "#7c3aed"; // messaging - purple
  if (/cache|redis|sorted set|index|registry|frontier|top-k|trie|counter|hash ring|bloom/.test(l))
    return "#059669"; // in-memory / index - green
  if (/s3|store|db|database|storage|ledger|graph|feed/.test(l)) return "#d97706"; // storage - amber
  if (/load balancer|gateway|cdn|router|coordinator|websocket|providers/.test(l)) return "#0891b2"; // edge/network - teal
  return "#475569"; // service - slate
}

function wrapText(label, maxChars) {
  const words = String(label).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxChars) {
      cur = (cur + " " + w).trim();
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function box(x, y, label, isFirst) {
  const fill = colorFor(label, isFirst);
  const lines = wrapText(label, 20);
  const lineH = 14;
  const startY = y + BOX_H / 2 - ((lines.length - 1) * lineH) / 2 + 4;
  const texts = lines
    .map(
      (ln, i) =>
        `<text x="${x + BOX_W / 2}" y="${startY + i * lineH}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="600">${esc(
          ln
        )}</text>`
    )
    .join("");
  return `<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="8" ry="8" fill="${fill}"/>${texts}`;
}

function hArrow(x1, y, x2) {
  return `<line x1="${x1}" y1="${y}" x2="${x2 - 8}" y2="${y}" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>`;
}
function diagArrow(x1, y1, x2, y2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2 - 8}" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>`;
}

function flowX(i) {
  return MARGIN + i * (BOX_W + GAP_X);
}

// Returns { svg, width, height }
function renderSvg(spec) {
  const flow = spec.flow;
  const extras = spec.extras || [];
  const n = flow.length;
  const width = MARGIN * 2 + n * BOX_W + (n - 1) * GAP_X;
  const hasExtras = extras.length > 0;
  const row2Y = ROW1_Y + BOX_H + GAP_Y;
  const height = (hasExtras ? row2Y + BOX_H : ROW1_Y + BOX_H) + MARGIN;

  const parts = [];
  // main flow boxes + arrows
  for (let i = 0; i < n; i++) {
    const x = flowX(i);
    parts.push(box(x, ROW1_Y, flow[i], i === 0));
    if (i < n - 1) parts.push(hArrow(x + BOX_W, ROW1_Y + BOX_H / 2, flowX(i + 1)));
  }
  // extras (row 2), positioned under their source flow box
  const usedByFrom = {};
  for (const ex of extras) {
    const fIdx = flow.indexOf(ex.from);
    const offset = usedByFrom[fIdx] || 0;
    usedByFrom[fIdx] = offset + 1;
    let ex_x = flowX(fIdx) + offset * (BOX_W + 24);
    ex_x = Math.max(MARGIN, Math.min(ex_x, width - MARGIN - BOX_W));
    parts.push(box(ex_x, row2Y, ex.to, false));
    parts.push(
      diagArrow(flowX(fIdx) + BOX_W / 2, ROW1_Y + BOX_H, ex_x + BOX_W / 2, row2Y)
    );
  }

  const defs =
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/></marker></defs>';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    defs +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
    parts.join("") +
    "</svg>";

  return { svg, width, height };
}

module.exports = { SPECS, renderSvg, BOX_W, BOX_H };
