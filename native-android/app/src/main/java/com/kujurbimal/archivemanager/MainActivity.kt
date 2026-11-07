package com.kujurbimal.archivemanager

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

private const val PREFS_NAME = "archive_manager_library"
private const val PREFS_URIS = "selected_document_uris"
private val CREATE_FORMATS = listOf("ZIP", "TAR", "TAR.GZ", "GZIP", "7Z")
private val ARCHIVE_FORMATS = listOf("ZIP", "TAR", "TAR.GZ", "GZIP", "7Z")

data class LocalArchive(val uri: Uri, val name: String, val sizeLabel: String)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val savedUris = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getStringSet(PREFS_URIS, emptySet()).orEmpty()
            .mapNotNull { runCatching { Uri.parse(it) }.getOrNull() }
            .filter { uri -> runCatching { contentResolver.openFileDescriptor(uri, "r")?.use { true } ?: false }.getOrDefault(false) }
        setContent {
            ArchiveManagerApp(
                initialUris = savedUris,
                nameOf = ::queryName,
                sizeOf = ::querySize,
                rememberUri = ::retainAndSaveUri,
                removeUri = ::removeSavedUri,
                importToCache = ::copyUriToCache,
                createFromUris = ::createArchive,
                extractToTree = ::extractArchive,
                inspectArchive = ::inspectArchive,
                exportFormats = CREATE_FORMATS,
                archiveFormats = ARCHIVE_FORMATS
            )
        }
    }

    private fun retainAndSaveUri(uri: Uri) {
        runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val current = prefs.getStringSet(PREFS_URIS, emptySet()).orEmpty().toMutableSet()
        current.add(uri.toString())
        prefs.edit().putStringSet(PREFS_URIS, current).apply()
    }

    private fun removeSavedUri(uri: Uri) {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val current = prefs.getStringSet(PREFS_URIS, emptySet()).orEmpty().toMutableSet()
        current.remove(uri.toString())
        prefs.edit().putStringSet(PREFS_URIS, current).apply()
        runCatching { contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
    }

    private fun queryName(uri: Uri): String = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0)?.takeIf(String::isNotBlank) ?: "Selected file" else "Selected file"
        } ?: "Selected file"
    }.getOrDefault("Selected file")

    private fun querySize(uri: Uri): String = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use {
            if (it.moveToFirst() && !it.isNull(0)) {
                val bytes = it.getLong(0)
                if (bytes >= 1_048_576) "${bytes / 1_048_576} MB" else "${bytes / 1024} KB"
            } else "Size unavailable"
        } ?: "Size unavailable"
    }.getOrDefault("Size unavailable")

    private fun copyUriToCache(uri: Uri): File {
        val file = File.createTempFile("archive-input-", ".bin", cacheDir)
        contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use(input::copyTo) }
            ?: throw IllegalStateException("Cannot open selected file")
        return file
    }

    private fun detectFormat(name: String): String {
        val n = name.lowercase(Locale.ROOT)
        return when {
            n.endsWith(".tar.gz") || n.endsWith(".tgz") -> "tar.gz"
            n.endsWith(".zip") -> "zip"
            n.endsWith(".tar") -> "tar"
            n.endsWith(".7z") -> "7z"
            n.endsWith(".gz") -> "gzip"
            n.endsWith(".rar") -> "rar"
            else -> throw IllegalArgumentException("Choose a ZIP, TAR, TAR.GZ, GZIP or 7Z archive. RAR extraction is not enabled in this build.")
        }
    }

    private fun inspectArchive(uri: Uri): List<String> {
        val temp = copyUriToCache(uri)
        return try {
            val format = detectFormat(queryName(uri))
            ArchiveEngine.list(temp, format)
        } finally { temp.delete() }
    }

    private fun extractArchive(uri: Uri, destinationUri: Uri, onProgress: (String) -> Unit) {
        val input = copyUriToCache(uri)
        val staging = File(cacheDir, "extract-${System.currentTimeMillis()}").apply { mkdirs() }
        try {
            val format = detectFormat(queryName(uri))
            ArchiveEngine.extract(input, format, staging) { count -> onProgress("Extracted $count entries…") }
            val destination = DocumentFile.fromTreeUri(this, destinationUri)
                ?: throw IllegalStateException("Cannot access destination folder")
            copyDirectoryToDocuments(staging, destination)
        } finally {
            input.delete()
            staging.deleteRecursively()
        }
    }

    private fun copyDirectoryToDocuments(source: File, target: DocumentFile) {
        source.listFiles()?.forEach { child ->
            if (child.isDirectory) {
                val folder = target.findFile(child.name) ?: target.createDirectory(child.name)
                    ?: throw IllegalStateException("Cannot create folder ${child.name}")
                copyDirectoryToDocuments(child, folder)
            } else {
                val existing = target.findFile(child.name)
                if (existing != null && !existing.delete()) throw IllegalStateException("Cannot replace ${child.name}")
                val output = target.createFile("application/octet-stream", child.name)
                    ?: throw IllegalStateException("Cannot create ${child.name}")
                contentResolver.openOutputStream(output.uri, "w")?.use { out -> child.inputStream().use { it.copyTo(out) } }
                    ?: throw IllegalStateException("Cannot write ${child.name}")
            }
        }
    }

    private fun createArchive(uris: List<Uri>, format: String, outputUri: Uri) {
        val inputs = mutableListOf<File>()
        val namedFiles = mutableListOf<File>()
        val output = File.createTempFile("archive-output-", ".bin", cacheDir)
        try {
            uris.forEach { inputs.add(copyUriToCache(it)) }
            inputs.forEachIndexed { index, file ->
                val desired = queryName(uris[index]).replace(Regex("[/\\\\]"), "_")
                val named = File(file.parentFile, "${index}_$desired")
                if (file.renameTo(named)) namedFiles.add(named) else namedFiles.add(file)
            }
            ArchiveEngine.create(namedFiles, output, format.lowercase(Locale.ROOT))
            contentResolver.openOutputStream(outputUri, "w")?.use { target -> output.inputStream().use { it.copyTo(target) } }
                ?: throw IllegalStateException("Cannot write destination document")
        } finally {
            inputs.forEach { it.delete() }
            namedFiles.forEach { it.delete() }
            output.delete()
        }
    }
}

