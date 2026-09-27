package com.ichirokuxvi.shopwalk.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlin.math.cos

class JsonTest {

    @Test
    fun parsesAndWritesTheBasics() {
        val v = Json.parse("""{"a":[1,2.5,-3e2],"b":"x\"é\n","c":[{"d":true},null],"e":[]}""") as Map<*, *>
        assertTrue((v["a"] as DoubleArray).contentEquals(doubleArrayOf(1.0, 2.5, -300.0)))
        assertEquals("x\"é\n", v["b"])
        assertEquals(true, ((v["c"] as List<*>)[0] as Map<*, *>)["d"])
        val again = Json.parse(Json.stringify(v)) as Map<*, *>
        assertEquals("x\"é\n", again["b"])
        assertEquals("[1,2.5,1.0E-5]", Json.stringify(doubleArrayOf(1.0, 2.5, 0.00001)))
    }
}

class WalkFileTest {

    private fun walk() = Synth().rest(1500).walk(3).mark(WalkMark.NOTE, "wet floor").build(
        origin = WalkOrigin(40.4168, -3.7038, 12.5),
        location = listOf(doubleArrayOf(12.3, 40.4168, -3.7038, 12.5)),
    ).copy(events = listOf(WalkEvent(5.0, "sensor-missing", "pressure")), poseSource = null)

    @Test
    fun roundTripsThroughJson() {
        val w = walk()
        val text = WalkJson.stringify(w)
        val back = WalkJson.parse(text)
        assertEquals(w.id, back.id)
        assertEquals(w.name, back.name)
        assertEquals(w.startedAt, back.startedAt)
        assertEquals(w.durationMs, back.durationMs, 0.0)
        assertEquals(w.origin, back.origin)
        assertEquals(w.marks, back.marks)
        assertEquals(w.events, back.events)
        assertEquals(w.settings, back.settings)
        assertEquals(w.streams.motion!!.size, back.streams.motion!!.size)
        for (k in w.streams.motion!!.indices) assertTrue(w.streams.motion!![k].contentEquals(back.streams.motion!![k]))
        assertTrue(w.streams.steps!!.contentEquals(back.streams.steps!!))
        assertEquals(null, back.streams.pose)
        assertEquals(text, WalkJson.stringify(back))
    }

    @Test
    fun refusesAnotherFormatOrVersionAndIgnoresUnknownFields() {
        try {
            WalkJson.parse("""{"format":"other","version":1,"id":"x"}""")
            fail()
        } catch (e: WalkFormatException) { /* expected */ }
        try {
            WalkJson.parse("""{"format":"shop-walk","version":2,"id":"x"}""")
            fail()
        } catch (e: WalkFormatException) { /* expected */ }
        val w = WalkJson.parse(
            """{"format":"shop-walk","version":1,"id":"x","startedAt":"2026-09-28T10:00:00+02:00","durationMs":10,
               "source":{"platform":"web","app":"velista-walk-lab","appVersion":"1","userAgent":"UA"},
               "settings":{"stepMetres":0.65,"cellMetres":0.5},"future":{"x":1},
               "streams":{"motion":[[0,0,0,9.8,0,0,0]],"steps":[],"lidar":[[1,2]]},"marks":[],"events":[]}""",
        )
        assertEquals("web", w.source.platform)
        assertEquals(0.65, w.settings.stepMetres, 0.0)
        assertEquals(0, w.streams.steps!!.size)
        assertEquals(null, w.streams.game)
    }
}

class GeoJsonTest {

    @Test
    fun projectsWithTheEquirectangularFormula() {
        val o = WalkOrigin(40.0, -3.0, 5.0)
        val p = GeoJson.project(100.0, 200.0, o)
        assertEquals(-3.0 + 100.0 / (111320 * cos(Math.toRadians(40.0))), p[0], 1e-7)
        assertEquals(40.0 + 200.0 / 111320, p[1], 1e-7)
        val en = GeoJson.toEastNorth(0.0, 1.0, 90.0)
        assertEquals(1.0, en[0], 1e-12)
        assertEquals(0.0, en[1], 1e-12)
        val en2 = GeoJson.toEastNorth(1.0, 0.0, 90.0)
        assertEquals(0.0, en2[0], 1e-12)
        assertEquals(-1.0, en2[1], 1e-12)
    }

