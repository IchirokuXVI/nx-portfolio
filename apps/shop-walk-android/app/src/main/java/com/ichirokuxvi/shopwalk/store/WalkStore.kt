package com.ichirokuxvi.shopwalk.store

import com.ichirokuxvi.shopwalk.engine.GeoJson
import com.ichirokuxvi.shopwalk.engine.Imported
import com.ichirokuxvi.shopwalk.engine.Json
import com.ichirokuxvi.shopwalk.engine.WalkFile
import com.ichirokuxvi.shopwalk.engine.WalkJson
import java.io.File
import java.util.UUID

/** What the walk list shows about a saved walk, read without parsing the whole walk. */
data class WalkMeta(
    val id: String,
    val name: String,
    val startedAt: String,
    val durationMs: Double,
    val platform: String,
    /** "walk" replays; "plain" is a GeoJSON with no walk, drawn as it is. */
    val kind: String,
    val marks: Int,
    val bytes: Long,
    /** True while a recording is still writing it. */
    val recording: Boolean = false,
)

sealed class Stored {
    data class Walk(val walk: WalkFile) : Stored()
    data class Plain(val name: String, val plain: Imported.Plain) : Stored()
}

/**
 * Walks saved in the app's own storage: `<id>.walk.json` (the walk file), or
 * `<id>.plain.geojson` (an imported GeoJSON with no walk), each with a `<id>.meta.json`.
 * Writes go to a temporary file first and are renamed, so a crash never leaves half a file.
 */
class WalkStore(root: File) {
    private val dir = File(root, "walks").apply { mkdirs() }

    private fun walkFile(id: String) = File(dir, "$id.walk.json")
    private fun plainFile(id: String) = File(dir, "$id.plain.geojson")
    private fun metaFile(id: String) = File(dir, "$id.meta.json")

    @Synchronized
    fun list(): List<WalkMeta> {
        val ids = dir.listFiles().orEmpty().mapNotNull { f ->
            when {
                f.name.endsWith(".walk.json") -> f.name.removeSuffix(".walk.json")
                f.name.endsWith(".plain.geojson") -> f.name.removeSuffix(".plain.geojson")
                else -> null
            }
        }.distinct()
        return ids.mapNotNull { id -> readMeta(id) ?: rebuildMeta(id) }.sortedByDescending { it.startedAt }
    }

    private fun readMeta(id: String): WalkMeta? = try {
        val m = Json.parse(metaFile(id).readText()) as Map<*, *>
        WalkMeta(
            id = id,
            name = m["name"] as? String ?: "",
            startedAt = m["startedAt"] as? String ?: "",
            durationMs = m["durationMs"] as? Double ?: 0.0,
            platform = m["platform"] as? String ?: "",
            kind = m["kind"] as? String ?: "walk",
            marks = (m["marks"] as? Double)?.toInt() ?: 0,
            bytes = (m["bytes"] as? Double)?.toLong() ?: 0L,
            recording = m["recording"] as? Boolean ?: false,
        )
    } catch (e: Exception) {
        null
    }

    private fun rebuildMeta(id: String): WalkMeta? = try {
        when (val s = load(id)) {
            is Stored.Walk -> meta(s.walk, walkFile(id).length(), false).also { writeMeta(it) }
            is Stored.Plain -> null
        }
    } catch (e: Exception) {
        null
    }

    private fun meta(w: WalkFile, bytes: Long, recording: Boolean) = WalkMeta(
        id = w.id,
        name = w.name.orEmpty(),
        startedAt = w.startedAt,
        durationMs = w.durationMs,
        platform = w.source.platform,
        kind = "walk",
        marks = w.marks.size,
        bytes = bytes,
        recording = recording,
    )

    private fun writeMeta(m: WalkMeta) {
        val v = linkedMapOf(
            "name" to m.name, "startedAt" to m.startedAt, "durationMs" to m.durationMs,
            "platform" to m.platform, "kind" to m.kind, "marks" to m.marks, "bytes" to m.bytes,
            "recording" to m.recording,
        )
        atomicWrite(metaFile(m.id)) { Json.write(v, it) }
    }

    private fun atomicWrite(target: File, body: (Appendable) -> Unit) {
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.bufferedWriter(Charsets.UTF_8, 1 shl 16).use { body(it) }
        if (!tmp.renameTo(target)) {
            target.delete()
            if (!tmp.renameTo(target)) throw java.io.IOException("Could not save ${target.name}")
        }
    }

    @Synchronized
    fun save(walk: WalkFile, recording: Boolean = false) {
        val f = walkFile(walk.id)
        atomicWrite(f) { WalkJson.write(walk, it) }
        writeMeta(meta(walk, f.length(), recording))
    }

    @Synchronized
    fun savePlain(name: String, text: String): String {
        val id = UUID.randomUUID().toString()
        plainFile(id).writeText(text)
        writeMeta(WalkMeta(id, name, "", 0.0, "geojson", "plain", 0, text.length.toLong()))
        return id
    }

    fun load(id: String): Stored {
        val wf = walkFile(id)
        if (wf.exists()) return Stored.Walk(WalkJson.parse(wf.readText()))
        val pf = plainFile(id)
        val meta = readMeta(id)
        val imported = GeoJson.import(pf.readText())
        return when (imported) {
            is Imported.Plain -> Stored.Plain(meta?.name ?: "GeoJSON", imported)
            is Imported.Walk -> Stored.Walk(imported.walk)
        }
    }

    @Synchronized
    fun delete(id: String) {
        walkFile(id).delete()
        plainFile(id).delete()
        metaFile(id).delete()
    }

    fun exists(id: String): Boolean = walkFile(id).exists() || plainFile(id).exists()
}
