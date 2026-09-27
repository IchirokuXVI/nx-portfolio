package com.ichirokuxvi.shopwalk

import android.app.Application
import android.content.Context
import com.ichirokuxvi.shopwalk.recording.Recorder
import com.ichirokuxvi.shopwalk.store.WalkStore

class ShopWalkApp : Application() {
    lateinit var store: WalkStore
        private set
    lateinit var recorder: Recorder
        private set
    lateinit var labels: LabelMemory
        private set

    override fun onCreate() {
        super.onCreate()
        store = WalkStore(filesDir)
        recorder = Recorder(this, store)
        labels = LabelMemory(this)
    }
}

/** Checkpoint labels used in earlier walks, most recent first, offered before typing. */
class LabelMemory(context: Context) {
    private val prefs = context.getSharedPreferences("labels", Context.MODE_PRIVATE)

    fun recent(): List<String> =
        prefs.getString("checkpoint", "").orEmpty().split('\n').filter { it.isNotBlank() }

    fun remember(label: String) {
        val l = label.trim()
        if (l.isEmpty()) return
        val list = (listOf(l) + recent().filter { it != l }).take(12)
        prefs.edit().putString("checkpoint", list.joinToString("\n")).apply()
    }
}
