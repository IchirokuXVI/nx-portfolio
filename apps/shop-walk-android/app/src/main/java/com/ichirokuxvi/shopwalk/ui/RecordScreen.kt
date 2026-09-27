package com.ichirokuxvi.shopwalk.ui

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.opengl.GLSurfaceView
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.ichirokuxvi.shopwalk.LabelMemory
import com.ichirokuxvi.shopwalk.engine.Metrics
import com.ichirokuxvi.shopwalk.engine.WalkMark
import com.ichirokuxvi.shopwalk.recording.ArCameraRenderer
import com.ichirokuxvi.shopwalk.recording.ArSupport
import com.ichirokuxvi.shopwalk.recording.RecordConfig
import com.ichirokuxvi.shopwalk.recording.Recorder
import kotlinx.coroutines.delay

@Composable
fun RecordScreen(recorder: Recorder, labels: LabelMemory, onFinish: () -> Unit, onBack: () -> Unit) {
    val live by recorder.state.collectAsState()
    if (live.recording) {
        LiveRecording(recorder, labels, onFinish)
    } else {
        RecordSetup(recorder, onBack)
    }
}

@Composable
private fun RecordSetup(recorder: Recorder, onBack: () -> Unit) {
    val context = LocalContext.current
    val activity = context as Activity
    var name by rememberSaveable { mutableStateOf("") }
    var holding by rememberSaveable { mutableStateOf("flat") }
    var stepText by rememberSaveable { mutableStateOf("0.70") }
    var camera by rememberSaveable { mutableStateOf(false) }
    var arStatus by remember { mutableStateOf(ArSupport.Status.CHECKING) }
    var arMessage by remember { mutableStateOf<String?>(null) }
    var resumeCount by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) resumeCount++ }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(resumeCount) {
        repeat(20) {
            arStatus = ArSupport.check(context)
            if (arStatus != ArSupport.Status.CHECKING) return@LaunchedEffect
            delay(300)
        }
    }

    val permissions = remember(camera) {
        buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(Manifest.permission.ACTIVITY_RECOGNITION)
            if (camera) add(Manifest.permission.CAMERA)
        }.toTypedArray()
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val cameraGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val arReady = arStatus == ArSupport.Status.SUPPORTED_INSTALLED
        val step = stepText.replace(',', '.').toDoubleOrNull()?.takeIf { it in 0.2..1.5 } ?: 0.7
        recorder.start(RecordConfig(name, holding, step, camera && cameraGranted && arReady))
        if (camera && !cameraGranted) recorder.event("permission-denied", "camera")
        else if (camera && !arReady) recorder.event("sensor-missing", "arcore: ${arStatus.name.lowercase()}")
    }

    BackHandler(onBack = onBack)
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("New walk", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Shop name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("How do you hold the phone?", fontSize = 18.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((id, label) in listOf("flat" to "Flat", "upright" to "Upright")) {
                BigButton(
                    label,
                    Modifier.weight(1f),
                    color = if (holding == id) MaterialTheme.colorScheme.primary else Color(0xFF9E9E9E),
                ) { holding = id }
            }
        }
        Text("Step length (metres)", fontSize = 18.sp)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton("−", Modifier.width(72.dp)) {
                val v = (stepText.replace(',', '.').toDoubleOrNull() ?: 0.7) - 0.05
                stepText = "%.2f".format(java.util.Locale.ROOT, v.coerceIn(0.3, 1.2))
            }
            OutlinedTextField(
                value = stepText,
                onValueChange = { stepText = it },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f),
                textStyle = MaterialTheme.typography.headlineSmall,
            )
            BigButton("+", Modifier.width(72.dp)) {
                val v = (stepText.replace(',', '.').toDoubleOrNull() ?: 0.7) + 0.05
                stepText = "%.2f".format(java.util.Locale.ROOT, v.coerceIn(0.3, 1.2))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Camera tracking (ARCore)", fontSize = 18.sp)
                val s = when (arStatus) {
                    ArSupport.Status.CHECKING -> "checking this phone…"
                    ArSupport.Status.SUPPORTED_INSTALLED -> "ready"
                    ArSupport.Status.NEEDS_INSTALL -> "needs Google Play Services for AR: switching on installs it"
                    ArSupport.Status.UNSUPPORTED -> "not supported on this phone"
                }
                Text(arMessage ?: s, fontSize = 14.sp, color = Color.DarkGray)
            }
            Switch(
                checked = camera,
                enabled = arStatus != ArSupport.Status.UNSUPPORTED,
                onCheckedChange = { on ->
                    camera = on
                    arMessage = null
                    if (on && arStatus == ArSupport.Status.NEEDS_INSTALL) {
                        try {
                            if (ArSupport.requestInstall(activity)) arStatus = ArSupport.Status.SUPPORTED_INSTALLED
                        } catch (e: Throwable) {
                            camera = false
                            arMessage = "Could not install ARCore: ${e.message ?: e.javaClass.simpleName}"
                        }
                    }
                },
            )
        }
        Spacer(Modifier.height(8.dp))
        BigButton("Start", Modifier.fillMaxWidth(), minHeight = 80) { launcher.launch(permissions) }
        Text(
            "Start asks for location, physical activity (the step counter) and, with tracking on, the camera. " +
                "Anything refused is written into the walk and the rest still records.",
            fontSize = 14.sp,
            color = Color.DarkGray,
        )
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Back to walks") }
    }
}

