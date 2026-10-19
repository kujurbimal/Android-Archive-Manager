import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useArchive } from '@/context/ArchiveContext';
import {
  ArchiveItem,
  exportFile,
  formatBytes,
  readTextFile,
  ZipEntry,
} from '@/lib/archive';
import {
  ARCHIVE_FORMAT_OPTIONS,
  ArchiveFormat,
  archiveFormatFromName,
  archiveStatusText,
  inspectArchiveInFormat,
  testArchiveInFormat,
} from '@/lib/archive-formats';

type MainTab = 'files' | 'create' | 'modules';
type LibraryFilter = 'all' | 'archives' | 'files';

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'xml', 'lua', 'html', 'css', 'js', 'ts', 'csv', 'log']);

export default function ArchiveWorkspace() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { items, ready, importFiles, createArchive, extractSelected, deleteItem } = useArchive();
  const [tab, setTab] = useState<MainTab>('files');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [archiveName, setArchiveName] = useState('');
  const [archiveFormat, setArchiveFormat] = useState<ArchiveFormat>('zip');
  const [compression, setCompression] = useState(6);
  const [busy, setBusy] = useState(false);
  const [openedArchive, setOpenedArchive] = useState<ArchiveItem | null>(null);
  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [notice, setNotice] = useState('');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const filteredItems = items
    .filter((item) => {
      if (filter === 'archives' && item.kind !== 'archive') return false;
      if (filter === 'files' && item.kind !== 'file') return false;
      return item.name.toLowerCase().includes(search.trim().toLowerCase());
    })
    .sort((a, b) => b.addedAt - a.addedAt);

  const selectedSize = items
    .filter((item) => selectedIds.includes(item.id))
    .reduce((sum, item) => sum + item.size, 0);

  const tell = (message: string) => setNotice(message);

  const touch = () => {
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const handleImport = async () => {
    try {
      setBusy(true);
      const count = await importFiles();
      if (count > 0) tell(`${count} ${count === 1 ? 'file added' : 'files added'} to your library.`);
    } catch (error) {
      tell(error instanceof Error ? error.message : 'Could not add these files.');
    } finally {
      setBusy(false);
    }
  };

  const openItem = async (item: ArchiveItem) => {
    touch();
    if (item.kind === 'archive') {
      setBusy(true);
      try {
        if (!archiveFormatFromName(item.name)) {
          tell('Open ZIP, 7z, TAR, TAR.GZ, or GZIP archives.');
          return;
        }
        const archiveEntries = await inspectArchiveInFormat(item.uri, item.name);
        setOpenedArchive(item);
        setEntries(archiveEntries);
        setSelectedPaths(archiveEntries.filter((entry) => !entry.isDirectory).map((entry) => entry.path));
      } catch (error) {
        tell(error instanceof Error ? error.message : 'Could not open this archive.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const extension = item.name.split('.').pop()?.toLowerCase() ?? '';
    if (!TEXT_EXTENSIONS.has(extension)) {
      tell('Preview is available for text, JSON, XML, Lua, HTML, CSS, JS, CSV, and log files.');
      return;
    }
    if (item.size > 1024 * 1024) {
      tell('Text preview is limited to files under 1 MB.');
      return;
    }
    try {
      setBusy(true);
      setPreview({ title: item.name, content: await readTextFile(item.uri) });
    } catch (error) {
      tell(error instanceof Error ? error.message : 'Could not preview this file.');
    } finally {
      setBusy(false);
    }
  };

  const checkArchive = async () => {
    if (!openedArchive) return;
    try {
      setBusy(true);
      const result = await testArchiveInFormat(openedArchive.uri, openedArchive.name);
      tell(`Archive check passed · ${result.fileCount} files · ${formatBytes(result.expandedBytes)} unpacked`);
    } catch (error) {
      tell(error instanceof Error ? error.message : 'Archive integrity check failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async () => {
    if (!openedArchive) return;
    try {
      setBusy(true);
      const count = await extractSelected(openedArchive, selectedPaths);
      setOpenedArchive(null);
      tell(`${count} ${count === 1 ? 'file extracted' : 'files extracted'} to your library.`);
    } catch (error) {
      tell(error instanceof Error ? error.message : 'Could not extract these files.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateArchive = async () => {
    if (selectedIds.length === 0) {
      tell('Select at least one file to continue.');
      return;
    }
    try {
      setBusy(true);
      const created = await createArchive(
        archiveName.trim() || 'My archive',
        selectedIds,
        compression,
        archiveFormat,
      );
      setSelectedIds([]);
      setArchiveName('');
      setTab('files');
      tell(`${created.name} created · ${formatBytes(created.size)}`);
    } catch (error) {
      tell(error instanceof Error ? error.message : 'Could not create the ZIP archive.');
    } finally {
      setBusy(false);
    }
  };

  const shareItem = async (item: ArchiveItem) => {
    try {
      if (Platform.OS === 'web') {
        await exportFile(item);
        tell('Download started.');
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(item.uri, {
          dialogTitle: `Export ${item.name}`,
          mimeType: item.kind === 'archive' ? archiveMimeType(item.name) : undefined,
        });
      } else {
        tell('Sharing is not available on this device.');
      }
    } catch (error) {
      tell(error instanceof Error ? error.message : 'Could not export this file.');
    }
  };

  const confirmDelete = (item: ArchiveItem) => {
    const performDelete = async () => {
      try {
        await deleteItem(item);
        tell(`${item.name} removed from the library.`);
      } catch (error) {
        tell(error instanceof Error ? error.message : 'Could not remove this file.');
      }
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Remove ${item.name} from this device?`)) void performDelete();
      return;
    }
    Alert.alert('Remove file?', `${item.name} will be deleted from this app's storage.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void performDelete() },
    ]);
  };

  const toggleSelected = (id: string) => {
    touch();
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const togglePath = (entry: ZipEntry) => {
    touch();
    if (entry.isDirectory) {
      const descendants = entries
        .filter((candidate) => !candidate.isDirectory && candidate.path.startsWith(`${entry.path}/`))
        .map((candidate) => candidate.path);
      const allSelected = descendants.length > 0 && descendants.every((path) => selectedPaths.includes(path));
      setSelectedPaths((current) =>
        allSelected
          ? current.filter((path) => !descendants.includes(path))
          : Array.from(new Set([...current, ...descendants])),
      );
      return;
    }
    setSelectedPaths((current) =>
      current.includes(entry.path)
        ? current.filter((path) => path !== entry.path)
        : [...current, entry.path],
    );
  };

  const closeArchive = () => {
    setOpenedArchive(null);
    setEntries([]);
    setSelectedPaths([]);
  };

  return (
    <View style={[styles.app, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      <View
        style={[
          styles.topInset,
          { paddingTop: Platform.OS === 'web' ? 67 : insets.top + 8 },
        ]}
      />
      <View style={styles.content}>
        {tab === 'files' && (
          <LibraryPanel
            items={filteredItems}
            allCount={items.length}
            archiveCount={items.filter((item) => item.kind === 'archive').length}
            filter={filter}
            search={search}
            setFilter={setFilter}
            setSearch={setSearch}
            ready={ready}
            busy={busy}
            onImport={handleImport}
            onOpen={openItem}
            onShare={shareItem}
            onDelete={confirmDelete}
            onCreate={() => setTab('create')}
            styles={styles}
            colors={colors}
          />
        )}
        {tab === 'create' && (
          <CreatePanel
            items={items}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            archiveName={archiveName}
            setArchiveName={setArchiveName}
            format={archiveFormat}
            setFormat={setArchiveFormat}
            compression={compression}
            setCompression={setCompression}
            selectedSize={selectedSize}
            busy={busy}
            onImport={handleImport}
            onCreate={handleCreateArchive}
            styles={styles}
            colors={colors}
          />
        )}
        {tab === 'modules' && <ModulesPanel styles={styles} colors={colors} />}
      </View>

      {notice.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setNotice('')}
          style={[styles.notice, { backgroundColor: colors.foreground }]}
        >
          <Text style={[styles.noticeText, { color: colors.background }]}>{notice}</Text>
          <Feather name="x" size={17} color={colors.background} />
        </Pressable>
      )}

      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      )}

      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 10),
          },
        ]}
      >
        <TabButton
          label="Library"
          icon="folder"
          active={tab === 'files'}
          onPress={() => setTab('files')}
          colors={colors}
          styles={styles}
        />
        <TabButton
          label="Create"
          icon="archive"
          active={tab === 'create'}
          onPress={() => setTab('create')}
          colors={colors}
          styles={styles}
        />
        <TabButton
          label="Modules"
          icon="grid"
          active={tab === 'modules'}
          onPress={() => setTab('modules')}
          colors={colors}
          styles={styles}
        />
      </View>

      <Modal
        visible={!!openedArchive}
        animationType="slide"
        transparent
        onRequestClose={closeArchive}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleBlock}>
                <Text numberOfLines={1} style={[styles.sheetTitle, { color: colors.foreground }]}>
                  {openedArchive?.name}
                </Text>
                <Text style={[styles.caption, { color: colors.mutedForeground }]}>
                  {entries.filter((entry) => !entry.isDirectory).length} files · select what to extract
                </Text>
              </View>
              <IconButton
                icon="x"
                accessibilityLabel="Close archive"
                onPress={closeArchive}
                colors={colors}
                styles={styles}
              />
            </View>
            <View style={styles.sheetActions}>
              <Pressable
                accessibilityRole="button"
                testID="test-archive-button"
                onPress={() => void checkArchive()}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Feather name="shield" size={16} color={colors.primary} />
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Test archive</Text>
              </Pressable>
              {openedArchive && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void shareItem(openedArchive)}
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                >
                  <Feather name="share" size={16} color={colors.primary} />
                  <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Export</Text>
                </Pressable>
              )}
            </View>
            <FlatList
              data={entries}
              keyExtractor={(entry) => entry.path}
              style={styles.entryList}
              contentContainerStyle={entries.length === 0 ? styles.emptyList : undefined}
              renderItem={({ item }) => {
                const selected = item.isDirectory
                  ? entries
                      .filter((candidate) => !candidate.isDirectory && candidate.path.startsWith(`${item.path}/`))
                      .every((candidate) => selectedPaths.includes(candidate.path))
                  : selectedPaths.includes(item.path);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    onPress={() => togglePath(item)}
                    style={[styles.entryRow, { borderBottomColor: colors.border }]}
                  >
                    <Feather
                      name={item.isDirectory ? 'folder' : fileIcon(item.path)}
                      size={18}
                      color={item.isDirectory ? colors.primary : colors.mutedForeground}
                    />
                    <Text numberOfLines={1} style={[styles.entryName, { color: colors.foreground }]}>
                      {item.path}
                    </Text>
                    {!item.isDirectory && (
                      <Text style={[styles.entrySize, { color: colors.mutedForeground }]}>
                        {formatBytes(item.size)}
                      </Text>
                    )}
                    <Feather
                      name={selected ? 'check-circle' : 'circle'}
                      size={19}
                      color={selected ? colors.primary : colors.border}
                    />
                  </Pressable>
                );
              }}
            />
            <View style={[styles.extractFooter, { borderTopColor: colors.border }]}>
              <Text style={[styles.caption, { color: colors.mutedForeground }]}>
                {selectedPaths.length} selected
              </Text>
              <Pressable
                accessibilityRole="button"
                testID="extract-selected-button"
                onPress={() => void handleExtract()}
                disabled={selectedPaths.length === 0 || busy}
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  (selectedPaths.length === 0 || busy) && styles.disabled,
                ]}
              >
                <Feather name="download" size={17} color={colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                  Extract selected
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!preview} animationType="slide" onRequestClose={() => setPreview(null)}>
        <View style={[styles.previewPage, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 67 : insets.top + 16 }]}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleBlock}>
              <Text style={[styles.kicker, { color: colors.primary }]}>FILE PREVIEW</Text>
              <Text numberOfLines={1} style={[styles.sheetTitle, { color: colors.foreground }]}>
                {preview?.title}
              </Text>
            </View>
            <IconButton
              icon="x"
              accessibilityLabel="Close preview"
              onPress={() => setPreview(null)}
              colors={colors}
              styles={styles}
            />
          </View>
          <ScrollView style={styles.previewScroll}>
            <Text selectable style={[styles.previewText, { color: colors.foreground }]}>
              {preview?.content}
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function LibraryPanel(props: {
  items: ArchiveItem[];
  allCount: number;
  archiveCount: number;
  filter: LibraryFilter;
  search: string;
  setFilter: (filter: LibraryFilter) => void;
  setSearch: (search: string) => void;
  ready: boolean;
  busy: boolean;
  onImport: () => void;
  onOpen: (item: ArchiveItem) => void;
  onShare: (item: ArchiveItem) => void;
  onDelete: (item: ArchiveItem) => void;
  onCreate: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const {
    items, allCount, archiveCount, filter, search, setFilter, setSearch,
    ready, busy, onImport, onOpen, onShare, onDelete, onCreate, styles, colors,
  } = props;
  const filters: { value: LibraryFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: allCount },
    { value: 'archives', label: 'Archives', count: archiveCount },
    { value: 'files', label: 'Files', count: allCount - archiveCount },
  ];

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.pageContent}
    >
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Feather name="archive" size={17} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.brand, { color: colors.foreground }]}>ARC / ROOM</Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.localBadge, { backgroundColor: colors.accent }]}>
          <View style={[styles.localDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.localBadgeText, { color: colors.accentForeground }]}>ON DEVICE</Text>
        </View>
      </View>
      <Text style={[styles.headline, { color: colors.foreground }]}>Files, in order.</Text>
      <Text style={[styles.subhead, { color: colors.mutedForeground }]}>
        Your archive workspace. Everything stays on this device.
      </Text>

      <View style={styles.quickActions}>
        <Pressable
          accessibilityRole="button"
          testID="create-zip-shortcut"
          onPress={onCreate}
          style={[styles.quickAction, { backgroundColor: colors.primary }]}
        >
          <View style={styles.quickIcon}>
            <Feather name="plus" size={18} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.quickTitle, { color: colors.primaryForeground }]}>Create ZIP</Text>
          <Text style={[styles.quickHint, { color: colors.primaryForeground }]}>Bundle selected files</Text>
          <Feather name="arrow-up-right" size={17} color={colors.primaryForeground} style={styles.quickArrow} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="import-files-button"
          disabled={busy}
          onPress={onImport}
          style={[styles.quickAction, styles.quickActionSecondary, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.quickIcon, { backgroundColor: colors.accent }]}>
            <Feather name="folder-plus" size={18} color={colors.primary} />
          </View>
          <Text style={[styles.quickTitle, { color: colors.foreground }]}>Add files</Text>
          <Text style={[styles.quickHint, { color: colors.mutedForeground }]}>Import from your device</Text>
          <Feather name="arrow-up-right" size={17} color={colors.mutedForeground} style={styles.quickArrow} />
        </Pressable>
      </View>

      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your library</Text>
        <Text style={[styles.caption, { color: colors.mutedForeground }]}>{allCount} items</Text>
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={17} color={colors.mutedForeground} />
        <TextInput
          accessibilityLabel="Search library"
          value={search}
          onChangeText={setSearch}
          placeholder="Search files and archives"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable accessibilityLabel="Clear search" onPress={() => setSearch('')}>
            <Feather name="x-circle" size={17} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      <View style={styles.filterRow}>
        {filters.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === option.value }}
            onPress={() => setFilter(option.value)}
            style={[
              styles.filterChip,
              { borderColor: colors.border },
              filter === option.value && { backgroundColor: colors.foreground, borderColor: colors.foreground },
            ]}
          >
            <Text style={[styles.filterText, { color: filter === option.value ? colors.background : colors.mutedForeground }]}>
              {option.label}
            </Text>
            <Text style={[styles.filterCount, { color: filter === option.value ? colors.background : colors.mutedForeground }]}>
              {option.count}
            </Text>
          </Pressable>
        ))}
      </View>

      {!ready ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>Opening your library…</Text>
        </View>
      ) : items.length === 0 && allCount === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
            <Feather name="archive" size={24} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>A clear start.</Text>
          <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>
            Add files from your device to build your local library, or create your first ZIP.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onImport}
            style={[styles.primaryButton, { backgroundColor: colors.primary }, busy && styles.disabled]}
          >
            <Feather name="folder-plus" size={17} color={colors.primaryForeground} />
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Choose files</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? null : (
        <View style={styles.fileList}>
          {items.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              onOpen={() => onOpen(item)}
              onShare={() => onShare(item)}
              onDelete={() => onDelete(item)}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>
      )}
      {ready && allCount > 0 && items.length === 0 && (
        <View style={[styles.noMatches, { borderColor: colors.border }]}>
          <Feather name="search" size={19} color={colors.mutedForeground} />
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
          No {filter === 'archives' ? 'archives' : 'files'} match this view.
          </Text>
        </View>
      )}
      <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
        Local-first by design · No sign-in · No uploads
      </Text>
    </ScrollView>
  );
}

