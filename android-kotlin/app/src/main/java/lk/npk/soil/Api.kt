package lk.npk.soil

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/** Carries the HTTP status so callers can tell 401 apart from a network drop. */
class ApiException(
    message: String,
    val status: Int = 0,
    val network: Boolean = false,
) : Exception(message)

/**
 * Tiny HTTP client over the built-in HttpURLConnection — no third-party
 * networking library. All calls are suspend functions that run on the IO
 * dispatcher. Token + backend URL + language are persisted in SharedPreferences.
 */
object Api {
    private const val PREFS = "npk_prefs"
    private const val KEY_BASE = "apiBase"
    private const val KEY_TOKEN = "token"
    private const val KEY_LAND = "land"
    private const val KEY_LANG = "lang"

    // Android emulator reaches the host PC at 10.0.2.2 (not 127.0.0.1).
    const val DEFAULT_BASE = "http://10.0.2.2:8000"

    private lateinit var prefs: SharedPreferences
    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    var apiBase: String
        get() = prefs.getString(KEY_BASE, DEFAULT_BASE)?.ifBlank { DEFAULT_BASE } ?: DEFAULT_BASE
        set(v) {
            prefs.edit().putString(KEY_BASE, v.trim().trimEnd('/')).apply()
        }

    val token: String? get() = prefs.getString(KEY_TOKEN, null)
    fun savedLandJson(): String? = prefs.getString(KEY_LAND, null)

    var lang: String
        get() = prefs.getString(KEY_LANG, "si") ?: "si"
        set(v) { prefs.edit().putString(KEY_LANG, v).apply() }

    private fun saveSession(token: String, landJson: String) {
        prefs.edit().putString(KEY_TOKEN, token).putString(KEY_LAND, landJson).apply()
    }

    fun clearSession() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_LAND).apply()
    }

    private suspend fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        auth: Boolean = false,
    ): String = withContext(Dispatchers.IO) {
        val conn = (URL("$apiBase$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            if (auth) token?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use(BufferedReader::readText) ?: ""
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(text).optString("error", "HTTP $code") }
                    .getOrDefault("HTTP $code")
                throw ApiException(msg, status = code)
            }
            text
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(e.message ?: "network error", network = true)
        } finally {
            conn.disconnect()
        }
    }

    suspend fun login(landId: String, password: String): AuthResult {
        val res = request(
            "/api/land/login/", "POST",
            JSONObject().put("land_id", landId).put("password", password),
        )
        return parseAuth(res)
    }

    suspend fun register(payload: JSONObject): AuthResult =
        parseAuth(request("/api/land/register/", "POST", payload))

    suspend fun latest(): Reading? {
        val o = JSONObject(request("/api/land/latest/", auth = true))
        if (o.isNull("time")) return null
        return Reading.from(o)
    }

    suspend fun crops(): List<Crop> {
        val arr = JSONArray(request("/api/crops/"))
        return (0 until arr.length()).map { Crop.from(arr.getJSONObject(it)) }
    }

    suspend fun logout() {
        runCatching { request("/api/land/logout/", "POST", auth = true) }
    }

    private fun parseAuth(res: String): AuthResult {
        val o = JSONObject(res)
        val landObj = o.getJSONObject("field")
        saveSession(o.getString("token"), landObj.toString())
        return AuthResult(o.getString("token"), Land.from(landObj))
    }
}