@Composable
private fun LiveRecording(recorder: Recorder, labels: LabelMemory, onFinish: () -> Unit) {
    val live by recorder.state.collectAsState()
    val haptics = LocalHapticFeedback.current
    var dialog by remember { mutableStateOf<String?>(null) }
    var lastMark by remember { mutableStateOf<String?>(null) }
    var arStatus by remember { mutableStateOf("starting") }

    // The screen stays on while recording.
    val view = LocalView.current
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
    BackHandler { dialog = "finish" }

    fun mark(kind: String, label: String? = null) {
        recorder.mark(kind, label)
        if (kind == WalkMark.CHECKPOINT && label != null) labels.remember(label)
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        lastMark = "${kind}${label?.let { " \"$it\"" } ?: ""} at ${formatDuration(recorder.nowT())}"
    }

    Column(Modifier.fillMaxSize().padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(formatDuration(live.elapsedMs), fontSize = 44.sp, fontWeight = FontWeight.Bold)
                Text("Steps ${live.ownSteps} · hardware ${live.hwSteps}", fontSize = 18.sp)
                val gps = if (live.locationFixes > 0) "location ${live.locationFixes} fixes ±${formatMetres(live.lastAccuracy)} m" else "no location fix yet"
                Text(gps, fontSize = 13.sp, color = Color.DarkGray)
                if (live.camera) Text("camera: $arStatus · ${live.poseRows} poses", fontSize = 13.sp, color = Color.DarkGray)
                Text(
                    live.saveError?.let { "SAVE FAILED: $it" } ?: "saved at ${formatDuration(live.savedAtMs)}",
                    fontSize = 13.sp,
                    color = if (live.saveError != null) MaterialTheme.colorScheme.error else Color.DarkGray,
                )
            }
            if (live.camera) {
                ArPreview(recorder, Modifier.size(width = 120.dp, height = 160.dp)) { arStatus = it }
            }
        }
        if (live.problems.isNotEmpty()) {
            Text(live.problems.joinToString(" · "), fontSize = 12.sp, color = Color(0xFF6D4C41), maxLines = 2)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (m in live.modes) {
                FilterChip(selected = m == live.liveMode, onClick = { recorder.setLiveMode(m) }, label = { Text(m) })
            }
        }
        val track = live.track
        val lines = remember(track) {
            if (track == null) emptyList() else listOf(DrawLine(track.mode, track.x, track.y, colorFor(track.mode), bold = true))
        }
        val marks = remember(track, live.marks) {
            if (track == null || track.size == 0) emptyList() else live.marks.map { m ->
                val k = Metrics.positionAt(track, m.t)
                DrawMark(track.x[k], track.y[k], m.label ?: m.kind, markColor(m.kind))
            }
        }
        TrackCanvas(lines, marks, emptySet(), 0.5, Modifier.fillMaxWidth().weight(1f), follow = true)
        Text(lastMark?.let { "Last mark: $it" } ?: "No marks yet", fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton("Entrance", Modifier.weight(1f), color = markColor(WalkMark.ENTRANCE), minHeight = 76) { mark(WalkMark.ENTRANCE) }
            BigButton("Checkout", Modifier.weight(1f), color = markColor(WalkMark.CHECKOUT), minHeight = 76) { mark(WalkMark.CHECKOUT) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton("Checkpoint", Modifier.weight(1f), color = markColor(WalkMark.CHECKPOINT), minHeight = 76) { dialog = "checkpoint" }
            BigButton("Note", Modifier.weight(1f), color = markColor(WalkMark.NOTE), minHeight = 76) { dialog = "note" }
        }
        BigButton("Finish", Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.error, minHeight = 60) { dialog = "finish" }
    }

    when (dialog) {
        "checkpoint" -> LabelDialog(
            title = "Checkpoint",
            offered = (recorder.labels() + labels.recent()).distinct(),
            placeholder = "door, fish counter…",
            onDismiss = { dialog = null },
        ) { label -> dialog = null; mark(WalkMark.CHECKPOINT, label) }
        "note" -> LabelDialog("Note", emptyList(), "what is here", onDismiss = { dialog = null }) { text ->
            dialog = null
            mark(WalkMark.NOTE, text)
        }
        "finish" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("Finish this walk?") },
            text = { Text("Recording stops and the walk opens in the viewer.") },
            confirmButton = { TextButton(onClick = { dialog = null; onFinish() }) { Text("Finish", fontSize = 18.sp) } },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Keep recording", fontSize = 18.sp) } },
        )
    }
}

