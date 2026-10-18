import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { unzipSync, zipSync } from 'fflate';

export type ArchiveItem = {
  id: string;
  name: string;
  uri: string;
  size: number;
  kind: 'archive' | 'file';
  addedAt: number;
};

export type ZipEntry = {
  path: string;
  size: number;
  isDirectory: boolean;
};

type CentralEntry = ZipEntry & { crc32: number };

const ROOT_FOLDER = 'ArchiveManager';
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRIES = 3000;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cleanFileName(name: string) {
  const leaf = name.split(/[\\/]/).pop() ?? '';
  const safe = leaf
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+$/, '')
    .trim();
  return safe || 'untitled';
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getRootDirectory() {
  return new Directory(Paths.document, ROOT_FOLDER);
}

export async function readUriBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read this file.');
    return new Uint8Array(await response.arrayBuffer());
  }
  return new File(uri).bytes();
}

export async function readTextFile(uri: string) {
  const bytes = await readUriBytes(uri);
  return new TextDecoder().decode(bytes);
}

export async function saveBytes(relativePath: string, bytes: Uint8Array): Promise<string> {
  const safeParts = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map(cleanFileName);
  const fileName = safeParts.pop() || 'file';

  if (Platform.OS === 'web') {
    return URL.createObjectURL(new Blob([toArrayBuffer(bytes)]));
  }

  const root = getRootDirectory();
  const directory = new Directory(root, ...safeParts);
  directory.create({ intermediates: true, idempotent: true });
  const output = new File(directory, fileName);
  if (output.exists) output.delete();
  output.write(bytes);
  return output.uri;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function safeArchivePath(input: string) {
  const path = input.replace(/\\/g, '/');
  if (
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    path.includes('\0')
  ) {
    throw new Error('This archive contains an unsafe file path.');
  }
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) {
    throw new Error('This archive contains an unsafe file path.');
  }
  const cleaned = parts.filter((part) => part !== '.').join('/');
  if (!cleaned) throw new Error('This archive contains an invalid file path.');
  return cleaned;
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('ZIP files over 64 MB are not supported in this preview build.');
  }
  if (bytes.byteLength < 22) throw new Error('This file is not a valid ZIP archive.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliestEocd = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= earliestEocd; offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) <= bytes.byteLength
    ) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP directory not found. The archive may be incomplete or split into parts.');

  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported in this build.');
  }
  if (count > MAX_ENTRIES) throw new Error(`This archive has more than ${MAX_ENTRIES} entries.`);

  const entries: CentralEntry[] = [];
  const seen = new Set<string>();
  let totalExpanded = 0;
  let cursor = centralOffset;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('The archive directory is damaged.');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const expandedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const nameStart = cursor + 46;
    const next = nameStart + nameLength + extraLength + commentLength;

    if (next > bytes.byteLength) throw new Error('The archive directory is damaged.');
    if (flags & 1) throw new Error('Password-protected ZIP files are not supported yet.');
    if (method !== 0 && method !== 8) throw new Error('This ZIP uses an unsupported compression method.');
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff) {
      throw new Error('ZIP64 entries are not supported in this build.');
    }

    const rawName = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const path = safeArchivePath(rawName);
    if (seen.has(path)) throw new Error('This archive has duplicate file paths.');
    seen.add(path);
    const isDirectory = rawName.endsWith('/') || rawName.endsWith('\\');
    if (!isDirectory) {
      totalExpanded += expandedSize;
      if (totalExpanded > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('This archive expands beyond the 200 MB safety limit.');
      }
    }
    entries.push({ path, size: expandedSize, isDirectory, crc32: crc });
    cursor = next;
  }

  const files = entries.filter((entry) => !entry.isDirectory);
  const folders = new Set<string>();
  for (const entry of files) {
    const parts = entry.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'));
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory) folders.add(entry.path.replace(/\/$/, ''));
  }
  for (const folder of folders) {
    if (!seen.has(folder)) entries.push({ path: folder, size: 0, isDirectory: true, crc32: 0 });
  }
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

