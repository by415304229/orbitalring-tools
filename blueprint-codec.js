/* AUTO-GENERATED wrapper around tools/blueprint-codec.mjs — do not edit */
// blueprint-codec.mjs
// ---------------------------------------------------------------------------
// Dyson Sphere Program (DSP) factory blueprint encoder / decoder.
// Self-contained ES module. No npm dependencies, no build step.
//
// Implements the exact in-game "paste" format:
//   BLUEPRINT:<12 comma separated header cells>"<base64(gzip(binary))>"<MD5F hex>
//
// Verified against real blueprint strings (huww98/dsp_blueprint_editor test
// vector) and against the official MD5F test vectors from johndoe31415/dspbptk.
//
// Public API:
//   decodeBlueprint(str) -> object
//   encodeBlueprint(obj) -> string
// Extra helpers (also exported for convenience):
//   md5fHex(u8)          -> lowercase hex string of the DSP "MD5F" digest
//   nowTicks()           -> current time as .NET ticks (string)
//
// Notes on the object schema are at the bottom of this file.
// ---------------------------------------------------------------------------

// ===========================================================================
// MD5F  (Dyson Sphere Program's modified MD5)
// ---------------------------------------------------------------------------
// Identical to RFC-1321 MD5 except for the initial state and 8 modified K
// constants. This is dspbptk's DysonSphereMD5.Variant.MD5F, which matches the
// K-table hard-coded by huww98's md5.ts.
// ===========================================================================

const MD5F_K = Int32Array.of(
  0xd76aa478, 0xe8d7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304623, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b9f1122, 0xfd987193, 0xa679438e, 0x39b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xc9b6c7aa, 0xd62f105d, 0x02443453, 0xd8a1e681, 0xe7d3fbc8,
  0x21f1cde6, 0xc33707d6, 0xf4d50d87, 0x475a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
);

const MD5F_S = Uint8Array.of(
   7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
   5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
   4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
   6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,
);

// MD5F initial state (little-endian words): differs from MD5 in b0 and d0.
const MD5F_INIT = [0x67452301, 0xefdcab89, 0x98badcfe, 0x10325746];

function md5fBytes(data) {
  const s = Int32Array.from(MD5F_INIT);
  const BS = 64;

  const block = (buf, off) => {
    const dv = new DataView(buf.buffer, buf.byteOffset + off, 64);
    let a = s[0], b = s[1], c = s[2], d = s[3];
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16)      { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d;          g = (3 * i + 5) % 16; }
      else             { f = c ^ (b | ~d);       g = (7 * i) % 16; }
      f = (f + a + MD5F_K[i] + dv.getInt32(g * 4, true)) | 0;
      const rot = ((f << MD5F_S[i]) | (f >>> (32 - MD5F_S[i]))) | 0;
      a = d; d = c; c = b; b = (b + rot) | 0;
    }
    s[0] = (s[0] + a) | 0; s[1] = (s[1] + b) | 0;
    s[2] = (s[2] + c) | 0; s[3] = (s[3] + d) | 0;
  };

  let i = 0;
  for (; i <= data.length - BS; i += BS) block(data, i);

  const rem = data.length - i;
  const lastLen = Math.ceil((rem + 9) / BS) * BS;
  const last = new Uint8Array(lastLen);
  for (let j = 0; j < rem; j++) last[j] = data[i + j];
  last[rem] = 0x80;
  new DataView(last.buffer).setUint32(lastLen - 8, (data.length * 8) >>> 0, true);
  for (let o = 0; o <= lastLen - BS; o += BS) block(last, o);

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  for (let k = 0; k < 4; k++) odv.setInt32(k * 4, s[k], true);
  return out;
}

function md5fHex(u8) {
  const d = md5fBytes(u8);
  let out = '';
  for (let i = 0; i < d.length; i++) out += d[i].toString(16).padStart(2, '0');
  return out;
}

// ===========================================================================
// CRC32 (needed for the gzip trailer)
// ===========================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ===========================================================================
// Base64 (standard alphabet, with padding)
// ===========================================================================

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes) {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < n ? bytes[i + 1] : 0, b2 = i + 2 < n ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < n ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < n ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

const B64_LOOKUP = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) m[B64_CHARS.charCodeAt(i)] = i;
  m['='.charCodeAt(0)] = 0;
  return m;
})();

function base64Decode(str) {
  let clean = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 61 /* = */) break;               // stop at padding
    if (c < 128 && B64_LOOKUP[c] >= 0) clean += str[i];
  }
  const bytes = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(bytes);
}

