import { Gunzip, gzipSync } from 'fflate';

export type CodecEntry = {
  path: string;
  size: number;
  isDirectory: boolean;
};

export type TarContents = {
  entries: CodecEntry[];
  files: Record<string, Uint8Array>;
  expandedBytes: number;
};

const TAR_BLOCK_SIZE = 512;
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function decodeField(bytes: Uint8Array) {
  const end = bytes.indexOf(0);
  return UTF8_DECODER.decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function parseOctal(bytes: Uint8Array) {
  const text = decodeField(bytes).trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error('This TAR contains an invalid numeric field.');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('This TAR contains an invalid numeric field.');
  }
  return value;
}

function encodeOctal(value: number, width: number) {
  const text = Math.floor(value).toString(8);
  if (text.length > width - 1) throw new Error('A TAR file is too large to represent safely.');
  return `${'0'.repeat(width - 1 - text.length)}${text}\0`;
}

function writeText(header: Uint8Array, offset: number, width: number, text: string) {
  const bytes = UTF8.encode(text);
  if (bytes.byteLength > width) throw new Error('A TAR file path is too long.');
  header.set(bytes, offset);
}

function splitUstarPath(path: string) {
  const bytes = UTF8.encode(path);
  if (bytes.byteLength <= 100) return { name: path, prefix: '' };

  const segments = path.split('/');
  for (let split = segments.length - 1; split > 0; split -= 1) {
    const prefix = segments.slice(0, split).join('/');
    const name = segments.slice(split).join('/');
    if (UTF8.encode(prefix).byteLength <= 155 && UTF8.encode(name).byteLength <= 100) {
      return { name, prefix };
    }
  }
  throw new Error('TAR supports paths up to 255 UTF-8 bytes in this build.');
}

