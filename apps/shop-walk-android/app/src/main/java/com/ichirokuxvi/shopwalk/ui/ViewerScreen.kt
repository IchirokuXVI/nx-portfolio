package com.ichirokuxvi.shopwalk.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ichirokuxvi.shopwalk.engine.EngineOptions
import com.ichirokuxvi.shopwalk.engine.Metrics
import com.ichirokuxvi.shopwalk.engine.Modes
import com.ichirokuxvi.shopwalk.engine.StepModel
import com.ichirokuxvi.shopwalk.engine.TrackSet
import com.ichirokuxvi.shopwalk.engine.WalkFile
import com.ichirokuxvi.shopwalk.store.Stored
import com.ichirokuxvi.shopwalk.store.WalkStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** The mode the viewer selects first: the recorder of plan 0001 when the walk has it. */
fun defaultMode(modes: List<String>): String? =
    listOf("pdr:own:gyro:snap", "pdr:hw:gyro:snap", "pdr:own:game:snap", "vio").firstOrNull { it in modes } ?: modes.firstOrNull()

@Composable
fun ViewerScreen(
    store: WalkStore,
    id: String,
    onBack: () -> Unit,
    onExport: (String, String?) -> Unit,
    onShare: (String, String?) -> Unit,
) {
    var stored by remember { mutableStateOf<Stored?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    BackHandler(onBack = onBack)
    LaunchedEffect(id) {
        try {
            stored = withContext(Dispatchers.IO) { store.load(id) }
        } catch (e: Throwable) {
            error = "Could not open this walk: ${e.message ?: e.javaClass.simpleName}"
        }
    }
    Column(Modifier.fillMaxSize()) {
        when (val s = stored) {
            null -> {
                Header("Walk", onBack, null, null)
                if (error != null) Text(error!!, Modifier.padding(16.dp)) else LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            is Stored.Walk -> WalkViewer(s.walk, onBack, onExport, onShare)
            is Stored.Plain -> PlainViewer(s, onBack)
        }
    }
}

@Composable
private fun Header(title: String, onBack: () -> Unit, onExport: (() -> Unit)?, onShare: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        SmallButton("Back") { onBack() }
        Text(title, Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        if (onExport != null) SmallButton("Export") { onExport() }
        if (onShare != null) SmallButton("Share") { onShare() }
    }
}

@Composable
private fun WalkViewer(
    walk: WalkFile,
    onBack: () -> Unit,
    onExport: (String, String?) -> Unit,
    onShare: (String, String?) -> Unit,
) {
    var stepModel by remember { mutableStateOf(StepModel.FIXED) }
    var lengthText by remember { mutableStateOf("%.2f".format(java.util.Locale.ROOT, walk.settings.stepMetres)) }
    var kText by remember { mutableStateOf("0.48") }
    var set by remember { mutableStateOf<TrackSet?>(null) }
    var computing by remember { mutableStateOf(true) }
    val hidden = remember { mutableStateMapOf<String, Boolean>() }
    var selected by remember { mutableStateOf<String?>(null) }
    var mapMode by remember { mutableStateOf<String?>(null) }
    var mapOn by remember { mutableStateOf(true) }

    val length = lengthText.replace(',', '.').toDoubleOrNull()?.takeIf { it in 0.1..2.0 } ?: walk.settings.stepMetres
    val k = kText.replace(',', '.').toDoubleOrNull()?.takeIf { it in 0.05..2.0 } ?: 0.48
    val options = EngineOptions(stepModel = stepModel, stepMetres = length, weinbergK = k)

    LaunchedEffect(options) {
        computing = true
        delay(150)
        val result = withContext(Dispatchers.Default) { TrackSet.compute(walk, options) }
        set = result
        val modes = result.tracks.map { it.mode }
        if (selected == null || selected !in modes) selected = defaultMode(modes)
        if (mapMode == null || mapMode !in modes) mapMode = modes.firstOrNull { Modes.isSnap(it) }
        computing = false
    }

    Header(walk.name ?: "(no name)", onBack, { onExport(walk.id, selected) }, { onShare(walk.id, selected) })
    if (computing) LinearProgressIndicator(Modifier.fillMaxWidth()) else HorizontalDivider()
    val s = set ?: return
    val visible = s.tracks.filter { hidden[it.mode] != true }
    val lines = remember(s, hidden.toMap(), selected) {
        visible.map { DrawLine(it.mode, it.x, it.y, colorFor(it.mode), bold = it.mode == selected) }
    }
    val selTrack = selected?.let { s.track(it) }
    val marks = remember(s, selected) {
        if (selTrack == null || selTrack.size == 0) emptyList() else walk.marks.map { m ->
            val i = Metrics.positionAt(selTrack, m.t)
            DrawMark(selTrack.x[i], selTrack.y[i], m.label ?: m.kind, markColor(m.kind))
        }
    }
    val cells = remember(s, mapMode, mapOn) {
        val t = mapMode?.let { s.track(it) }
        if (!mapOn || t == null) emptySet() else walkedCells(t.x, t.y, walk.settings.cellMetres)
    }
    Column(Modifier.fillMaxSize()) {
        TrackCanvas(lines, marks, cells, walk.settings.cellMetres, Modifier.fillMaxWidth().weight(1.1f), fitKey = s)
        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Modes: tick to draw, choose one for the marks", fontWeight = FontWeight.Bold)
            for (t in s.tracks) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { selected = t.mode }) {
                    Checkbox(checked = hidden[t.mode] != true, onCheckedChange = { hidden[t.mode] = !it })
                    Box(Modifier.size(width = 22.dp, height = 8.dp).background(colorFor(t.mode)))
                    Text(" ${t.mode}", Modifier.weight(1f), fontSize = 15.sp)
                    RadioButton(selected = selected == t.mode, onClick = { selected = t.mode })
                }
            }
            HorizontalDivider()
            Text("Map layer: the cells a snap mode walked", fontWeight = FontWeight.Bold)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(selected = !mapOn, onClick = { mapOn = !mapOn }, label = { Text("off") })
                for (t in s.tracks.filter { Modes.isSnap(it.mode) }) {
                    FilterChip(selected = mapOn && mapMode == t.mode, onClick = { mapMode = t.mode; mapOn = true }, label = { Text(t.mode) })
                }
            }
            HorizontalDivider()
            Text("Step length", fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (m in StepModel.entries) {
                    FilterChip(selected = stepModel == m, onClick = { stepModel = m }, label = { Text(m.id, fontSize = 16.sp) })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = lengthText, onValueChange = { lengthText = it }, singleLine = true,
                    label = { Text("fixed length m") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = kText, onValueChange = { kText = it }, singleLine = true,
                    label = { Text("Weinberg K") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                )
            }
            HorizontalDivider()
            MetricsTable(s)
            HorizontalDivider()
            WalkInfo(walk, s)
        }
    }
}