// ===========================================================================
// DEFLATE / INFLATE (RFC 1951)
// ===========================================================================

const LEN_BASE  = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEN_EXTRA = [0,0,0,0,0,0,0,0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE  = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2, 2, 3, 3, 4, 4, 5, 5,  6,  6,  7,  7,  8,  8,   9,   9,  10,  10,  11,  11,  12,   12,   13,   13];

// Map a match length (3..258) to its length-code index (0..28).
const LEN_SYM = (() => {
  const t = new Int16Array(259);
  for (let i = 0; i < 29; i++)
    for (let k = 0; k < (1 << LEN_EXTRA[i]); k++)
      t[LEN_BASE[i] + k] = i;
  return t;
})();

// ---- Huffman (canonical), puff-style --------------------------------------

function huffmanConstruct(lengths, n) {
  let maxBits = 0;
  for (let i = 0; i < n; i++) if (lengths[i] > maxBits) maxBits = lengths[i];
  const count = new Int32Array(maxBits + 1);
  for (let i = 0; i < n; i++) if (lengths[i]) count[lengths[i]]++;
  if (count[0] === n) return null;                       // empty code
  let left = 1;
  for (let len = 1; len <= maxBits; len++) {
    left <<= 1; left -= count[len];
    if (left < 0) throw new Error('over-subscribed Huffman code');
  }
  const offs = new Int32Array(maxBits + 1);
  for (let len = 1; len <= maxBits; len++) offs[len] = offs[len - 1] + count[len - 1];
  const symbol = new Int32Array(n);
  for (let sym = 0; sym < n; sym++) if (lengths[sym]) symbol[offs[lengths[sym]]++] = sym;
  return { count, symbol, maxBits };
}

function canonicalCodes(lengths, n) {
  const maxBits = lengths.reduce((a, b) => Math.max(a, b), 0);
  const blCount = new Int32Array(maxBits + 1);
  for (let i = 0; i < n; i++) if (lengths[i]) blCount[lengths[i]]++;
  const nextCode = new Int32Array(maxBits + 2);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits++) { code = (code + blCount[bits - 1]) << 1; nextCode[bits] = code; }
  const codes = new Array(n);
  for (let sym = 0; sym < n; sym++) {
    const len = lengths[sym];
    if (len) { codes[sym] = { code: nextCode[len], len }; nextCode[len]++; }
  }
  return codes;
}

class BitReader {
  constructor(bytes) { this.b = bytes; this.pos = 0; this.bit = 0; }
  readBits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.b.length) throw new Error('unexpected end of deflate stream');
      v |= ((this.b[this.pos] >>> this.bit) & 1) << i;
      if (++this.bit === 8) { this.bit = 0; this.pos++; }
    }
    return v >>> 0;
  }
  alignByte() { if (this.bit !== 0) { this.bit = 0; this.pos++; } }
}

function huffmanDecode(h, br) {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= h.maxBits; len++) {
    code |= br.readBits(1);
    const cnt = h.count[len];
    if (code - first < cnt) return h.symbol[index + (code - first)];
    index += cnt; first = (first + cnt) << 1; code <<= 1;
  }
  throw new Error('invalid Huffman code');
}

// Fixed Huffman tables (built once).
const FIXED_LITLEN = (() => {
  const L = new Array(288);
  for (let i = 0; i <= 143; i++) L[i] = 8;
  for (let i = 144; i <= 255; i++) L[i] = 9;
  for (let i = 256; i <= 279; i++) L[i] = 7;
  for (let i = 280; i <= 287; i++) L[i] = 8;
  return { huff: huffmanConstruct(L, 288), codes: canonicalCodes(L, 288) };
})();
const FIXED_DIST = (() => {
  const L = new Array(30).fill(5);
  return { huff: huffmanConstruct(L, 30), codes: canonicalCodes(L, 30) };
})();

function inflateBlock(br, out, litLenHuff, distHuff) {
  for (;;) {
    const sym = huffmanDecode(litLenHuff, br);
    if (sym < 256) { out.push(sym); }
    else if (sym === 256) { break; }
    else {
      const li = sym - 257;
      if (li >= 29) throw new Error('invalid length code');
      const len = LEN_BASE[li] + br.readBits(LEN_EXTRA[li]);
      const dsym = huffmanDecode(distHuff, br);
      const dist = DIST_BASE[dsym] + br.readBits(DIST_EXTRA[dsym]);
      if (dist > out.length) throw new Error('distance too far back');
      for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
    }
  }
}

