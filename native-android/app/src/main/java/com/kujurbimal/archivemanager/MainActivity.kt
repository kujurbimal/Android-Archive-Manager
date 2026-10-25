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
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.util.zip.ZipFile

data class LocalArchive(val uri: Uri, val name: String, val sizeLabel: String)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    ArchiveHome(
                        onPicked = { uri ->
                            val name = queryName(uri)
                            val size = querySize(uri)
                            // Retain access to the selected document across app restarts.
                            runCatching {
                                contentResolver.takePersistableUriPermission(
                                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                                )
                            }
                            uri
                        },
                        getDisplayName = ::queryName,
                        getDisplaySize = ::querySize,
                        inspectZip = ::inspectZip
                    )
                }
            }
        }
    }

    private fun queryName(uri: Uri): String =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) ?: "Selected archive" else "Selected archive"
        } ?: "Selected archive"

    private fun querySize(uri: Uri): String =
        contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) {
                val bytes = cursor.getLong(0)
                if (bytes >= 1_048_576) "${bytes / 1_048_576} MB" else "${bytes / 1024} KB"
            } else "Size unavailable"
        } ?: "Size unavailable"

    private fun inspectZip(uri: Uri): List<String> {
        return try {
            contentResolver.openInputStream(uri)?.use { input ->
                val temp = java.io.File(cacheDir, "inspect-${System.currentTimeMillis()}.zip")
                temp.outputStream().use { output -> input.copyTo(output) }
                try {
                    ZipFile(temp).use { zip ->
                        val result = mutableListOf<String>()
                        val entries = zip.entries()
                        while (entries.hasMoreElements() && result.size < 200) {
                            result.add(entries.nextElement().name)
                        }
                        result
                    }
                } finally { temp.delete() }
            } ?: emptyList()
        } catch (_: Exception) {
            listOf("Unable to read this file as a valid ZIP archive.")
        }
    }
}

@Composable
private fun ArchiveHome(
    onPicked: (Uri) -> Uri,
    getDisplayName: (Uri) -> String,
    getDisplaySize: (Uri) -> String,
    inspectZip: (Uri) -> List<String>
) {
    val archives = remember { mutableStateListOf<LocalArchive>() }
    val details = remember { mutableStateListOf<String>() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val retained = onPicked(uri)
            val item = LocalArchive(retained, getDisplayName(retained), getDisplaySize(retained))
            if (archives.none { it.uri == retained }) archives.add(item)
            details.clear()
            details.add("Imported: ${item.name}")
        }
    }

    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Archive Manager+", style = MaterialTheme.typography.headlineMedium)
        Text("A local-first place to select and inspect ZIP archives.")
        Button(onClick = { picker.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) {
            Text("Import a file")
        }
        Text("Library (${archives.size})", style = MaterialTheme.typography.titleLarge)
        if (archives.isEmpty()) {
            Text("No files selected yet. Choose a file to add it to this session.")
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(archives, key = { it.uri.toString() }) { archive ->
                    Card(colors = CardDefaults.cardColors()) {
                        Column(Modifier.fillMaxWidth().padding(14.dp)) {
                            Text(archive.name, style = MaterialTheme.typography.titleMedium)
                            Text(archive.sizeLabel, style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = {
                                    details.clear()
                                    details.addAll(inspectZip(archive.uri).ifEmpty { listOf("No entries found.") })
                                }) { Text("Inspect ZIP") }
                                Button(onClick = {
                                    archives.remove(archive)
                                    details.clear()
                                    details.add("Removed from this session. Original file is unchanged.")
                                }) { Text("Remove") }
                            }
                        }
                    }
                }
            }
        }
        if (details.isNotEmpty()) {
            Text("Details", style = MaterialTheme.typography.titleMedium)
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(details) { Text(it, style = MaterialTheme.typography.bodyMedium) }
            }
        }
    }
}
