// Builds a single Word .docx from the system-design learning markdown files.
// Zero dependencies: uses only Node built-ins (fs, path, zlib).
// A .docx is a ZIP archive of WordprocessingML XML parts, both of which we build by hand.
// Usage: node build-docx.js   (or: npm run build)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DIR = __dirname;
const OUTPUT = path.join(DIR, "System-Design-Learning.docx");

// Order matters: README (index) first, then parts 1-5.
const FILES = [
  "README.md",
  "part-1-fundamentals.md",
  "part-2-components.md",
  "part-3-databases.md",
  "part-4-scalability-growth.md",
  "part-5-reliability-advanced.md",
];

// ---------------------------------------------------------------------------
// Minimal ZIP writer (store or deflate), enough for a valid .docx container.
// ---------------------------------------------------------------------------
let crcTable;
function makeCrcTable() {
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
}
function crc32(buf) {
  if (!crcTable) makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const stored = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, stored);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(stored.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    offset += 30 + nameBuf.length + stored.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

// ---------------------------------------------------------------------------
// Markdown -> WordprocessingML
// ---------------------------------------------------------------------------
function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Parse inline markdown (bold/italic/code) into runs. Links become plain text.
function parseInline(text) {
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links -> label
  const runs = [];
  let cur = "";
  let bold = false;
  let italic = false;
  let code = false;
  const push = () => {
    if (cur) runs.push({ text: cur, bold, italic, code });
    cur = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      push();
      code = !code;
      i++;
      continue;
    }
    if (!code && text[i] === "*" && text[i + 1] === "*") {
      push();
      bold = !bold;
      i += 2;
      continue;
    }
    if (!code && text[i] === "*") {
      push();
      italic = !italic;
      i++;
      continue;
    }
    cur += text[i];
    i++;
  }
  push();
  return runs.length ? runs : [{ text: "", bold, italic, code }];
}

function runXml(run, extraRpr = "") {
  let rpr = "";
  if (run.bold) rpr += "<w:b/>";
  if (run.italic) rpr += "<w:i/>";
  if (run.code)
    rpr +=
      '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';
  rpr += extraRpr;
  const rprXml = rpr ? `<w:rPr>${rpr}</w:rPr>` : "";
  return `<w:r>${rprXml}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function runsXml(text, extraRpr = "") {
  return parseInline(text)
    .map((r) => runXml(r, extraRpr))
    .join("");
}

function para(inner, opts = {}) {
  const { style, jc, indLeft, hanging, extraPpr } = opts;
  let ppr = "";
  if (style) ppr += `<w:pStyle w:val="${style}"/>`;
  if (extraPpr) ppr += extraPpr;
  if (indLeft != null)
    ppr += `<w:ind w:left="${indLeft}"${hanging ? ` w:hanging="${hanging}"` : ""}/>`;
  if (jc) ppr += `<w:jc w:val="${jc}"/>`;
  const pprXml = ppr ? `<w:pPr>${ppr}</w:pPr>` : "";
  return `<w:p>${pprXml}${inner}</w:p>`;
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const TABLE_BORDERS =
  "<w:tblBorders>" +
  '<w:top w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:left w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:bottom w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:right w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:insideH w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:insideV w:val="single" w:sz="4" w:color="999999"/>' +
  "</w:tblBorders>";

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function tableXml(rows) {
  const header = rows[0];
  const body = rows.slice(2); // skip header + separator row
  const cell = (content, isHeader) => {
    const extraRpr = isHeader ? '<w:color w:val="FFFFFF"/><w:b/>' : "";
    const shd = isHeader
      ? '<w:shd w:val="clear" w:color="auto" w:fill="14375A"/>'
      : "";
    return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${shd}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${runsXml(
      content,
      extraRpr
    )}</w:p></w:tc>`;
  };
  const tr = (cells, isHeader) =>
    `<w:tr>${cells.map((c) => cell(c, isHeader)).join("")}</w:tr>`;
  const rowsXml = tr(header, true) + body.map((r) => tr(r, false)).join("");
  const tbl =
    "<w:tbl><w:tblPr>" +
    '<w:tblW w:w="0" w:type="auto"/>' +
    TABLE_BORDERS +
    "</w:tblPr>" +
    rowsXml +
    "</w:tbl>";
  return tbl + para(""); // trailing empty paragraph after table
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}
function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block
    if (trimmed.startsWith("```")) {
      i++;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      for (const c of code) {
        out.push(
          para(`<w:r><w:t xml:space="preserve">${escapeXml(c)}</w:t></w:r>`, {
            style: "Code",
          })
        );
      }
      out.push(para("", { style: "Code" }));
      continue;
    }

    // Table
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(tableXml(rows));
      continue;
    }

    // Blank line
    if (trimmed === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push(
        para("", {
          extraPpr:
            '<w:pBdr><w:bottom w:val="single" w:sz="6" w:color="999999" w:space="1"/></w:pBdr>',
        })
      );
      i++;
      continue;
    }

    // Heading
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length, 3);
      out.push(para(runsXml(h[2]), { style: "Heading" + level }));
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const content = trimmed.replace(/^>\s?/, "");
      out.push(
        para(runsXml(content), {
          style: "Quote",
          indLeft: 360,
          extraPpr:
            '<w:pBdr><w:left w:val="single" w:sz="18" w:color="1F4E79" w:space="4"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEF3F8"/>',
        })
      );
      i++;
      continue;
    }

    // Unordered list item
    const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      const level = Math.floor(ul[1].length / 2);
      const indLeft = 360 + level * 360;
      out.push(
        para(runXml({ text: "\u2022  " }) + runsXml(ul[2]), {
          indLeft,
          hanging: 360,
        })
      );
      i++;
      continue;
    }

    // Ordered list item
    const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ol) {
      const level = Math.floor(ol[1].length / 2);
      const indLeft = 360 + level * 360;
      out.push(
        para(runXml({ text: ol[2] + ".  " }) + runsXml(ol[3]), {
          indLeft,
          hanging: 360,
        })
      );
      i++;
      continue;
    }

    // Normal paragraph
    out.push(para(runsXml(trimmed)));
    i++;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Assemble the document
