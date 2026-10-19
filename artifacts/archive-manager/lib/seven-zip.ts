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
import { parseSevenZipListing } from '@/lib/seven-zip-listing';

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
  const listing = parseSevenZipListing(
    output,
    safeArchivePath,
    MAX_ENTRIES,
    MAX_TOTAL_UNCOMPRESSED_BYTES,
  );
  return { ...listing, files: {} };
}

function openSevenZip(engine: SevenZipModule, bytes: Uint8Array) {
  engine.FS.writeFile('/input.7z', bytes);
  return '/input.7z';
}

function guardOutputWrites(
  engine: SevenZipModule,
  maxBytes: number,
  onLimit: () => void,
) {
  const originalWrite = engine.FS.write.bind(engine.FS);
  const fileSizes = new Map<string, number>();
  let totalWritten = 0;

  engine.FS.write = (stream, buffer, offset, length, position, canOwn) => {
    let path = '';
    try {
      path = engine.FS.getPath(stream.object);
    } catch {
      return originalWrite(stream, buffer, offset, length, position, canOwn);
    }
    if (!path.startsWith('/extract/')) {
      return originalWrite(stream, buffer, offset, length, position, canOwn);
    }

    const currentSize = fileSizes.get(path) ?? 0;
    const streamPosition = (stream as typeof stream & { position?: number }).position;
    const start = position ?? streamPosition ?? currentSize;
    const nextSize = Math.max(currentSize, start + length);
    if (totalWritten + nextSize - currentSize > maxBytes) {
      onLimit();
      throw new Error('This archive expands beyond the 200 MB safety limit.');
    }

    const written = originalWrite(stream, buffer, offset, length, position, canOwn);
    if (written > 0) {
      const actualSize = Math.max(currentSize, start + written);
      totalWritten += actualSize - currentSize;
      fileSizes.set(path, actualSize);
    }
    return written;
  };
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
  } catch (error) {
    if (error instanceof Error && !/^(?:Aborted|ExitStatus)/.test(error.message)) throw error;
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
  let expandedLimitHit = false;
  try {
    engine.callMain(['l', '-slt', archivePath]);
    listing = parseList(output);
    engine.FS.mkdir('/extract');
    guardOutputWrites(engine, MAX_TOTAL_UNCOMPRESSED_BYTES, () => {
      expandedLimitHit = true;
    });
    engine.callMain(['x', '-y', archivePath, '-o/extract']);
  } catch (error) {
    if (expandedLimitHit) {
      throw new Error('This archive expands beyond the 200 MB safety limit.');
    }
    if (error instanceof Error && !/^(?:Aborted|ExitStatus)/.test(error.message)) throw error;
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
