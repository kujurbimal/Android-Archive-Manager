package com.kujurbimal.archivemanager

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ZipArchiveInspectorTest {
    @Test
    fun readsEntryNamesWithoutExtractingFiles() {
        val zip = createZip("docs/readme.txt", "images/logo.png")
        try {
            assertEquals(
                listOf("docs/readme.txt", "images/logo.png"),
                ZipArchiveInspector.readEntries(zip)
            )
        } finally {
            zip.delete()
        }
    }

    @Test
    fun limitsDisplayedEntriesAndAddsNotice() {
        val zip = createZip("one.txt", "two.txt", "three.txt")
        try {
            assertEquals(
                listOf("one.txt", "two.txt", "Showing the first 2 entries."),
                ZipArchiveInspector.readEntries(zip, maxEntries = 2)
            )
        } finally {
            zip.delete()
        }
    }

    @Test
    fun rejectsNonPositiveEntryLimit() {
        val zip = createZip("one.txt")
        try {
            assertThrows(IllegalArgumentException::class.java) {
                ZipArchiveInspector.readEntries(zip, maxEntries = 0)
            }
        } finally {
            zip.delete()
        }
    }

    private fun createZip(vararg names: String): File {
        val file = File.createTempFile("archive-manager-test-", ".zip")
        ZipOutputStream(file.outputStream()).use { output ->
            names.forEach { name ->
                output.putNextEntry(ZipEntry(name))
                output.write("test".toByteArray())
                output.closeEntry()
            }
        }
        return file
    }
}
