package com.ichirokuxvi.shopwalk.engine

/**
 * The walk file of recorder plan 0002, section 2. Every stream is optional; a stream that
 * is null was not offered by the phone. Rows are DoubleArrays in `t` order.
 */
data class WalkFile(
    val id: String,
    val name: String? = null,
    val startedAt: String,
    val durationMs: Double,
    val source: WalkSource,
    val holding: String? = null,
    val settings: WalkSettings = WalkSettings(),
    val origin: WalkOrigin? = null,
    val streams: WalkStreams = WalkStreams(),
    val poseSource: String? = null,
    val marks: List<WalkMark> = emptyList(),
    val events: List<WalkEvent> = emptyList(),
) {
    companion object {
        const val FORMAT = "shop-walk"
        const val VERSION = 1
    }
}

data class WalkSource(
    val platform: String,
    val app: String,
    val appVersion: String,
    val device: String? = null,
    val userAgent: String? = null,
)

data class WalkSettings(val stepMetres: Double = 0.7, val cellMetres: Double = 0.5)

data class WalkOrigin(val lat: Double, val lon: Double, val accuracyMetres: Double)

data class WalkStreams(
    /** [t, ax, ay, az, gx, gy, gz] */
    val motion: List<DoubleArray>? = null,
    /** [t, qx, qy, qz, qw] */
    val game: List<DoubleArray>? = null,
    /** [t, qx, qy, qz, qw] */
    val absolute: List<DoubleArray>? = null,
    /** [t, mx, my, mz] in µT */
    val magnetic: List<DoubleArray>? = null,
    /** [t] of each hardware step */
    val steps: DoubleArray? = null,
    /** [t, lat, lon, accuracyMetres] */
    val location: List<DoubleArray>? = null,
    /** [t, x, y, z, qx, qy, qz, qw] */
    val pose: List<DoubleArray>? = null,
    /** [t, hPa] */
    val pressure: List<DoubleArray>? = null,
)

data class WalkMark(val t: Double, val kind: String, val label: String? = null) {
    companion object {
        const val ENTRANCE = "entrance"
        const val CHECKOUT = "checkout"
        const val CHECKPOINT = "checkpoint"
        const val NOTE = "note"
    }
}

data class WalkEvent(val t: Double, val kind: String, val detail: String? = null)

class WalkFormatException(message: String) : RuntimeException(message)

/** Reads and writes the walk file as JSON. Unknown fields are ignored on read. */
object WalkJson {

    fun parse(text: String): WalkFile = fromValue(Json.parse(text))

    fun fromValue(value: Any?): WalkFile {
        val m = value as? Map<*, *> ?: throw WalkFormatException("A walk file is a JSON object")
        if (m["format"] != WalkFile.FORMAT) throw WalkFormatException("Not a shop-walk file (format is ${m["format"]})")
        val version = (m["version"] as? Double)
        if (version != WalkFile.VERSION.toDouble()) throw WalkFormatException("Unsupported walk file version ${m["version"]}")
        val src = m["source"] as? Map<*, *>
        val settings = m["settings"] as? Map<*, *>
        val origin = m["origin"] as? Map<*, *>
        val streams = m["streams"] as? Map<*, *>
        return WalkFile(
            id = m["id"] as? String ?: throw WalkFormatException("A walk file needs an id"),
            name = m["name"] as? String,
            startedAt = m["startedAt"] as? String ?: "",
            durationMs = (m["durationMs"] as? Double) ?: 0.0,
            source = WalkSource(
                platform = src?.get("platform") as? String ?: "unknown",
                app = src?.get("app") as? String ?: "unknown",
                appVersion = src?.get("appVersion") as? String ?: "",
                device = src?.get("device") as? String,
                userAgent = src?.get("userAgent") as? String,
            ),
            holding = m["holding"] as? String,
            settings = WalkSettings(
                stepMetres = settings?.get("stepMetres") as? Double ?: 0.7,
                cellMetres = settings?.get("cellMetres") as? Double ?: 0.5,
            ),
            origin = origin?.let {
                val lat = it["lat"] as? Double
                val lon = it["lon"] as? Double
                if (lat == null || lon == null) null
                else WalkOrigin(lat, lon, it["accuracyMetres"] as? Double ?: 0.0)
            },
            streams = WalkStreams(
                motion = rows(streams?.get("motion")),
                game = rows(streams?.get("game")),
                absolute = rows(streams?.get("absolute")),
                magnetic = rows(streams?.get("magnetic")),
                steps = flat(streams?.get("steps")),
                location = rows(streams?.get("location")),
                pose = rows(streams?.get("pose")),
                pressure = rows(streams?.get("pressure")),
            ),
            poseSource = m["poseSource"] as? String,
            marks = list(m["marks"]).mapNotNull { e ->
                val o = e as? Map<*, *> ?: return@mapNotNull null
                val t = o["t"] as? Double ?: return@mapNotNull null
                val kind = o["kind"] as? String ?: return@mapNotNull null
                WalkMark(t, kind, o["label"] as? String)
            },
            events = list(m["events"]).mapNotNull { e ->
                val o = e as? Map<*, *> ?: return@mapNotNull null
                val t = o["t"] as? Double ?: return@mapNotNull null
                val kind = o["kind"] as? String ?: return@mapNotNull null
                WalkEvent(t, kind, o["detail"] as? String)
            },
        )
    }

