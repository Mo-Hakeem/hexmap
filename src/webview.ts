import { ParsedImage } from './parsers';

export interface HexRow {
  kind: 'data' | 'gap' | 'segment';
  addr: number;          // data rows: 16-byte aligned row addr; gap/segment: start addr
  endAddr?: number;      // gap/segment rows: end address
  skip?: number;         // data rows: leading empty byte slots before first byte
  bytes?: number[];      // data rows only
  ascii?: string;
}

export interface WebviewPayload {
  fileName: string;
  format: ParsedImage['format'];
  entryPoint?: number;
  warnings: string[];
  stats: { min: number; max: number; segs: number; gaps: number; bytes: number };
  fileSize: number;
  sha256: string;
  payloadSha256: string;
  payloadCrc32: number;
  segments: { addr: number; len: number; b64: string }[];
  gaps: { addr: number; len: number }[];
}

const DEFAULT_ROW_BYTES = 16;

export function buildRows(image: ParsedImage, rowBytes = DEFAULT_ROW_BYTES): HexRow[] {
  const rows: HexRow[] = [];
  const segs = image.segments;

  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    const segEnd = seg.addr + seg.data.length;

    const prevEnd = s === 0 ? undefined : segs[s - 1].addr + segs[s - 1].data.length;
    if (prevEnd !== undefined && seg.addr > prevEnd) {
      rows.push({ kind: 'gap', addr: prevEnd, endAddr: seg.addr });
    }

    rows.push({
      kind: 'segment',
      addr: seg.addr,
      endAddr: segEnd,
      bytes: [],
    });

    let off = 0;
    while (off < seg.data.length) {
      const rowStart = seg.addr + off;
      const aligned = rowStart - (rowStart % rowBytes);
      const skip = rowStart - aligned;
      const take = Math.min(rowBytes - skip, seg.data.length - off);
      const bytes = Array.from(seg.data.subarray(off, off + take));
      const ascii = bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
      rows.push({ kind: 'data', addr: aligned, skip, bytes, ascii });
      off += take;
    }
  }
  return rows;
}

function statsOf(image: ParsedImage): { min: number; max: number; segs: number; gaps: number; bytes: number } {
  let min = Infinity, max = 0, bytes = 0, gaps = 0;
  const segs = image.segments;
  for (let i = 0; i < segs.length; i++) {
    min = Math.min(min, segs[i].addr);
    max = Math.max(max, segs[i].addr + segs[i].data.length);
    bytes += segs[i].data.length;
    if (i > 0) {
      const prevEnd = segs[i - 1].addr + segs[i - 1].data.length;
      if (segs[i].addr > prevEnd) gaps++;
    }
  }
  if (segs.length === 0) { min = 0; max = 0; }
  return { min, max, segs: segs.length, gaps, bytes };
}

export function buildWebviewPayload(image: ParsedImage, fileName: string): WebviewPayload {
  const stats = statsOf(image);
  const segments: { addr: number; len: number; b64: string }[] = [];
  const gaps: { addr: number; len: number }[] = [];
  for (let i = 0; i < image.segments.length; i++) {
    const s = image.segments[i];
    segments.push({
      addr: s.addr,
      len: s.data.length,
      b64: Buffer.from(s.data.buffer, s.data.byteOffset, s.data.byteLength).toString('base64'),
    });
    if (i > 0) {
      const prevEnd = image.segments[i - 1].addr + image.segments[i - 1].data.length;
      if (s.addr > prevEnd) gaps.push({ addr: prevEnd, len: s.addr - prevEnd });
    }
  }
  return {
    fileName,
    format: image.format,
    entryPoint: image.entryPoint,
    warnings: image.warnings,
    stats,
    fileSize: image.fileSize,
    sha256: image.sha256,
    payloadSha256: image.payloadSha256,
    payloadCrc32: image.payloadCrc32,
    segments,
    gaps,
  };
}

