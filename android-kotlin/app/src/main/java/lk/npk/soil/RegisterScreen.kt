package lk.npk.soil

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun RegisterScreen(
    lang: String,
    onLang: (String) -> Unit,
    onLoggedIn: (AuthResult) -> Unit,
    onGoLogin: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var ownerName by remember { mutableStateOf("") }
    var sizeAcres by remember { mutableStateOf("1") }
    var region by remember { mutableStateOf("") }
    var cropKey by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var crops by remember { mutableStateOf<List<Crop>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var created by remember { mutableStateOf<AuthResult?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { crops = Api.crops() }
    }

    fun submit() {
        error = ""
        if (name.isBlank()) { error = S.landName.t(lang); return }
        if (password.length < 4) { error = S.choosePassword.t(lang); return }
        scope.launch {
            busy = true
            try {
                val payload = JSONObject()
                    .put("name", name.trim())
                    .put("owner_name", ownerName.trim())
                    .put("region", region.trim())
                    .put("crop_key", cropKey)
                    .put("size_acres", sizeAcres.toDoubleOrNull() ?: 1.0)
                    .put("password", password)
                created = Api.register(payload)
            } catch (e: ApiException) {
                error = if (e.network) S.networkError.t(lang) else (e.message ?: "")
            } finally {
                busy = false
            }
        }
    }

    val result = created
    if (result != null) {
        ScreenBg {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).padding(top = 40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Brand(lang, compact = true)
                Gap(10)
                AppCard {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("✅", fontSize = 44.sp)
                        Gap(6)
                        Text(S.landCreated.t(lang), color = C.primaryDeep, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                        Gap(14)
                        Text(S.yourLandId.t(lang), color = C.muted, fontSize = 13.sp)
                        Gap(8)
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(14.dp))
                                .background(C.okBg)
                                .border(1.dp, C.borderStrong, RoundedCornerShape(14.dp))
                                .padding(horizontal = 28.dp, vertical = 14.dp)
                        ) {
                            Text(result.land.landId, color = C.primaryDeep, fontSize = 34.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp)
                        }
                        Gap(12)
                        Text(S.saveLandId.t(lang), color = C.muted, fontSize = 12.sp, textAlign = TextAlign.Center)
                        Gap(18)
                        PrimaryButton("→  ${S.goToDashboard.t(lang)}", { onLoggedIn(result) })
                    }
                }
            }
        }
        return
    }

    ScreenBg {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).padding(top = 40.dp)
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                LangToggle(lang, onLang)
            }
            Gap(8)
            Brand(lang, compact = true)
            Gap(16)

            AppCard {
                Text(S.registerTitle.t(lang), color = C.primaryDeep, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                Gap(14)
                ErrorBanner(error)
                LabeledField(S.landName.t(lang), name, { name = it })
                LabeledField(S.ownerName.t(lang), ownerName, { ownerName = it })
                LabeledField(S.sizeAcres.t(lang), sizeAcres, { sizeAcres = it }, keyboardType = KeyboardType.Number)
                LabeledField(S.region.t(lang), region, { region = it })

                Text(S.crop.t(lang), color = C.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Gap(8)
                if (crops.isEmpty()) {
                    Text(S.selectCrop.t(lang), color = C.subtle, fontSize = 13.sp)
                } else {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                        crops.forEach { c ->
                            val on = cropKey == c.cropKey
                            Box(
                                Modifier
                                    .padding(end = 8.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(if (on) C.primary else C.fieldBg)
                                    .border(1.dp, if (on) C.primary else C.borderStrong, RoundedCornerShape(999.dp))
                                    .clickable { cropKey = if (on) "" else c.cropKey }
                                    .padding(horizontal = 13.dp, vertical = 7.dp)
                            ) {
                                Text(c.name(lang), color = if (on) C.white else C.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
                Gap(14)
                LabeledField(S.password.t(lang), password, { password = it }, placeholder = S.choosePassword.t(lang), password = true)
                PrimaryButton(S.createLand.t(lang), ::submit, loading = busy)
            }

            Row(Modifier.fillMaxWidth().clickable { onGoLogin() }.padding(12.dp), horizontalArrangement = Arrangement.Center) {
                Text(S.haveAccount.t(lang), color = C.primaryDark, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
            Gap(30)
        }
    }
}
