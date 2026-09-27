package com.ichirokuxvi.shopwalk.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs

/**
 * The cross platform check: the golden walks the TypeScript recorder wrote
 * (`libs/luna-shopper/shop-map/recorder/src/__fixtures__/walks`, copied here unchanged)
 * replay in Kotlin to the same numbers. Steps and turns exactly, end positions within
 * 0.05 m, everything else within 1e-3 (the expected file rounds to four decimals).
 */
class GoldenWalkTest {

    private val root: File = File(javaClass.classLoader!!.getResource("walks")!!.toURI())

    private fun num(v: Any?): Double = v as Double

    @Test
    fun everyGoldenWalkReplaysToTheTypeScriptNumbers() {
        val dirs = root.listFiles()!!.filter { it.isDirectory }.sortedBy { it.name }
        assertEquals(3, dirs.size)
        val table = StringBuilder("walk | mode | model | TS steps/turns/end | Kotlin steps/turns/end | max end diff\n")
        var compared = 0
        for (dir in dirs) {
            val expected = Json.parse(File(dir, "expected.json").readText()) as Map<*, *>
            val file = File(dir, expected["file"] as String)
            val text = file.readText()
            val walk = (GeoJson.import(text) as Imported.Walk).walk
            assertEquals(dir.name, expected["file"], GeoJson.fileName(walk))

            val available = (expected["availableModes"] as List<*>).map { it as String }
            assertEquals(dir.name, available, Availability.of(walk).modes())

            val modes = expected["modes"] as Map<*, *>
            for ((mode, models) in modes) {
                for ((model, e) in models as Map<*, *>) {
                    val exp = e as Map<*, *>
                    val base = EngineOptions.forWalk(walk)
                    val options = if (model == "weinberg") base.copy(stepModel = StepModel.WEINBERG) else base
                    val set = TrackSet.compute(walk, options)
                    val track = set.track(mode as String)!!
                    val m = set.metrics.first { it.mode == mode }
                    val where = "${dir.name} $mode $model"
                    val ex = (exp["final"] as Map<*, *>)
                    val fx = track.x.last()
                    val fy = track.y.last()
                    val diff = maxOf(abs(fx - num(ex["x"])), abs(fy - num(ex["y"])))
                    table.append(
                        "${dir.name} | $mode | $model | ${num(exp["steps"]).toInt()}/${num(exp["turns"]).toInt()}/" +
                            "(${ex["x"]}, ${ex["y"]}) | ${track.steps}/${track.turns}/" +
                            "(%.4f, %.4f) | %.5f\n".format(fx, fy, diff),
                    )
                    assertEquals(where, num(exp["steps"]).toInt(), track.steps)
                    assertEquals(where, num(exp["turns"]).toInt(), track.turns)
                    assertTrue("$where end differs by $diff", diff <= 0.05)
                    assertEquals(where, num(exp["distanceMetres"]), m.distanceMetres, 1e-3)
                    assertEquals(where, num(exp["endToStartMetres"]), m.endToStartMetres, 1e-3)
                    assertEquals(where, num(exp["rotation"]), track.rotation, 1e-3)
                    assertEquals(where, num(exp["points"]).toInt(), track.size)
                    assertEquals(where, num(exp["segments"]).toInt(), track.segments.size)
                    exp["bearing"]?.let { assertEquals(where, num(it), track.bearingDeg!!, 1e-3) }
                    val cps = (exp["checkpoints"] as? List<*>).orEmpty().map { it as Map<*, *> }
                    assertEquals(where, cps.map { it["label"] }, m.checkpoints.map { it.label })
                    for ((k, c) in cps.withIndex()) {
                        assertEquals(where, num(c["count"]).toInt(), m.checkpoints[k].count)
                        assertEquals(where, num(c["errorMetres"]), m.checkpoints[k].errorMetres, 1e-3)
                    }
                    compared++
                }
            }
        }
        println(table)
        File("build/golden-walks.txt").apply { parentFile.mkdirs() }.writeText(table.toString())
        assertTrue(compared > 30)
    }

    /** Our export of a golden walk draws the same lines as the file TypeScript wrote. */
    @Test
    fun reExportingAGoldenWalkGivesTheSameCoordinates() {
        for (dir in root.listFiles()!!.filter { it.isDirectory }) {
            val file = dir.listFiles()!!.first { it.name.endsWith(".geojson") }
            val theirs = Json.parse(file.readText()) as Map<*, *>
            val walk = (GeoJson.import(file.readText()) as Imported.Walk).walk
            val ours = GeoJson.export(TrackSet.compute(walk), "pdr:own:gyro:snap")
            assertEquals(dir.name, theirs["bearing"] as Double, ours["bearing"] as Double, 1e-9)
            assertEquals(dir.name, theirs["localFrame"], ours["localFrame"])
            val a = theirs["features"] as List<*>
            val b = ours["features"] as List<*>
            assertEquals(dir.name, a.size, b.size)
            for (k in a.indices) {
                val fa = a[k] as Map<*, *>
                val fb = b[k] as Map<*, *>
                val pa = fa["properties"] as Map<*, *>
                val pb = fb["properties"] as Map<*, *>
                assertEquals(pa["mode"], pb["mode"])
                assertEquals(pa["mark"], pb["mark"])
                assertEquals(pa["label"], pb["label"])
                val ga = (fa["geometry"] as Map<*, *>)["coordinates"]
                val gb = (fb["geometry"] as Map<*, *>)["coordinates"]
                val ca: List<DoubleArray> = if (ga is DoubleArray) listOf(ga) else (ga as List<*>).map { it as DoubleArray }
                val cb: List<DoubleArray> = if (gb is DoubleArray) listOf(gb) else (gb as List<*>).map { it as DoubleArray }
                assertEquals("${dir.name} feature $k", ca.size, cb.size)
                for (i in ca.indices) {
                    // Within 0.05 m of each other, in degrees.
                    assertEquals(ca[i][0], cb[i][0], 5e-7)
                    assertEquals(ca[i][1], cb[i][1], 5e-7)
                }
            }
        }
    }
}
