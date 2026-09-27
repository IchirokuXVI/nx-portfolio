package com.ichirokuxvi.shopwalk.recording

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.ichirokuxvi.shopwalk.BuildConfig
import com.ichirokuxvi.shopwalk.engine.Alignment
import com.ichirokuxvi.shopwalk.engine.Availability
import com.ichirokuxvi.shopwalk.engine.EngineOptions
import com.ichirokuxvi.shopwalk.engine.Modes
import com.ichirokuxvi.shopwalk.engine.Stream
import com.ichirokuxvi.shopwalk.engine.Track
import com.ichirokuxvi.shopwalk.engine.TrackEngine
import com.ichirokuxvi.shopwalk.engine.WalkEvent
import com.ichirokuxvi.shopwalk.engine.WalkFile
import com.ichirokuxvi.shopwalk.engine.WalkMark
import com.ichirokuxvi.shopwalk.engine.WalkOrigin
import com.ichirokuxvi.shopwalk.engine.WalkSettings
import com.ichirokuxvi.shopwalk.engine.WalkSource
import com.ichirokuxvi.shopwalk.engine.WalkStreams
import com.ichirokuxvi.shopwalk.store.WalkStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID

data class RecordConfig(
    val name: String,
    val holding: String,
    val stepMetres: Double,
    val camera: Boolean,
    /** Why camera tracking cannot run, when the person asked for it and it cannot. */
    val cameraUnavailable: String? = null,
)

/** What the recording screen draws, published twice a second. */
data class LiveState(
    val recording: Boolean = false,
    val id: String = "",
    val name: String = "",
    val elapsedMs: Double = 0.0,
    val ownSteps: Int = 0,
    val hwSteps: Int = 0,
    val modes: List<String> = emptyList(),
    val liveMode: String = Modes.pdr(com.ichirokuxvi.shopwalk.engine.StepSource.OWN, com.ichirokuxvi.shopwalk.engine.HeadingSource.GYRO, true),
    val track: Track? = null,
    val marks: List<WalkMark> = emptyList(),
    val camera: Boolean = false,
    val arState: String = "",
    val poseRows: Int = 0,
    val locationFixes: Int = 0,
    val lastAccuracy: Double? = null,
    val problems: List<String> = emptyList(),
    val savedAtMs: Double = 0.0,
    val saveError: String? = null,
)

/**
 * Records every stream of recorder plan 0002, section 2, on one clock. Lives in the
 * application object, so it outlives the activity; nothing it does throws into the UI.
 */
class Recorder(private val app: Context, private val store: WalkStore) {

    private val lock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val _state = MutableStateFlow(LiveState())
    val state: StateFlow<LiveState> = _state

    // Everything below is guarded by [lock].
    private var id = ""
    private var config = RecordConfig("", "flat", 0.7, false)
    private var startedAt = ""
    private var t0 = 0L
    private var motion: ArrayList<DoubleArray>? = null
    private var game: ArrayList<DoubleArray>? = null
    private var absolute: ArrayList<DoubleArray>? = null
    private var magnetic: ArrayList<DoubleArray>? = null
    private var steps: ArrayList<Double>? = null
    private var location: ArrayList<DoubleArray>? = null
    private var pose: ArrayList<DoubleArray>? = null
    private var pressure: ArrayList<DoubleArray>? = null
    private var origin: WalkOrigin? = null
    private val marks = ArrayList<WalkMark>()
    private val events = ArrayList<WalkEvent>()
    private var poseSource: String? = null
    private var recording = false
    private var lastGyro: FloatArray? = null
    private var gyroExpected = false
    private var firstAccelT = -1.0
    private var arState = ""

    private var sensorThread: HandlerThread? = null
    private var sensorManager: SensorManager? = null
    private val listener = Listener()
    private var fused: FusedLocationProviderClient? = null
    private var fusedCallback: LocationCallback? = null
    private var locationManager: LocationManager? = null
    private var locationListener: LocationListener? = null
    private val sensorClocks = HashMap<Int, ClockMapper>()
    private val locationClock = ClockMapper()
    private val poseClock = ClockMapper()
    private var saveJob: Job? = null
    private var liveJob: Job? = null
    private var liveEngine: TrackEngine? = null
    private val fed = IntArray(Stream.entries.size)
    private var liveMode = LiveState().liveMode

