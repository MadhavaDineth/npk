package lk.npk.soil

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun DashboardScreen(
    lang: String,
    land: Land,
    onLang: (String) -> Unit,
    onLogout: () -> Unit,
) {
    var reading by remember { mutableStateOf<Reading?>(null) }
    var crops by remember { mutableStateOf<List<Crop>>(emptyList()) }
    var cropKey by remember { mutableStateOf(land.cropKey) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    fun load() {
        scope.launch {
            error = ""
            try {
                val latest = Api.latest()
                val cropRows = if (crops.isEmpty()) Api.crops() else crops
                reading = latest
                if (crops.isEmpty()) crops = cropRows
            } catch (e: ApiException) {
                if (e.status == 401) {
                    Api.clearSession(); onLogout(); return@launch
                }
                error = if (e.network) S.networkError.t(lang) else (e.message ?: "")
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    val crop = crops.firstOrNull { it.cropKey == cropKey }
    val hasReading = reading?.time != null
    val statuses = if (hasReading) buildStatuses(reading!!, crop) else emptyList()
    val recs = statuses.filter { it.status == Status.LOW || it.status == Status.HIGH }

    ScreenBg {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(18.dp).padding(top = 40.dp)
        ) {
            // Header
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(40.dp).clip(RoundedCornerShape(13.dp)).background(C.okBg),
                    contentAlignment = Alignment.Center,
                ) { Text("🌱", fontSize = 18.sp) }
                WGap(10)
                Column(Modifier.weight(1f)) {
                    Text(land.name.ifBlank { "Dashboard" }, color = C.primaryDeep, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
                    val acres = if (land.sizeAcres > 0) "  ·  ${trimNum(land.sizeAcres)} ac" else ""
                    Text("${S.landId.t(lang)}: ${land.landId}$acres", color = C.muted, fontSize = 12.sp)
                }
                LangToggle(lang, onLang)
            }
            Gap(14)

            if (loading) {
                Column(Modifier.fillMaxWidth().padding(vertical = 60.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = C.primary)
                    Gap(12)
                    Text(S.loading.t(lang), color = C.muted, fontSize = 13.sp)
                }
                return@ScreenBg
            }

            if (error.isNotEmpty()) {
                AppCard {
                    Text(error, color = C.lowText, fontSize = 13.sp)
                    Gap(8)
                    Row(Modifier.clickable { load() }) {
                        Text(S.retry.t(lang), color = C.lowText, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Gap(12)
            }

            // Crop selector
            if (crops.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    crops.forEach { c ->
                        val on = cropKey == c.cropKey
                        Box(
                            Modifier
                                .padding(end = 8.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(if (on) C.primary else C.white)
                                .border(1.dp, if (on) C.primary else C.borderStrong, RoundedCornerShape(999.dp))
                                .clickable { cropKey = if (on) "" else c.cropKey }
                                .padding(horizontal = 13.dp, vertical = 7.dp)
                        ) {
                            Text(c.name(lang), color = if (on) C.white else C.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                Gap(4)
            }

            SectionTitle(S.latestReading.t(lang))

            if (!hasReading) {
                AppCard { Text(S.noReadings.t(lang), color = C.muted, fontSize = 14.sp, lineHeight = 20.sp) }
            } else {
                Row(Modifier.fillMaxWidth()) {
                    statuses.forEachIndexed { i, s ->
                        NpkCard(s, lang, Modifier.weight(1f))
                        if (i < statuses.lastIndex) WGap(10)
                    }
                }
                Gap(10)
                Row(Modifier.fillMaxWidth()) {
                    MiniTile(S.ph.t(lang), reading!!.ph?.let { oneDp(it) } ?: "—", Modifier.weight(1f))
                    WGap(10)
                    MiniTile(S.moisture.t(lang), reading!!.moisture?.let { "${it.roundToInt()}%" } ?: "—", Modifier.weight(1f))
                    WGap(10)
                    MiniTile(S.temperature.t(lang), reading!!.temperature?.let { "${it.roundToInt()}°" } ?: "—", Modifier.weight(1f))
                }
                Gap(10)
                Text("${S.updatedAt.t(lang)}: ${formatTime(reading!!.time)}", color = C.subtle, fontSize = 11.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End)
            }

            SectionTitle(S.recommendations.t(lang))
            AppCard {
                when {
                    !hasReading -> Text(S.noReadings.t(lang), color = C.muted, fontSize = 14.sp, lineHeight = 20.sp)
                    crop == null -> Text(S.selectCropForRecs.t(lang), color = C.muted, fontSize = 14.sp, lineHeight = 20.sp)
                    recs.isEmpty() -> Text(S.allGood.t(lang), color = C.okText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, lineHeight = 21.sp)
                    else -> recs.forEachIndexed { i, r ->
                        if (i > 0) Gap(4)
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(4.dp))
                                .background(statusBg(r.status!!))
                                .padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 10.dp)
                        ) {
                            Box(Modifier.size(width = 4.dp, height = 40.dp).background(statusColor(r.status)))
                            WGap(10)
                            Column(Modifier.weight(1f)) {
                                Text(r.headline()?.t(lang) ?: "", color = C.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold, lineHeight = 20.sp)
                                Gap(4)
                                Text(
                                    "${r.key.uppercase()}: ${r.value?.roundToInt()} · ${S.target.t(lang)} ${r.min?.roundToInt()}–${r.max?.roundToInt()}",
                                    color = C.muted, fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }

            Row(Modifier.fillMaxWidth().clickable {
                scope.launch { Api.logout(); Api.clearSession(); onLogout() }
            }.padding(18.dp), horizontalArrangement = Arrangement.Center) {
                Text("⏻  ${S.logout.t(lang)}", color = C.muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
            Gap(30)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Gap(18)
    Text(text, color = C.text, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
    Gap(10)
}

@Composable
private fun NpkCard(s: NutrientStatus, lang: String, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(C.card)
            .border(1.dp, C.border, RoundedCornerShape(20.dp))
            .padding(12.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(s.key.uppercase(), color = C.primary, fontSize = 16.sp, fontWeight = FontWeight.Black)
            s.status?.let { StatusPill(it, lang) }
        }
        Gap(8)
        Text(s.value?.roundToInt()?.toString() ?: "—", color = C.ink, fontSize = 28.sp, fontWeight = FontWeight.Black)
        Text("mg/kg", color = C.subtle, fontSize = 11.sp)
        Gap(8)
        if (s.min != null && s.max != null) {
            Text("${S.target.t(lang)}: ${s.min.roundToInt()}–${s.max.roundToInt()}", color = C.muted, fontSize = 11.sp)
        } else {
            Text(S.selectCrop.t(lang), color = C.subtle, fontSize = 11.sp)
        }
    }
}

@Composable
private fun MiniTile(label: String, value: String, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(C.white)
            .border(1.dp, C.border, RoundedCornerShape(14.dp))
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = C.text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
        Gap(3)
        Text(label, color = C.muted, fontSize = 11.sp)
    }
}

private fun statusBg(s: Status) = when (s) {
    Status.LOW -> C.lowBg
    Status.HIGH -> C.highBg
    Status.OK -> C.okBg
}

private fun trimNum(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else d.toString()
private fun oneDp(d: Double): String = String.format("%.1f", d)

private fun formatTime(iso: String?): String {
    if (iso == null) return ""
    return runCatching {
        val odt = java.time.OffsetDateTime.parse(iso)
        odt.atZoneSameInstant(java.time.ZoneId.systemDefault())
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
    }.getOrDefault(iso)
}