function inflateRaw(data) {
  const br = new BitReader(data);
  const out = [];
  let bfinal = 0;
  do {
    bfinal = br.readBits(1);
    const btype = br.readBits(2);
    if (btype === 0) {                                   // stored
      br.alignByte();
      const len = data[br.pos] | (data[br.pos + 1] << 8);
      br.pos += 4;                                       // skip LEN + NLEN
      for (let i = 0; i < len; i++) out.push(data[br.pos++]);
    } else if (btype === 1) {                            // fixed
      inflateBlock(br, out, FIXED_LITLEN.huff, FIXED_DIST.huff);
    } else if (btype === 2) {                            // dynamic
      const hlit = br.readBits(5) + 257;
      const hdist = br.readBits(5) + 1;
      const hclen = br.readBits(4) + 4;
      const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      const cl = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) cl[order[i]] = br.readBits(3);
      const clHuff = huffmanConstruct(cl, 19);
      const lengths = new Array(hlit + hdist).fill(0);
      let idx = 0;
      while (idx < hlit + hdist) {
        const sym = huffmanDecode(clHuff, br);
        if (sym < 16) { lengths[idx++] = sym; }
        else if (sym === 16) { const rep = br.readBits(2) + 3, prev = lengths[idx - 1]; for (let k = 0; k < rep; k++) lengths[idx++] = prev; }
        else if (sym === 17) { const rep = br.readBits(3) + 3; for (let k = 0; k < rep; k++) lengths[idx++] = 0; }
        else if (sym === 18) { const rep = br.readBits(7) + 11; for (let k = 0; k < rep; k++) lengths[idx++] = 0; }
      }
      const litLenHuff = huffmanConstruct(lengths.slice(0, hlit), hlit);
      const distHuff = huffmanConstruct(lengths.slice(hlit), hdist) || huffmanConstruct(new Array(1).fill(0), 1);
      inflateBlock(br, out, litLenHuff, distHuff);
    } else {
      throw new Error('invalid deflate block type');
    }
  } while (!bfinal);
  return new Uint8Array(out);
}

class BitWriter {
  constructor() { this.out = []; this.acc = 0; this.nbits = 0; }
  _push(bit) { this.acc |= bit << this.nbits; if (++this.nbits === 8) { this.out.push(this.acc & 0xff); this.acc = 0; this.nbits = 0; } }
  writeBits(value, n) { for (let i = 0; i < n; i++) this._push((value >>> i) & 1); }      // LSB-first
  writeCode(code, len) { for (let i = len - 1; i >= 0; i--) this._push((code >>> i) & 1); } // MSB-first
  finish() { if (this.nbits > 0) { this.out.push(this.acc & 0xff); this.acc = 0; this.nbits = 0; } return new Uint8Array(this.out); }
}

function distSymbol(dist) {
  for (let i = 0; i < 30; i++) {
    if (dist < DIST_BASE[i] + (1 << DIST_EXTRA[i]))
      return { sym: i, extraBits: DIST_EXTRA[i], extraVal: dist - DIST_BASE[i] };
  }
  throw new Error('distance out of range');
}

