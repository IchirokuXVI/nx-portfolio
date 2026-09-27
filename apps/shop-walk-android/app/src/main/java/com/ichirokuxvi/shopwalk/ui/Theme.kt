package com.ichirokuxvi.shopwalk.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val scheme = lightColorScheme(
    primary = Color(0xFF1B5E20),
    onPrimary = Color.White,
    secondary = Color(0xFF0D47A1),
    error = Color(0xFFB71C1C),
)

@Composable
fun ShopWalkTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}

/** One colour per mode, in the order of [com.ichirokuxvi.shopwalk.engine.Modes.ALL]. */
val modeColors = listOf(
    Color(0xFFE53935), Color(0xFFEF9A9A),
    Color(0xFF1E88E5), Color(0xFF90CAF9),
    Color(0xFF43A047), Color(0xFFA5D6A7),
    Color(0xFF8E24AA), Color(0xFFCE93D8),
    Color(0xFFFB8C00), Color(0xFFFFCC80),
    Color(0xFF00897B), Color(0xFF80CBC4),
    Color(0xFF212121), Color(0xFF795548),
)

fun colorFor(mode: String): Color {
    val i = com.ichirokuxvi.shopwalk.engine.Modes.ALL.indexOf(mode)
    return if (i >= 0) modeColors[i % modeColors.size] else Color(0xFF607D8B)
}

/** A big button for one hand use. */
@Composable
fun BigButton(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    enabled: Boolean = true,
    minHeight: Int = 64,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = minHeight.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SmallButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = 48.dp),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, fontSize = 15.sp)
    }
}

@Suppress("unused")
fun Modifier.full() = this.fillMaxWidth()

fun formatDuration(ms: Double): String {
    val total = (ms / 1000).toLong().coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
}

fun formatMetres(m: Double?): String = when {
    m == null -> "–"
    m >= 100 -> "%.0f".format(m)
    else -> "%.1f".format(m)
}
