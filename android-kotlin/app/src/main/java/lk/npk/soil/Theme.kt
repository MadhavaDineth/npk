package lk.npk.soil

import androidx.compose.ui.graphics.Color

/** A bilingual string. `t(lang)` picks Sinhala or English. */
data class Str(val si: String, val en: String) {
    fun t(lang: String): String = if (lang == "si") si else en
}

/** Brand palette — the same emerald family as the web / RN apps. */
object C {
    val primary = Color(0xFF059669)
    val primaryDark = Color(0xFF047857)
    val primaryDeep = Color(0xFF15803D)

    val ok = Color(0xFF059669)
    val low = Color(0xFFDC2626)
    val high = Color(0xFFD97706)

    val bgTop = Color(0xFFECFDF5)
    val bgBottom = Color(0xFFDCFCE7)
    val card = Color(0xFFFFFFFF)
    val border = Color(0xFFD1FAE5)
    val borderStrong = Color(0xFFA7F3D0)

    val ink = Color(0xFF052E16)
    val text = Color(0xFF14532D)
    val muted = Color(0xFF6B7280)
    val subtle = Color(0xFF9CA3AF)
    val white = Color(0xFFFFFFFF)

    val okBg = Color(0xFFD1FAE5); val okText = Color(0xFF047857)
    val lowBg = Color(0xFFFEE2E2); val lowText = Color(0xFFB91C1C)
    val highBg = Color(0xFFFEF3C7); val highText = Color(0xFFB45309)
    val fieldBg = Color(0xFFF8FEFB)
}

/** String bank (Sinhala default / English), mirroring the web + RN apps. */
object S {
    val appTitle = Str("පස් පෝෂක නිරීක්ෂණ පද්ධතිය", "Soil Nutrient Monitoring")
    val appTagline = Str(
        "ඔබේ ඉඩම් සඳහා IoT පදනම් වූ පස් විශ්ලේෂණයෙන් නිවැරදි බෝග හා පොහොර තීරණ ගන්න",
        "IoT-based soil analysis for smarter crop & fertilizer decisions on your land",
    )

    val loginTitle = Str("ඉඩමට ඇතුළු වන්න", "Sign in to your land")
    val loginHint = Str("ඔබේ Land ID එකයි මුරපදයයි දෙන්න", "Enter your Land ID and password")
    val landId = Str("Land ID", "Land ID")
    val password = Str("මුරපදය", "Password")
    val signIn = Str("ඇතුළු වන්න", "Sign in")
    val noAccount = Str("නව ඉඩමක් ලියාපදිංචි කරන්න", "Register a new land")
    val registerHint = Str(
        "ඉඩමේ නම, ප්‍රමාණය සහ බෝගය ඇතුළත් කර ලියාපදිංචි වන්න — Land ID එකක් ලැබේ",
        "Add your land's name, size & crop to register — you'll get a Land ID",
    )

    val registerTitle = Str("නව ඉඩමක් ලියාපදිංචි කරන්න", "Register a new land")
    val landName = Str("ඉඩමේ නම", "Land name")
    val ownerName = Str("අයිතිකරුගේ නම (විකල්ප)", "Owner name (optional)")
    val sizeAcres = Str("ප්‍රමාණය (අක්කර)", "Size (acres)")
    val region = Str("ප්‍රදේශය (විකල්ප)", "Region (optional)")
    val crop = Str("බෝගය", "Crop")
    val choosePassword = Str("මුරපදයක් තෝරන්න (අකුරු 4+)", "Choose a password (4+ chars)")
    val createLand = Str("ලියාපදිංචි කරන්න", "Create land")
    val haveAccount = Str("දැනටමත් Land ID තිබේද? ඇතුළු වන්න", "Already have a Land ID? Sign in")
    val selectCrop = Str("බෝගයක් තෝරන්න", "Select a crop")

    val landCreated = Str("ඉඩම සාර්ථකව සෑදිණි!", "Land created!")
    val yourLandId = Str("ඔබේ Land ID එක", "Your Land ID")
    val saveLandId = Str("මෙය සටහන් කරගන්න — ඇතුළු වීමට අවශ්‍යයි.", "Note this down — you'll need it to sign in.")
    val goToDashboard = Str("ඩෑෂ්බෝඩ් එකට යන්න", "Go to dashboard")

    val latestReading = Str("නවතම කියවීම", "Latest reading")
    val noReadings = Str(
        "තවම කියවීම් නැත. ESP32 device එකෙන් දත්ත එවන තෙක් රැඳී සිටින්න.",
        "No readings yet. Waiting for data from your ESP32 device.",
    )
    val recommendations = Str("නිර්දේශ", "Recommendations")
    val allGood = Str(
        "සියලු පෝෂක නිසි මට්ටමේ පවතී 🎉 — දැනට පොහොර යෙදීම අවශ්‍ය නැත.",
        "All nutrients are in range 🎉 — no fertilizer needed right now.",
    )
    val selectCropForRecs = Str("නිර්දේශ සඳහා ඉහළින් බෝගයක් තෝරන්න", "Select a crop above to see recommendations")
    val target = Str("ඉලක්ක පරාසය", "Target")
    val ph = Str("pH අගය", "pH")
    val moisture = Str("තෙතමනය", "Moisture")
    val temperature = Str("උෂ්ණත්වය", "Temp")
    val updatedAt = Str("යාවත්කාලීන", "Updated")
    val logout = Str("ඉවත් වන්න", "Log out")

    val low = Str("අඩුයි", "Low")
    val high = Str("වැඩියි", "High")
    val ok = Str("හොඳයි", "Good")

    val serverSettings = Str("සර්වර් සැකසුම්", "Server settings")
    val serverUrl = Str("Backend URL", "Backend URL")
    val serverHint = Str(
        "Emulator: 10.0.2.2 · දුරකථනය: PC එකේ LAN IP",
        "Emulator: 10.0.2.2 · Phone: your PC's LAN IP",
    )
    val save = Str("සුරකින්න", "Save")

    val loading = Str("පූරණය වෙමින්...", "Loading…")
    val retry = Str("නැවත උත්සාහ කරන්න", "Retry")
    val networkError = Str(
        "සර්වරයට සම්බන්ධ විය නොහැක. Backend URL එක හා WiFi පරීක්ෂා කරන්න.",
        "Can't reach the server. Check the Backend URL and WiFi.",
    )
}

fun statusColor(s: Status): Color = when (s) {
    Status.LOW -> C.low
    Status.HIGH -> C.high
    Status.OK -> C.ok
}