// DEFLATE compressor using fixed Huffman codes + LZ77 (single-slot hash table).
function deflateRaw(bytes) {
  const bw = new BitWriter();
  bw.writeBits(1, 1);   // BFINAL = 1 (single block)
  bw.writeBits(1, 2);   // BTYPE  = 01 (fixed Huffman)

  const MIN_MATCH = 3, MAX_MATCH = 258, WINDOW = 32768;
  const HASH_BITS = 15, HASH_SIZE = 1 << HASH_BITS;
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const hash3 = (i) => (((bytes[i] << 10) ^ (bytes[i + 1] << 5) ^ bytes[i + 2]) & (HASH_SIZE - 1));

  const emitLiteral = (v) => { const c = FIXED_LITLEN.codes[v]; bw.writeCode(c.code, c.len); };
  const emitEOB = () => { const c = FIXED_LITLEN.codes[256]; bw.writeCode(c.code, c.len); };

  let i = 0;
  while (i < bytes.length) {
    let bestLen = 0, bestDist = 0;
    if (i + MIN_MATCH <= bytes.length) {
      const h = hash3(i);
      const p = head[h];
      if (p >= 0 && i - p <= WINDOW) {
        let l = 0;
        const maxL = Math.min(MAX_MATCH, bytes.length - i);
        while (l < maxL && bytes[p + l] === bytes[i + l]) l++;
        if (l >= MIN_MATCH) { bestLen = l; bestDist = i - p; }
      }
      head[h] = i;
    }
    if (bestLen >= MIN_MATCH) {
      const li = LEN_SYM[bestLen];
      const lc = FIXED_LITLEN.codes[li + 257];
      bw.writeCode(lc.code, lc.len);
      if (LEN_EXTRA[li]) bw.writeBits(bestLen - LEN_BASE[li], LEN_EXTRA[li]);
      const d = distSymbol(bestDist);
      const dc = FIXED_DIST.codes[d.sym];
      bw.writeCode(dc.code, dc.len);
      if (d.extraBits) bw.writeBits(d.extraVal, d.extraBits);
      // Register skipped positions in the hash table so future matches see them.
      for (let k = 1; k < bestLen; k++) {
        if (i + k + MIN_MATCH <= bytes.length) head[hash3(i + k)] = i + k;
      }
      i += bestLen;
    } else {
      emitLiteral(bytes[i]);
      i++;
    }
  }
  emitEOB();
  return bw.finish();
}

// ===========================================================================
// gzip wrapper
// ===========================================================================

function gzip(bytes) {
  const header = Uint8Array.of(0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff);
  const body = deflateRaw(bytes);
  const out = new Uint8Array(header.length + body.length + 8);
  out.set(header, 0);
  out.set(body, header.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(header.length + body.length, crc32(bytes), true);
  dv.setUint32(header.length + body.length + 4, bytes.length >>> 0, true);
  return out;
}

function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('not a gzip stream');
  if (bytes[2] !== 0x08) throw new Error('unsupported gzip compression method');
  const flg = bytes[3];
  let pos = 10;
  if (flg & 0x04) { const xlen = bytes[pos] | (bytes[pos + 1] << 8); pos += 2 + xlen; }
  if (flg & 0x08) { while (bytes[pos] !== 0) pos++; pos++; }   // FNAME
  if (flg & 0x10) { while (bytes[pos] !== 0) pos++; pos++; }   // FCOMMENT
  if (flg & 0x02) { pos += 2; }                                // FHCRC
  const body = bytes.subarray(pos, bytes.length - 8);
  const raw = inflateRaw(body);
  const dv = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
  if (crc32(raw) !== dv.getUint32(0, true)) throw new Error('gzip CRC32 mismatch');
  if ((raw.length >>> 0) !== dv.getUint32(4, true)) throw new Error('gzip ISIZE mismatch');
  return raw;
}

// ===========================================================================
// Little-endian binary reader / writer for the blueprint struct
// ===========================================================================

class ByteReader {
  constructor(u8) { this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.pos = 0; }
  int8()   { const v = this.view.getInt8(this.pos);   this.pos += 1; return v; }
  uint8()  { const v = this.view.getUint8(this.pos);  this.pos += 1; return v; }
  int16()  { const v = this.view.getInt16(this.pos, true);  this.pos += 2; return v; }
  int32()  { const v = this.view.getInt32(this.pos, true);  this.pos += 4; return v; }
  float32(){ const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
}

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1024); this.pos = 0; }
  _need(n) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.buf); this.buf = nb;
  }
  _dv() { this._need(8); return new DataView(this.buf.buffer); }
  int8(v)   { this._need(1); this.buf[this.pos++] = v & 0xff; }
  uint8(v)  { this._need(1); this.buf[this.pos++] = v & 0xff; }
  int16(v)  { this._dv().setInt16(this.pos, v, true); this.pos += 2; }
  int32(v)  { this._dv().setInt32(this.pos, v, true); this.pos += 4; }
  float32(v){ this._dv().setFloat32(this.pos, v, true); this.pos += 4; }
  bytes()   { return this.buf.subarray(0, this.pos); }
}

function readXYZ(r) { return { x: r.float32(), y: r.float32(), z: r.float32() }; }
function writeXYZ(w, v) { w.float32(v.x); w.float32(v.y); w.float32(v.z); }

