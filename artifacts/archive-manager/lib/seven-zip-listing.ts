export type SevenZipEntry = {
  path: string;
  size: number;
  isDirectory: boolean;
};

export type SevenZipListing = {
  entries: SevenZipEntry[];
  expandedBytes: number;
};

export function parseSevenZipListing(
  output: string[],
  safePath: (path: string) => string,
  maxEntries: number,
  maxExpandedBytes: number,
): SevenZipListing {
  const separator = output.findIndex((line) => line.trim() === '----------');
  if (separator < 0) {
    throw new Error('7z could not read the archive directory. It may be damaged or unsupported.');
  }

  const entries: SevenZipEntry[] = [];
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

    const path = safePath(fields.Path);
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
      if (expandedBytes > maxExpandedBytes) {
        throw new Error('This archive expands beyond the 200 MB safety limit.');
      }
    }
    entries.push({ path, size, isDirectory });
    if (entries.length > maxEntries) {
      throw new Error(`This archive has more than ${maxEntries} entries.`);
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
  if (entries.length > maxEntries) {
    throw new Error(`This archive has more than ${maxEntries} entries.`);
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return { entries, expandedBytes };
}