@Composable
private fun ArchiveManagerApp(
    initialUris: List<Uri>,
    nameOf: (Uri) -> String,
    sizeOf: (Uri) -> String,
    rememberUri: (Uri) -> Unit,
    removeUri: (Uri) -> Unit,
    importToCache: (Uri) -> File,
    createFromUris: (List<Uri>, String, Uri) -> Unit,
    extractToTree: (Uri, Uri, (String) -> Unit) -> Unit,
    inspectArchive: (Uri) -> List<String>,
    exportFormats: List<String>,
    archiveFormats: List<String>
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val activity = context as ComponentActivity
    val archives = remember {
        mutableStateListOf<LocalArchive>().apply {
            initialUris.forEach { add(LocalArchive(it, nameOf(it), sizeOf(it))) }
        }
    }
    val selected = remember { mutableStateListOf<Uri>() }
    val details = remember { mutableStateListOf<String>() }
    var search by remember { mutableStateOf("") }
    var sortByName by remember { mutableStateOf(true) }
    var dark by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Choose files or an archive to get started.") }
    var createFormat by remember { mutableStateOf("ZIP") }
    var activeArchive by remember { mutableStateOf<Uri?>(null) }
    val scope = rememberCoroutineScope()

    val importPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberUri(uri)
            if (archives.none { it.uri == uri }) archives.add(LocalArchive(uri, nameOf(uri), sizeOf(uri)))
        }
        status = "Imported ${uris.size} file(s)."
    }
    val createPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        selected.clear()
        selected.addAll(uris)
        status = "Selected ${uris.size} source file(s). Choose an output format and destination."
    }
    val outputPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null && selected.isNotEmpty()) {
            busy = true
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching { createFromUris(selected.toList(), createFormat, uri) }
                }
                status = result.fold({ "Created $createFormat archive successfully." }, { "Creation failed: ${it.message ?: "unknown error"}" })
                busy = false
            }
        }
    }
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        val archive = activeArchive
        if (tree != null && archive != null) {
            busy = true
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching { extractToTree(archive, tree) { progress -> status = progress } }
                }
                status = result.fold({ "Extraction completed. Existing files with matching names may have been replaced." }, { "Extraction failed: ${it.message ?: "unknown error"}" })
                busy = false
            }
        }
    }

    MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Archive Manager+", style = MaterialTheme.typography.headlineSmall)
                    Button(onClick = { dark = !dark }) { Text(if (dark) "Light" else "Dark") }
                }
                Text("Local archive tools", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !busy, onClick = { importPicker.launch(arrayOf("*/*")) }) { Text("Import") }
                    Button(enabled = !busy, onClick = { createPicker.launch(arrayOf("*/*")) }) { Text("Create archive") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = selected.isNotEmpty() && !busy, onClick = { outputPicker.launch("archive.${createFormat.lowercase()}" ) }) { Text("Save ${createFormat}") }
                    Button(onClick = { createFormat = exportFormats[(exportFormats.indexOf(createFormat) + 1) % exportFormats.size] }) { Text("Format: $createFormat") }
                    Button(onClick = { sortByName = !sortByName }) { Text(if (sortByName) "Sort: A–Z" else "Sort: newest") }
                }
                OutlinedTextField(value = search, onValueChange = { search = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Search library") }, singleLine = true)
                Text("Library (${archives.size})", style = MaterialTheme.typography.titleMedium)
                val visible = archives.filter { it.name.contains(search, ignoreCase = true) }
                    .let { if (sortByName) it.sortedBy { item -> item.name.lowercase() } else it.reversed() }
                LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(visible, key = { it.uri.toString() }) { item ->
                        Card {
                            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(item.name, style = MaterialTheme.typography.titleMedium)
                                Text(item.sizeLabel, style = MaterialTheme.typography.bodySmall)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Button(enabled = !busy, onClick = {
                                        busy = true
                                        scope.launch {
                                            val result = withContext(Dispatchers.IO) { runCatching { inspectArchive(item.uri) } }
                                            details.clear()
                                            details.addAll(result.getOrElse { listOf("Inspection failed: ${it.message}") })
                                            status = "Inspection finished."
                                            busy = false
                                        }
                                    }) { Text("Inspect") }
                                    Button(enabled = !busy, onClick = {
                                        activeArchive = item.uri
                                        folderPicker.launch(null)
                                    }) { Text("Extract") }
                                    Button(enabled = !busy, onClick = {
                                        archives.remove(item)
                                        removeUri(item.uri)
                                        status = "Removed from library. Original file is unchanged."
                                    }) { Text("Remove") }
                                }
                            }
                        }
                    }
                }
                if (details.isNotEmpty()) {
                    Text("Archive contents", style = MaterialTheme.typography.titleMedium)
                    LazyColumn(Modifier.weight(0.6f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        items(details) { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                }
                if (busy) CircularProgressIndicator()
                Text(status, style = MaterialTheme.typography.bodySmall)
                Text("Create: ZIP, TAR, TAR.GZ, GZIP, 7Z · Extract: ZIP, TAR, TAR.GZ, GZIP, 7Z, RAR", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
