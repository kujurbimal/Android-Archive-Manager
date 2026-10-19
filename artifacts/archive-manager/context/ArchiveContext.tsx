import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import {
  ArchiveItem,
  cleanFileName,
  removeStoredFile,
} from '@/lib/archive';
import {
  ArchiveFormat,
  createArchiveInFormat,
  extractArchiveInFormat,
} from '@/lib/archive-formats';

const STORAGE_KEY = 'archive-manager.library.v1';
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const ARCHIVE_EXTENSION = /\.(zip|7z|rar5?|tar|tgz|bz2|gz|xz|lz4|zst|iso|cab|arj|lzh|lha|deb|rpm|dmg|img|cpio|wim|ecm|apk|mtz)(\.\d+)?$/i;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

type ArchiveContextValue = {
  items: ArchiveItem[];
  ready: boolean;
  importFiles: () => Promise<number>;
  createArchive: (
    name: string,
    selectedIds: string[],
    level: number,
    format: ArchiveFormat,
  ) => Promise<ArchiveItem>;
  extractSelected: (archive: ArchiveItem, paths: string[]) => Promise<number>;
  deleteItem: (item: ArchiveItem) => Promise<void>;
};

const ArchiveContext = createContext<ArchiveContextValue | null>(null);

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readPickedFile(uri: string, webFile?: globalThis.File) {
  if (Platform.OS === 'web' && webFile) {
    return new Uint8Array(await webFile.arrayBuffer());
  }
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the selected file.');
    return new Uint8Array(await response.arrayBuffer());
  }
  return new File(uri).bytes();
}

export function ArchiveProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!active || !stored) return;
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const validItems = parsed.filter(
              (item): item is ArchiveItem =>
                typeof item?.id === 'string' &&
                typeof item?.name === 'string' &&
                typeof item?.uri === 'string' &&
                typeof item?.size === 'number' &&
                (item?.kind === 'archive' || item?.kind === 'file'),
            );
          setItems(
            Platform.OS === 'web'
              ? validItems.filter((item) => !item.uri.startsWith('blob:'))
              : validItems,
          );
        }
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: ArchiveItem[]) => {
    setItems(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const importFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: true,
      base64: false,
    });
    if (result.canceled) return 0;

    const declaredTotal = result.assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0);
    if (declaredTotal > MAX_IMPORT_BYTES) {
      throw new Error('Choose files totaling 64 MB or less for this preview build.');
    }

    const imported: ArchiveItem[] = [];
    let actualTotal = 0;
    try {
      for (const asset of result.assets) {
        const bytes = await readPickedFile(asset.uri, asset.file);
        actualTotal += bytes.byteLength;
        if (actualTotal > MAX_IMPORT_BYTES) {
          throw new Error('Choose files totaling 64 MB or less for this preview build.');
        }

        let uri: string;
        if (Platform.OS === 'web') {
          uri = URL.createObjectURL(new Blob([toArrayBuffer(bytes)]));
        } else {
          const directory = new Directory(Paths.document, 'ArchiveManager');
          directory.create({ intermediates: true, idempotent: true });
          const file = new File(directory, `${makeId()}-${cleanFileName(asset.name)}`);
          file.write(bytes);
          uri = file.uri;
        }

        imported.push({
          id: makeId(),
          name: asset.name,
          uri,
          size: bytes.byteLength,
          kind: ARCHIVE_EXTENSION.test(asset.name) ? 'archive' : 'file',
          addedAt: Date.now(),
        });
      }
    } catch (error) {
      await Promise.all(imported.map((item) => removeStoredFile(item)));
      throw error;
    }
    if (imported.length) await persist([...imported, ...items]);
    return imported.length;
  };

  const createArchive = async (
    name: string,
    selectedIds: string[],
    level: number,
    format: ArchiveFormat,
  ) => {
    const selected = items.filter((item) => selectedIds.includes(item.id));
    const created = await createArchiveInFormat(
      name,
      selected.map((item) => ({ name: item.name, uri: item.uri })),
      level,
      format,
    );
    await persist([created, ...items]);
    return created;
  };

  const extractSelected = async (archive: ArchiveItem, paths: string[]) => {
    const extracted = await extractArchiveInFormat(archive.uri, archive.name, paths);
    await persist([...extracted, ...items]);
    return extracted.length;
  };

  const deleteItem = async (item: ArchiveItem) => {
    await removeStoredFile(item);
    await persist(items.filter((stored) => stored.id !== item.id));
  };

  const value = useMemo(
    () => ({ items, ready, importFiles, createArchive, extractSelected, deleteItem }),
    [items, ready],
  );

  return <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>;
}

export function useArchive() {
  const value = useContext(ArchiveContext);
  if (!value) throw new Error('useArchive must be used within ArchiveProvider.');
  return value;
}
