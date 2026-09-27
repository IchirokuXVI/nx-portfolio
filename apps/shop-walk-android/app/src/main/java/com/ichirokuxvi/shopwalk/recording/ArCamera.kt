package com.ichirokuxvi.shopwalk.recording

import android.app.Activity
import android.content.Context
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.util.Log
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/** ARCore availability as the record screen needs it. */
object ArSupport {
    enum class Status { CHECKING, SUPPORTED_INSTALLED, NEEDS_INSTALL, UNSUPPORTED }

    fun check(context: Context): Status = try {
        val a = ArCoreApk.getInstance().checkAvailability(context)
        when {
            a.isTransient -> Status.CHECKING
            a == ArCoreApk.Availability.SUPPORTED_INSTALLED -> Status.SUPPORTED_INSTALLED
            a == ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD ||
                a == ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED -> Status.NEEDS_INSTALL
            else -> Status.UNSUPPORTED
        }
    } catch (e: Throwable) {
        Status.UNSUPPORTED
    }

    /**
     * Asks Google Play Services for AR to install or update. Answers true when ARCore is
     * ready now, false when an install was started (the person comes back to the app) or
     * refused, with the reason in the exception message.
     */
    fun requestInstall(activity: Activity): Boolean =
        ArCoreApk.getInstance().requestInstall(activity, true) == ArCoreApk.InstallStatus.INSTALLED
}

/**
 * Runs an ARCore session on a GLSurfaceView: draws the camera image as a small preview,
 * calls `session.update()` each frame and hands the camera pose to the recorder while
 * tracking. Every ARCore failure becomes a recorder event, never a crash.
 */
class ArCameraRenderer(
    private val context: Context,
    private val recorder: Recorder,
    private val onStatus: (String) -> Unit,
) : GLSurfaceView.Renderer {

    @Volatile
    var session: Session? = null
        private set

    @Volatile
    private var failed = false
    private var textureId = -1
    private var program = 0
    private var width = 0
    private var height = 0
    private var lastTimestamp = 0L
    private var geometrySet = false
    private var lastStatus = ""

    private val quadCoords = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
    private val quad: FloatBuffer = floatBuffer(quadCoords)
    private val texCoords: FloatBuffer = floatBuffer(FloatArray(8))

    /** Creates the session on the UI thread. Answers an error message, or null. */
    fun create(): String? {
        if (session != null) return null
        return try {
            val s = Session(context)
            val config = Config(s).apply {
                updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                planeFindingMode = Config.PlaneFindingMode.DISABLED
                lightEstimationMode = Config.LightEstimationMode.DISABLED
                focusMode = Config.FocusMode.AUTO
            }
            s.configure(config)
            session = s
            null
        } catch (e: Throwable) {
            failed = true
            "${e.javaClass.simpleName}: ${e.message ?: ""}"
        }
    }

    fun resume(): String? = try {
        session?.resume()
        null
    } catch (e: Throwable) {
        failed = true
        "${e.javaClass.simpleName}: ${e.message ?: ""}"
    }

    fun pause() {
        try { session?.pause() } catch (e: Throwable) { Log.w(TAG, "pause", e) }
    }

    fun close() {
        val s = session
        session = null
        try { s?.close() } catch (e: Throwable) { Log.w(TAG, "close", e) }
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        val tex = IntArray(1)
        GLES20.glGenTextures(1, tex, 0)
        textureId = tex[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        program = buildProgram()
        geometrySet = false
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w
        height = h
        GLES20.glViewport(0, 0, w, h)
        geometrySet = false
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val s = session ?: return
        if (failed) return
        try {
            s.setCameraTextureName(textureId)
            if (!geometrySet && width > 0) {
                // The activity is locked to portrait: display rotation 0.
                s.setDisplayGeometry(0, width, height)
                geometrySet = true
            }
            val frame = s.update()
            if (frame.hasDisplayGeometryChanged() || lastTimestamp == 0L) {
                quad.position(0)
                texCoords.position(0)
                frame.transformCoordinates2d(
                    Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quad,
                    Coordinates2d.TEXTURE_NORMALIZED, texCoords,
                )
            }
            if (frame.timestamp != 0L) drawBackground()
            val camera = frame.camera
            val state = camera.trackingState
            recorder.onTrackingState(state.name, camera.trackingFailureReason.name)
            val status = if (state == TrackingState.TRACKING) "TRACKING" else "${state.name} ${camera.trackingFailureReason.name}"
            if (status != lastStatus) {
                lastStatus = status
                onStatus(status)
            }
            val ts = frame.timestamp
            if (state == TrackingState.TRACKING && ts != lastTimestamp && ts != 0L) {
                val p = camera.pose
                recorder.onPose(ts, p.tx(), p.ty(), p.tz(), p.qx(), p.qy(), p.qz(), p.qw())
            }
            lastTimestamp = ts
        } catch (e: Throwable) {
            Log.w(TAG, "frame", e)
            // A camera that became unavailable is reported once and stops the preview.
            if (e is com.google.ar.core.exceptions.CameraNotAvailableException ||
                e is com.google.ar.core.exceptions.FatalException
            ) {
                failed = true
                recorder.event("tracking-lost", "arcore: ${e.javaClass.simpleName}")
                onStatus("camera unavailable")
            }
        }
    }

    private fun drawBackground() {
        if (program == 0) return
        quad.position(0)
        texCoords.position(0)
        GLES20.glDisable(GLES20.GL_DEPTH_TEST)
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        val pos = GLES20.glGetAttribLocation(program, "a_Position")
        val tex = GLES20.glGetAttribLocation(program, "a_TexCoord")
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glVertexAttribPointer(tex, 2, GLES20.GL_FLOAT, false, 0, texCoords)
        GLES20.glEnableVertexAttribArray(pos)
        GLES20.glEnableVertexAttribArray(tex)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(pos)
        GLES20.glDisableVertexAttribArray(tex)
    }

    private fun buildProgram(): Int {
        val vs = """
            attribute vec4 a_Position;
            attribute vec2 a_TexCoord;
            varying vec2 v_TexCoord;
            void main() { gl_Position = a_Position; v_TexCoord = a_TexCoord; }
        """.trimIndent()
        val fs = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            varying vec2 v_TexCoord;
            uniform samplerExternalOES sTexture;
            void main() { gl_FragColor = texture2D(sTexture, v_TexCoord); }
        """.trimIndent()
        val v = shader(GLES20.GL_VERTEX_SHADER, vs)
        val f = shader(GLES20.GL_FRAGMENT_SHADER, fs)
        if (v == 0 || f == 0) return 0
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, v)
        GLES20.glAttachShader(p, f)
        GLES20.glLinkProgram(p)
        val ok = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
        return if (ok[0] == 0) 0 else p
    }

    private fun shader(type: Int, src: String): Int {
        val s = GLES20.glCreateShader(type)
        GLES20.glShaderSource(s, src)
        GLES20.glCompileShader(s)
        val ok = IntArray(1)
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
        if (ok[0] == 0) {
            Log.w(TAG, "shader: " + GLES20.glGetShaderInfoLog(s))
            return 0
        }
        return s
    }

    companion object {
        private const val TAG = "ShopWalkAr"

        private fun floatBuffer(a: FloatArray): FloatBuffer =
            ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
                put(a)
                position(0)
            }
    }
}