function tarHeader(path: string, size: number, modifiedAt = Math.floor(Date.now() / 1000)) {
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  const { name, prefix } = splitUstarPath(path);
  writeText(header, 0, 100, name);
  writeText(header, 100, 8, encodeOctal(0o644, 8));
  writeText(header, 108, 8, encodeOctal(0, 8));
  writeText(header, 116, 8, encodeOctal(0, 8));
  writeText(header, 124, 12, encodeOctal(size, 12));
  writeText(header, 136, 12, encodeOctal(modifiedAt, 12));
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeText(header, 257, 6, 'ustar\0');
  writeText(header, 263, 2, '00');
  writeText(header, 265, 32, 'archive');
  writeText(header, 297, 32, 'archive');
  writeText(header, 345, 155, prefix);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0');
  writeText(header, 148, 6, checksumText);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

export function createTar(files: Record<string, Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for (const [path, contents] of Object.entries(files)) {
    const safePath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const header = tarHeader(safePath, contents.byteLength);
    chunks.push(header, contents);
    const padding = (TAR_BLOCK_SIZE - (contents.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (padding) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(TAR_BLOCK_SIZE * 2));

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parsePax(data: Uint8Array) {
  const result: Record<string, string> = {};
  let offset = 0;
  while (offset < data.byteLength) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) throw new Error('This TAR contains a damaged PAX header.');
    const recordLength = Number.parseInt(UTF8_DECODER.decode(data.subarray(offset, space)), 10);
    const end = offset + recordLength;
    if (!Number.isInteger(recordLength) || recordLength <= 0 || end > data.byteLength) {
      throw new Error('This TAR contains a damaged PAX header.');
    }
    const record = UTF8_DECODER.decode(data.subarray(space + 1, end)).replace(/\n$/, '');
    const equals = record.indexOf('=');
    if (equals > 0) result[record.slice(0, equals)] = record.slice(equals + 1);
    offset = end;
  }
  return result;
}

function paxSize(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('This TAR contains an invalid PAX size.');
  const size = Number(value);
  if (!Number.isSafeInteger(size)) throw new Error('This TAR contains an invalid PAX size.');
  return size;
}

function isZeroBlock(bytes: Uint8Array) {
  for (const byte of bytes) if (byte !== 0) return false;
  return true;
}

function addParents(entries: CodecEntry[]) {
  const seen = new Set(entries.map((entry) => entry.path.replace(/\/$/, '')));
  const directories: CodecEntry[] = [];
  for (const entry of entries) {
    const parts = entry.path.replace(/\/$/, '').split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const path = parts.slice(0, index).join('/');
      if (!seen.has(path)) {
        seen.add(path);
        directories.push({ path, size: 0, isDirectory: true });
      }
    }
  }
  return [...entries, ...directories].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

export function readTar(
  bytes: Uint8Array,
  safePath: (path: string) => string,
  maxEntries: number,
  maxExpandedBytes: number,
): TarContents {
  if (bytes.byteLength < TAR_BLOCK_SIZE || bytes.byteLength % TAR_BLOCK_SIZE !== 0) {
    throw new Error('This file is not a valid TAR archive.');
  }

  const entries: CodecEntry[] = [];
  const files: Record<string, Uint8Array> = {};
  const seen = new Set<string>();
  let expandedBytes = 0;
  let globalPax: Record<string, string> = {};
  let localPax: Record<string, string> = {};
  let pendingLongName: string | undefined;
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (isZeroBlock(header)) break;

    const expectedChecksum = parseOctal(header.subarray(148, 156));
    let actualChecksum = 0;
    for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
      actualChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (expectedChecksum !== actualChecksum) {
      throw new Error('TAR header integrity check failed.');
    }

    const name = decodeField(header.subarray(0, 100));
    const prefix = decodeField(header.subarray(345, 500));
    const basePath = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 0);
    const headerSize = parseOctal(header.subarray(124, 136));
    const metadata = { ...globalPax, ...localPax };
    const isMetadata = type === 'g' || type === 'x' || type === 'L';
    const dataSize = isMetadata ? headerSize : paxSize(metadata.size, headerSize);
    const metadataOffset = offset + TAR_BLOCK_SIZE;
    const metadataEnd = metadataOffset + dataSize;
    if (metadataEnd > bytes.byteLength) throw new Error('This TAR archive is incomplete.');
    const data = bytes.subarray(metadataOffset, metadataEnd);
    const paddedSize = Math.ceil(dataSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    offset = metadataOffset + paddedSize;

    if (type === 'g' || type === 'x') {
      const metadata = parsePax(data);
      if (type === 'g') globalPax = { ...globalPax, ...metadata };
      else localPax = metadata;
      continue;
    }
    if (type === 'L') {
      pendingLongName = UTF8_DECODER.decode(data).replace(/\0+$/, '');
      continue;
    }

    const rawPath = pendingLongName ?? metadata.path ?? basePath;
    pendingLongName = undefined;
    localPax = {};

    if (type === '1' || type === '2' || type === '3' || type === '4' || type === '6') {
      throw new Error('This TAR contains a link or special device entry, which is not extracted.');
    }
    if (type !== '\0' && type !== '0' && type !== '5' && type !== '7') {
      throw new Error('This TAR uses an unsupported entry type.');
    }

    const path = safePath(rawPath);
    const isDirectory = type === '5' || rawPath.endsWith('/');
    const size = isDirectory ? 0 : dataSize;
    if (seen.has(path)) throw new Error('This archive has duplicate file paths.');
    seen.add(path);
    if (!isDirectory) {
      expandedBytes += size;
      if (expandedBytes > maxExpandedBytes) {
        throw new Error('This archive expands beyond the 200 MB safety limit.');
      }
      files[path] = data.subarray(0, size).slice();
    }
    entries.push({ path, size, isDirectory });
    if (entries.length > maxEntries) throw new Error(`This archive has more than ${maxEntries} entries.`);
  }

  return { entries: addParents(entries), files, expandedBytes };
}

export function gunzipLimited(bytes: Uint8Array, maxOutputBytes: number) {
  if (
    bytes.byteLength < 18 ||
    bytes[0] !== 0x1f ||
    bytes[1] !== 0x8b ||
    bytes[2] !== 0x08
  ) {
    throw new Error('This file is not a valid GZIP stream.');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let limitExceeded = false;
  const stream = new Gunzip((chunk) => {
    total += chunk.byteLength;
    if (total > maxOutputBytes) {
      limitExceeded = true;
      throw new Error('This compressed file expands beyond the 200 MB safety limit.');
    }
    chunks.push(chunk.slice());
  });

  try {
    stream.push(bytes, true);
  } catch (error) {
    if (limitExceeded) {
      throw new Error('This compressed file expands beyond the 200 MB safety limit.');
    }
    throw new Error('GZIP decompression failed. The file may be damaged.');
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function createGzip(bytes: Uint8Array, level: number) {
  return gzipSync(bytes, { level: Math.max(0, Math.min(9, Math.round(level))) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
}
