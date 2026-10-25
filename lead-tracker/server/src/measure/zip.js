// Minimal streaming ZIP writer — "stored" entries only (no compression).
// Everything this zips is JPEG photos plus a little JSON, and JPEGs don't
// compress, so this skips a dependency for no real cost. Each entry is
// written as soon as it's added, so only one photo is in memory at a time.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function createZipWriter(write) {
  const entries = [];
  let offset = 0;
  const out = (buf) => {
    write(buf);
    offset += buf.length;
  };

  return {
    add(name, data) {
      const nameBuf = Buffer.from(name, "utf8");
      const crc = crc32(data);
      const { time, date } = dosTime(new Date());
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4); // version needed
      header.writeUInt16LE(0x0800, 6); // utf-8 names
      header.writeUInt16LE(0, 8); // stored
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(data.length, 18);
      header.writeUInt32LE(data.length, 22);
      header.writeUInt16LE(nameBuf.length, 26);
      header.writeUInt16LE(0, 28);
      entries.push({ nameBuf, crc, size: data.length, offset, time, date });
      out(header);
      out(nameBuf);
      out(data);
    },
    finish() {
      const start = offset;
      for (const e of entries) {
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(20, 4); // version made by
        c.writeUInt16LE(20, 6); // version needed
        c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(0, 10);
        c.writeUInt16LE(e.time, 12);
        c.writeUInt16LE(e.date, 14);
        c.writeUInt32LE(e.crc, 16);
        c.writeUInt32LE(e.size, 20);
        c.writeUInt32LE(e.size, 24);
        c.writeUInt16LE(e.nameBuf.length, 28);
        c.writeUInt32LE(e.offset, 42);
        out(c);
        out(e.nameBuf);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(offset - start, 12);
      end.writeUInt32LE(start, 16);
      out(end);
    },
  };
}
