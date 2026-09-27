package com.ichirokuxvi.shopwalk.ui

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** A line to draw, in metres, y up. */
class DrawLine(val key: String, val x: DoubleArray, val y: DoubleArray, val color: Color, val bold: Boolean = false)

class DrawMark(val x: Double, val y: Double, val text: String, val color: Color)

/**
 * Tracks over a grid of [cellMetres], with shaded cells, marks, pinch zoom and pan. With
 * [follow] the view refits whenever the content grows, which the live recording uses.
 */
@Composable
fun TrackCanvas(
    lines: List<DrawLine>,
    marks: List<DrawMark>,
    cells: Set<Long>,
    cellMetres: Double,
    modifier: Modifier = Modifier,
    follow: Boolean = false,
    fitKey: Any? = null,
) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    var scale by remember { mutableFloatStateOf(0f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val textPaint = remember {
        Paint().apply {
            isAntiAlias = true
            textSize = 34f
            color = android.graphics.Color.BLACK
        }
    }

    fun fit() {
        if (size.width == 0) return
        var minX = -1.0; var maxX = 1.0; var minY = -1.0; var maxY = 1.0
        for (l in lines) for (k in l.x.indices) {
            minX = min(minX, l.x[k]); maxX = max(maxX, l.x[k])
            minY = min(minY, l.y[k]); maxY = max(maxY, l.y[k])
        }
        for (m in marks) {
            minX = min(minX, m.x); maxX = max(maxX, m.x); minY = min(minY, m.y); maxY = max(maxY, m.y)
        }
        val w = (maxX - minX).coerceAtLeast(2.0)
        val h = (maxY - minY).coerceAtLeast(2.0)
        val s = (min(size.width / w, size.height / h) * 0.88).toFloat()
        scale = s
        val cx = ((minX + maxX) / 2).toFloat()
        val cy = ((minY + maxY) / 2).toFloat()
        offset = Offset(size.width / 2f - cx * s, size.height / 2f + cy * s)
    }

    androidx.compose.runtime.LaunchedEffect(size, fitKey, if (follow) lines else Unit) { fit() }

    Box(modifier.background(Color(0xFFFAFAFA))) {
        Canvas(
            Modifier
                .fillMaxSize()
                .onSizeChanged { size = it }
                .pointerInput(Unit) {
                    detectTransformGestures { centroid, pan, zoom, _ ->
                        val newScale = (scale * zoom).coerceIn(0.5f, 2000f)
                        val k = newScale / scale
                        offset = Offset(
                            centroid.x - (centroid.x - offset.x) * k + pan.x,
                            centroid.y - (centroid.y - offset.y) * k + pan.y,
                        )
                        scale = newScale
                    }
                }
                .pointerInput(lines, marks, size) {
                    detectTapGestures(onDoubleTap = { fit() })
                },
        ) {
            if (scale <= 0f) return@Canvas
            drawGrid(cellMetres, scale, offset, this.size)
            // The basic map: the cells the selected snap mode walked.
            val cellPx = (cellMetres * scale).toFloat()
            for (c in cells) {
                val i = (c shr 32).toInt()
                val j = c.toInt()
                val sx = offset.x + (i * cellMetres * scale).toFloat()
                val sy = offset.y - ((j + 1) * cellMetres * scale).toFloat()
                drawRect(Color(0x552E7D32), Offset(sx, sy), Size(cellPx, cellPx))
            }
            for (l in lines) {
                if (l.x.isEmpty()) continue
                val p = Path()
                p.moveTo(offset.x + (l.x[0] * scale).toFloat(), offset.y - (l.y[0] * scale).toFloat())
                for (k in 1 until l.x.size) {
                    p.lineTo(offset.x + (l.x[k] * scale).toFloat(), offset.y - (l.y[k] * scale).toFloat())
                }
                drawPath(
                    p, l.color,
                    style = Stroke(width = if (l.bold) 7f else 4f, cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
            }
            // The start.
            drawCircle(Color.Black, 9f, offset)
            for (m in marks) {
                val c = Offset(offset.x + (m.x * scale).toFloat(), offset.y - (m.y * scale).toFloat())
                drawCircle(Color.White, 13f, c)
                drawCircle(m.color, 10f, c)
                if (m.text.isNotEmpty()) drawContext.canvas.nativeCanvas.drawText(m.text, c.x + 14f, c.y - 10f, textPaint)
            }
        }
        androidx.compose.material3.Text(
            "grid ${cellMetres} m · double tap to fit",
            modifier = Modifier.align(Alignment.BottomStart).padding(4.dp),
            fontSize = androidx.compose.ui.unit.TextUnit(11f, androidx.compose.ui.unit.TextUnitType.Sp),
            color = Color.Gray,
        )
    }
}

private fun DrawScope.drawGrid(cell: Double, scale: Float, offset: Offset, size: Size) {
    // Keep grid lines at least 8 px apart when zoomed out: 1, 2, 5, 10, 20, 50 cells...
    var step = cell
    var k = 0
    while (step * scale < 8 && k < 30) {
        k++
        val decade = Math.pow(10.0, (k / 3).toDouble())
        step = cell * decade * doubleArrayOf(1.0, 2.0, 5.0)[k % 3]
    }
    val x0 = floor((-offset.x / scale) / step).toInt()
    val x1 = floor(((size.width - offset.x) / scale) / step).toInt() + 1
    val y0 = floor(((offset.y - size.height) / scale) / step).toInt()
    val y1 = floor((offset.y / scale) / step).toInt() + 1
    val light = Color(0xFFE3E3E3)
    val strong = Color(0xFFBDBDBD)
    for (i in x0..x1) {
        val sx = offset.x + (i * step * scale).toFloat()
        val metres = i * step
        drawLine(if (Math.abs(metres % 5.0) < 1e-6) strong else light, Offset(sx, 0f), Offset(sx, size.height), 1f)
    }
    for (j in y0..y1) {
        val sy = offset.y - (j * step * scale).toFloat()
        val metres = j * step
        drawLine(if (Math.abs(metres % 5.0) < 1e-6) strong else light, Offset(0f, sy), Offset(size.width, sy), 1f)
    }
}

/** The cells a track walked, sampled every quarter cell along each segment, packed as (i, j). */
fun walkedCells(x: DoubleArray, y: DoubleArray, cell: Double): Set<Long> {
    val out = HashSet<Long>()
    fun add(px: Double, py: Double) {
        val i = floor(px / cell).toInt()
        val j = floor(py / cell).toInt()
        out.add((i.toLong() shl 32) or (j.toLong() and 0xffffffffL))
    }
    if (x.isNotEmpty()) add(x[0], y[0])
    for (k in 1 until x.size) {
        val dx = x[k] - x[k - 1]
        val dy = y[k] - y[k - 1]
        val n = max(1, (Math.hypot(dx, dy) / (cell / 4)).toInt())
        for (s in 1..n) add(x[k - 1] + dx * s / n, y[k - 1] + dy * s / n)
    }
    return out
}