function readArea(r) {
  return {
    index: r.int8(),
    parentIndex: r.int8(),
    tropicAnchor: r.int16(),
    areaSegments: r.int16(),
    anchorLocalOffset: { x: r.int16(), y: r.int16() },
    size: { x: r.int16(), y: r.int16() },
  };
}
function writeArea(w, a) {
  w.int8(a.index); w.int8(a.parentIndex);
  w.int16(a.tropicAnchor); w.int16(a.areaSegments);
  w.int16(a.anchorLocalOffset.x); w.int16(a.anchorLocalOffset.y);
  w.int16(a.size.x); w.int16(a.size.y);
}

function readBuilding(r) {
  const first = r.int32();
  const v2 = first <= -100;              // v2 buildings carry a sentinel + tilt
  const b = {
    index: v2 ? r.int32() : first,
    areaIndex: r.int8(),
    localOffset: [readXYZ(r), readXYZ(r)],
    yaw: [r.float32(), r.float32()],
    tilt: v2 ? r.float32() : 0.0,
    itemId: r.int16(),
    modelIndex: r.int16(),
    outputObjIdx: r.int32(),
    inputObjIdx: r.int32(),
    outputToSlot: r.int8(),
    inputFromSlot: r.int8(),
    outputFromSlot: r.int8(),
    inputToSlot: r.int8(),
    outputOffset: r.int8(),
    inputOffset: r.int8(),
    recipeId: r.int16(),
    filterId: r.int16(),
    parameters: null,
  };
  const len = r.int16();
  if (len > 0) {
    const p = new Array(len);
    for (let i = 0; i < len; i++) p[i] = r.int32();
    b.parameters = p;
  }
  return b;
}

// Encoder always emits the v1 layout (single index, no tilt sentinel), matching
// huww98/dsp_blueprint_editor, which the game accepts.
function writeBuilding(w, b) {
  w.int32(b.index);
  w.int8(b.areaIndex);
  writeXYZ(w, b.localOffset[0]); writeXYZ(w, b.localOffset[1]);
  w.float32(b.yaw[0]); w.float32(b.yaw[1]);
  w.int16(b.itemId); w.int16(b.modelIndex);
  w.int32(b.outputObjIdx); w.int32(b.inputObjIdx);
  w.int8(b.outputToSlot); w.int8(b.inputFromSlot);
  w.int8(b.outputFromSlot); w.int8(b.inputToSlot);
  w.int8(b.outputOffset); w.int8(b.inputOffset);
  w.int16(b.recipeId); w.int16(b.filterId);
  if (b.parameters && b.parameters.length) {
    w.int16(b.parameters.length);
    for (let i = 0; i < b.parameters.length; i++) w.int32(b.parameters[i]);
  } else {
    w.int16(0);
  }
}

// ===========================================================================
// Header (CSV) + full string assembly
// ===========================================================================

const START = 'BLUEPRINT:';
const utf8 = (s) => new TextEncoder().encode(s);

function nowTicks() {
  // .NET ticks: 100ns intervals since 0001-01-01 UTC.
  return (BigInt(Date.now()) * 10000n + 621355968000000000n).toString();
}

function decodeBlueprint(str) {
  if (typeof str !== 'string') str = String(str);
  str = str.trim();
  if (!str.startsWith(START)) throw new Error('Blueprint must start with "BLUEPRINT:"');

  const p1 = str.indexOf('"', START.length);
  if (p1 < 0) throw new Error('Malformed header (missing first quote)');
  const cells = str.substring(START.length, p1).split(',');
  if (cells.length < 12) throw new Error('Header too short (' + cells.length + ' cells, need 12)');

  const header = {
    layout: parseInt(cells[1], 10),
    icons: cells.slice(2, 7).map((s) => parseInt(s, 10)),   // icon0..icon4
    time: cells[8],                                           // raw .NET ticks (kept as string: exceeds Number.MAX_SAFE_INTEGER)
    gameVersion: cells[9],
    shortDesc: decodeURIComponent(cells[10]),
    desc: decodeURIComponent(cells[11]),
  };

  const p2 = str.length - 33;                                 // position of the last quote
  if (str[p2] !== '"') throw new Error('Checksum quote not found');
  const expected = str.substring(p2 + 1).toLowerCase();
  const hashed = str.substring(0, p2);                        // header + '"' + base64
  const actual = md5fHex(utf8(hashed));
  if (actual !== expected) throw new Error('Checksum mismatch: expected ' + expected + ', computed ' + actual);

  const b64 = str.substring(p1 + 1, p2);
  const raw = gunzip(base64Decode(b64));
  const r = new ByteReader(raw);

  const meta = {
    version: r.int32(),
    cursorOffset: { x: r.int32(), y: r.int32() },
    cursorTargetArea: r.int32(),
    dragBoxSize: { x: r.int32(), y: r.int32() },
    primaryAreaIdx: r.int32(),
  };

  const numAreas = r.uint8();
  const areas = [];
  for (let i = 0; i < numAreas; i++) areas.push(readArea(r));

  const numBuildings = r.int32();
  const buildings = [];
  for (let i = 0; i < numBuildings; i++) buildings.push(readBuilding(r));

  return { header, ...meta, areas, buildings };
}

