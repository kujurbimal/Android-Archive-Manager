package com.kujurbimal.archivemanager

import org.apache.commons.compress.archivers.ArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry
import org.apache.commons.compress.archivers.zip.ZipArchiveInputStream
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

internal object ArchiveEngine {
    const val MAX_ENTRIES = 10_000
    const val MAX_EXPANDED_BYTES = 1024L * 1024L * 1024L
    private const val BUFFER_SIZE = 32 * 1024

    fun list(file: File, format: String): List<String> = when (format.lowercase()) {
        "zip" -> ZipInputStream(BufferedInputStream(FileInputStream(file))).use { input ->
            val names = mutableListOf<String>()
            var entry = input.nextEntry
            while (entry != null && names.size < MAX_ENTRIES) {
                names.add(entry.name)
                entry = input.nextEntry
            }
            names
        }
        "tar", "tar.gz", "tgz" -> openTar(file, format).use { input ->
            val names = mutableListOf<String>()
            var entry = input.nextTarEntry
            while (entry != null && names.size < MAX_ENTRIES) {
                names.add(entry.name)
                entry = input.nextTarEntry
            }
            names
        }
        "gz", "gzip" -> listOf(file.name.removeSuffix(".gz"))
        "7z" -> SevenZFile.builder().setFile(file).get().use { archive ->
            val names = mutableListOf<String>()
            for (entry in archive.entries) {
                if (names.size >= MAX_ENTRIES) break
                names.add(entry.name)
            }
            names
        }
        else -> throw IllegalArgumentException("Unsupported archive format: $format")
    }

    fun extract(file: File, format: String, destination: File, progress: (Int) -> Unit = {}) {
        require(destination.exists() || destination.mkdirs()) { "Cannot create extraction folder" }
        var entries = 0
        var expanded = 0L
        fun writeEntry(name: String, directory: Boolean, copy: (OutputStream) -> Long) {
            entries++
            require(entries <= MAX_ENTRIES) { "Archive contains too many entries" }
            val target = safeTarget(destination, name)
            if (directory) {
                require(target.exists() || target.mkdirs()) { "Cannot create folder: $name" }
                return
            }
            target.parentFile?.let { require(it.exists() || it.mkdirs()) { "Cannot create folder" } }
            val temporary = File(target.parentFile, ".${target.name}.extracting")
            try {
                val written = FileOutputStream(temporary).use(copy)
                expanded += written
                require(expanded <= MAX_EXPANDED_BYTES) { "Expanded data exceeds 1 GB safety limit" }
                if (target.exists()) target.delete()
                require(temporary.renameTo(target)) { "Could not finalize extracted file" }
            } finally {
                temporary.delete()
            }
            progress(entries)
        }

        when (format.lowercase()) {
            "zip" -> ZipInputStream(BufferedInputStream(FileInputStream(file))).use { input ->
                var entry = input.nextEntry
                while (entry != null) {
                    val current = entry
                    writeEntry(current.name, current.isDirectory) { out -> copyLimited(input, out, MAX_EXPANDED_BYTES - expanded) }
                    input.closeEntry()
                    entry = input.nextEntry
                }
            }
            "tar", "tar.gz", "tgz" -> openTar(file, format).use { input ->
                var entry = input.nextTarEntry
                while (entry != null) {
                    val current = entry
                    require(!current.isSymbolicLink && !current.isLink && !current.isCharacterDevice && !current.isBlockDevice) {
                        "Links and device entries are not extracted"
                    }
                    writeEntry(current.name, current.isDirectory) { out ->
                        if (current.isDirectory) 0L else copyLimited(input, out, MAX_EXPANDED_BYTES - expanded)
                    }
                    entry = input.nextTarEntry
                }
            }
            "gz", "gzip" -> GZIPInputStream(BufferedInputStream(FileInputStream(file))).use { input ->
                writeEntry(file.name.removeSuffix(".gz"), false) { out -> copyLimited(input, out, MAX_EXPANDED_BYTES) }
            }
            "7z" -> SevenZFile.builder().setFile(file).get().use { archive ->
                for (entry in archive.entries) {
                    val current = entry
                    require(!current.isAntiItem) { "7z anti-items are not supported" }
                    writeEntry(current.name, current.isDirectory) { out ->
                        if (current.isDirectory) 0L else {
                            val buffer = ByteArray(BUFFER_SIZE)
                            var count: Int
                            var total = 0L
                            while (archive.read(buffer).also { count = it } != -1) {
                                total += count
                                require(total <= MAX_EXPANDED_BYTES - expanded) { "Expanded data exceeds 1 GB safety limit" }
                                out.write(buffer, 0, count)
                            }
                            total
                        }
                    }
                }
            }
            else -> throw IllegalArgumentException("Extraction is not supported for $format")
        }
    }