fun markColor(kind: String): Color = when (kind) {
    WalkMark.ENTRANCE -> Color(0xFF2E7D32)
    WalkMark.CHECKOUT -> Color(0xFF6A1B9A)
    WalkMark.CHECKPOINT -> Color(0xFF1565C0)
    else -> Color(0xFF5D4037)
}

@Composable
private fun LabelDialog(
    title: String,
    offered: List<String>,
    placeholder: String,
    onDismiss: () -> Unit,
    onDone: (String) -> Unit,
) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (l in offered) {
                    BigButton(l, Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.secondary, minHeight = 56) { onDone(l) }
                }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    placeholder = { Text(placeholder) },
                    label = { Text(if (offered.isEmpty()) "Text" else "Or a new one") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = text.isNotBlank(), onClick = { onDone(text.trim()) }) { Text("Mark", fontSize = 18.sp) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", fontSize = 18.sp) } },
    )
}

/** A small camera preview that runs the ARCore session and feeds its poses to the recorder. */
@Composable
private fun ArPreview(recorder: Recorder, modifier: Modifier, onStatus: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val main = remember { Handler(Looper.getMainLooper()) }
    var failed by remember { mutableStateOf<String?>(null) }
    val renderer = remember { ArCameraRenderer(context, recorder) { s -> main.post { onStatus(s) } } }
    val glView = remember {
        GLSurfaceView(context).apply {
            preserveEGLContextOnPause = true
            setEGLContextClientVersion(2)
            setEGLConfigChooser(8, 8, 8, 8, 16, 0)
            setRenderer(renderer)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
    }
    DisposableEffect(lifecycle) {
        val err = renderer.create()
        if (err != null) {
            failed = err
            recorder.event("sensor-missing", "arcore: $err")
            onStatus("unavailable")
        }
        var running = false
        fun resume() {
            if (running || failed != null) return
            val e = renderer.resume()
            if (e != null) {
                failed = e
                recorder.event("sensor-missing", "arcore: $e")
                onStatus("unavailable")
                return
            }
            glView.onResume()
            running = true
        }
        fun pause() {
            if (!running) return
            glView.onPause()
            renderer.pause()
            running = false
        }
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_RESUME -> resume()
                Lifecycle.Event.ON_PAUSE -> pause()
                else -> Unit
            }
        }
        lifecycle.addObserver(obs)
        onDispose {
            lifecycle.removeObserver(obs)
            pause()
            renderer.close()
        }
    }
    Box(modifier) {
        if (failed == null) {
            AndroidView(factory = { glView }, modifier = Modifier.fillMaxSize())
        } else {
            Text("camera off:\n$failed", fontSize = 11.sp, color = Color.Gray)
        }
    }
}