@Composable
private fun MetricsTable(s: TrackSet) {
    Text("Metrics (metres)", fontWeight = FontWeight.Bold)
    val labels = s.metrics.flatMap { it.checkpointErrors.keys }.distinct()
    Column(Modifier.horizontalScroll(rememberScrollState())) {
        val header = listOf("mode", "steps", "turns", "dist", "end-start") + labels.map { "cp $it" }
        TableRow(header, bold = true)
        for (m in s.metrics) {
            TableRow(
                listOf(
                    m.mode,
                    m.steps.toString(),
                    if (Modes.isSnap(m.mode)) m.turns.toString() else "–",
                    formatMetres(m.distanceMetres),
                    formatMetres(m.endToStartMetres),
                ) + labels.map { formatMetres(m.checkpointErrors[it]) },
                color = colorFor(m.mode),
            )
        }
    }
    if (labels.isEmpty()) {
        Text("Checkpoint error needs a checkpoint label marked at least twice.", fontSize = 13.sp, color = Color.DarkGray)
    }
}

@Composable
private fun TableRow(cells: List<String>, bold: Boolean = false, color: Color? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (color != null) Box(Modifier.size(width = 6.dp, height = 18.dp).background(color)) else Box(Modifier.width(6.dp))
        cells.forEachIndexed { i, c ->
            Text(
                c,
                Modifier.width(if (i == 0) 170.dp else 74.dp).padding(horizontal = 4.dp, vertical = 3.dp),
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun WalkInfo(walk: WalkFile, s: TrackSet) {
    Text("Walk", fontWeight = FontWeight.Bold)
    val st = walk.streams
    val info = buildList {
        add("${formatDate(walk.startedAt)} · ${formatDuration(walk.durationMs)} · held ${walk.holding ?: "?"}")
        add("${walk.source.platform} ${walk.source.app} ${walk.source.appVersion} ${walk.source.device ?: walk.source.userAgent ?: ""}")
        add("origin: ${walk.origin?.let { "%.6f, %.6f ±%.0f m".format(it.lat, it.lon, it.accuracyMetres) } ?: "none"} · bearing ${"%.1f".format(s.bearingDeg)}°")
        add(
            "rows: motion ${st.motion?.size ?: "–"}, game ${st.game?.size ?: "–"}, absolute ${st.absolute?.size ?: "–"}, " +
                "magnetic ${st.magnetic?.size ?: "–"}, steps ${st.steps?.size ?: "–"}, location ${st.location?.size ?: "–"}, " +
                "pose ${st.pose?.size ?: "–"}${walk.poseSource?.let { " ($it)" } ?: ""}, pressure ${st.pressure?.size ?: "–"}",
        )
        for (m in walk.marks) add("${formatDuration(m.t)} ${m.kind}${m.label?.let { ": $it" } ?: ""}")
        for (e in walk.events) add("${formatDuration(e.t)} event ${e.kind}${e.detail?.let { ": $it" } ?: ""}")
    }
    for (line in info) Text(line, fontSize = 13.sp)
}

@Composable
private fun PlainViewer(p: Stored.Plain, onBack: () -> Unit) {
    val hidden = remember { mutableStateMapOf<String, Boolean>() }
    val palette = modeColors
    val lines = remember(p, hidden.toMap()) {
        p.plain.lines.mapIndexedNotNull { i, l ->
            if (hidden["$i"] == true) null else DrawLine("$i", l.x, l.y, if (l.name in Modes.ALL) colorFor(l.name) else palette[i % palette.size])
        }
    }
    val marks = remember(p) { p.plain.points.map { DrawMark(it.x, it.y, it.name, Color(0xFF1565C0)) } }
    Header(p.name, onBack, null, null)
    Column(Modifier.fillMaxSize()) {
        TrackCanvas(lines, marks, emptySet(), 0.5, Modifier.fillMaxWidth().weight(1.3f), fitKey = p)
        Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()).padding(8.dp)) {
            Text("A GeoJSON without a walk: drawn as it is, nothing to replay.", fontSize = 13.sp)
            p.plain.lines.forEachIndexed { i, l ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = hidden["$i"] != true, onCheckedChange = { hidden["$i"] = !it })
                    Text(l.name)
                }
            }
        }
    }
}
