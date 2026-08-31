package lk.npk.soil

import org.json.JSONObject

/** A land account (the login unit), as returned in the `field` object. */
data class Land(
    val id: Int,
    val name: String,
    val landId: String,
    val cropKey: String,
    val sizeAcres: Double,
    val region: String,
) {
    companion object {
        fun from(o: JSONObject) = Land(
            id = o.optInt("id"),
            name = o.optString("name"),
            landId = o.optString("land_id"),
            cropKey = o.optString("crop_key"),
            sizeAcres = o.optDouble("size_acres", 0.0),
            region = o.optString("region"),
        )
    }
}

/** One soil reading (nulls when the sensor doesn't report a channel). */
data class Reading(
    val n: Double?,
    val p: Double?,
    val k: Double?,
    val ph: Double?,
    val moisture: Double?,
    val temperature: Double?,
    val time: String?,
) {
    companion object {
        private fun JSONObject.dbl(key: String): Double? =
            if (isNull(key)) null else optDouble(key)

        fun from(o: JSONObject) = Reading(
            n = o.dbl("n"), p = o.dbl("p"), k = o.dbl("k"),
            ph = o.dbl("ph"), moisture = o.dbl("moisture"),
            temperature = o.dbl("temperature"),
            time = if (o.isNull("time")) null else o.optString("time"),
        )
    }
}

/** Crop guideline (target N/P/K ranges) from /api/crops/. */
data class Crop(
    val cropKey: String,
    val nameEn: String,
    val nameSi: String,
    val nMin: Double, val nMax: Double,
    val pMin: Double, val pMax: Double,
    val kMin: Double, val kMax: Double,
) {
    fun name(lang: String) = if (lang == "si" && nameSi.isNotBlank()) nameSi else nameEn

    companion object {
        fun from(o: JSONObject) = Crop(
            cropKey = o.optString("crop_key"),
            nameEn = o.optString("name_en"),
            nameSi = o.optString("name_si"),
            nMin = o.optDouble("n_min"), nMax = o.optDouble("n_max"),
            pMin = o.optDouble("p_min"), pMax = o.optDouble("p_max"),
            kMin = o.optDouble("k_min"), kMax = o.optDouble("k_max"),
        )
    }
}

data class AuthResult(val token: String, val land: Land)
