export interface Segment {
  addr: number; // absolute byte address (>= 0)
  data: Uint8Array;
}

export type FormatKind = 'intel-hex' | 'srecord' | 'binary';

import { createHash } from 'crypto';

export interface ParsedImage {
  format: FormatKind;
  segments: Segment[]; // sorted, non-overlapping, contiguous-merged
  entryPoint?: number;
  warnings: string[];
  fileSize: number;
  sha256: string;
  payloadSha256: string;
  payloadCrc32: number;
}

interface RawRecord {
  addr: number;
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Intel HEX
// ---------------------------------------------------------------------------

function parseIntelHex(text: string, warnings: string[]): { records: RawRecord[]; entry?: number } {
  const records: RawRecord[] = [];
  let upperAddr = 0; // 32-bit upper address bits
  let entry: number | undefined;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0 || line[0] !== ':') continue;
    const hex = line.slice(1);
    if (hex.length < 10 || hex.length % 2 !== 0) {
      warnings.push(`line ${i + 1}: malformed Intel HEX record`);
      continue;
    }
    const bytes: number[] = [];
    for (let j = 0; j < hex.length; j += 2) {
      const b = parseInt(hex.substr(j, 2), 16);
      if (Number.isNaN(b)) {
        warnings.push(`line ${i + 1}: bad hex digit`);
        bytes.length = 0;
        break;
      }
      bytes.push(b);
    }
    if (bytes.length === 0) continue;

    const len = bytes[0];
    const addr16 = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    if (bytes.length !== 5 + len) {
      warnings.push(`line ${i + 1}: length field mismatch`);
      continue;
    }
    let sum = 0;
    for (const b of bytes) sum = (sum + b) & 0xff;
    if (sum !== 0) {
      warnings.push(`line ${i + 1}: checksum error`);
      continue;
    }
    const payload = bytes.slice(4, 4 + len);

    switch (type) {
      case 0x00: // data
        records.push({ addr: (upperAddr + addr16) >>> 0, data: new Uint8Array(payload) });
        break;
      case 0x01: // EOF
        return { records, entry };
      case 0x02: // segment address -> upper 4 bits
        if (payload.length === 2) {
          upperAddr = (((payload[0] << 8) | payload[1]) << 4) >>> 0;
        }
        break;
      case 0x03: // start segment address (CS:IP)
        if (payload.length === 4) {
          const cs = (payload[0] << 8) | payload[1];
          const ip = (payload[2] << 8) | payload[3];
          entry = ((cs << 4) + ip) >>> 0;
        }
        break;
      case 0x04: // extended linear address -> upper 16 bits
        if (payload.length === 2) {
          upperAddr = (((payload[0] << 8) | payload[1]) << 16) >>> 0;
        }
        break;
      case 0x05: // start linear address (32-bit EIP)
        if (payload.length === 4) {
          entry = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
        }
        break;
      default:
        warnings.push(`line ${i + 1}: unknown record type 0x${type.toString(16)}`);
    }
  }
  return { records, entry };
}

// ---------------------------------------------------------------------------
// Motorola S-Record
// ---------------------------------------------------------------------------