// ---------------------------------------------------------------------------
function preprocess(md) {
  // Mermaid diagrams can't render in Word; keep the source as readable text.
  return md.replace(/```mermaid/g, "```\n[Diagram (Mermaid source)]");
}

function buildDocumentXml() {
  const cover =
    para(runsXml("System Design Learning"), { style: "Title", jc: "center" }) +
    para(runsXml("**100 Questions & Answers — In-Depth Edition**"), {
      jc: "center",
    }) +
    para(runsXml("Components · Theory · Concepts · How systems grow with users"), {
      jc: "center",
    }) +
    PAGE_BREAK;

  const body = FILES.map((file, idx) => {
    const md = preprocess(fs.readFileSync(path.join(DIR, file), "utf8"));
    const rendered = renderMarkdown(md);
    return idx === 0 ? rendered : PAGE_BREAK + rendered;
  }).join("");

  const sectPr =
    "<w:sectPr>" +
    '<w:footerReference w:type="default" r:id="rIdFooter"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
    "</w:sectPr>";

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<w:body>" +
    cover +
    body +
    sectPr +
    "</w:body></w:document>"
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  "<w:docDefaults><w:rPrDefault><w:rPr>" +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>' +
  "</w:rPr></w:rPrDefault></w:docDefaults>" +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>' +
  '<w:pPr><w:spacing w:before="2400" w:after="240"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="14375A"/><w:sz w:val="64"/><w:szCs w:val="64"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/>' +
  '<w:pBdr><w:bottom w:val="single" w:sz="8" w:color="14375A" w:space="2"/></w:pBdr></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="14375A"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="2E5F8A"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>' +
  '<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/></w:pPr>' +
  '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>' +
  '<w:rPr><w:i/><w:color w:val="333333"/></w:rPr></w:style>' +
  "</w:styles>";

const FOOTER_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
  "</Types>";

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
  "</Relationships>";

function main() {
  const documentXml = buildDocumentXml();
  const entries = [
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS },
    { name: "word/styles.xml", data: STYLES_XML },
    { name: "word/footer1.xml", data: FOOTER_XML },
  ];
  const buffer = zip(entries);
  fs.writeFileSync(OUTPUT, buffer);
  console.log("Created:", OUTPUT);
  console.log("Size:", (buffer.length / 1024).toFixed(1), "KB");
}

main();
