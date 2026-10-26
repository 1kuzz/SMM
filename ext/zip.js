// SMM — ZIP без зависимостей: deflate через CompressionStream, CRC-32, имена в UTF-8.
// shortcut: без ZIP64 — до 65 535 файлов и 4 ГБ на архив; запись столько не набирает (скриншотов не больше 2000).
const SMMZip = (() => {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (u8) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = table[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const deflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const dos = (d) => ({
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  });

  /** files: [{ name, data: string | Uint8Array | Blob, store?: true (already compressed, e.g. JPEG), date? }] → Blob */
  async function build(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
      const crc = crc32(data);
      const body = f.store ? data : await deflate(data);
      const method = f.store ? 0 : 8;
      const name = enc.encode(f.name);
      const { time, date } = dos(f.date || new Date());
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, method, true);
      head.setUint16(10, time, true); head.setUint16(12, date, true); head.setUint32(14, crc, true);
      head.setUint32(18, body.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true);
      parts.push(head.buffer, name, body);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, method, true); cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
      cd.setUint32(20, body.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
      central.push(cd.buffer, name);
      offset += 30 + name.length + body.length;
    }
    const size = central.reduce((a, b) => a + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  return { build, crc32 };
})();