async function readAndVerifyZip(uri: string) {
  const bytes = await readUriBytes(uri);
  const entries = readCentralDirectory(bytes);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('The archive could not be decompressed. It may be incomplete or damaged.');
  }

  const fileEntries = entries.filter((entry) => !entry.isDirectory);
  for (const entry of fileEntries) {
    const content = files[entry.path];
    if (!content || content.byteLength !== entry.size || crc32(content) !== entry.crc32) {
      throw new Error(`Integrity check failed for ${entry.path}.`);
    }
  }
  return { entries, files, archiveSize: bytes.byteLength };
}

export async function inspectZip(uri: string) {
  const result = await readAndVerifyZip(uri);
  return result.entries;
}

export async function testZip(uri: string) {
  const result = await readAndVerifyZip(uri);
  const fileCount = result.entries.filter((entry) => !entry.isDirectory).length;
  const expandedBytes = result.entries.reduce(
    (sum, entry) => sum + (entry.isDirectory ? 0 : entry.size),
    0,
  );
  return { fileCount, expandedBytes };
}

export async function createZip(
  name: string,
  inputs: { name: string; uri: string }[],
  level: number,
): Promise<ArchiveItem> {
  if (inputs.length === 0) throw new Error('Choose at least one file first.');
  if (inputs.length > MAX_ENTRIES) throw new Error(`Choose ${MAX_ENTRIES} files or fewer.`);

  const payload: Record<string, Uint8Array> = {};
  let inputBytes = 0;
  const usedNames = new Set<string>();
  for (const input of inputs) {
    const base = cleanFileName(input.name);
    let candidate = base;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      const dot = base.lastIndexOf('.');
      candidate = dot > 0
        ? `${base.slice(0, dot)} (${suffix})${base.slice(dot)}`
        : `${base} (${suffix})`;
      suffix += 1;
    }
    usedNames.add(candidate);
    const bytes = await readUriBytes(input.uri);
    inputBytes += bytes.byteLength;
    if (inputBytes > MAX_ARCHIVE_BYTES) {
      throw new Error('Choose files totaling 64 MB or less for this preview build.');
    }
    payload[candidate] = bytes;
  }

  const normalizedLevel = Math.max(0, Math.min(9, Math.round(level))) as
    | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  const output = zipSync(payload, { level: normalizedLevel });
  if (output.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('The ZIP output exceeds the 64 MB preview limit.');
  }
  const safeName = cleanFileName(name.replace(/\.zip$/i, '') || 'Archive') + '.zip';
  const uri = await saveBytes(`${makeId()}-${safeName}`, output);
  return {
    id: makeId(),
    name: safeName,
    uri,
    size: output.byteLength,
    kind: 'archive',
    addedAt: Date.now(),
  };
}

export async function extractZip(uri: string, archiveName: string, selectedPaths: string[]) {
  if (selectedPaths.length === 0) throw new Error('Select at least one item to extract.');
  const result = await readAndVerifyZip(uri);
  const selected = new Set(selectedPaths);
  const filesToWrite = result.entries.filter(
    (entry) => !entry.isDirectory && selected.has(entry.path),
  );
  if (filesToWrite.length === 0) throw new Error('No files were selected for extraction.');

  const outputFolder = `${cleanFileName(archiveName.replace(/\.zip$/i, '') || 'Extracted')}-${makeId()}`;
  const extracted: ArchiveItem[] = [];
  for (const entry of filesToWrite) {
    const content = result.files[entry.path];
    if (!content) continue;
    const uri = await saveBytes(`Extracted/${outputFolder}/${entry.path}`, content);
    extracted.push({
      id: makeId(),
      name: entry.path,
      uri,
      size: content.byteLength,
      kind: 'file',
      addedAt: Date.now(),
    });
  }
  return extracted;
}

export async function removeStoredFile(item: ArchiveItem) {
  if (Platform.OS === 'web') {
    if (item.uri.startsWith('blob:')) URL.revokeObjectURL(item.uri);
    return;
  }
  const file = new File(item.uri);
  if (file.exists) file.delete();
}

export async function exportFile(item: ArchiveItem) {
  if (Platform.OS !== 'web') return item.uri;
  const bytes = await readUriBytes(item.uri);
  const objectUrl = URL.createObjectURL(new Blob([toArrayBuffer(bytes)]));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = cleanFileName(item.name);
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return objectUrl;
}