function parseSRecord(text: string, warnings: string[]): { records: RawRecord[]; entry?: number } {
  const records: RawRecord[] = [];
  let entry: number | undefined;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 4 || line[0] !== 'S') continue;
    const typeCh = line[1];
    const type = parseInt(typeCh, 10);
    if (Number.isNaN(type) || type < 0 || type > 9) continue;

    // number of address bytes for data record types
    const addrBytes = type === 1 ? 2 : type === 2 ? 3 : type === 3 ? 4 : 0;
    const hex = line.slice(2);
    if (hex.length < 2 || hex.length % 2 !== 0) {
      warnings.push(`line ${i + 1}: malformed S-record`);
      continue;
    }
    const bytes: number[] = [];
    for (let j = 0; j < hex.length; j += 2) {
      const b = parseInt(hex.substr(j, 2), 16);
      if (Number.isNaN(b)) {
        warnings.push(`line ${i + 1}: bad hex digit`);
        bytes.length = 0;
        break;
      }
      bytes.push(b);
    }
    if (bytes.length === 0) continue;

    const count = bytes[0];
    if (bytes.length !== count + 1) {
      warnings.push(`line ${i + 1}: count field mismatch (got ${bytes.length - 1} bytes, expected ${count})`);
      continue;
    }
    // checksum: sum of all bytes incl. count must equal 0xFF
    let sum = 0;
    for (const b of bytes) sum = (sum + b) & 0xff;
    if (sum !== 0xff) {
      warnings.push(`line ${i + 1}: checksum error`);
      continue;
    }

    if (addrBytes > 0) {
      if (bytes.length < 1 + addrBytes + 1) continue;
      let addr = 0;
      for (let k = 0; k < addrBytes; k++) addr = ((addr << 8) | bytes[1 + k]) >>> 0;
      const dataLen = count - addrBytes - 1;
      const data = new Uint8Array(bytes.slice(1 + addrBytes, 1 + addrBytes + dataLen));
      records.push({ addr, data });
    } else if (type === 7 || type === 8 || type === 9) {
      // entry point record: S7=4 bytes (32-bit), S8=3 bytes (24-bit), S9=2 bytes (16-bit)
      const addrLen = type === 7 ? 4 : type === 8 ? 3 : 2;
      if (bytes.length >= 1 + addrLen + 1) {
        let addr = 0;
        for (let k = 0; k < addrLen; k++) addr = ((addr << 8) | bytes[1 + k]) >>> 0;
        entry = addr;
      }
    }
    // S0 header, S5/S6/S7 count records ignored
  }
  return { records, entry };
}

// ---------------------------------------------------------------------------
// Segment building
// ---------------------------------------------------------------------------

function buildSegments(records: RawRecord[]): Segment[] {
  const sorted = records
    .filter((r) => r.data.length > 0)
    .map((r) => ({ addr: r.addr >>> 0, data: r.data }))
    .sort((a, b) => a.addr - b.addr || a.data.length - b.data.length);

  const segs: Segment[] = [];
  for (const r of sorted) {
    const last = segs[segs.length - 1];
    if (last && r.addr <= last.addr + last.data.length) {
      // overlap or contiguous -> merge (data beyond existing tail appended/overwritten)
      const end = Math.max(last.addr + last.data.length, r.addr + r.data.length);
      const merged = new Uint8Array(end - last.addr);
      merged.set(last.data, 0);
      const off = r.addr - last.addr;
      merged.set(r.data, off);
      last.data = merged;
    } else {
      segs.push({ addr: r.addr, data: r.data.slice() });
    }
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function computePayloadHashes(segments: Segment[]): { payloadSha256: string; payloadCrc32: number } {
  const hash = createHash('sha256');
  let crc = 0xffffffff;
  for (const seg of segments) {
    hash.update(seg.data);
    const d = seg.data;
    for (let i = 0; i < d.length; i++) {
      crc = CRC32_TABLE[(crc ^ d[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return {
    payloadSha256: hash.digest('hex'),
    payloadCrc32: (crc ^ 0xffffffff) >>> 0,
  };
}

export function parseImage(buffer: Buffer, fileName: string): ParsedImage {
  const warnings: string[] = [];
  const meta = {
    fileSize: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };

  // Try text formats only if the content looks like text
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  const looksText = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(sample) && buffer.length > 0;

  if (looksText) {
    const intelWarn: string[] = [];
    const { records: intelRecs, entry: intelEntry } = parseIntelHex(buffer.toString('utf8'), intelWarn);
    if (intelRecs.length > 0) {
      const segments = buildSegments(intelRecs);
      return {
        format: 'intel-hex',
        segments,
        entryPoint: intelEntry,
        warnings: intelWarn,
        ...meta,
        ...computePayloadHashes(segments),
      };
    }
    const sWarn: string[] = [];
    const { records: sRecs, entry } = parseSRecord(buffer.toString('utf8'), sWarn);
    if (sRecs.length > 0) {
      const segments = buildSegments(sRecs);
      return {
        format: 'srecord',
        segments,
        entryPoint: entry,
        warnings: sWarn,
        ...meta,
        ...computePayloadHashes(segments),
      };
    }
    warnings.push(...intelWarn.slice(0, 3), ...sWarn.slice(0, 3));
  }

  // Fallback: raw binary image at base address 0
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const segments = [{ addr: 0, data: data.slice() }];
  return {
    format: 'binary',
    segments,
    warnings: ['File is not a recognizable Intel HEX or S-record; showing raw bytes at base 0.'],
    ...meta,
    ...computePayloadHashes(segments),
  };
}