function encodeBlueprint(obj) {
  const header = obj.header || {};
  const layout = header.layout !== undefined ? header.layout : 10;
  const icons = header.icons || [0, 0, 0, 0, 0];
  const time = header.time !== undefined ? String(header.time) : nowTicks();
  const gameVersion = header.gameVersion !== undefined ? header.gameVersion : '0.9.24.11286';
  const shortDesc = header.shortDesc !== undefined ? header.shortDesc : '';
  const desc = header.desc !== undefined ? header.desc : '';

  const areas = (obj.areas && obj.areas.length)
    ? obj.areas
    : [{ index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 0, anchorLocalOffset: { x: 0, y: 0 }, size: { x: 0, y: 0 } }];
  const buildings = obj.buildings || [];

  const w = new ByteWriter();
  w.int32(obj.version !== undefined ? obj.version : 1);
  w.int32((obj.cursorOffset && obj.cursorOffset.x) || 0);
  w.int32((obj.cursorOffset && obj.cursorOffset.y) || 0);
  w.int32(obj.cursorTargetArea || 0);
  w.int32((obj.dragBoxSize && obj.dragBoxSize.x) || 0);
  w.int32((obj.dragBoxSize && obj.dragBoxSize.y) || 0);
  w.int32(obj.primaryAreaIdx || 0);

  w.uint8(areas.length);
  for (const a of areas) writeArea(w, a);

  w.int32(buildings.length);
  for (const b of buildings) writeBuilding(w, b);

  const b64 = base64Encode(gzip(w.bytes()));

  let out = START;
  out += '0,' + layout + ',';
  out += icons[0] + ',' + icons[1] + ',' + icons[2] + ',' + icons[3] + ',' + icons[4] + ',';
  out += '0,' + time + ',' + gameVersion + ',';
  out += encodeURIComponent(shortDesc) + ',' + encodeURIComponent(desc);
  out += '"' + b64;

  const hash = md5fHex(utf8(out)).toUpperCase();
  out += '"' + hash;
  return out;
}

// ---------------------------------------------------------------------------
// Object schema (returned by decodeBlueprint / consumed by encodeBlueprint)
// ---------------------------------------------------------------------------
// {
//   header: {
//     layout: number,          // integer, e.g. 10 (this is the game's layout version)
//     icons: [n,n,n,n,n],      // 5 icon slots (icon0..icon4); packed id/level ints
//     time: string,            // raw .NET ticks (100ns since year 1); string => lossless
//     gameVersion: string,     // e.g. "0.9.24.11286"
//     shortDesc: string,       // URL-decoded
//     desc: string,            // long description, URL-decoded
//   },
//   version: number,           // struct version (1 = classic, >=? uses v2 buildings)
//   cursorOffset: {x:number, y:number},
//   cursorTargetArea: number,
//   dragBoxSize: {x:number, y:number},
//   primaryAreaIdx: number,
//   areas: [ { index, parentIndex, tropicAnchor, areaSegments,
//              anchorLocalOffset:{x,y}, size:{x,y} } ],
//   buildings: [ {
//     index, areaIndex,
//     localOffset: [ {x,y,z}, {x,y,z} ],   // two float32 triples (NOT a packed int)
//     yaw: [float32, float32],             // radians, two slots (e.g. belt vs inserter)
//     tilt: float32,                       // 0 for v1; only present in v2 buildings
//     itemId, modelIndex,
//     outputObjIdx, inputObjIdx,           // index of connected building (-1 = none)
//     outputToSlot, inputFromSlot, outputFromSlot, inputToSlot,
//     outputOffset, inputOffset,           // inserter/belt attach offsets
//     recipeId, filterId,
//     parameters: number[] | null,         // raw int32 payload (station/belt/lab/... config)
//   } ],
// }
// ---------------------------------------------------------------------------

window.SRBlueprint = { decodeBlueprint, encodeBlueprint, md5fHex, nowTicks };
