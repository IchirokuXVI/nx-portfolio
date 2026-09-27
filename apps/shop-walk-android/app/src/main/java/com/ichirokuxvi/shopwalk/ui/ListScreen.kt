package com.ichirokuxvi.shopwalk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ichirokuxvi.shopwalk.store.WalkMeta
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

@Composable
fun ListScreen(
    walks: List<WalkMeta>,
    recordingId: String?,
    message: String?,
    onRecord: () -> Unit,
    onImport: () -> Unit,
    onOpen: (WalkMeta) -> Unit,
    onExport: (WalkMeta) -> Unit,
    onShare: (WalkMeta) -> Unit,
    onDelete: (WalkMeta) -> Unit,
) {
    var confirmDelete by remember { mutableStateOf<WalkMeta?>(null) }
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Shop walk", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton(if (recordingId != null) "Back to recording" else "Record", Modifier.weight(1.4f), onClick = onRecord)
            BigButton("Import", Modifier.weight(1f), color = MaterialTheme.colorScheme.secondary, onClick = onImport)
        }
        if (message != null) {
            Text(message, Modifier.padding(top = 8.dp), color = Color(0xFF6D4C41))
        }
        Spacer(Modifier.height(8.dp))
        if (walks.isEmpty()) {
            Text("No walks yet. Tap Record to start one, or Import a file from the web lab.", Modifier.padding(top = 16.dp))
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(walks, key = { it.id }) { w ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(w.name.ifBlank { "(no name)" }, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        val status = when {
                            w.id == recordingId -> " · recording now"
                            w.recording -> " · interrupted, kept up to the last save"
                            else -> ""
                        }
                        val details = if (w.kind == "plain") {
                            "GeoJSON without a walk, drawn as it is"
                        } else {
                            "${formatDate(w.startedAt)} · ${formatDuration(w.durationMs)} · ${w.platform} · " +
                                "${w.marks} marks · ${w.bytes / 1024} KB"
                        }
                        Text(details + status, fontSize = 14.sp, color = Color.DarkGray)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            SmallButton("Open", Modifier.weight(1f)) { onOpen(w) }
                            if (w.kind != "plain") {
                                SmallButton("Export", Modifier.weight(1f)) { onExport(w) }
                                SmallButton("Share", Modifier.weight(1f)) { onShare(w) }
                            }
                            if (w.id != recordingId) SmallButton("Delete", Modifier.weight(1f)) { confirmDelete = w }
                        }
                    }
                }
            }
        }
    }
    confirmDelete?.let { w ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete this walk?") },
            text = { Text("\"${w.name.ifBlank { "(no name)" }}\" is removed from this phone. Exported files are not touched.") },
            confirmButton = {
                TextButton(onClick = { confirmDelete = null; onDelete(w) }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Keep") } },
        )
    }
}

fun formatDate(iso: String): String = try {
    OffsetDateTime.parse(iso).format(DateTimeFormatter.ofPattern("d MMM yyyy HH:mm"))
} catch (e: Exception) {
    iso
}
