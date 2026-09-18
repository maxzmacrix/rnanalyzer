package eu.macrix.rndevice

import android.content.Context
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

/**
 * Gemini Nano through the ML Kit GenAI Prompt API: the on-device narrative layer of the corner coach.
 * Available on supported phones only (Pixel 9 family, Galaxy S25 and others); everywhere else the app
 * falls back to template sentences.
 */
object RnAi {
    private var model: GenerativeModel? = null
    private fun client(): GenerativeModel = model ?: Generation.getClient().also { model = it }

    /** "available" | "downloadable" | "downloading" | "unavailable" */
    @JvmStatic fun status(ctx: Context, cb: (String) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                cb(when (client().checkStatus()) {
                    FeatureStatus.AVAILABLE -> "available"
                    FeatureStatus.DOWNLOADABLE -> "downloadable"
                    FeatureStatus.DOWNLOADING -> "downloading"
                    else -> "unavailable"
                })
            } catch (e: Throwable) { cb("unavailable") }
        }
    }

    @JvmStatic fun generate(ctx: Context, instructions: String, prompt: String, cb: (String?, Throwable?) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val m = client()
                if (m.checkStatus() == FeatureStatus.DOWNLOADABLE) m.download().collect { }
                val text = if (instructions.isBlank()) prompt else instructions + "\n\n" + prompt
                val response = m.generateContent(text)
                cb(response.candidates.firstOrNull()?.text, null)
            } catch (e: Throwable) { cb(null, e) }
        }
    }
}