    private fun list(v: Any?): List<Any?> = when (v) {
        is List<*> -> v
        is DoubleArray -> v.toList()
        else -> emptyList()
    }

    /** A stream's rows, stably sorted by `t` only when they are out of order. */
    private fun rows(v: Any?): List<DoubleArray>? {
        val rows = when (v) {
            null -> return null
            is DoubleArray -> if (v.isEmpty()) emptyList() else return null
            is List<*> -> v.mapNotNull { (it as? DoubleArray)?.takeIf { r -> r.isNotEmpty() } }
            else -> return null
        }
        for (k in 1 until rows.size) {
            if (rows[k][0] < rows[k - 1][0]) return rows.sortedBy { it[0] }
        }
        return rows
    }

    private fun flat(v: Any?): DoubleArray? {
        val steps = when (v) {
            null -> return null
            is DoubleArray -> v
            // Tolerate steps written as one element rows.
            is List<*> -> v.mapNotNull { (it as? DoubleArray)?.firstOrNull() }.toDoubleArray()
            else -> return null
        }
        for (k in 1 until steps.size) {
            if (steps[k] < steps[k - 1]) return steps.sortedArray()
        }
        return steps
    }

    /** The walk as a JSON tree in the field order of the contract. */
    fun toValue(w: WalkFile): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        out["format"] = WalkFile.FORMAT
        out["version"] = WalkFile.VERSION
        out["id"] = w.id
        if (w.name != null) out["name"] = w.name
        out["startedAt"] = w.startedAt
        out["durationMs"] = w.durationMs
        out["source"] = LinkedHashMap<String, Any?>().apply {
            put("platform", w.source.platform)
            put("app", w.source.app)
            put("appVersion", w.source.appVersion)
            if (w.source.device != null) put("device", w.source.device)
            if (w.source.userAgent != null) put("userAgent", w.source.userAgent)
        }
        if (w.holding != null) out["holding"] = w.holding
        out["settings"] = linkedMapOf("stepMetres" to w.settings.stepMetres, "cellMetres" to w.settings.cellMetres)
        if (w.origin != null) out["origin"] = linkedMapOf(
            "lat" to w.origin.lat, "lon" to w.origin.lon, "accuracyMetres" to w.origin.accuracyMetres,
        )
        val s = LinkedHashMap<String, Any?>()
        w.streams.motion?.let { s["motion"] = it }
        w.streams.game?.let { s["game"] = it }
        w.streams.absolute?.let { s["absolute"] = it }
        w.streams.magnetic?.let { s["magnetic"] = it }
        w.streams.steps?.let { s["steps"] = it }
        w.streams.location?.let { s["location"] = it }
        w.streams.pose?.let { s["pose"] = it }
        w.streams.pressure?.let { s["pressure"] = it }
        out["streams"] = s
        if (w.poseSource != null) out["poseSource"] = w.poseSource
        out["marks"] = w.marks.map { mk ->
            LinkedHashMap<String, Any?>().apply {
                put("t", mk.t); put("kind", mk.kind); if (mk.label != null) put("label", mk.label)
            }
        }
        out["events"] = w.events.map { e ->
            LinkedHashMap<String, Any?>().apply {
                put("t", e.t); put("kind", e.kind); if (e.detail != null) put("detail", e.detail)
            }
        }
        return out
    }

    fun write(w: WalkFile, out: Appendable) = Json.write(toValue(w), out)

    fun stringify(w: WalkFile): String = StringBuilder(1 shl 16).also { write(w, it) }.toString()
}