    val isRecording: Boolean get() = synchronized(lock) { recording }

    /** Milliseconds since the start, one decimal, on the elapsed realtime clock. */
    private fun tOf(elapsedNanos: Long): Double = Math.round((elapsedNanos - t0) / 1e5) / 10.0

    fun nowT(): Double = tOf(SystemClock.elapsedRealtimeNanos())

    private fun granted(p: String) = ContextCompat.checkSelfPermission(app, p) == PackageManager.PERMISSION_GRANTED

    fun start(cfg: RecordConfig) {
        synchronized(lock) {
            if (recording) return
            id = UUID.randomUUID().toString()
            config = cfg
            startedAt = OffsetDateTime.now().truncatedTo(ChronoUnit.MILLIS).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            t0 = SystemClock.elapsedRealtimeNanos()
            motion = null; game = null; absolute = null; magnetic = null; steps = null
            location = null; pose = null; pressure = null; origin = null
            marks.clear(); events.clear(); poseSource = null; lastGyro = null; arState = ""; firstAccelT = -1.0
            sensorClocks.clear()
            fed.fill(0)
            recording = true
        }
        val sm = app.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        sensorManager = sm
        val thread = HandlerThread("walk-sensors").apply { start() }
        sensorThread = thread
        val handler = Handler(thread.looper)

        fun register(type: Int, name: String, periodUs: Int, create: () -> Unit): Boolean {
            val sensor = sm.getDefaultSensor(type)
            if (sensor == null) {
                event("sensor-missing", name)
                return false
            }
            synchronized(lock) { create() }
            val ok = try {
                sm.registerListener(listener, sensor, periodUs, 0, handler)
            } catch (e: Exception) {
                false
            }
            if (!ok) event("sensor-missing", "$name (registration refused)")
            return ok
        }

        gyroExpected = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
        register(Sensor.TYPE_ACCELEROMETER, "accelerometer", 10_000) { motion = ArrayList(1 shl 14) }
        if (gyroExpected) {
            gyroExpected = try {
                sm.registerListener(listener, sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE), 10_000, 0, handler)
            } catch (e: Exception) {
                false
            }
            if (!gyroExpected) event("sensor-missing", "gyroscope (registration refused)")
        } else {
            event("sensor-missing", "gyroscope")
        }
        register(Sensor.TYPE_GAME_ROTATION_VECTOR, "game-rotation-vector", 20_000) { game = ArrayList(1 shl 13) }
        register(Sensor.TYPE_ROTATION_VECTOR, "rotation-vector", 20_000) { absolute = ArrayList(1 shl 13) }
        register(Sensor.TYPE_MAGNETIC_FIELD, "magnetic-field", 20_000) { magnetic = ArrayList(1 shl 13) }
        register(Sensor.TYPE_PRESSURE, "pressure", SensorManager.SENSOR_DELAY_NORMAL) { pressure = ArrayList() }
        val stepsAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACTIVITY_RECOGNITION)
        if (stepsAllowed) {
            register(Sensor.TYPE_STEP_DETECTOR, "step-detector", 0) { steps = ArrayList() }
        } else {
            event("permission-denied", "activity-recognition (step detector)")
        }
        startLocation(thread)
        if (cfg.camera && cfg.cameraUnavailable == null) {
            synchronized(lock) { pose = ArrayList(1 shl 12); poseSource = "arcore" }
        } else if (cfg.camera) {
            event("sensor-missing", "arcore: ${cfg.cameraUnavailable}")
        }

        synchronized(lock) {
            liveEngine = null
        }
        saveJob = scope.launch {
            while (isActive) {
                delay(10_000)
                save(true)
            }
        }
        liveJob = scope.launch {
            while (isActive) {
                try {
                    tick()
                } catch (e: Exception) {
                    Log.e(TAG, "live tick", e)
                }
                delay(500)
            }
        }
        scope.launch { save(true) }
    }

    @SuppressLint("MissingPermission")
    private fun startLocation(thread: HandlerThread) {
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (!fine && !coarse) {
            event("permission-denied", "location")
            return
        }
        if (!fine) event("permission-denied", "precise location (approximate only)")
        synchronized(lock) { location = ArrayList() }
        val playOk = try {
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(app) == ConnectionResult.SUCCESS
        } catch (e: Exception) {
            false
        }
        if (playOk) {
            try {
                val client = LocationServices.getFusedLocationProviderClient(app)
                val cb = object : LocationCallback() {
                    override fun onLocationResult(result: LocationResult) {
                        for (l in result.locations) onLocation(l)
                    }
                }
                val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
                    .setMinUpdateIntervalMillis(500)
                    .setWaitForAccurateLocation(false)
                    .build()
                client.requestLocationUpdates(req, cb, thread.looper)
                fused = client
                fusedCallback = cb
                return
            } catch (e: Exception) {
                Log.w(TAG, "fused location failed, falling back", e)
            }
        }
        try {
            val lm = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val l = LocationListener { onLocation(it) }
            var any = false
            for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (lm.allProviders.contains(p)) {
                    try {
                        lm.requestLocationUpdates(p, 1000L, 0f, l, thread.looper)
                        any = true
                    } catch (e: Exception) {
                        Log.w(TAG, "provider $p", e)
                    }
                }
            }
            if (!any) event("sensor-missing", "location provider")
            locationManager = lm
            locationListener = l
        } catch (e: Exception) {
            event("sensor-missing", "location: ${e.message}")
        }
    }

    private fun onLocation(l: Location) {
        val ts = locationClock.toElapsedRealtime(l.elapsedRealtimeNanos)
        synchronized(lock) {
            if (!recording) return
            val t = tOf(ts)
            // A fix cached from before the start belongs to no walk.
            if (t < 0) return
            val rows = location ?: return
            if (rows.isNotEmpty() && t < rows.last()[0]) return
            val acc = if (l.hasAccuracy()) Math.round(l.accuracy * 10.0) / 10.0 else -1.0
            rows.add(doubleArrayOf(t, r7(l.latitude), r7(l.longitude), acc))
            if (origin == null) origin = WalkOrigin(r7(l.latitude), r7(l.longitude), acc)
        }
    }

    private inner class Listener : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val clock = sensorClocks.getOrPut(e.sensor.type) { ClockMapper() }
            val ts = clock.toElapsedRealtime(e.timestamp)
            val v = e.values
            // A reader refuses a row with a value that is not a finite number.
            for (x in v) if (x.isNaN() || x.isInfinite()) return
            synchronized(lock) {
                if (!recording) return
                val t = tOf(ts)
                if (t < 0) return
                when (e.sensor.type) {
                    Sensor.TYPE_GYROSCOPE -> lastGyro = v.copyOf(3)
                    Sensor.TYPE_ACCELEROMETER -> {
                        val rows = motion ?: return
                        val g = lastGyro
                        if (firstAccelT < 0) firstAccelT = t
                        // Wait up to a second for the first gyroscope reading, so no row
                        // claims a zero rate; a gyroscope that stays silent longer is
                        // recorded as missing and the rows carry zero rates.
                        if (g == null && gyroExpected) {
                            if (t - firstAccelT < 1000) return
                            gyroExpected = false
                            events.add(WalkEvent(t, "sensor-missing", "gyroscope (no readings)"))
                        }
                        if (rows.isNotEmpty() && t < rows.last()[0]) return
                        rows.add(
                            doubleArrayOf(
                                t, r4(v[0]), r4(v[1]), r4(v[2]),
                                r5(g?.get(0) ?: 0f), r5(g?.get(1) ?: 0f), r5(g?.get(2) ?: 0f),
                            ),
                        )
                    }
                    Sensor.TYPE_GAME_ROTATION_VECTOR -> addQuat(game, t, v)
                    Sensor.TYPE_ROTATION_VECTOR -> addQuat(absolute, t, v)
                    Sensor.TYPE_MAGNETIC_FIELD -> magnetic?.let {
                        if (it.isEmpty() || t >= it.last()[0]) it.add(doubleArrayOf(t, r2(v[0]), r2(v[1]), r2(v[2])))
                    }
                    Sensor.TYPE_PRESSURE -> pressure?.let {
                        if (it.isEmpty() || t >= it.last()[0]) it.add(doubleArrayOf(t, Math.round(v[0] * 1000.0) / 1000.0))
                    }
                    Sensor.TYPE_STEP_DETECTOR -> steps?.let {
                        if (it.isEmpty() || t >= it.last()) it.add(t)
                    }
                }
            }
        }

        private val q = FloatArray(4)

        private fun addQuat(rows: ArrayList<DoubleArray>?, t: Double, v: FloatArray) {
            if (rows == null) return
            if (rows.isNotEmpty() && t < rows.last()[0]) return
            // getQuaternionFromVector answers [w, x, y, z]; the file wants [x, y, z, w].
            SensorManager.getQuaternionFromVector(q, v)
            rows.add(doubleArrayOf(t, r6(q[1]), r6(q[2]), r6(q[3]), r6(q[0])))
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    /** A camera pose from ARCore, while tracking. [ts] is `Frame.getTimestamp()`. */
    fun onPose(ts: Long, tx: Float, ty: Float, tz: Float, qx: Float, qy: Float, qz: Float, qw: Float) {
        val er = poseClock.toElapsedRealtime(ts)
        synchronized(lock) {
            if (!recording) return
            val rows = pose ?: return
            val t = tOf(er)
            if (t < 0) return
            if (rows.isNotEmpty() && t <= rows.last()[0]) return
            rows.add(doubleArrayOf(t, r4(tx), r4(ty), r4(tz), r6(qx), r6(qy), r6(qz), r6(qw)))
        }
    }

    /** ARCore's tracking state changed: TRACKING, PAUSED or STOPPED, with the failure reason. */
    fun onTrackingState(state: String, reason: String) {
        val previous = synchronized(lock) { arState.also { arState = state } }
        if (previous == state) return
        if (state == "TRACKING" && previous.isNotEmpty()) event("tracking-resumed", null)
        if (state != "TRACKING" && previous == "TRACKING") event("tracking-lost", reason)
    }

    fun event(kind: String, detail: String?) {
        synchronized(lock) {
            if (!recording) return
            events.add(WalkEvent(nowT(), kind, detail))
        }
    }

    fun mark(kind: String, label: String?) {
        synchronized(lock) {
            if (!recording) return
            marks.add(WalkMark(nowT(), kind, label?.trim()?.takeIf { it.isNotEmpty() }))
        }
        scope.launch { tick() }
    }

    fun setLiveMode(mode: String) {
        synchronized(lock) { liveMode = mode }
        scope.launch { tick() }
    }

    fun labels(): List<String> = synchronized(lock) {
        marks.filter { it.kind == WalkMark.CHECKPOINT }.mapNotNull { it.label }.distinct()
    }

    /** Stops every source, saves the walk for the last time and answers its id. */
    fun finish(): String? {
        val wasRecording = synchronized(lock) { recording }
        if (!wasRecording) return null
        stopSources()
        saveJob?.cancel()
        liveJob?.cancel()
        save(false)
        val finishedId = synchronized(lock) {
            recording = false
            id
        }
        _state.value = LiveState()
        return finishedId
    }

    @SuppressLint("MissingPermission")
    private fun stopSources() {
        try { sensorManager?.unregisterListener(listener) } catch (e: Exception) { Log.w(TAG, "unregister", e) }
        try { fusedCallback?.let { fused?.removeLocationUpdates(it) } } catch (e: Exception) { Log.w(TAG, "fused", e) }
        try { locationListener?.let { locationManager?.removeUpdates(it) } } catch (e: Exception) { Log.w(TAG, "lm", e) }
        fused = null; fusedCallback = null; locationManager = null; locationListener = null
        sensorThread?.quitSafely()
        sensorThread = null
    }

    private fun snapshot(): WalkFile = synchronized(lock) {
        WalkFile(
            id = id,
            name = config.name.trim().takeIf { it.isNotEmpty() },
            startedAt = startedAt,
            durationMs = nowT(),
            source = WalkSource(
                platform = "android",
                app = "shop-walk-android",
                appVersion = BuildConfig.VERSION_NAME,
                device = "${Build.MANUFACTURER} ${Build.MODEL}",
            ),
            holding = config.holding,
            settings = WalkSettings(config.stepMetres, 0.5),
            origin = origin,
            streams = WalkStreams(
                motion = motion?.let { ArrayList(it) },
                game = game?.let { ArrayList(it) },
                absolute = absolute?.let { ArrayList(it) },
                magnetic = magnetic?.let { ArrayList(it) },
                steps = steps?.toDoubleArray(),
                location = location?.let { ArrayList(it) },
                pose = pose?.let { ArrayList(it) },
                pressure = pressure?.let { ArrayList(it) },
            ),
            poseSource = poseSource,
            marks = ArrayList(marks),
            events = ArrayList(events),
        )
    }

    @Synchronized
    private fun save(stillRecording: Boolean) {
        if (!synchronized(lock) { recording }) return
        try {
            val w = snapshot()
            store.save(w, recording = stillRecording)
            _state.value = _state.value.copy(savedAtMs = w.durationMs, saveError = null)
        } catch (e: Throwable) {
            Log.e(TAG, "save", e)
            _state.value = _state.value.copy(saveError = e.message ?: e.javaClass.simpleName)
        }
    }

    /** Feeds the live engine every row up to 300 ms ago, merged by `t`, and publishes. */
    @Synchronized
    private fun tick() {
        val batch = ArrayList<Pair<Stream, DoubleArray>>()
        val watermark: Double
        val availability: Availability
        synchronized(lock) {
            if (!recording) return
            watermark = nowT() - 300.0
            availability = Availability(
                motion = motion != null,
                game = game != null,
                absolute = absolute != null,
                steps = steps != null,
                pose = pose != null,
                location = location != null,
            )
            fun take(s: Stream, rows: List<DoubleArray>?) {
                if (rows == null) return
                var i = fed[s.ordinal]
                while (i < rows.size && rows[i][0] <= watermark) { batch.add(s to rows[i]); i++ }
                fed[s.ordinal] = i
            }
            take(Stream.MOTION, motion)
            take(Stream.GAME, game)
            take(Stream.ABSOLUTE, absolute)
            steps?.let { st ->
                var i = fed[Stream.STEPS.ordinal]
                while (i < st.size && st[i] <= watermark) { batch.add(Stream.STEPS to doubleArrayOf(st[i])); i++ }
                fed[Stream.STEPS.ordinal] = i
            }
            take(Stream.LOCATION, location)
            take(Stream.POSE, pose)
        }
        batch.sortWith(compareBy({ it.second[0] }, { it.first.ordinal }))
        val engine = liveEngine ?: TrackEngine(availability, EngineOptions(stepMetres = config.stepMetres)).also { liveEngine = it }
        for ((s, r) in batch) engine.push(s, r)
        publish()
    }

    private fun publish() {
        val engine = liveEngine
        val s = synchronized(lock) {
            if (!recording) return
            val modes = engine?.modes() ?: emptyList()
            if (modes.isNotEmpty() && liveMode !in modes) liveMode = modes.first()
            val problems = events.filter { it.kind == "sensor-missing" || it.kind == "permission-denied" }
                .map { "${it.kind}: ${it.detail ?: ""}" }
            LiveState(
                recording = true,
                id = id,
                name = config.name,
                elapsedMs = nowT(),
                ownSteps = engine?.ownSteps ?: 0,
                hwSteps = steps?.size ?: 0,
                modes = modes,
                liveMode = liveMode,
                track = null,
                marks = ArrayList(marks),
                camera = pose != null,
                arState = arState,
                poseRows = pose?.size ?: 0,
                locationFixes = location?.size ?: 0,
                lastAccuracy = location?.lastOrNull()?.get(3),
                problems = problems,
                savedAtMs = _state.value.savedAtMs,
                saveError = _state.value.saveError,
            )
        }
        val track = engine?.let { e -> e.track(s.liveMode)?.let { Alignment.align(it) } }
        _state.value = s.copy(track = track)
    }

    companion object {
        private const val TAG = "ShopWalkRecorder"
        private fun r2(v: Float) = Math.round(v * 100.0) / 100.0
        private fun r4(v: Float) = Math.round(v * 1e4) / 1e4
        private fun r5(v: Float) = Math.round(v * 1e5) / 1e5
        private fun r6(v: Float) = Math.round(v * 1e6) / 1e6
        private fun r7(v: Double) = Math.round(v * 1e7) / 1e7
    }
}
