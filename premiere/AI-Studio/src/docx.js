/*
 * Reads the text out of a Word .docx file. A .docx is a zip of XML files, and UXP has no unzip,
 * so this carries a small zip reader and DEFLATE decoder (RFC 1951). PDFs don't need this: Claude
 * reads them directly.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});

  // ---------- DEFLATE ----------

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  /** Canonical Huffman table: counts per bit length + symbols sorted by code. */
  function buildTable(lengths) {
    const counts = new Uint16Array(16);
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;
    const offs = new Uint16Array(16);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    const symbols = new Uint16Array(lengths.length);
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { counts, symbols };
  }

  function inflateRaw(input, sizeHint) {
    let out = new Uint8Array(sizeHint || input.length * 4 + 1024);
    let outPos = 0;
    let pos = 0;
    let bitBuf = 0;
    let bitCnt = 0;

    function ensure(n) {
      if (outPos + n <= out.length) return;
      const bigger = new Uint8Array(Math.max(out.length * 2, outPos + n));
      bigger.set(out);
      out = bigger;
    }
    function bits(n) {
      while (bitCnt < n) {
        if (pos >= input.length) throw new Error("Unexpected end of compressed data");
        bitBuf |= input[pos++] << bitCnt;
        bitCnt += 8;
      }
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    }
    function decode(t) {
      let code = 0;
      let first = 0;
      let index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const count = t.counts[len];
        if (code - first < count) return t.symbols[index + code - first];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error("Bad Huffman code");
    }

    let fixedLit = null;
    let fixedDist = null;
    let final = 0;
    while (!final) {
      final = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0;
        bitCnt = 0;
        const len = input[pos] | (input[pos + 1] << 8);
        pos += 4;
        ensure(len);
        out.set(input.subarray(pos, pos + len), outPos);
        pos += len;
        outPos += len;
        continue;
      }
      let lit;
      let dist;
      if (type === 1) {
        if (!fixedLit) {
          const l = new Uint8Array(288);
          for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
          fixedLit = buildTable(l);
          fixedDist = buildTable(new Uint8Array(30).fill(5));
        }
        lit = fixedLit;
        dist = fixedDist;
      } else if (type === 2) {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
        const clTable = buildTable(cl);
        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist; ) {
          const sym = decode(clTable);
          if (sym < 16) lens[i++] = sym;
          else {
            let rep;
            let val = 0;
            if (sym === 16) {
              val = lens[i - 1];
              rep = 3 + bits(2);
            } else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            while (rep--) lens[i++] = val;
          }
        }
        lit = buildTable(lens.subarray(0, hlit));
        dist = buildTable(lens.subarray(hlit));
      } else {
        throw new Error("Bad block type");
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {
          ensure(1);
          out[outPos++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
          const di = decode(dist);
          const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
          ensure(len);
          for (let k = 0; k < len; k++, outPos++) out[outPos] = out[outPos - d];
        }
      }
    }
    return out.subarray(0, outPos);
  }

  // ---------- zip ----------

  function readZipEntry(buffer, wanted) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    // End of central directory: search backwards for its signature.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("This file isn't a valid Word document.");
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    for (let n = 0; n < count; n++) {
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      let name = "";
      for (let i = 0; i < nameLen; i++) name += String.fromCharCode(bytes[p + 46 + i]);
      if (name === wanted) {
        const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = bytes.subarray(dataStart, dataStart + compSize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data, size);
        throw new Error("Unsupported compression in this Word file.");
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error("No text found in this Word document.");
  }

  function utf8(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    try {
      return decodeURIComponent(escape(s));
    } catch (e) {
      return s;
    }
  }

  function unescapeXml(s) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, "&");
  }

  /** Plain text of a .docx, one line per paragraph (same approach as the Seedance connector). */
  function docxText(buffer) {
    const xml = utf8(readZipEntry(buffer, "word/document.xml"));
    const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    return paras
      .map((p) => {
        const parts = [];
        const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
        let m;
        while ((m = re.exec(p))) parts.push(m[1] != null ? unescapeXml(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n");
        return parts.join("");
      })
      .join("\n");
  }

  Studio.docx = { docxText, inflateRaw, utf8 };
})();