function FileRow(props: {
  item: ArchiveItem;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const { item, onOpen, onShare, onDelete, styles, colors } = props;
  return (
    <View style={[styles.fileRow, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name}`}
        onPress={onOpen}
        style={styles.fileMain}
      >
        <View style={[styles.fileIcon, { backgroundColor: item.kind === 'archive' ? colors.accent : colors.secondary }]}>
          <Feather
            name={item.kind === 'archive' ? 'archive' : fileIcon(item.name)}
            size={18}
            color={item.kind === 'archive' ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={styles.fileText}>
          <Text numberOfLines={1} style={[styles.fileName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.fileMeta, { color: colors.mutedForeground }]}>
            {item.kind === 'archive' ? archiveTypeLabel(item.name) : 'File'} · {formatBytes(item.size)}
          </Text>
        </View>
      </Pressable>
      <IconButton icon="share" accessibilityLabel={`Export ${item.name}`} onPress={onShare} colors={colors} styles={styles} />
      <IconButton icon="trash-2" accessibilityLabel={`Remove ${item.name}`} onPress={onDelete} colors={colors} styles={styles} destructive />
    </View>
  );
}

function CreatePanel(props: {
  items: ArchiveItem[];
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  archiveName: string;
  setArchiveName: (name: string) => void;
  format: ArchiveFormat;
  setFormat: (format: ArchiveFormat) => void;
  compression: number;
  setCompression: (level: number) => void;
  selectedSize: number;
  busy: boolean;
  onImport: () => void;
  onCreate: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const {
    items, selectedIds, setSelectedIds, archiveName, setArchiveName, compression,
    format, setFormat, setCompression, selectedSize, busy, onImport, onCreate, styles, colors,
  } = props;
  const profiles = [
    { level: 1, label: 'Quick', detail: 'Fastest' },
    { level: 6, label: 'Balanced', detail: 'Recommended' },
    { level: 9, label: 'Maximum', detail: 'Smallest file' },
  ];

  const toggle = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.pageContent}
      >
        <Text style={[styles.kicker, { color: colors.primary }]}>ARCHIVE BUILDER</Text>
        <Text style={[styles.headline, { color: colors.foreground }]}>Pack it up.</Text>
        <Text style={[styles.subhead, { color: colors.mutedForeground }]}>
          Choose local files, select an archive format, and create it on this device.
        </Text>

        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Archive name</Text>
        <TextInput
          accessibilityLabel="Archive name"
          value={archiveName}
          onChangeText={setArchiveName}
          placeholder="My archive"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.nameInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          autoCapitalize="sentences"
          returnKeyType="done"
        />

        <View style={styles.formatHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Format</Text>
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>LOCAL</Text>
        </View>
        <View style={styles.formatRow}>
          {ARCHIVE_FORMAT_OPTIONS.map((option) => {
            const active = format === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                testID={`format-${option.id.replace('.', '-')}`}
                onPress={() => setFormat(option.id)}
                style={[
                  styles.formatOption,
                  {
                    backgroundColor: active ? colors.accent : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={[styles.formatName, { color: active ? colors.primary : colors.foreground }]}>
                  {option.label}
                </Text>
                <Text style={[styles.formatDetail, { color: colors.mutedForeground }]}>{option.detail}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.formatNote, { color: colors.mutedForeground }]}>
          {archiveStatusText(format)}
        </Text>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Compression</Text>
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
            {format === 'zip' ? 'ZIP / DEFLATE' : format === '7z' ? '7z / LZMA2' : format === 'tar' ? 'NONE' : 'GZIP'}
          </Text>
        </View>
        {format === 'tar' ? (
          <Text style={[styles.formatNote, { color: colors.mutedForeground }]}>TAR stores files without compressing them.</Text>
        ) : (
          <View style={styles.profileRow}>
            {profiles.map((profile) => {
              const active = compression === profile.level;
              return (
                <Pressable
                  key={profile.level}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => setCompression(profile.level)}
                  style={[
                    styles.profileCard,
                    { backgroundColor: active ? colors.accent : colors.card, borderColor: active ? colors.primary : colors.border },
                  ]}
                >
                  <Feather name={active ? 'check-circle' : 'circle'} size={17} color={active ? colors.primary : colors.mutedForeground} />
                  <Text style={[styles.profileName, { color: colors.foreground }]}>{profile.label}</Text>
                  <Text style={[styles.profileDetail, { color: colors.mutedForeground }]}>{profile.detail}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Files to include</Text>
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
            {selectedIds.length} selected · {formatBytes(selectedSize)}
          </Text>
        </View>

        {items.length === 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={onImport}
            style={[styles.addFirstFile, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="plus-circle" size={21} color={colors.primary} />
            <View style={styles.fileText}>
              <Text style={[styles.fileName, { color: colors.foreground }]}>Add files from device</Text>
              <Text style={[styles.fileMeta, { color: colors.mutedForeground }]}>They stay in this app's local library</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <View style={[styles.selectList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {items.map((item) => {
              const selected = selectedIds.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggle(item.id)}
                  style={[styles.selectRow, { borderBottomColor: colors.border }]}
                >
                  <View style={[styles.fileIconSmall, { backgroundColor: colors.secondary }]}>
                    <Feather name={item.kind === 'archive' ? 'archive' : fileIcon(item.name)} size={15} color={colors.mutedForeground} />
                  </View>
                  <View style={styles.fileText}>
                    <Text numberOfLines={1} style={[styles.fileName, { color: colors.foreground }]}>{item.name}</Text>
                    <Text style={[styles.fileMeta, { color: colors.mutedForeground }]}>{formatBytes(item.size)}</Text>
                  </View>
                  <Feather
                    name={selected ? 'check-circle' : 'circle'}
                    size={20}
                    color={selected ? colors.primary : colors.border}
                  />
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={[styles.securityNote, { backgroundColor: colors.accent }]}>
          <Feather name="lock" size={16} color={colors.primary} />
          <Text style={[styles.securityText, { color: colors.accentForeground }]}>
            All formats stay on-device · up to 64 MB input and 200 MB unpacked.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          testID="create-archive-button"
          disabled={selectedIds.length === 0 || busy || (format === 'gzip' && selectedIds.length !== 1)}
          onPress={onCreate}
          style={[
            styles.primaryButton,
            styles.createButton,
            { backgroundColor: colors.primary },
            (selectedIds.length === 0 || busy || (format === 'gzip' && selectedIds.length !== 1)) && styles.disabled,
          ]}
        >
          <Feather name="archive" size={17} color={colors.primaryForeground} />
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
            Create {format.toUpperCase()} archive
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ModulesPanel(props: {
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const { styles, colors } = props;
  const modules = [
    { icon: 'archive' as const, title: 'Archive formats', detail: 'Create and inspect ZIP, 7z, TAR, TAR.GZ, and GZIP files.', state: 'READY' },
    { icon: 'layers' as const, title: 'More archive formats', detail: 'RAR, bzip2, XZ, lz4, and zstd.', state: 'PLANNED' },
    { icon: 'key' as const, title: 'Encrypted & split archives', detail: 'Password protection and numbered multi-volume sets.', state: 'PLANNED' },
    { icon: 'edit-3' as const, title: 'Archive editing & engine', detail: 'Add or remove files in-place, fast small-file parsing, and multithreaded processing.', state: 'PLANNED' },
    { icon: 'mail' as const, title: 'Email & Android handoff', detail: 'Open mail attachments, install app backups, and place OBB game data.', state: 'PLANNED' },
    { icon: 'cloud' as const, title: 'Cloud connections', detail: 'Drive, OneDrive, Dropbox, Box, and remote pipelines.', state: 'PLANNED' },
    { icon: 'zap' as const, title: 'AI organization', detail: 'File classification, cleanup, and smart batch renaming.', state: 'PLANNED' },
    { icon: 'film' as const, title: 'Preview & conversion', detail: 'Code editing, media streaming, WebP / MP3 / PDF conversion.', state: 'PLANNED' },
    { icon: 'wifi' as const, title: 'Local network sharing', detail: 'Secure FTP, SMB, and Wi-Fi transfer between nearby devices.', state: 'PLANNED' },
    { icon: 'shield' as const, title: 'Biometric vault', detail: 'Hardware-backed private storage with fingerprint or face unlock.', state: 'PLANNED' },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageContent}>
      <Text style={[styles.kicker, { color: colors.primary }]}>CAPABILITIES</Text>
      <Text style={[styles.headline, { color: colors.foreground }]}>Built in layers.</Text>
      <Text style={[styles.subhead, { color: colors.mutedForeground }]}>
        ZIP, 7z, TAR, and gzip are active locally. Other systems shown here are planned—not active integrations.
      </Text>
      <View style={styles.moduleList}>
        {modules.map((module) => (
          <View key={module.title} style={[styles.moduleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.moduleIcon, { backgroundColor: module.state === 'READY' ? colors.accent : colors.secondary }]}>
              <Feather name={module.icon} size={18} color={module.state === 'READY' ? colors.primary : colors.mutedForeground} />
            </View>
            <View style={styles.moduleText}>
              <View style={styles.moduleTitleRow}>
                <Text style={[styles.moduleTitle, { color: colors.foreground }]}>{module.title}</Text>
                <Text style={[styles.moduleState, { color: module.state === 'READY' ? colors.primary : colors.mutedForeground }]}>
                  {module.state}
                </Text>
              </View>
              <Text style={[styles.moduleDetail, { color: colors.mutedForeground }]}>{module.detail}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={[styles.footerInfo, { borderTopColor: colors.border }]}>
        <Feather name="smartphone" size={16} color={colors.mutedForeground} />
        <Text style={[styles.footerInfoText, { color: colors.mutedForeground }]}>
          Core operations run locally. Cloud and Android system access require separate setup and permissions.
        </Text>
      </View>
    </ScrollView>
  );
}

function TabButton(props: {
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { label, icon, active, onPress, colors, styles } = props;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.tabButton}
    >
      <Feather name={icon} size={19} color={active ? colors.primary : colors.mutedForeground} />
      <Text style={[styles.tabLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

function IconButton(props: {
  icon: React.ComponentProps<typeof Feather>['name'];
  accessibilityLabel: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
  destructive?: boolean;
}) {
  const { icon, accessibilityLabel, onPress, colors, styles, destructive } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={styles.iconButton}
    >
      <Feather name={icon} size={17} color={destructive ? colors.destructive : colors.mutedForeground} />
    </Pressable>
  );
}

function fileIcon(name: string): React.ComponentProps<typeof Feather>['name'] {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(extension)) return 'image';
  if (extension && ['mp3', 'wav', 'mp4', 'mkv', 'mov'].includes(extension)) return 'film';
  if (extension && ['json', 'xml', 'lua', 'html', 'css', 'js', 'ts'].includes(extension)) return 'code';
  if (extension === 'pdf') return 'file-text';
  return 'file';
}

function archiveTypeLabel(name: string) {
  const format = archiveFormatFromName(name);
  return format ? `${format.toUpperCase()} archive` : 'Archive';
}

function archiveMimeType(name: string) {
  const format = archiveFormatFromName(name);
  if (format === '7z') return 'application/x-7z-compressed';
  if (format === 'tar') return 'application/x-tar';
  if (format === 'gzip' || format === 'tar.gz') return 'application/gzip';
  return 'application/zip';
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    app: { flex: 1 },
    topInset: { flexShrink: 0 },
    content: { flex: 1 },
    screen: { flex: 1 },
    pageContent: { paddingHorizontal: 22, paddingBottom: 124 },
    brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 25, gap: 9 },
    brandMark: {
      width: 28, height: 28, borderRadius: 9, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    brand: { fontSize: 12, letterSpacing: 1.7, fontFamily: 'Inter_700Bold' },
    localBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 },
    localDot: { width: 6, height: 6, borderRadius: 3 },
    localBadgeText: { fontSize: 9, letterSpacing: 1, fontFamily: 'Inter_700Bold' },
    headline: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 38, letterSpacing: -1.1 },
    subhead: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 6 },
    quickActions: { flexDirection: 'row', gap: 12, marginTop: 24, marginBottom: 29 },
    quickAction: { flex: 1, minHeight: 142, borderRadius: 19, padding: 15, position: 'relative', overflow: 'hidden' },
    quickActionSecondary: { borderWidth: 1 },
    quickIcon: { height: 31, width: 31, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    quickTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 4 },
    quickHint: { fontFamily: 'Inter_400Regular', fontSize: 10.5, lineHeight: 15, maxWidth: '88%' },
    quickArrow: { position: 'absolute', right: 13, top: 14 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
    sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17, letterSpacing: -0.3 },
    caption: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
    searchBox: { minHeight: 45, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 9 },
    searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, paddingVertical: 11, outlineStyle: 'none' as never },
    filterRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 10 },
    filterChip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
    filterText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
    filterCount: { fontFamily: 'Inter_400Regular', fontSize: 10 },
    emptyCard: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 25, borderWidth: 1, borderRadius: 18, marginTop: 9 },
    emptyIcon: { width: 50, height: 50, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
    emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
    emptyCopy: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 19, marginTop: 7, marginBottom: 17, maxWidth: 265 },
    primaryButton: { minHeight: 46, paddingHorizontal: 16, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    primaryButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
    disabled: { opacity: 0.45 },
    loadingBox: { minHeight: 130, justifyContent: 'center', alignItems: 'center', gap: 10 },
    fileList: { marginTop: 2 },
    fileRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
    fileMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
    fileIcon: { width: 39, height: 39, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
    fileIconSmall: { width: 31, height: 31, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    fileText: { flex: 1, minWidth: 0 },
    fileName: { fontFamily: 'Inter_500Medium', fontSize: 12.5, marginBottom: 4 },
    fileMeta: { fontFamily: 'Inter_400Regular', fontSize: 10.5 },
    iconButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
    noMatches: { minHeight: 110, borderWidth: 1, borderStyle: 'dashed', borderRadius: 15, alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10 },
    privacyNote: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center', marginTop: 20 },
    kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.7, marginBottom: 10 },
    fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 23, marginBottom: 8 },
    nameInput: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, fontFamily: 'Inter_400Regular', fontSize: 13, outlineStyle: 'none' as never },
    formatHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 9 },
    formatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
    formatOption: { flexGrow: 1, flexBasis: '17%', minWidth: 58, minHeight: 55, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 3 },
    formatName: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
    formatDetail: { fontFamily: 'Inter_400Regular', fontSize: 8.5, marginTop: 2 },
    formatNote: { fontFamily: 'Inter_400Regular', fontSize: 10.5, lineHeight: 16, marginBottom: 14 },
    profileRow: { flexDirection: 'row', gap: 9, marginBottom: 23 },
    profileCard: { flex: 1, minHeight: 85, borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 10, justifyContent: 'space-between' },
    profileName: { fontFamily: 'Inter_600SemiBold', fontSize: 11.5, marginTop: 5 },
    profileDetail: { fontFamily: 'Inter_400Regular', fontSize: 9.5 },
    addFirstFile: { minHeight: 66, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13 },
    selectList: { borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, overflow: 'hidden' },
    selectRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
    securityNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, marginTop: 18, marginBottom: 14 },
    securityText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 10.5, lineHeight: 16 },
    createButton: { marginBottom: 9 },
    moduleList: { gap: 9, marginTop: 24 },
    moduleRow: { minHeight: 78, borderWidth: 1, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
    moduleIcon: { height: 38, width: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    moduleText: { flex: 1 },
    moduleTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
    moduleTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, flexShrink: 1 },
    moduleState: { fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 1 },
    moduleDetail: { fontFamily: 'Inter_400Regular', fontSize: 10.5, lineHeight: 15 },
    footerInfo: { flexDirection: 'row', gap: 9, borderTopWidth: 1, paddingTop: 17, marginTop: 22 },
    footerInfoText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15 },
    tabBar: { minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 8 },
    tabButton: { width: '32%', minHeight: 43, alignItems: 'center', justifyContent: 'center', gap: 4 },
    tabLabel: { fontFamily: 'Inter_500Medium', fontSize: 9.5 },
    notice: { position: 'absolute', left: 18, right: 18, bottom: 88, minHeight: 48, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, elevation: 8, zIndex: 5 },
    noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11.5, lineHeight: 17 },
    busyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12, 25, 22, 0.38)' },
    sheet: { maxHeight: '90%', minHeight: '68%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
    sheetHandle: { width: 39, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    sheetTitleBlock: { flex: 1, minWidth: 0 },
    sheetTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
    sheetActions: { flexDirection: 'row', gap: 9, marginTop: 16, marginBottom: 11 },
    secondaryButton: { minHeight: 38, borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
    secondaryButtonText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
    entryList: { flexGrow: 1 },
    emptyList: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
    entryRow: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
    entryName: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11.5 },
    entrySize: { fontFamily: 'Inter_400Regular', fontSize: 9, marginRight: 2 },
    extractFooter: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    previewPage: { flex: 1, paddingHorizontal: 20 },
    previewScroll: { flex: 1, marginTop: 20, marginBottom: 20 },
    previewText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 19 },
  });
}
