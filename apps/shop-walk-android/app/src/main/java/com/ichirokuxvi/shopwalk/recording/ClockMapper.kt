package com.ichirokuxvi.shopwalk.recording

import android.os.SystemClock
import kotlin.math.abs

/**
 * Puts a timestamp from any source on the elapsed realtime clock (CLOCK_BOOTTIME), the
 * clock `SensorEvent.timestamp` and `Location.elapsedRealtimeNanos` use.
 *
 * Some sources are on another base: a few devices stamp sensor events with the monotonic
 * clock (`System.nanoTime`), and ARCore leaves `Frame.getTimestamp` formally undefined.
 * So on a source's first sample the mapper checks which clock the timestamp is closer to
 * now, and from then on adds the offset between the two clocks when it was the monotonic
 * one. The two clocks only differ by the time the phone spent in deep sleep, so a source on
 * either base lands within a frame of the truth.
 */
class ClockMapper {
    private var offset: Long? = null

    fun toElapsedRealtime(ts: Long): Long {
        val o = offset ?: run {
            val er = SystemClock.elapsedRealtimeNanos()
            val mono = System.nanoTime()
            val v = if (abs(ts - er) <= abs(ts - mono)) 0L else er - mono
            offset = v
            v
        }
        return ts + o
    }
}
