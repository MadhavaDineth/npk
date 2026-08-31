package lk.npk.soil

enum class Status { LOW, OK, HIGH }

/** Same rule as the web/RN app: below min = LOW, above max = HIGH, else OK. */
fun statusOf(v: Double?, min: Double?, max: Double?): Status? {
    if (v == null || min == null || max == null) return null
    return when {
        v < min -> Status.LOW
        v > max -> Status.HIGH
        else -> Status.OK
    }
}

data class NutrientStatus(
    val key: String,
    val value: Double?,
    val min: Double?,
    val max: Double?,
    val status: Status?,
) {
    /** Plain-language advice headline when action is needed (else null). */
    fun headline(): Str? = when (status) {
        Status.LOW, Status.HIGH -> RecHeadlines.of(key, status)
        else -> null
    }
}

fun buildStatuses(reading: Reading, crop: Crop?): List<NutrientStatus> = listOf(
    NutrientStatus("n", reading.n, crop?.nMin, crop?.nMax, statusOf(reading.n, crop?.nMin, crop?.nMax)),
    NutrientStatus("p", reading.p, crop?.pMin, crop?.pMax, statusOf(reading.p, crop?.pMin, crop?.pMax)),
    NutrientStatus("k", reading.k, crop?.kMin, crop?.kMax, statusOf(reading.k, crop?.kMin, crop?.kMax)),
)

/** Nutrient headlines, copied verbatim from the web app so advice matches. */
object RecHeadlines {
    private val map = mapOf(
        "n" to mapOf(
            Status.LOW to Str("නයිට්‍රජන් (N) අඩුයි — යූරියා යෙදීම අවශ්‍යයි", "Nitrogen (N) is low — apply Urea"),
            Status.HIGH to Str("නයිට්‍රජන් (N) වැඩියි — නයිට්‍රජන් පොහොර නවත්වන්න", "Nitrogen (N) is high — stop applying nitrogen fertilizer"),
        ),
        "p" to mapOf(
            Status.LOW to Str("පොස්පරස් (P) අඩුයි — TSP යෙදීම අවශ්‍යයි", "Phosphorus (P) is low — apply TSP"),
            Status.HIGH to Str("පොස්පරස් (P) වැඩියි — පොස්පේට් පොහොර නවත්වන්න", "Phosphorus (P) is high — stop applying phosphate fertilizer"),
        ),
        "k" to mapOf(
            Status.LOW to Str("පොටෑසියම් (K) අඩුයි — MOP යෙදීම අවශ්‍යයි", "Potassium (K) is low — apply MOP"),
            Status.HIGH to Str("පොටෑසියම් (K) වැඩියි — පොටෑසියම් පොහොර නවත්වන්න", "Potassium (K) is high — stop applying potassium fertilizer"),
        ),
    )

    fun of(key: String, status: Status): Str? = map[key]?.get(status)
}