    fun create(files: List<File>, output: File, format: String) {
        require(files.isNotEmpty()) { "Select at least one file" }
        require(files.all { it.isFile }) { "Only files can be archived in this version" }
        when (format.lowercase()) {
            "zip" -> ZipOutputStream(BufferedOutputStream(FileOutputStream(output))).use { zip ->
                files.forEach { file ->
                    zip.putNextEntry(ZipEntry(file.name))
                    FileInputStream(file).use { it.copyTo(zip) }
                    zip.closeEntry()
                }
            }
            "tar" -> TarArchiveOutputStream(BufferedOutputStream(FileOutputStream(output))).use { tar ->
                tar.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX)
                files.forEach { file ->
                    val entry = TarArchiveEntry(file, file.name)
                    tar.putArchiveEntry(entry)
                    FileInputStream(file).use { it.copyTo(tar) }
                    tar.closeArchiveEntry()
                }
                tar.finish()
            }
            "tar.gz", "tgz" -> GZIPOutputStream(BufferedOutputStream(FileOutputStream(output))).use { gzip ->
                TarArchiveOutputStream(gzip).use { tar ->
                    tar.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX)
                    files.forEach { file ->
                        tar.putArchiveEntry(TarArchiveEntry(file, file.name))
                        FileInputStream(file).use { it.copyTo(tar) }
                        tar.closeArchiveEntry()
                    }
                    tar.finish()
                }
            }
            "gz", "gzip" -> {
                require(files.size == 1) { "GZIP creates one compressed file at a time" }
                GZIPOutputStream(BufferedOutputStream(FileOutputStream(output))).use { gzip ->
                    FileInputStream(files.single()).use { it.copyTo(gzip) }
                }
            }
            "7z" -> SevenZOutputFile(output).use { seven ->
                files.forEach { file ->
                    val entry = seven.createArchiveEntry(file, file.name)
                    seven.putArchiveEntry(entry)
                    FileInputStream(file).use { input ->
                        val buffer = ByteArray(BUFFER_SIZE)
                        var count: Int
                        while (input.read(buffer).also { count = it } != -1) seven.write(buffer, 0, count)
                    }
                    seven.closeArchiveEntry()
                }
                seven.finish()
            }
            else -> throw IllegalArgumentException("Creation is not supported for $format")
        }
    }

    private fun openTar(file: File, format: String): TarArchiveInputStream {
        val raw: InputStream = BufferedInputStream(FileInputStream(file))
        val source = if (format.lowercase() in setOf("tar.gz", "tgz")) GZIPInputStream(raw) else raw
        return TarArchiveInputStream(source)
    }

    private fun safeTarget(root: File, archiveName: String): File {
        require(archiveName.isNotBlank()) { "Archive contains an empty path" }
        require(!archiveName.startsWith("/") && !archiveName.startsWith("\\")) { "Absolute archive paths are blocked" }
        val segments = archiveName.replace('\\', '/').split('/')
        require(segments.none { it == ".." || it == "." || it.isEmpty() }) { "Unsafe archive path blocked: $archiveName" }
        val base = root.canonicalFile
        val target = File(base, segments.joinToString(File.separator)).canonicalFile
        require(target.toPath().startsWith(base.toPath())) { "Archive path escapes destination" }
        return target
    }

    private fun copyLimited(input: InputStream, output: OutputStream, remaining: Long): Long {
        val buffer = ByteArray(BUFFER_SIZE)
        var total = 0L
        var count: Int
        while (input.read(buffer).also { count = it } != -1) {
            total += count
            require(total <= remaining) { "Expanded data exceeds 1 GB safety limit" }
            output.write(buffer, 0, count)
        }
        return total
    }
}