    private fun walk(origin: WalkOrigin?) = Synth(startBearingDeg = 90.0).rest(2000)
        .mark(WalkMark.ENTRANCE).walk(10).mark(WalkMark.CHECKPOINT, "door").rest(500).build(origin = origin)

    @Test
    fun exportsOneLinePerModeAndOnePointPerMark() {
        val origin = WalkOrigin(40.0, -3.0, 5.0)
        val set = TrackSet.compute(walk(origin))
        val text = GeoJson.exportString(set, "pdr:own:gyro:snap")
        val v = Json.parse(text) as Map<*, *>
        assertEquals("FeatureCollection", v["type"])
        assertEquals(false, v["localFrame"])
        assertEquals(90.0, v["bearing"] as Double, 1e-6)
        val features = v["features"] as List<*>
        val lines = features.filter { ((it as Map<*, *>)["geometry"] as Map<*, *>)["type"] == "LineString" }
        val points = features.filter { ((it as Map<*, *>)["geometry"] as Map<*, *>)["type"] == "Point" }
        assertEquals(12, lines.size)
        assertEquals(2, points.size)
        // The walk went 7 m east of the origin (bearing 90).
        val line = lines.first { (((it as Map<*, *>)["properties"]) as Map<*, *>)["mode"] == "pdr:own:gyro:snap" } as Map<*, *>
        val coords = (line["geometry"] as Map<*, *>)["coordinates"] as List<*>
        val last = coords.last() as DoubleArray
        assertEquals(-3.0 + 7.0 / (111320 * cos(Math.toRadians(40.0))), last[0], 2e-7)
        assertEquals(40.0, last[1], 2e-7)
        val door = points.last() as Map<*, *>
        assertEquals("door", (door["properties"] as Map<*, *>)["label"])
        // And the file imports back as a walk.
        val imported = GeoJson.import(text)
        assertTrue(imported is Imported.Walk)
        assertEquals(set.walk.id, (imported as Imported.Walk).walk.id)
    }

    @Test
    fun withoutAnOriginTheFrameIsLocal() {
        val set = TrackSet.compute(walk(null))
        val v = Json.parse(GeoJson.exportString(set, null)) as Map<*, *>
        assertEquals(true, v["localFrame"])
        val first = (((v["features"] as List<*>)[0] as Map<*, *>)["geometry"] as Map<*, *>)["coordinates"] as List<*>
        assertTrue((first[0] as DoubleArray).contentEquals(doubleArrayOf(0.0, 0.0)))
    }

    @Test
    fun importsABareWalkAndAPlainGeoJson() {
        val w = walk(null)
        assertTrue(GeoJson.import(WalkJson.stringify(w)) is Imported.Walk)
        val plain = GeoJson.import(
            """{"type":"FeatureCollection","features":[
              {"type":"Feature","properties":{"name":"edited"},"geometry":{"type":"LineString","coordinates":[[-3,40],[-3,40.0001]]}},
              {"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[-3,40]}}]}""",
        )
        assertTrue(plain is Imported.Plain)
        val p = plain as Imported.Plain
        assertEquals("edited", p.lines[0].name)
        assertEquals(11.132, p.lines[0].y[1], 1e-3)
        assertEquals(1, p.points.size)
        assertFalse(p.lines.isEmpty())
    }

    @Test
    fun namesTheFile() {
        val w = walk(null).copy(name = "Mercadona Plaza Mayor, Ávila!")
        assertEquals("walk-20260928-1030-mercadona-plaza-mayor-avila.geojson", GeoJson.fileName(w))
        assertEquals("walk-20260928-1030.geojson", GeoJson.fileName(w.copy(name = null)))
    }
}
