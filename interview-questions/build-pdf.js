// Builds a PDF from the interview markdown files using Microsoft Edge (headless print-to-pdf).
// Zero npm dependencies. Injects inline SVG architecture diagrams and a clickable Table of Contents.
// Usage: node build-pdf.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { SPECS, renderSvg } = require("./diagrams");

const DIR = __dirname;
const HTML_OUT = path.join(DIR, "System-Design-Interviews-Top20.html");
const PDF_OUT = path.join(DIR, "System-Design-Interviews-Top20.pdf");

const FILES = ["00-intro.md", "01-part-a.md", "02-part-b.md", "03-part-c.md", "04-part-d.md"];

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
function findEdge() {
  return EDGE_PATHS.find((p) => fs.existsSync(p));
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Inline markdown: bold, italic, code, links.
function inline(text) {
  let out = "";
  let i = 0;
  let bold = false;
  let italic = false;
  let code = false;
  // handle links first
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`") {
      out += code ? "</code>" : "<code>";
      code = !code;
      i++;
      continue;
    }
    if (!code && ch === "*" && text[i + 1] === "*") {
      out += bold ? "</strong>" : "<strong>";
      bold = !bold;
      i += 2;
      continue;
    }
    if (!code && ch === "*") {
      out += italic ? "</em>" : "<em>";
      italic = !italic;
      i++;
      continue;
    }
    out += esc(ch);
    i++;
  }
  if (code) out += "</code>";
  if (italic) out += "</em>";
  if (bold) out += "</strong>";
  return out;
}

const tocEntries = [];

function isTableRow(l) {
  return /^\s*\|.*\|\s*$/.test(l);
}
function isTableSep(l) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes("-");
}
function splitRow(l) {
  let s = l.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let listType = null;
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (t.startsWith("```")) {
      closeList();
      i++;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre>${esc(code.join("\n"))}</pre>`);
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeList();
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const header = rows[0];
      const body = rows.slice(2);
      let tb = "<table><thead><tr>";
      tb += header.map((c) => `<th>${inline(c)}</th>`).join("");
      tb += "</tr></thead><tbody>";
      tb += body.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("");
      tb += "</tbody></table>";
      out.push(tb);
      continue;
    }
    if (t === "") {
      closeList();
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      closeList();
      out.push("<hr/>");
      i++;
      continue;
    }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      const text = h[2];
      if (level === 1) {
        const id = slug(text);
        tocEntries.push({ id, text });
        out.push(`<h1 id="${id}">${inline(text)}</h1>`);
        // inject diagram after a system heading like "1. URL Shortener ..."
        const m = text.match(/^(\d+)\.\s+/);
        if (m && SPECS[m[1]]) {
          const { svg } = renderSvg(SPECS[m[1]]);
          out.push(`<figure class="diagram">${svg}<figcaption>Architecture overview</figcaption></figure>`);
        }
      } else {
        out.push(`<h${level}>${inline(text)}</h${level}>`);
      }
      i++;
      continue;
    }
    if (t.startsWith(">")) {
      closeList();
      out.push(`<blockquote>${inline(t.replace(/^>\s?/, ""))}</blockquote>`);
      i++;
      continue;
    }
    const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inline(ul[2])}</li>`);
      i++;
      continue;
    }
    const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inline(ol[3])}</li>`);
      i++;
      continue;
    }
    closeList();
    out.push(`<p>${inline(t)}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}

const CSS = `
  @page { size: Letter; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 20pt; color: #14375a; border-bottom: 2px solid #14375a; padding-bottom: 5px; break-before: page; margin-top: 0; }
  h1:first-of-type { break-before: avoid; }
  h2 { font-size: 14pt; color: #1f4e79; margin-top: 16px; }
  h3 { font-size: 11.5pt; color: #2e5f8a; margin-top: 12px; }
  code { font-family: Consolas, monospace; background: #f2f2f2; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
  pre { font-family: Consolas, monospace; background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 10px; white-space: pre-wrap; font-size: 9pt; line-height: 1.35; overflow-wrap: anywhere; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; }
  th, td { border: 1px solid #b0b0b0; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #14375a; color: #fff; }
  blockquote { border-left: 4px solid #1f4e79; margin: 8px 0; padding: 6px 12px; background: #eef3f8; }
  ul, ol { margin: 6px 0 6px 22px; }
  li { margin: 2px 0; }
  hr { border: none; border-top: 1px solid #ccc; margin: 14px 0; }
  figure.diagram { text-align: center; margin: 14px 0; padding: 10px; border: 1px solid #e1e4e8; border-radius: 8px; background: #fafbfc; break-inside: avoid; }
  figure.diagram svg { max-width: 100%; height: auto; }
  figcaption { font-size: 8.5pt; color: #666; margin-top: 6px; font-style: italic; }
  .cover { text-align: center; padding-top: 150px; break-after: page; }
  .cover h1 { font-size: 30pt; border: none; break-before: avoid; }
  .cover .sub { font-size: 14pt; color: #1f4e79; margin-top: 8px; }
  .cover .desc { font-size: 10pt; color: #555; margin-top: 14px; }
  .toc { break-after: page; }
  .toc h2 { border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .toc a { color: #1f4e79; text-decoration: none; }
  .toc li { margin: 4px 0; }
`;

function build() {
  const bodyParts = FILES.map((f) => mdToHtml(fs.readFileSync(path.join(DIR, f), "utf8")));
  const body = bodyParts.join("\n");

  const toc =
    '<nav class="toc"><h2>Table of Contents</h2><ul>' +
    tocEntries.map((e) => `<li><a href="#${e.id}">${esc(e.text)}</a></li>`).join("") +
    "</ul></nav>";

  const cover =
    '<div class="cover"><h1>System Design Interviews</h1>' +
    '<div class="sub">Top 20 Questions — 7-Step Framework + AWS Well-Architected Review</div>' +
    '<div class="desc">Functional &amp; Non-Functional Requirements · Core Entities · API · High-Level Design · Deep Dives · Trade-offs · 6 AWS Pillars</div></div>';

  const html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'><style>" +
    CSS +
    "</style></head><body>" +
    cover +
    toc +
    body +
    "</body></html>";

  fs.writeFileSync(HTML_OUT, html, "utf8");
  console.log("Wrote HTML:", HTML_OUT);

  const edge = findEdge();
  if (!edge) {
    console.error("Microsoft Edge not found; HTML written but PDF not generated.");
    process.exit(1);
  }
  const fileUrl = "file:///" + HTML_OUT.replace(/\\/g, "/");
  execFileSync(
    edge,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${PDF_OUT}`,
      fileUrl,
    ],
    { stdio: "ignore", timeout: 120000 }
  );
  const kb = (fs.statSync(PDF_OUT).size / 1024).toFixed(1);
  console.log("Created PDF:", PDF_OUT, `(${kb} KB)`);
}

build();
