package com.ichirokuxvi.shopwalk.engine

import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.cos
import kotlin.math.round
import kotlin.math.sin

/** A line read from a plain GeoJSON with no `walk`, in metres around its first coordinate. */
data class PlainLine(val name: String, val x: DoubleArray, val y: DoubleArray)

data class PlainPoint(val name: String, val x: Double, val y: Double)

/** What an imported file turned out to be (recorder plan 0002, section 3). */
sealed class Imported {
    data class Walk(val walk: WalkFile) : Imported()
    data class Plain(val lines: List<PlainLine>, val points: List<PlainPoint>) : Imported()
}

/** The GeoJSON export and import of recorder plan 0002, section 3. */
object GeoJson {
    private const val M = TrackEngine.METRES_PER_DEGREE

    /** `walk-<YYYYMMDD>-<HHmm>-<name in kebab case>.geojson`. */
    fun fileName(walk: WalkFile): String {
        val stamp = try {
            OffsetDateTime.parse(walk.startedAt).format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"))
        } catch (e: Exception) {
            "00000000-0000"
        }
        val kebab = kebab(walk.name.orEmpty())
        return if (kebab.isEmpty()) "walk-$stamp.geojson" else "walk-$stamp-$kebab.geojson"
    }

    fun kebab(s: String): String {
        val folded = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .lowercase()
        return folded.replace(Regex("[^a-z0-9]+"), "-").trim('-')
    }

    /** Local metres (east, north) to `[lon, lat]`, placed at [origin] or at 0,0. */
    fun project(east: Double, north: Double, origin: WalkOrigin?): DoubleArray {
        val lat0 = origin?.lat ?: 0.0
        val lon0 = origin?.lon ?: 0.0
        val lat = lat0 + north / M
        val lon = lon0 + east / (M * cos(Math.toRadians(lat0)))
        return doubleArrayOf(round7(lon), round7(lat))
    }

    /** Rotates an aligned local point by [bearingDeg] into east and north. */
    fun toEastNorth(x: Double, y: Double, bearingDeg: Double): DoubleArray {
        val b = Math.toRadians(bearingDeg)
        val c = cos(b)
        val s = sin(b)
        return doubleArrayOf(x * c + y * s, -x * s + y * c)
    }

    private fun round7(v: Double) = Math.round(v * 1e7) / 1e7

    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0

    /**
     * The FeatureCollection of section 3 for a computed track set. Marks are placed on the
     * track of [selectedMode], or on the first computed track when it is absent.
     */
    fun export(set: TrackSet, selectedMode: String?): Map<String, Any?> {
        val walk = set.walk
        val origin = walk.origin
        val bearing = set.bearingDeg
        val features = ArrayList<Any?>()
        val metrics = set.metrics.associateBy { it.mode }
        fun coords(track: Track, k: Int): DoubleArray {
            val en = toEastNorth(track.x[k], track.y[k], bearing)
            return project(en[0], en[1], origin)
        }
        for (track in set.tracks) {
            if (track.size == 0) continue
            val cs = ArrayList<DoubleArray>(track.size)
            for (k in 0 until track.size) cs.add(coords(track, k))
            // A LineString needs two positions: a track that never moved repeats its start.
            if (cs.size == 1) cs.add(cs[0])
            val m = metrics[track.mode]
            features.add(
                linkedMapOf(
                    "type" to "Feature",
                    "geometry" to linkedMapOf("type" to "LineString", "coordinates" to cs),
                    "properties" to linkedMapOf(
                        "mode" to track.mode,
                        "steps" to track.steps,
                        "turns" to track.turns,
                        "distanceMetres" to round2(m?.distanceMetres ?: 0.0),
                    ),
                ),
            )
        }
        val markTrack = selectedMode?.let { set.track(it) } ?: set.tracks.firstOrNull()
        if (markTrack != null && markTrack.size > 0) {
            for (mark in walk.marks) {
                val k = Metrics.positionAt(markTrack, mark.t)
                val props = LinkedHashMap<String, Any?>()
                props["mark"] = mark.kind
                if (mark.label != null) props["label"] = mark.label
                props["t"] = mark.t
                props["mode"] = markTrack.mode
                features.add(
                    linkedMapOf(
                        "type" to "Feature",
                        "geometry" to linkedMapOf("type" to "Point", "coordinates" to coords(markTrack, k)),
                        "properties" to props,
                    ),
                )
            }
        }
        return linkedMapOf(
            "type" to "FeatureCollection",
            "localFrame" to (origin == null),
            "bearing" to Math.round(bearing * 100.0) / 100.0,
            "features" to features,
            "walk" to WalkJson.toValue(walk),
        )
    }

    fun exportString(set: TrackSet, selectedMode: String?): String =
        StringBuilder(1 shl 16).also { Json.write(export(set, selectedMode), it) }.toString()

    /** Accepts this file, a bare walk file, or a plain GeoJSON with no `walk`. */
    fun import(text: String): Imported {
        val v = Json.parse(text) as? Map<*, *> ?: throw WalkFormatException("The file is not a JSON object")
        if (v["type"] == "FeatureCollection" || v["type"] == "Feature") {
            val walk = v["walk"]
            if (walk != null) return Imported.Walk(WalkJson.fromValue(walk))
            return plain(v)
        }
        if (v.containsKey("format")) return Imported.Walk(WalkJson.fromValue(v))
        throw WalkFormatException("Neither a shop-walk file nor GeoJSON")
    }

    private fun plain(v: Map<*, *>): Imported.Plain {
        val features: List<Map<*, *>> = if (v["type"] == "Feature") listOf(v) else
            (v["features"] as? List<*>)?.mapNotNull { it as? Map<*, *> } ?: emptyList()
        val rawLines = ArrayList<Pair<String, List<DoubleArray>>>()
        val rawPoints = ArrayList<Pair<String, DoubleArray>>()
        for ((i, f) in features.withIndex()) {
            val g = f["geometry"] as? Map<*, *> ?: continue
            val props = f["properties"] as? Map<*, *>
            val name = (props?.get("mode") ?: props?.get("name") ?: props?.get("label") ?: props?.get("mark"))
                ?.toString() ?: "line ${i + 1}"
            when (g["type"]) {
                "LineString" -> positions(g["coordinates"])?.let { rawLines.add(name to it) }
                "MultiLineString" -> (g["coordinates"] as? List<*>)?.forEach { part ->
                    positions(part)?.let { rawLines.add(name to it) }
                }
                "Point" -> (g["coordinates"] as? DoubleArray)?.takeIf { it.size >= 2 }?.let { rawPoints.add(name to it) }
            }
        }
        val first = rawLines.firstOrNull()?.second?.firstOrNull() ?: rawPoints.firstOrNull()?.second
            ?: return Imported.Plain(emptyList(), emptyList())
        val lon0 = first[0]
        val lat0 = first[1]
        val k = M * cos(Math.toRadians(lat0))
        val lines = rawLines.map { (name, ps) ->
            PlainLine(name, DoubleArray(ps.size) { (ps[it][0] - lon0) * k }, DoubleArray(ps.size) { (ps[it][1] - lat0) * M })
        }
        val points = rawPoints.map { (name, p) -> PlainPoint(name, (p[0] - lon0) * k, (p[1] - lat0) * M) }
        return Imported.Plain(lines, points)
    }

    private fun positions(v: Any?): List<DoubleArray>? {
        val l = v as? List<*> ?: return null
        val ps = l.mapNotNull { (it as? DoubleArray)?.takeIf { p -> p.size >= 2 } }
        return ps.takeIf { it.isNotEmpty() }
    }
}
