import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { SevenZipModule } from '7z-wasm';
import {
  MAX_ARCHIVE_BYTES,
  MAX_ENTRIES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  safeArchivePath,
} from '@/lib/archive';
import type { ZipEntry } from '@/lib/archive';

declare const require: (path: string) => number;
const WASM_ASSET = require('7z-wasm/7zz.wasm');

type SevenZipRun = {
  engine: SevenZipModule;
  output: string[];
  errors: string[];
};

type SevenZipContents = {
  entries: ZipEntry[];
  files: Record<string, Uint8Array>;
  expandedBytes: number;
};

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function loadWasmBinary() {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = (async () => {
      const asset = Asset.fromModule(WASM_ASSET);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) throw new Error('The 7z engine could not be loaded.');
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        if (!response.ok) throw new Error('The 7z engine could not be loaded.');
        return response.arrayBuffer();
      }
      return toArrayBuffer(await new File(uri).bytes());
    })().catch((error) => {
      wasmBinaryPromise = null;
      throw error;
    });
  }
  return wasmBinaryPromise;
}

async function createRun(): Promise<SevenZipRun> {
  if (typeof WebAssembly === 'undefined') {
    throw new Error('7z extraction needs WebAssembly support in this runtime.');
  }
  const wasmBinary = await loadWasmBinary();
  const { default: createEngine } = await import('7z-wasm');
  const output: string[] = [];
  const errors: string[] = [];
  const engine = await createEngine({
    wasmBinary,
    noExitRuntime: true,
    print: (line) => output.push(line),
    printErr: (line) => errors.push(line),
  });
  return { engine, output, errors };
}

function parseList(output: string[]): SevenZipContents {
  const separator = output.findIndex((line) => line.trim() === '----------');
  if (separator < 0) {
    throw new Error('7z could not read the archive directory. It may be damaged or unsupported.');
  }

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let expandedBytes = 0;
  const blocks = output.slice(separator + 1).join('\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const fields: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const separatorAt = line.indexOf(' = ');
      if (separatorAt >= 0) fields[line.slice(0, separatorAt)] = line.slice(separatorAt + 3);
    }
    if (!fields.Path) continue;

    const attributes = fields.Attributes ?? '';
    if (
      fields['Hard Link'] ||
      fields['Symbolic Link'] ||
      /l[rwx-]{8,}/.test(attributes)
    ) {
      throw new Error('This 7z archive contains a link, which is not extracted.');
    }
    if (/^(?:\+|1|true|yes)$/i.test(fields.Encrypted ?? '')) {
      throw new Error('Password-protected 7z archives are not supported yet.');
    }

    const path = safeArchivePath(fields.Path);
    const isDirectory =
      fields.Folder === '+' ||
      attributes.trimStart().startsWith('D') ||
      fields.Path.endsWith('/') ||
      fields.Path.endsWith('\\');
    const size = isDirectory ? 0 : Number(fields.Size ?? 0);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('This 7z archive has an invalid file size.');
    }
    if (seen.has(path)) throw new Error('This archive has duplicate file paths.');
    seen.add(path);
    if (!isDirectory) {
      expandedBytes += size;
      if (expandedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('This archive expands beyond the 200 MB safety limit.');
      }
    }
    entries.push({ path, size, isDirectory });
    if (entries.length > MAX_ENTRIES) {
      throw new Error(`This archive has more than ${MAX_ENTRIES} entries.`);
    }
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
    if (!seen.has(folder)) entries.push({ path: folder, size: 0, isDirectory: true });
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return { entries, files: {}, expandedBytes };
}

function openSevenZip(engine: SevenZipModule, bytes: Uint8Array) {
  engine.FS.writeFile('/input.7z', bytes);
  return '/input.7z';
}

export async function listSevenZip(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Archive files over 64 MB are not supported in this build.');
  }
  const { engine, output, errors } = await createRun();
  const archivePath = openSevenZip(engine, bytes);
  try {
    engine.callMain(['l', '-slt', archivePath]);
  } catch {
    throw new Error(errors.join(' ') || '7z could not read this archive.');
  }
  return parseList(output);
}

export async function testSevenZip(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Archive files over 64 MB are not supported in this build.');
  }
  const { engine, output, errors } = await createRun();
  const archivePath = openSevenZip(engine, bytes);
  let listing: SevenZipContents;
  try {
    engine.callMain(['l', '-slt', archivePath]);
    listing = parseList(output);
    output.length = 0;
    engine.callMain(['t', archivePath]);
  } catch {
    throw new Error(errors.join(' ') || 'The 7z integrity test failed.');
  }
  if (!output.some((line) => line.includes('Everything is Ok'))) {
    throw new Error(errors.join(' ') || 'The 7z integrity test failed.');
  }
  return {
    fileCount: listing.entries.filter((entry) => !entry.isDirectory).length,
    expandedBytes: listing.expandedBytes,
  };
}

export async function extractSevenZip(bytes: Uint8Array, selectedPaths: string[]) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Archive files over 64 MB are not supported in this build.');
  }
  if (selectedPaths.length === 0) throw new Error('Select at least one item to extract.');

  const { engine, output, errors } = await createRun();
  const archivePath = openSevenZip(engine, bytes);
  let listing: SevenZipContents;
  try {
    engine.callMain(['l', '-slt', archivePath]);
    listing = parseList(output);
    engine.FS.mkdir('/extract');
    engine.callMain(['x', '-y', archivePath, '-o/extract']);
  } catch {
    throw new Error(errors.join(' ') || 'The 7z archive could not be extracted.');
  }

  const selected = new Set(selectedPaths);
  const extracted: Record<string, Uint8Array> = {};
  for (const entry of listing.entries) {
    if (entry.isDirectory || !selected.has(entry.path)) continue;
    const outputPath = `/extract/${entry.path}`;
    try {
      const stat = engine.FS.lstat(outputPath);
      if (engine.FS.isLink(stat.mode) || !engine.FS.isFile(stat.mode)) {
        throw new Error('This archive contains a link or special device entry.');
      }
      const data = engine.FS.readFile(outputPath);
      if (data.byteLength !== entry.size) throw new Error(`7z integrity check failed for ${entry.path}.`);
      extracted[entry.path] = data.slice();
    } catch (error) {
      if (error instanceof Error && error.message.includes('integrity check')) throw error;
      throw new Error(`Could not safely extract ${entry.path}.`);
    }
  }
  if (Object.keys(extracted).length === 0) {
    throw new Error('No selected files were found in this 7z archive.');
  }
  return { files: extracted, entries: listing.entries };
}

export async function createSevenZip(files: Record<string, Uint8Array>, level: number) {
  const { engine, output, errors } = await createRun();
  engine.FS.mkdir('/input');
  const names = Object.keys(files);
  for (const name of names) engine.FS.writeFile(`/input/${name}`, files[name]);
  engine.FS.chdir('/input');

  try {
    engine.callMain([
      'a',
      '-t7z',
      `-mx=${Math.max(0, Math.min(9, Math.round(level)))}`,
      '/output.7z',
      ...names,
    ]);
  } catch {
    throw new Error(errors.join(' ') || 'Could not create a 7z archive.');
  }
  if (!output.some((line) => line.includes('Everything is Ok'))) {
    throw new Error(errors.join(' ') || 'Could not create a 7z archive.');
  }
  const bytes = engine.FS.readFile('/output.7z').slice();
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('The 7z output exceeds the 64 MB preview limit.');
  }
  return bytes;
}
