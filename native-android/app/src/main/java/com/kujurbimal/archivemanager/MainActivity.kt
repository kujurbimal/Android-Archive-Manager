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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipException
import java.util.zip.ZipFile

private const val PREFS_NAME = "archive_manager_library"
private const val PREFS_URIS = "selected_document_uris"
private const val MAX_ZIP_BYTES = 256L * 1024L * 1024L
private const val MAX_DISPLAY_ENTRIES = 500

data class LocalArchive(val uri: Uri, val name: String, val sizeLabel: String)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val savedUris = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getStringSet(PREFS_URIS, emptySet())
            .orEmpty()
            .mapNotNull { raw -> runCatching { Uri.parse(raw) }.getOrNull() }
            .filter { uri ->
                runCatching {
                    contentResolver.openFileDescriptor(uri, "r")?.use { true } ?: false
                }.getOrDefault(false)
            }
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    ArchiveHome(
                        initialUris = savedUris,
                        getDisplayName = ::queryName,
                        getDisplaySize = ::querySize,
                        onPicked = ::retainAndSaveUri,
                        onRemoved = ::removeSavedUri,
                        inspectZip = ::inspectZip
                    )
                }
            }
        }
    }

    private fun retainAndSaveUri(uri: Uri) {
        runCatching {
            contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        }
        val current = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getStringSet(PREFS_URIS, emptySet()).orEmpty().toMutableSet()
        current.add(uri.toString())
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putStringSet(PREFS_URIS, current).apply()
    }

    private fun removeSavedUri(uri: Uri) {
        val current = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getStringSet(PREFS_URIS, emptySet()).orEmpty().toMutableSet()
        current.remove(uri.toString())
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putStringSet(PREFS_URIS, current).apply()
        runCatching {
            contentResolver.releasePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        }
    }

    private fun queryName(uri: Uri): String = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0)?.takeIf { it.isNotBlank() } ?: "Selected file"
            else "Selected file"
        } ?: "Selected file"
    }.getOrDefault("Selected file")

    private fun querySize(uri: Uri): String = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) {
                val bytes = cursor.getLong(0)
                if (bytes >= 1_048_576) "${bytes / 1_048_576} MB" else "${bytes / 1024} KB"
            } else "Size unavailable"
        } ?: "Size unavailable"
    }.getOrDefault("Size unavailable")

    private fun inspectZip(uri: Uri): List<String> {
        val temp = File.createTempFile("archive-inspect-", ".zip", cacheDir)
        try {
            val input = contentResolver.openInputStream(uri)
                ?: return listOf("Could not open the selected document.")
            input.use { source ->
                temp.outputStream().buffered().use { destination ->
                    val buffer = ByteArray(8 * 1024)
                    var total = 0L
                    while (true) {
                        val read = source.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_ZIP_BYTES) {
                            return listOf("File is larger than the 256 MB inspection limit.")
                        }
                        destination.write(buffer, 0, read)
                    }
                }
            }
            return ZipArchiveInspector.readEntries(temp)
        } catch (_: ZipException) {
            return listOf("This file is not a valid ZIP archive.")
        } catch (_: SecurityException) {
            return listOf("Access to this document was denied. Please import it again.")
        } catch (_: Exception) {
            return listOf("Could not inspect this file. It may be unavailable or damaged.")
        } finally {
            temp.delete()
        }
    }
}

@Composable
private fun ArchiveHome(
    initialUris: List<Uri>,
    getDisplayName: (Uri) -> String,
    getDisplaySize: (Uri) -> String,
    onPicked: (Uri) -> Unit,
    onRemoved: (Uri) -> Unit,
    inspectZip: (Uri) -> List<String>
) {
    val archives = remember {
        mutableStateListOf<LocalArchive>().apply {
            initialUris.forEach { uri ->
                add(LocalArchive(uri, getDisplayName(uri), getDisplaySize(uri)))
            }
        }
    }
    val details = remember { mutableStateListOf<String>() }
    var inspectingUri by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            onPicked(uri)
            val item = LocalArchive(uri, getDisplayName(uri), getDisplaySize(uri))
            if (archives.none { it.uri == uri }) archives.add(item)
            details.clear()
            details.add("Imported: ${item.name}")
        }
    }

    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Archive Manager+", style = MaterialTheme.typography.headlineMedium)
        Text("Select local files and inspect ZIP archive contents.")
        Button(
            onClick = { picker.launch(arrayOf("*/*")) },
            modifier = Modifier.fillMaxWidth()
        ) { Text("Import a file") }

        Text("Library (${archives.size})", style = MaterialTheme.typography.titleLarge)
        if (archives.isEmpty()) {
            Text("No files selected yet. Choose a file to add it to your library.")
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f, fill = false),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(archives, key = { it.uri.toString() }) { archive ->
                    Card {
                        Column(Modifier.fillMaxWidth().padding(14.dp)) {
                            Text(archive.name, style = MaterialTheme.typography.titleMedium)
                            Text(archive.sizeLabel, style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    enabled = inspectingUri == null,
                                    onClick = {
                                        inspectingUri = archive.uri.toString()
                                        scope.launch {
                                            val result = withContext(Dispatchers.IO) {
                                                inspectZip(archive.uri)
                                            }
                                            details.clear()
                                            details.addAll(result)
                                            inspectingUri = null
                                        }
                                    }
                                ) {
                                    if (inspectingUri == archive.uri.toString()) {
                                        CircularProgressIndicator()
                                    } else Text("Inspect ZIP")
                                }
                                Button(onClick = {
                                    archives.remove(archive)
                                    onRemoved(archive.uri)
                                    details.clear()
                                    details.add("Removed from your library. The original file was not deleted.")
                                }) { Text("Remove") }
                            }
                        }
                    }
                }
            }
        }
        if (details.isNotEmpty()) {
            Text("Details", style = MaterialTheme.typography.titleMedium)
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(details) { entry -> Text(entry, style = MaterialTheme.typography.bodyMedium) }
            }
        }
    }
}


/** Small, testable ZIP directory reader. It never extracts or writes archive paths. */
internal object ZipArchiveInspector {
    fun readEntries(file: File, maxEntries: Int = MAX_DISPLAY_ENTRIES): List<String> {
        require(maxEntries > 0) { "maxEntries must be positive" }
        return ZipFile(file).use { zip ->
            val names = mutableListOf<String>()
            val entries = zip.entries()
            while (entries.hasMoreElements() && names.size < maxEntries) {
                names.add(entries.nextElement().name)
            }
            when {
                names.isEmpty() -> listOf("This ZIP archive contains no entries.")
                entries.hasMoreElements() -> names + "Showing the first $maxEntries entries."
                else -> names
            }
        }
    }
}
