import {
  ArchiveItem,
  cleanFileName,
  createZip,
  extractZip,
  formatBytes,
  makeId,
  MAX_ARCHIVE_BYTES,
  MAX_ENTRIES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  readUriBytes,
  safeArchivePath,
  saveBytes,
  testZip,
  ZipEntry,
  inspectZip,
} from '@/lib/archive';
import { createGzip, createTar, gunzipLimited, readTar } from '@/lib/archive-codecs';
import {
  createSevenZip,
  extractSevenZip,
  listSevenZip,
  testSevenZip,
} from '@/lib/seven-zip';

export type ArchiveFormat = 'zip' | '7z' | 'tar' | 'tar.gz' | 'gzip';

export const ARCHIVE_FORMAT_OPTIONS: {
  id: ArchiveFormat;
  label: string;
  extension: string;
  detail: string;
}[] = [
  { id: 'zip', label: 'ZIP', extension: '.zip', detail: 'Universal' },
  { id: '7z', label: '7z', extension: '.7z', detail: 'Smallest' },
  { id: 'tar', label: 'TAR', extension: '.tar', detail: 'Bundle' },
  { id: 'tar.gz', label: 'TAR.GZ', extension: '.tar.gz', detail: 'Compressed bundle' },
  { id: 'gzip', label: 'GZIP', extension: '.gz', detail: 'One file' },
];

type ParsedContents = {
  entries: ZipEntry[];
  files: Record<string, Uint8Array>;
  expandedBytes: number;
};

function outputName(name: string, format: ArchiveFormat) {
  const suffix = ARCHIVE_FORMAT_OPTIONS.find((option) => option.id === format)?.extension ?? '.zip';
  const base = cleanFileName(
    name.replace(/\.(?:tar\.gz|tgz|zip|7z|tar|gz)$/i, '') || 'Archive',
  );
  return `${base}${suffix}`;
}

export function archiveFormatFromName(name: string): ArchiveFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.7z')) return '7z';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.gz')) return 'gzip';
  return null;
}

async function readInputs(inputs: { name: string; uri: string }[]) {
  if (inputs.length === 0) throw new Error('Choose at least one file first.');
  if (inputs.length > MAX_ENTRIES) throw new Error(`Choose ${MAX_ENTRIES} files or fewer.`);

  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  let total = 0;
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
    total += bytes.byteLength;
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error('Choose files totaling 64 MB or less for this preview build.');
    }
    files[candidate] = bytes;
  }
  return files;
}

export async function createArchiveInFormat(
  name: string,
  inputs: { name: string; uri: string }[],
  level: number,
  format: ArchiveFormat,
): Promise<ArchiveItem> {
  if (format === 'zip') return createZip(name, inputs, level);
  if (format === 'gzip' && inputs.length !== 1) {
    throw new Error('GZIP compresses one file at a time. Choose one file or use TAR.GZ.');
  }

  const payload = await readInputs(inputs);
  let output: Uint8Array;
  switch (format) {
    case '7z':
      output = await createSevenZip(payload, level);
      break;
    case 'tar':
      output = createTar(payload);
      break;
    case 'tar.gz':
      output = createGzip(createTar(payload), level);
      break;
    case 'gzip':
      output = createGzip(Object.values(payload)[0], level);
      break;
  }
  if (output.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`The ${format.toUpperCase()} output exceeds the 64 MB preview limit.`);
  }

  const safeName = outputName(name, format);
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

async function readContents(uri: string, name: string): Promise<ParsedContents> {
  const format = archiveFormatFromName(name);
  if (!format) throw new Error('This archive format is not supported yet.');
  if (format === 'zip') throw new Error('ZIP contents use the ZIP verification path.');

  const bytes = await readUriBytes(uri);
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Archive files over 64 MB are not supported in this build.');
  }

  if (format === '7z') return listSevenZip(bytes);
  if (format === 'tar') {
    const parsed = readTar(bytes, safeArchivePath, MAX_ENTRIES, MAX_TOTAL_UNCOMPRESSED_BYTES);
    return { ...parsed, entries: parsed.entries as ZipEntry[] };
  }
  if (format === 'tar.gz') {
    const tarBytes = gunzipLimited(bytes, MAX_TOTAL_UNCOMPRESSED_BYTES);
    const parsed = readTar(tarBytes, safeArchivePath, MAX_ENTRIES, MAX_TOTAL_UNCOMPRESSED_BYTES);
    return { ...parsed, entries: parsed.entries as ZipEntry[] };
  }

  const expanded = gunzipLimited(bytes, MAX_TOTAL_UNCOMPRESSED_BYTES);
  const nameWithoutGzip = cleanFileName(name.replace(/\.gz$/i, '') || 'decompressed file');
  return {
    entries: [{ path: nameWithoutGzip, size: expanded.byteLength, isDirectory: false }],
    files: { [nameWithoutGzip]: expanded },
    expandedBytes: expanded.byteLength,
  };
}

export async function inspectArchiveInFormat(uri: string, name: string): Promise<ZipEntry[]> {
  const format = archiveFormatFromName(name);
  if (format === 'zip') return inspectZip(uri);
  const contents = await readContents(uri, name);
  return contents.entries;
}

export async function testArchiveInFormat(uri: string, name: string) {
  const format = archiveFormatFromName(name);
  if (format === 'zip') return testZip(uri);
  if (format === '7z') {
    const bytes = await readUriBytes(uri);
    return testSevenZip(bytes);
  }
  const contents = await readContents(uri, name);
  return {
    fileCount: contents.entries.filter((entry) => !entry.isDirectory).length,
    expandedBytes: contents.expandedBytes,
  };
}

export async function extractArchiveInFormat(
  uri: string,
  archiveName: string,
  selectedPaths: string[],
) {
  const format = archiveFormatFromName(archiveName);
  if (format === 'zip') return extractZip(uri, archiveName, selectedPaths);
  if (selectedPaths.length === 0) throw new Error('Select at least one item to extract.');

  const contents = format === '7z'
    ? await extractSevenZip(await readUriBytes(uri), selectedPaths)
    : await readContents(uri, archiveName);
  const selected = new Set(selectedPaths);
  const outputFolder = `${cleanFileName(archiveName.replace(/\.(?:tar\.gz|tgz|7z|tar|gz)$/i, '') || 'Extracted')}-${makeId()}`;
  const extracted: ArchiveItem[] = [];
  let expanded = 0;

  for (const entry of contents.entries) {
    if (entry.isDirectory || !selected.has(entry.path)) continue;
    const bytes = contents.files[entry.path];
    if (!bytes) continue;
    expanded += bytes.byteLength;
    if (expanded > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Selected files exceed the 200 MB safety limit.');
    }
    const path = safeArchivePath(entry.path);
    const savedUri = await saveBytes(`Extracted/${outputFolder}/${path}`, bytes);
    extracted.push({
      id: makeId(),
      name: path,
      uri: savedUri,
      size: bytes.byteLength,
      kind: 'file',
      addedAt: Date.now(),
    });
  }
  if (extracted.length === 0) throw new Error('No selected files were found in this archive.');
  return extracted;
}

export function archiveStatusText(format: ArchiveFormat) {
  if (format === 'gzip') return 'GZIP stores one compressed file; use TAR.GZ to combine files.';
  if (format === '7z') return '7z uses a local engine. No files leave this device.';
  if (format === 'tar') return 'TAR bundles files without compression.';
  if (format === 'tar.gz') return 'TAR.GZ bundles and compresses multiple files.';
  return `ZIP uses DEFLATE compression · ${formatBytes(MAX_ARCHIVE_BYTES)} file limit.`;
}