export function getWebviewContent(image: ParsedImage, fileName: string): string {
  const payload = JSON.stringify(buildWebviewPayload(image, fileName));
  const safePayload = payload.replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: var(--vscode-editor-font-family, 'Cascadia Code', Consolas, 'Courier New', monospace);
    font-size: 12px;
    margin: 0;
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #d4d4d4);
    user-select: text;
    display: flex; flex-direction: column; overflow: hidden;
  }
  #toolbar {
    display: flex; gap: 8px; align-items: center;
    padding: 6px 8px; flex: 0 0 auto;
    background: var(--vscode-editorWidget-background, #252526);
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    flex-wrap: wrap;
  }
  #toolbar label { display: flex; gap: 4px; align-items: center; white-space: nowrap; }
  input[type="text"], select, button {
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #d4d4d4);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 2px 6px; border-radius: 3px; font: inherit;
  }
  input[type="text"]:focus, select:focus, button:focus {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }
  button { cursor: pointer; }
  button:hover { filter: brightness(1.15); }
  button.active {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border-color: var(--vscode-button-background, #0e639c);
  }
  #search { width: 190px; }
  #gotoAddr, #baseAddr { width: 96px; }
  #findNav { display: inline-flex; gap: 3px; align-items: center; }
  #findCount { color: var(--vscode-descriptionForeground, #999); font-size: 11px; min-width: 44px; text-align: center; }
  #stats { margin-left: auto; font-size: 11px; display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .stat-pill {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 1px 6px; border-radius: 3px;
    background: rgba(128, 128, 128, 0.14);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    color: var(--vscode-editor-foreground, #d4d4d4);
    white-space: nowrap;
  }
  .stat-pill.fmt { color: var(--vscode-textLink-foreground, #9cdcfe); font-weight: 600; text-transform: uppercase; }
  .stat-pill.entry { color: var(--vscode-charts-green, #6a9955); cursor: pointer; }
  .stat-pill.clickable { cursor: pointer; }
  .stat-pill.clickable:hover, .stat-pill.entry:hover { border-color: var(--vscode-focusBorder, #007fd4); filter: brightness(1.15); }
  #memMap {
    height: 10px; flex: 0 0 auto; position: relative; cursor: pointer;
    background: var(--vscode-editorGutter-background, #181818);
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
  }
  #memMap .seg-bar {
    position: absolute; top: 1px; bottom: 1px; min-width: 2px;
    background: var(--vscode-charts-purple, #c586c0); opacity: 0.75;
  }
  #memMap .view-bar {
    position: absolute; top: 0; bottom: 0; min-width: 3px;
    border: 1px solid var(--vscode-focusBorder, #007fd4);
    background: rgba(0, 127, 212, 0.25); pointer-events: none;
  }
  #memMap .entry-tick {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: var(--vscode-charts-green, #6a9955); pointer-events: none;
  }
  .drawer {
    flex: 0 0 auto; max-height: 220px; overflow: auto;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-editorWidget-background, #252526);
    padding: 6px 10px; font-size: 11px; display: none;
  }
  .drawer.open { display: block; }
  .clickable-row { cursor: pointer; }
  .clickable-row:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  #warnings {
    color: var(--vscode-editorWarning-foreground, #dcdcaa);
    font-size: 11px; padding: 4px 8px; flex: 0 0 auto;
    white-space: pre-wrap; max-height: 70px; overflow: auto;
    display: none; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
  }
  #warnings.open { display: block; }
  #scroller { flex: 1 1 auto; overflow-y: auto; overflow-x: auto; position: relative; overflow-anchor: none; }
  table.hex-table { border-collapse: collapse; width: 100%; table-layout: fixed; min-width: 680px; }
  table.hex-table td, table.hex-table th {
    padding: 0 6px; text-align: left; vertical-align: top;
    white-space: pre; height: 18px; line-height: 18px; overflow: hidden;
  }
  thead th {
    height: auto; overflow: visible; padding: 2px 6px 3px;
    color: var(--vscode-descriptionForeground, #808080); font-weight: normal;
    position: sticky; top: 0; z-index: 1;
    background: var(--vscode-editor-background, #1e1e1e);
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
  }
  .col-addr { width: 112px; }
  .col-hex  { width: 428px; }
  .col-ascii{ width: auto; }
  tr { overflow-anchor: none; height: 18px; }
  tr.data:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  tr.hit td { background: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.28)) !important; }
  tr.hit .addr { color: var(--vscode-editorWarning-foreground, #d7ba7d); }
  tr.match td { background: rgba(46, 160, 67, 0.14); }
  .addr { color: var(--vscode-textLink-foreground, #569cd6); cursor: pointer; }
  .hex { color: var(--vscode-debugTokenExpression-string, #ce9178); }
  .ascii { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
  tr.gap td { color: var(--vscode-descriptionForeground, #808080); font-style: italic; background: rgba(128,128,128,0.06); }
  tr.gap .addr { color: var(--vscode-charts-green, #6a9955); cursor: default; }
  tr.segment td { color: var(--vscode-charts-purple, #c586c0); background: rgba(197, 134, 192, 0.08); box-shadow: inset 0 1px 0 var(--vscode-panel-border, #3c3c3c); }
  tr.segment .addr { color: var(--vscode-charts-purple, #c586c0); cursor: default; }
  #topSpacer td, #botSpacer td { height: 0; padding: 0; line-height: 0; font-size: 0; }
  #scroller table.noascii .col-ascii, #scroller table.noascii td.ascii { display: none; }
  #hexHead .lanes { color: var(--vscode-charts-green, #6a9955); display: block; line-height: 16px; }
  .b-tok, .a-tok { cursor: pointer; border-radius: 2px; }
  .b-tok:hover, .a-tok:hover { outline: 1px solid var(--vscode-focusBorder, #007fd4); }
  .b-tok.sel, .a-tok.sel {
    background: var(--vscode-editor-selectionBackground, #264f78);
    color: var(--vscode-editor-selectionForeground, #ffffff);
  }
  .b-tok.fhit, .a-tok.fhit {
    background: var(--vscode-editor-findMatchBackground, #515c6a);
    outline: 1px solid var(--vscode-editorWarning-foreground, #d7ba7d);
  }
  .b-pad { opacity: 0.35; }
  #inspector {
    flex: 0 0 auto; padding: 5px 8px; font-size: 11px;
    background: var(--vscode-editorWidget-background, #252526);
    border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  }
  .insp-kv { display: inline-flex; gap: 4px; align-items: baseline; }
  .insp-k { color: var(--vscode-descriptionForeground, #808080); }
  .insp-v { color: var(--vscode-editor-foreground, #d4d4d4); font-weight: 500; }
  .insp-actions { margin-left: auto; display: inline-flex; gap: 4px; }
  #toast {
    position: fixed; bottom: 38px; right: 16px; padding: 4px 10px;
    background: var(--vscode-notifications-background, #333);
    color: var(--vscode-notifications-foreground, #fff);
    border: 1px solid var(--vscode-focusBorder, #007fd4);
    border-radius: 3px; font-size: 11px; opacity: 0; pointer-events: none;
    transition: opacity 0.15s ease;
  }
  #toast.show { opacity: 1; }
</style>
</head>
<body>
<div id="toolbar">
  <label>Find <input id="search" type="text" placeholder="0xaddr, hex bytes, or ASCII"></label>
  <span id="findNav">
    <button id="findPrev" type="button" title="Previous match (Shift+Enter)">&#9650;</button>
    <button id="findNext" type="button" title="Next match (Enter)">&#9660;</button>
    <span id="findCount"></span>
  </span>
  <label title="Hide non-matching rows"><input type="checkbox" id="filterMode"> filter</label>
  <label>Cols
    <select id="colCount">
      <option value="8">8</option>
      <option value="16" selected>16</option>
      <option value="32">32</option>
    </select>
  </label>
  <label>Group
    <select id="groupSize">
      <option value="1" selected>1</option>
      <option value="2">2</option>
      <option value="4">4</option>
      <option value="8">8</option>
    </select>
  </label>
  <label>Endian
    <select id="endian">
      <option value="le" selected>LE</option>
      <option value="be">BE</option>
    </select>
  </label>
  <label><input type="checkbox" id="showAscii" checked> ASCII</label>
  <label><input type="checkbox" id="hideGaps"> hide gaps</label>
  <label><input type="checkbox" id="hideData"> hide data</label>
  <label id="baseWrap" style="display:none;" title="Base address for raw binary">Base <input id="baseAddr" type="text" value="0x00000000"></label>
  <label>Goto <input id="gotoAddr" type="text" placeholder="0x0800"><button id="gotoBtn" type="button">Go</button></label>
  <button id="stringsBtn" type="button">Strings</button>
  <button id="infoBtn" type="button">Info</button>
  <span id="stats"></span>
</div>
<div id="memMap" title="Memory map (click to jump)"></div>
<div id="infoPanel" class="drawer"></div>
<div id="stringsPanel" class="drawer"></div>
<div id="warnings"></div>
<div id="scroller">
  <table class="hex-table">
    <thead><tr><th class="col-addr">Address</th><th class="col-hex" id="hexHead">Bytes</th><th class="col-ascii" id="asciiHead">ASCII</th></tr></thead>
    <tbody id="body">
      <tr id="topSpacer"><td colspan="3"></td></tr>
      <tr id="botSpacer"><td colspan="3"></td></tr>
    </tbody>
  </table>
</div>
<div id="inspector"><span class="insp-k">Click any byte to inspect &bull; Shift+Click to select a range</span></div>
<div id="toast"></div>
<script>
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
let DATA = ${safePayload};

const scroller = document.getElementById('scroller');
const body = document.getElementById('body');
const topSpacer = document.getElementById('topSpacer');
const botSpacer = document.getElementById('botSpacer');
const statsEl = document.getElementById('stats');
const warnEl = document.getElementById('warnings');
const searchEl = document.getElementById('search');
const filterModeEl = document.getElementById('filterMode');
const findPrevEl = document.getElementById('findPrev');
const findNextEl = document.getElementById('findNext');
const findCountEl = document.getElementById('findCount');
const hideGapsEl = document.getElementById('hideGaps');
const hideDataEl = document.getElementById('hideData');
const colCountEl = document.getElementById('colCount');
const groupSizeEl = document.getElementById('groupSize');
const endianEl = document.getElementById('endian');
const showAsciiEl = document.getElementById('showAscii');
const baseWrapEl = document.getElementById('baseWrap');
const baseAddrEl = document.getElementById('baseAddr');
const gotoAddrEl = document.getElementById('gotoAddr');
const gotoBtnEl = document.getElementById('gotoBtn');
const infoBtnEl = document.getElementById('infoBtn');
const stringsBtnEl = document.getElementById('stringsBtn');
const infoPanelEl = document.getElementById('infoPanel');
const stringsPanelEl = document.getElementById('stringsPanel');
const memMapEl = document.getElementById('memMap');
const inspectorEl = document.getElementById('inspector');
const tableEl = document.querySelector('#scroller table');
const hexHeadEl = document.getElementById('hexHead');
const toastEl = document.getElementById('toast');

const ROW_H = 18;
const OVERSCAN = 15;
let VIEW_ROWS = 60;
let RENDER_ROWS = VIEW_ROWS + OVERSCAN * 2;

let rowBytes = 16;
let groupSize = 1;
let endian = 'le';
let showAscii = true;
let filterMode = false;
let baseOffset = 0;
let findQ = '';
let targetAll = -1;
let selAnchor = null; // absolute address
let selStart = null;  // inclusive
let selEnd = null;    // inclusive
let findHits = [];    // { addr, len }
let findCursor = -1;

let ALL = [];
let SEG_CHUNKS = []; // contiguous { addr, bytes: Uint8Array } for fast search/inspect
let vis = [];
let baseStats = '';
let lastStart = -1, lastEnd = -1, lastTotal = -1;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

function copyText(text, label) {
  if (vscode) vscode.postMessage({ type: 'copy', text });
  else if (navigator.clipboard) navigator.clipboard.writeText(text);
  showToast('Copied ' + (label || text));
}

function fmtAddr(a) {
  return '0x' + (a >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function hexOf(b) { return b.toString(16).padStart(2, '0'); }

function saveState() {
  if (!vscode) return;
  vscode.setState({
    rowBytes, groupSize, endian, showAscii, filterMode,
    hideGaps: hideGapsEl.checked,
    hideData: hideDataEl.checked,
    baseOffset,
    search: searchEl.value,
    scrollTop: scroller.scrollTop,
  });
}

function restoreState() {
  if (!vscode) return;
  const st = vscode.getState();
  if (!st) return;
  if (st.rowBytes) { rowBytes = st.rowBytes; colCountEl.value = String(rowBytes); }
  if (st.groupSize) { groupSize = st.groupSize; groupSizeEl.value = String(groupSize); }
  if (st.endian) { endian = st.endian; endianEl.value = endian; }
  if (typeof st.showAscii === 'boolean') {
    showAscii = st.showAscii; showAsciiEl.checked = showAscii;
    tableEl.classList.toggle('noascii', !showAscii);
  }
  if (typeof st.filterMode === 'boolean') { filterMode = st.filterMode; filterModeEl.checked = filterMode; }
  if (typeof st.hideGaps === 'boolean') hideGapsEl.checked = st.hideGaps;
  if (typeof st.hideData === 'boolean') hideDataEl.checked = st.hideData;
  if (typeof st.baseOffset === 'number' && DATA.format === 'binary') {
    baseOffset = st.baseOffset >>> 0;
    baseAddrEl.value = fmtAddr(baseOffset);
  }
  if (typeof st.search === 'string') searchEl.value = st.search;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function rebuildModel() {
  const shift = DATA.format === 'binary' ? baseOffset : 0;
  SEG_CHUNKS = DATA.segments.map(s => ({
    addr: (s.addr + shift) >>> 0,
    bytes: b64ToBytes(s.b64),
  }));

  ALL = [];
  for (let s = 0; s < SEG_CHUNKS.length; s++) {
    const ch = SEG_CHUNKS[s];
    const segEnd = (ch.addr + ch.bytes.length) >>> 0;
    if (s > 0) {
      const prevEnd = (SEG_CHUNKS[s - 1].addr + SEG_CHUNKS[s - 1].bytes.length) >>> 0;
      if (ch.addr > prevEnd) {
        ALL.push({
          kind: 'gap', addr: prevEnd, end: ch.addr,
          a: fmtAddr(prevEnd) + ' ... ' + fmtAddr(ch.addr - 1),
          h: 'GAP  ' + (ch.addr - prevEnd) + ' bytes skipped',
          s: '',
          text: (fmtAddr(prevEnd) + ' ' + fmtAddr(ch.addr - 1) + ' gap ' + (ch.addr - prevEnd)).toLowerCase(),
        });
      }
    }
    ALL.push({
      kind: 'segment', addr: ch.addr, end: segEnd,
      a: fmtAddr(ch.addr),
      h: '--- segment start (' + ch.bytes.length + ' bytes) ---',
      s: '',
      text: (fmtAddr(ch.addr) + ' segment').toLowerCase(),
    });

    let off = 0;
    while (off < ch.bytes.length) {
      const rowStart = (ch.addr + off) >>> 0;
      const aligned = (rowStart - (rowStart % rowBytes)) >>> 0;
      const skip = rowStart - aligned;
      const take = Math.min(rowBytes - skip, ch.bytes.length - off);
      const sub = ch.bytes.subarray(off, off + take);
      const bytes = Array.from(sub);
      let ascii = '';
      let hexStr = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        ascii += (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');
        hexStr += (i > 0 ? ' ' : '') + hexOf(b);
      }
      ALL.push({
        kind: 'data', addr: aligned, skip, b: bytes,
        a: fmtAddr(aligned),
        h: hexStr,
        s: ascii,
        text: (fmtAddr(aligned) + ' ' + hexStr + ' ' + ascii).toLowerCase(),
      });
      off += take;
    }
  }

  baseWrapEl.style.display = DATA.format === 'binary' ? 'flex' : 'none';

  const segsShifted = DATA.segments.map(s => ({ addr: (s.addr + shift) >>> 0, len: s.len }));
  const gapsShifted = DATA.gaps.map(g => ({ addr: (g.addr + shift) >>> 0, len: g.len }));
  const fmtBytesShort = (n) => n >= 1048576 ? (n / 1048576).toFixed(2) + ' MiB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KiB' : n + ' B';

  baseStats =
    '<span class="stat-pill fmt" title="Detected image format">' + DATA.format + '</span>' +
    '<span class="stat-pill clickable" id="statSummary" title="' + DATA.stats.bytes.toLocaleString() + ' bytes across ' + DATA.stats.segs + ' segment(s) and ' + DATA.stats.gaps + ' gap(s) — click for File Info">' +
      fmtBytesShort(DATA.stats.bytes) + ' &middot; ' + DATA.stats.segs + ' seg' +
      (DATA.stats.gaps ? ' &middot; ' + DATA.stats.gaps + ' gap' : '') +
    '</span>' +
    (DATA.entryPoint !== undefined
      ? '<span class="stat-pill entry" data-jump="' + DATA.entryPoint + '" title="Jump to entry point ' + fmtAddr(DATA.entryPoint) + '">entry ' + fmtAddr(DATA.entryPoint) + '</span>'
      : '');

  if (DATA.warnings && DATA.warnings.length) {
    warnEl.textContent = DATA.warnings.slice(0, 8).join('\\n') +
      (DATA.warnings.length > 8 ? '\\n... +' + (DATA.warnings.length - 8) + ' more' : '');
    warnEl.classList.add('open');
  } else {
    warnEl.classList.remove('open');
  }

  buildInfo(segsShifted, gapsShifted, shift);
  buildMemMap(segsShifted, shift);
  if (stringsPanelEl.classList.contains('open')) buildStrings();
}

function buildInfo(segsShifted, gapsShifted, shift) {
  const fmtSize = (n) => {
    if (n >= 1048576) return n.toLocaleString() + ' B (' + (n / 1048576).toFixed(2) + ' MiB)';
    if (n >= 1024) return n.toLocaleString() + ' B (' + (n / 1024).toFixed(1) + ' KiB)';
    return n.toLocaleString() + ' B';
  };
  const fmtNum = (n) => n.toLocaleString();
  const gapBytes = gapsShifted.reduce((a, g) => a + g.len, 0);
  const minA = (DATA.stats.min + shift) >>> 0;
  const maxA = (DATA.stats.max + shift) >>> 0;
  const span = DATA.stats.max - DATA.stats.min;
  const util = span > 0 ? ((DATA.stats.bytes / span) * 100).toFixed(1) + '%' : 'n/a';

  let h = '<table style="border-collapse:collapse;">';
  const row = (k, v) => '<tr><td style="color:#808080;padding:1px 12px 1px 0;white-space:nowrap;">' + k + '</td><td style="padding:1px 0;word-break:break-all;">' + v + '</td></tr>';
  h += row('File', DATA.fileName);
  h += row('Size', fmtSize(DATA.fileSize));
  h += row('Format', DATA.format);
  h += row('File SHA-256', DATA.sha256);
  h += row('Payload SHA-256', DATA.payloadSha256);
  h += row('Payload CRC-32', '0x' + DATA.payloadCrc32.toString(16).toUpperCase().padStart(8, '0'));
  h += row('Address range', fmtAddr(minA) + ' - ' + fmtAddr(maxA > 0 ? maxA - 1 : 0) + ' (span ' + fmtSize(span) + ')');
  h += row('Data bytes', fmtNum(DATA.stats.bytes) + ' (' + util + ' of span)');
  h += row('Segments', DATA.stats.segs);
  h += row('Gaps', DATA.stats.gaps + (DATA.stats.gaps ? ' (' + fmtNum(gapBytes) + ' bytes skipped)' : ''));
  if (DATA.entryPoint !== undefined) {
    h += row('Entry point', '<span class="addr" data-jump="' + DATA.entryPoint + '">' + fmtAddr(DATA.entryPoint) + '</span>');
  } else {
    h += row('Entry point', '-');
  }
  h += row('Warnings', DATA.warnings ? DATA.warnings.length : 0);
  h += '</table>';

  if (segsShifted.length) {
    h += '<div style="margin-top:8px;color:#c586c0;">Segments (click to jump)</div>';
    h += '<table style="border-collapse:collapse;margin-top:2px;"><tr style="color:#808080;"><td style="padding:0 12px 0 0;">#</td><td style="padding:0 12px 0 0;">Start</td><td style="padding:0 12px 0 0;">End</td><td>Length</td></tr>';
    segsShifted.slice(0, 100).forEach((s, i) => {
      h += '<tr class="clickable-row" data-jump="' + s.addr + '"><td style="padding:0 12px 0 0;color:#808080;">' + i + '</td>' +
           '<td style="padding:0 12px 0 0;color:#569cd6;">' + fmtAddr(s.addr) + '</td>' +
           '<td style="padding:0 12px 0 0;">' + fmtAddr(s.addr + s.len - 1) + '</td>' +
           '<td>' + fmtNum(s.len) + '</td></tr>';
    });
    if (segsShifted.length > 100) h += '<tr><td colspan="4" style="color:#808080;">... +' + (segsShifted.length - 100) + ' more</td></tr>';
    h += '</table>';
  }

  if (gapsShifted.length) {
    h += '<div style="margin-top:8px;color:#6a9955;">Address gaps (click to jump)</div>';
    h += '<table style="border-collapse:collapse;margin-top:2px;"><tr style="color:#808080;"><td style="padding:0 12px 0 0;">Start</td><td style="padding:0 12px 0 0;">End</td><td>Bytes</td></tr>';
    gapsShifted.slice(0, 100).forEach(g => {
      h += '<tr class="clickable-row" data-jump="' + g.addr + '"><td style="padding:0 12px 0 0;color:#6a9955;">' + fmtAddr(g.addr) + '</td>' +
           '<td style="padding:0 12px 0 0;">' + fmtAddr(g.addr + g.len - 1) + '</td>' +
           '<td>' + fmtNum(g.len) + '</td></tr>';
    });
    if (gapsShifted.length > 100) h += '<tr><td colspan="3" style="color:#808080;">... +' + (gapsShifted.length - 100) + ' more</td></tr>';
    h += '</table>';
  }
  infoPanelEl.innerHTML = h;
}

function buildMemMap(segsShifted, shift) {
  const minA = (DATA.stats.min + shift) >>> 0;
  const maxA = (DATA.stats.max + shift) >>> 0;
  const span = maxA - minA;
  if (span <= 0 || segsShifted.length === 0) {
    memMapEl.style.display = 'none';
    return;
  }
  memMapEl.style.display = 'block';
  let html = '';
  for (const s of segsShifted) {
    const left = ((s.addr - minA) / span) * 100;
    const width = (s.len / span) * 100;
    html += '<div class="seg-bar" style="left:' + left.toFixed(3) + '%;width:' + width.toFixed(3) + '%;" title="' + fmtAddr(s.addr) + ' (' + s.len + ' B)"></div>';
  }
  if (DATA.entryPoint !== undefined && DATA.entryPoint >= minA && DATA.entryPoint <= maxA) {
    const eLeft = ((DATA.entryPoint - minA) / span) * 100;
    html += '<div class="entry-tick" style="left:' + eLeft.toFixed(3) + '%;" title="Entry ' + fmtAddr(DATA.entryPoint) + '"></div>';
  }
  html += '<div class="view-bar" id="memViewBar"></div>';
  memMapEl.innerHTML = html;
}

function updateMemViewBar() {
  const bar = document.getElementById('memViewBar');
  if (!bar || vis.length === 0) return;
  const shift = DATA.format === 'binary' ? baseOffset : 0;
  const minA = (DATA.stats.min + shift) >>> 0;
  const maxA = (DATA.stats.max + shift) >>> 0;
  const span = maxA - minA;
  if (span <= 0) return;
  const topIdx = Math.min(vis.length - 1, Math.max(0, Math.floor(scroller.scrollTop / ROW_H)));
  const botIdx = Math.min(vis.length - 1, topIdx + VIEW_ROWS);
  const topAddr = ALL[vis[topIdx]].addr;
  const botAddr = ALL[vis[botIdx]].addr + rowBytes;
  const left = Math.max(0, Math.min(100, ((topAddr - minA) / span) * 100));
  const right = Math.max(left, Math.min(100, ((botAddr - minA) / span) * 100));
  bar.style.left = left.toFixed(2) + '%';
  bar.style.width = Math.max(0.5, right - left).toFixed(2) + '%';
}

function buildStrings() {
  const minLen = 4;
  const items = [];
  for (const ch of SEG_CHUNKS) {
    let runStart = -1;
    let str = '';
    for (let i = 0; i < ch.bytes.length; i++) {
      const b = ch.bytes[i];
      if (b >= 0x20 && b < 0x7f) {
        if (runStart < 0) runStart = i;
        str += String.fromCharCode(b);
      } else {
        if (runStart >= 0 && str.length >= minLen) {
          items.push({ addr: (ch.addr + runStart) >>> 0, str });
          if (items.length >= 2000) break;
        }
        runStart = -1;
        str = '';
      }
    }
    if (runStart >= 0 && str.length >= minLen && items.length < 2000) {
      items.push({ addr: (ch.addr + runStart) >>> 0, str });
    }
    if (items.length >= 2000) break;
  }
  let html = '<div style="margin-bottom:4px;color:#9cdcfe;">Printable ASCII strings (min 4 chars, ' + items.length + (items.length >= 2000 ? '+' : '') + ' found) — click to jump</div>';
  html += '<table style="border-collapse:collapse;width:100%;">';
  for (const it of items) {
    const esc = it.str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html += '<tr class="clickable-row" data-jump="' + it.addr + '" data-len="' + it.str.length + '">' +
            '<td style="color:#569cd6;width:95px;padding:1px 8px 1px 0;">' + fmtAddr(it.addr) + '</td>' +
            '<td style="color:#b5cea8;padding:1px 0;word-break:break-all;">' + esc + '</td></tr>';
  }
  html += '</table>';
  stringsPanelEl.innerHTML = html;
}

function sepAfter(col, g) {
  if (g === 1) {
    if (col % 8 === 7) return '   ';
    if (col % 4 === 3) return '  ';
    return ' ';
  }
  return (col % 8 === 7) ? '  ' : ' ';
}

function updateHexHead() {
  const g = groupSize;
  const w = rowBytes === 8 ? '235px' : rowBytes === 32 ? '890px' : '455px';
  hexHeadEl.style.width = w;
  let labels = '';
  if (g === 1) {
    for (let i = 0; i < rowBytes; i++) {
      labels += i.toString(16).padStart(2, '0').toUpperCase();
      if (i < rowBytes - 1) labels += sepAfter(i, 1);
    }
  } else {
    const tokenW = g * 2;
    for (let off = 0; off < rowBytes; off += g) {
      labels += off.toString(16).padStart(2, '0').toUpperCase().padEnd(tokenW, ' ');
      if (off + g < rowBytes) labels += sepAfter(off + g - 1, g);
    }
  }
  hexHeadEl.innerHTML = 'Bytes<span class="lanes">' + labels + '</span>';
}

function isSelected(addr, len) {
  if (selStart === null || selEnd === null) return false;
  return addr + len - 1 >= selStart && addr <= selEnd;
}

function isFindHit(addr, len) {
  if (findCursor < 0 || findCursor >= findHits.length) return false;
  const h = findHits[findCursor];
  return addr + len - 1 >= h.addr && addr <= h.addr + h.len - 1;
}

function renderHexTokens(r, tdH, tdS) {
  const bytes = r.b;
  const skip = r.skip || 0;
  const g = groupSize;
  let hHtml = '';
  let aHtml = '';

  if (skip > 0) {
    for (let k = 0; k < skip; k++) {
      hHtml += '<span class="b-pad">..</span>' + sepAfter(k, 1);
      if (showAscii) aHtml += ' ';
    }
  }

  if (g === 1) {
    for (let i = 0; i < bytes.length; i++) {
      const col = skip + i;
      const bAddr = (r.addr + col) >>> 0;
      const cls = 'b-tok' + (isSelected(bAddr, 1) ? ' sel' : '') + (isFindHit(bAddr, 1) ? ' fhit' : '');
      hHtml += '<span class="' + cls + '" data-addr="' + bAddr + '" data-len="1">' + hexOf(bytes[i]) + '</span>';
      if (i < bytes.length - 1) hHtml += sepAfter(col, 1);
    }
  } else {
    let i = 0;
    while (i < bytes.length) {
      const col = skip + i;
      const bAddr = (r.addr + col) >>> 0;
      const phase = bAddr % g;
      const room = g - phase;
      const take = Math.min(room, bytes.length - i);
      let s = '';
      if (take === g) {
        if (endian === 'be') {
          for (let k = 0; k < g; k++) s += hexOf(bytes[i + k]);
        } else {
          for (let k = g - 1; k >= 0; k--) s += hexOf(bytes[i + k]);
        }
      } else {
        for (let k = 0; k < take; k++) s += hexOf(bytes[i + k]);
      }
      const cls = 'b-tok' + (isSelected(bAddr, take) ? ' sel' : '') + (isFindHit(bAddr, take) ? ' fhit' : '');
      hHtml += '<span class="' + cls + '" data-addr="' + bAddr + '" data-len="' + take + '">' + s + '</span>';
      i += take;
      if (i < bytes.length) hHtml += sepAfter(col + take - 1, g);
    }
  }

  if (showAscii) {
    for (let i = 0; i < bytes.length; i++) {
      const col = skip + i;
      const bAddr = (r.addr + col) >>> 0;
      const ch = r.s[i] === '&' ? '&amp;' : r.s[i] === '<' ? '&lt;' : r.s[i] === '>' ? '&gt;' : r.s[i];
      const cls = 'a-tok' + (isSelected(bAddr, 1) ? ' sel' : '') + (isFindHit(bAddr, 1) ? ' fhit' : '');
      aHtml += '<span class="' + cls + '" data-addr="' + bAddr + '" data-len="1">' + ch + '</span>';
    }
  }

  tdH.innerHTML = hHtml;
  tdS.innerHTML = aHtml;
}

const pool = [];
function ensurePoolSize() {
  const needed = Math.max(20, Math.ceil((scroller.clientHeight || 800) / ROW_H) + 4);
  VIEW_ROWS = needed;
  RENDER_ROWS = VIEW_ROWS + OVERSCAN * 2;
  while (pool.length < RENDER_ROWS) {
    const tr = document.createElement('tr');
    const tdA = document.createElement('td'); tdA.className = 'addr';
    const tdH = document.createElement('td'); tdH.className = 'hex';
    const tdS = document.createElement('td'); tdS.className = 'ascii';
    tr.appendChild(tdA); tr.appendChild(tdH); tr.appendChild(tdS);
    body.insertBefore(tr, botSpacer);
    pool.push(tr);
  }
}

function renderWindow() {
  ensurePoolSize();
  const total = vis.length;
  const scrollTop = scroller.scrollTop;
  let start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  let end = Math.min(total, start + RENDER_ROWS);
  start = Math.max(0, end - RENDER_ROWS);
  if (start === lastStart && end === lastEnd && total === lastTotal) return;
  lastStart = start; lastEnd = end; lastTotal = total;

  topSpacer.style.height = (start * ROW_H) + 'px';
  botSpacer.style.height = ((total - end) * ROW_H) + 'px';

  for (let i = 0; i < pool.length; i++) {
    const tr = pool[i];
    const idx = start + i;
    if (idx >= end) { tr.style.display = 'none'; continue; }
    tr.style.display = '';
    const r = ALL[vis[idx]];
    const isRowMatch = filterMode && findQ && r.text.includes(findQ);
    tr.className = r.kind + (vis[idx] === targetAll ? ' hit' : '') + (isRowMatch ? ' match' : '');
    const tds = tr.children;
    tds[0].textContent = r.a;
    if (r.kind === 'data') {
      tds[0].dataset.addr = r.a;
      tds[0].style.cursor = 'pointer';
      renderHexTokens(r, tds[1], tds[2]);
      tr.title = '';
    } else {
      tds[0].dataset.addr = '';
      tds[0].style.cursor = 'default';
      tds[1].textContent = r.h;
      tds[2].textContent = '';
      tr.title = r.kind === 'gap'
        ? 'Address gap: ' + r.a + ' (' + (r.end - r.addr) + ' bytes)'
        : '';
    }
  }
  updateMemViewBar();
}

function repaint() {
  lastStart = lastEnd = lastTotal = -1;
  renderWindow();
}

function readBytesAt(addr, maxLen) {
  for (const ch of SEG_CHUNKS) {
    if (addr >= ch.addr && addr < ch.addr + ch.bytes.length) {
      const off = addr - ch.addr;
      return ch.bytes.subarray(off, Math.min(ch.bytes.length, off + maxLen));
    }
  }
  return null;
}

function crc32Bytes(arr) {
  let c = 0xffffffff;
  for (let i = 0; i < arr.length; i++) {
    c ^= arr[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function updateInspector() {
  if (selStart === null || selEnd === null) {
    inspectorEl.innerHTML = '<span class="insp-k">Click any byte to inspect &bull; Shift+Click to select a range</span>';
    return;
  }
  const len = selEnd - selStart + 1;
  const slice = readBytesAt(selStart, Math.min(len, 65536));
  const peek = readBytesAt(selStart, 8);
  if (!peek || peek.length === 0) {
    inspectorEl.innerHTML = '<span class="insp-k">No data at ' + fmtAddr(selStart) + '</span>';
    return;
  }
  const dv = new DataView(peek.buffer, peek.byteOffset, peek.byteLength);
  const le = endian === 'le';
  const kv = (k, v) => '<span class="insp-kv"><span class="insp-k">' + k + '</span><span class="insp-v">' + v + '</span></span>';

  let out = kv('Addr', fmtAddr(selStart));
  if (len > 1 && slice) {
    out += kv('Len', slice.length + ' B');
    out += kv('CRC32', '0x' + crc32Bytes(slice).toString(16).toUpperCase().padStart(8, '0'));
  }
  const u8 = dv.getUint8(0);
  const i8 = dv.getInt8(0);
  out += kv('u8/i8', u8 + ' / ' + i8);
  out += kv('bits', u8.toString(2).padStart(8, '0').replace(/(.{4})/, '$1_'));
  if (peek.length >= 2) {
    out += kv('u16', dv.getUint16(0, le));
    out += kv('i16', dv.getInt16(0, le));
  }
  if (peek.length >= 4) {
    const u32 = dv.getUint32(0, le);
    out += kv('u32', u32 + ' (0x' + u32.toString(16).toUpperCase().padStart(8, '0') + ')');
    out += kv('f32', dv.getFloat32(0, le).toPrecision(6));
  }
  if (peek.length >= 8) {
    out += kv('u64', dv.getBigUint64(0, le).toString());
  }
  out += '<span class="insp-actions">' +
    '<button type="button" id="cpHex">Copy Hex</button>' +
    '<button type="button" id="cpC">Copy C</button>' +
    '<button type="button" id="cpPy">Copy Py</button>' +
    '<button type="button" id="expBin">Export .bin</button>' +
    '</span>';
  inspectorEl.innerHTML = out;

  const getSel = () => readBytesAt(selStart, Math.min(len, 262144)) || new Uint8Array(0);
  document.getElementById('cpHex').onclick = () => {
    const b = getSel();
    copyText(Array.from(b).map(x => hexOf(x)).join(' '), b.length + ' hex bytes');
  };
  document.getElementById('cpC').onclick = () => {
    const b = getSel();
    const bodyC = Array.from(b).map(x => '0x' + hexOf(x)).join(', ');
    copyText('const uint8_t data[' + b.length + '] = { ' + bodyC + ' };', 'C array');
  };
  document.getElementById('cpPy').onclick = () => {
    const b = getSel();
    const bodyP = Array.from(b).map(x => '\\\\x' + hexOf(x)).join('');
    copyText('b"' + bodyP + '"', 'Python bytes');
  };
  document.getElementById('expBin').onclick = () => {
    const b = getSel();
    if (vscode) vscode.postMessage({ type: 'exportBin', bytes: Array.from(b), suffix: '_' + fmtAddr(selStart) + '.bin' });
  };
}

function jumpToAddress(addr, selectLen) {
  let pos = -1;
  for (let i = 0; i < vis.length; i++) {
    const r = ALL[vis[i]];
    if (r.kind === 'data') {
      const first = (r.addr + (r.skip || 0)) >>> 0;
      const last = (first + r.b.length - 1) >>> 0;
      if (addr >= r.addr && addr <= last) { pos = i; break; }
      if (first > addr) { pos = i; break; }
    } else if (r.kind === 'segment' && r.addr > addr) {
      pos = i; break;
    }
  }
  if (pos < 0 && vis.length > 0) pos = vis.length - 1;
  if (pos < 0) return;
  targetAll = vis[pos];
  if (selectLen && selectLen > 0) {
    selAnchor = selStart = addr >>> 0;
    selEnd = (addr + selectLen - 1) >>> 0;
    updateInspector();
  }
  const desiredTop = Math.max(0, pos * ROW_H - Math.floor(scroller.clientHeight / 3));
  scroller.scrollTop = desiredTop;
  repaint();
}

function computeFindHits(q) {
  findHits = [];
  findCursor = -1;
  if (!q) { findCountEl.textContent = ''; return; }

  // 1) Explicit 0x... address match
  if (/^0x[0-9a-f]+$/i.test(q)) {
    const target = parseInt(q, 16) >>> 0;
    for (const ch of SEG_CHUNKS) {
      if (target >= ch.addr && target < ch.addr + ch.bytes.length) {
        findHits.push({ addr: target, len: 1 });
      }
    }
  }

  // 2) Hex byte pattern (if >= 2 hex chars and only hex/spaces)
  const cleanHex = q.replace(/\s+/g, '');
  if (/^[0-9a-f]{2,}$/i.test(cleanHex) && cleanHex.length % 2 === 0) {
    const pat = [];
    for (let i = 0; i < cleanHex.length; i += 2) pat.push(parseInt(cleanHex.substr(i, 2), 16));
    for (const ch of SEG_CHUNKS) {
      const b = ch.bytes;
      for (let i = 0; i <= b.length - pat.length; i++) {
        let ok = true;
        for (let k = 0; k < pat.length; k++) {
          if (b[i + k] !== pat[k]) { ok = false; break; }
        }
        if (ok) {
          findHits.push({ addr: (ch.addr + i) >>> 0, len: pat.length });
          if (findHits.length >= 2000) break;
        }
      }
      if (findHits.length >= 2000) break;
    }
  }

  // 3) ASCII substring (case-insensitive)
  if (findHits.length === 0 || !/^[0-9a-f\s]+$/i.test(q)) {
    const pat = Array.from(q).map(c => c.toLowerCase().charCodeAt(0));
    for (const ch of SEG_CHUNKS) {
      const b = ch.bytes;
      for (let i = 0; i <= b.length - pat.length; i++) {
        let ok = true;
        for (let k = 0; k < pat.length; k++) {
          let c = b[i + k];
          if (c >= 65 && c <= 90) c += 32;
          if (c !== pat[k]) { ok = false; break; }
        }
        if (ok) {
          findHits.push({ addr: (ch.addr + i) >>> 0, len: pat.length });
          if (findHits.length >= 2000) break;
        }
      }
      if (findHits.length >= 2000) break;
    }
  }

  if (findHits.length > 0) {
    findCursor = 0;
    findCountEl.textContent = '1/' + findHits.length + (findHits.length >= 2000 ? '+' : '');
  } else {
    findCountEl.textContent = '0/0';
  }
}

function stepFind(dir) {
  if (!findHits.length) return;
  findCursor = (findCursor + dir + findHits.length) % findHits.length;
  const h = findHits[findCursor];
  findCountEl.textContent = (findCursor + 1) + '/' + findHits.length + (findHits.length >= 2000 ? '+' : '');
  jumpToAddress(h.addr, 0);
}

function applyFilter() {
  findQ = searchEl.value.trim().toLowerCase();
  filterMode = filterModeEl.checked;
  const hideGaps = hideGapsEl.checked;
  const hideData = hideDataEl.checked;
  vis = [];
  for (let i = 0; i < ALL.length; i++) {
    const r = ALL[i];
    if (r.kind === 'gap' && hideGaps) continue;
    if (r.kind === 'data' && hideData) continue;
    if (filterMode && findQ && !r.text.includes(findQ)) continue;
    vis.push(i);
  }
  computeFindHits(findQ);
  if (!filterMode && findHits.length > 0) {
    jumpToAddress(findHits[0].addr, 0);
  } else {
    scroller.scrollTop = 0;
    repaint();
  }
  statsEl.innerHTML = baseStats + (filterMode ? '<span class="stat-pill">filtered: ' + vis.length + ' rows</span>' : '');
  const sumPill = document.getElementById('statSummary');
  if (sumPill) {
    sumPill.onclick = () => {
      const open = infoPanelEl.classList.toggle('open');
      infoBtnEl.classList.toggle('active', open);
    };
  }
  saveState();
}

let rafPending = false;
scroller.addEventListener('scroll', () => {
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderWindow(); saveState(); });
  }
});

new ResizeObserver(() => repaint()).observe(scroller);

body.addEventListener('click', (e) => {
  const addrTd = e.target.closest('.addr');
  if (addrTd && addrTd.dataset.addr) {
    copyText(addrTd.dataset.addr, addrTd.dataset.addr);
    return;
  }
  const tok = e.target.closest('.b-tok, .a-tok');
  if (tok && tok.dataset.addr) {
    const a = parseInt(tok.dataset.addr, 10) >>> 0;
    const len = parseInt(tok.dataset.len || '1', 10);
    if (e.shiftKey && selAnchor !== null) {
      selStart = Math.min(selAnchor, a) >>> 0;
      selEnd = (Math.max(selAnchor, a) + len - 1) >>> 0;
    } else {
      selAnchor = selStart = a;
      selEnd = (a + len - 1) >>> 0;
    }
    updateInspector();
    repaint();
  }
});

memMapEl.addEventListener('click', (e) => {
  const rect = memMapEl.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const shift = DATA.format === 'binary' ? baseOffset : 0;
  const minA = (DATA.stats.min + shift) >>> 0;
  const maxA = (DATA.stats.max + shift) >>> 0;
  const target = (minA + Math.floor((maxA - minA) * frac)) >>> 0;
  jumpToAddress(target, 0);
});

document.addEventListener('click', (e) => {
  const jmp = e.target.closest('[data-jump]');
  if (jmp) {
    const addr = parseInt(jmp.dataset.jump, 10) >>> 0;
    const len = jmp.dataset.len ? parseInt(jmp.dataset.len, 10) : 0;
    jumpToAddress(addr, len);
  }
});

colCountEl.addEventListener('change', () => {
  rowBytes = parseInt(colCountEl.value, 10);
  updateHexHead();
  rebuildModel();
  applyFilter();
  saveState();
});
groupSizeEl.addEventListener('change', () => {
  groupSize = parseInt(groupSizeEl.value, 10);
  updateHexHead();
  repaint();
  saveState();
});
endianEl.addEventListener('change', () => {
  endian = endianEl.value;
  updateInspector();
  repaint();
  saveState();
});
showAsciiEl.addEventListener('change', () => {
  showAscii = showAsciiEl.checked;
  tableEl.classList.toggle('noascii', !showAscii);
  repaint();
  saveState();
});
baseAddrEl.addEventListener('change', () => {
  const v = baseAddrEl.value.trim();
  const n = parseInt(v, 16);
  if (isNaN(n) || n < 0) { baseAddrEl.style.borderColor = '#f48771'; return; }
  baseAddrEl.style.borderColor = '';
  baseOffset = n >>> 0;
  baseAddrEl.value = fmtAddr(baseOffset);
  selAnchor = selStart = selEnd = null;
  updateInspector();
  rebuildModel();
  applyFilter();
});

function gotoAddress() {
  const v = gotoAddrEl.value.trim();
  if (!v) return;
  const n = parseInt(v, 16);
  if (isNaN(n) || n < 0) { gotoAddrEl.style.borderColor = '#f48771'; return; }
  gotoAddrEl.style.borderColor = '';
  jumpToAddress(n >>> 0, 1);
}
gotoBtnEl.addEventListener('click', gotoAddress);
gotoAddrEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') gotoAddress(); });

infoBtnEl.addEventListener('click', () => {
  const open = infoPanelEl.classList.toggle('open');
  infoBtnEl.classList.toggle('active', open);
});
stringsBtnEl.addEventListener('click', () => {
  const open = stringsPanelEl.classList.toggle('open');
  stringsBtnEl.classList.toggle('active', open);
  if (open && !stringsPanelEl.innerHTML) buildStrings();
});

searchEl.addEventListener('input', applyFilter);
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') stepFind(e.shiftKey ? -1 : 1);
});
findNextEl.addEventListener('click', () => stepFind(1));
findPrevEl.addEventListener('click', () => stepFind(-1));
filterModeEl.addEventListener('change', applyFilter);
hideGapsEl.addEventListener('change', applyFilter);
hideDataEl.addEventListener('change', applyFilter);

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg && msg.type === 'update' && msg.payload) {
    const prevScroll = scroller.scrollTop;
    DATA = msg.payload;
    rebuildModel();
    applyFilter();
    scroller.scrollTop = prevScroll;
    repaint();
  }
});

restoreState();
updateHexHead();
rebuildModel();
applyFilter();
if (vscode) {
  const st = vscode.getState();
  if (st && typeof st.scrollTop === 'number') {
    scroller.scrollTop = st.scrollTop;
    repaint();
  }
}
</script>
</body>
</html>`;
}
