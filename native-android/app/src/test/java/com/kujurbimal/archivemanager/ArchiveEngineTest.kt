package com.kujurbimal.archivemanager

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ArchiveEngineTest {
    @Test
    fun createsListsAndExtractsZip() {
        val root = createTempDir(prefix = "archive-engine-test-")
        try {
            val source = File(root, "hello.txt").apply { writeText("hello archive") }
            val zip = File(root, "test.zip")
            ArchiveEngine.create(listOf(source), zip, "zip")
            assertEquals(listOf("hello.txt"), ArchiveEngine.list(zip, "zip"))
            val destination = File(root, "out")
            ArchiveEngine.extract(zip, "zip", destination)
            assertEquals("hello archive", File(destination, "hello.txt").readText())
        } finally { root.deleteRecursively() }
    }

    @Test
    fun blocksZipSlipPaths() {
        val root = createTempDir(prefix = "archive-slip-test-")
        try {
            val zip = File(root, "unsafe.zip")
            ZipOutputStream(zip.outputStream()).use { output ->
                output.putNextEntry(ZipEntry("../outside.txt"))
                output.write("bad".toByteArray())
                output.closeEntry()
            }
            val destination = File(root, "out")
            val result = runCatching { ArchiveEngine.extract(zip, "zip", destination) }
            assertTrue(result.isFailure)
            assertTrue(!File(root, "outside.txt").exists())
        } finally { root.deleteRecursively() }
    }

    @Test
    fun rejectsUnsupportedArchiveCreationFormat() {
        val root = createTempDir(prefix = "archive-format-test-")
        try {
            val source = File(root, "hello.txt").apply { writeText("hello") }
            val result = runCatching { ArchiveEngine.create(listOf(source), File(root, "x.rar"), "rar") }
            assertTrue(result.isFailure)
        } finally { root.deleteRecursively() }
    }
}
