package com.ichirokuxvi.shopwalk

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.FileProvider
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.ichirokuxvi.shopwalk.engine.EngineOptions
import com.ichirokuxvi.shopwalk.engine.GeoJson
import com.ichirokuxvi.shopwalk.engine.Imported
import com.ichirokuxvi.shopwalk.engine.TrackSet
import com.ichirokuxvi.shopwalk.store.Stored
import com.ichirokuxvi.shopwalk.store.WalkMeta
import com.ichirokuxvi.shopwalk.ui.ListScreen
import com.ichirokuxvi.shopwalk.ui.RecordScreen
import com.ichirokuxvi.shopwalk.ui.ShopWalkTheme
import com.ichirokuxvi.shopwalk.ui.ViewerScreen
import com.ichirokuxvi.shopwalk.ui.defaultMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private sealed class Screen {
    data object Walks : Screen()
    data object Record : Screen()
    data class View(val id: String) : Screen()
}

class MainActivity : ComponentActivity() {

    private val app get() = application as ShopWalkApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A recording that keeps running in the background says so in the file.
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                if (app.recorder.isRecording) app.recorder.event("hidden", "app left the screen")
            }

            override fun onStart(owner: LifecycleOwner) {
                if (app.recorder.isRecording) app.recorder.event("visible", null)
            }
        })
        setContent {
            ShopWalkTheme {
                Surface(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().safeDrawingPadding()) { Root() }
                }
            }
        }
    }

    @Composable
    private fun Root() {
        val recorder = app.recorder
        val store = app.store
        val scope = rememberCoroutineScope()
        val live by recorder.state.collectAsState()
        var screen by remember { mutableStateOf<Screen>(if (recorder.isRecording) Screen.Record else Screen.Walks) }
        var walks by remember { mutableStateOf<List<WalkMeta>>(emptyList()) }
        var refresh by remember { mutableIntStateOf(0) }
        var message by remember { mutableStateOf<String?>(null) }
        // The text of a pending export, written once the person picks where.
        var pendingExport by remember { mutableStateOf<String?>(null) }

        LaunchedEffect(refresh, screen) {
            if (screen == Screen.Walks) walks = withContext(Dispatchers.IO) { store.list() }
        }

        fun toast(s: String) = Toast.makeText(this@MainActivity, s, Toast.LENGTH_LONG).show()

        val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch {
                message = try {
                    withContext(Dispatchers.IO) { importFile(uri) }
                } catch (e: Throwable) {
                    "Import failed: ${e.message ?: e.javaClass.simpleName}"
                }
                refresh++
            }
        }
        val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/geo+json")) { uri: Uri? ->
            val text = pendingExport
            pendingExport = null
            if (uri == null || text == null) return@rememberLauncherForActivityResult
            scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        contentResolver.openOutputStream(uri, "wt")!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                    }
                    toast("Exported")
                } catch (e: Throwable) {
                    toast("Export failed: ${e.message}")
                }
            }
        }

        fun export(id: String, mode: String?) {
            scope.launch {
                try {
                    val (name, text) = withContext(Dispatchers.Default) { geoJsonFor(id, mode) }
                    pendingExport = text
                    exporter.launch(name)
                } catch (e: Throwable) {
                    toast("Export failed: ${e.message}")
                }
            }
        }

        fun share(id: String, mode: String?) {
            scope.launch {
                try {
                    val uri = withContext(Dispatchers.Default) {
                        val (name, text) = geoJsonFor(id, mode)
                        val dir = File(cacheDir, "exports").apply { mkdirs() }
                        dir.listFiles()?.forEach { it.delete() }
                        val f = File(dir, name)
                        f.writeText(text)
                        FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                    }
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, "Share walk"))
                } catch (e: Throwable) {
                    toast("Share failed: ${e.message}")
                }
            }
        }

        when (val s = screen) {
            Screen.Walks -> ListScreen(
                walks = walks,
                recordingId = if (live.recording) live.id else null,
                message = message,
                onRecord = { message = null; screen = Screen.Record },
                onImport = { importer.launch(arrayOf("*/*")) },
                onOpen = { screen = Screen.View(it.id) },
                onExport = { export(it.id, null) },
                onShare = { share(it.id, null) },
                onDelete = { w ->
                    scope.launch {
                        withContext(Dispatchers.IO) { store.delete(w.id) }
                        refresh++
                    }
                },
            )
            Screen.Record -> RecordScreen(
                recorder = recorder,
                labels = app.labels,
                onFinish = {
                    scope.launch {
                        val id = withContext(Dispatchers.IO) { recorder.finish() }
                        screen = if (id != null) Screen.View(id) else Screen.Walks
                    }
                },
                onBack = { screen = Screen.Walks },
            )
            is Screen.View -> ViewerScreen(
                store = store,
                id = s.id,
                onBack = { screen = Screen.Walks },
                onExport = { id, mode -> export(id, mode) },
                onShare = { id, mode -> share(id, mode) },
            )
        }
    }

    /** Recomputes every mode with the file's own settings and writes section 3's GeoJSON. */
    private fun geoJsonFor(id: String, mode: String?): Pair<String, String> {
        val stored = app.store.load(id) as? Stored.Walk ?: throw IllegalStateException("Only a walk can be exported")
        val walk = stored.walk
        val set = TrackSet.compute(walk, EngineOptions.forWalk(walk))
        val selected = mode ?: defaultMode(set.tracks.map { it.mode })
        return GeoJson.fileName(walk) to GeoJson.exportString(set, selected)
    }

    private fun importFile(uri: Uri): String {
        val text = contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
        return when (val imported = GeoJson.import(text)) {
            is Imported.Walk -> {
                val existed = app.store.exists(imported.walk.id)
                app.store.save(imported.walk)
                val name = imported.walk.name ?: "(no name)"
                if (existed) "Replaced \"$name\" with the imported copy" else "Imported \"$name\" from ${imported.walk.source.platform}"
            }
            is Imported.Plain -> {
                val name = uri.lastPathSegment?.substringAfterLast('/') ?: "GeoJSON"
                app.store.savePlain(name, text)
                "Imported \"$name\": a GeoJSON without a walk, drawn as it is"
            }
        }
    }
}
