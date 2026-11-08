// Writes an .sb3 (a zip) from a project's files, the way scratch-vm's own
// saveProjectSb3 does: the same order, the same fixed date, and DEFLATE only
// for the kinds of file that shrink (the rest are already compressed). Doing it
// here, with Node's own zlib, takes a moment, where zipping in an editor tab in
// the background took minutes.

import zlib from 'node:zlib';

const COMPRESSABLE = ['.json', '.svg', '.wav', '.ttf', '.otf'];

// scratch-vm's fixed date (1591657163000), as a zip stores it.
const DATE = new Date(1591657163000);
const DOS_TIME = (DATE.getHours() << 11) | (DATE.getMinutes() << 5) | Math.floor(DATE.getSeconds() / 2);
const DOS_DATE = ((DATE.getFullYear() - 1980) << 9) | ((DATE.getMonth() + 1) << 5) | DATE.getDate();

let table = null;
const crc32 = data => {
    if (zlib.crc32) return zlib.crc32(data) >>> 0;
    if (!table) {
        table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
};

/**
 * @param {Array<[string, Buffer]>} files name and contents, in order
 * @returns {Buffer} the zip
 */
export const makeSb3 = files => {
    if (files.length > 0xFFFF) throw new Error(`A project can hold at most 65535 files; this one has ${files.length}.`);
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, data] of files) {
        const nameBytes = Buffer.from(name, 'utf8');
        const deflate = COMPRESSABLE.some(ext => name.endsWith(ext));
        const stored = deflate ? zlib.deflateRawSync(data) : data;
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0x0800, 6); // names are UTF-8
        local.writeUInt16LE(deflate ? 8 : 0, 8);
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(stored.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28);
        parts.push(local, nameBytes, stored);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014B50, 0);
        entry.writeUInt16LE(20, 4); // made by
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x0800, 8);
        entry.writeUInt16LE(deflate ? 8 : 0, 10);
        entry.writeUInt16LE(DOS_TIME, 12);
        entry.writeUInt16LE(DOS_DATE, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(stored.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(nameBytes.length, 28);
        entry.writeUInt32LE(offset, 42);
        central.push(entry, nameBytes);
        offset += local.length + nameBytes.length + stored.length;
        if (offset > 0xFFFFFFFF) throw new Error('The project is over 4 GB, too big for an .sb3.');
    }
    const centralSize = central.reduce((sum, b) => sum + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, ...central, end]);
};
