package lk.npk.soil

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    lang: String,
    onLang: (String) -> Unit,
    onLoggedIn: (AuthResult) -> Unit,
    onGoRegister: () -> Unit,
) {
    var landId by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var showServer by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf(Api.apiBase) }
    val scope = rememberCoroutineScope()

    fun submit() {
        error = ""
        val id = landId.trim().uppercase()
        if (id.isEmpty() || password.isEmpty()) {
            error = S.loginHint.t(lang); return
        }
        scope.launch {
            busy = true
            try {
                onLoggedIn(Api.login(id, password))
            } catch (e: ApiException) {
                error = if (e.network) S.networkError.t(lang) else (e.message ?: "")
            } finally {
                busy = false
            }
        }
    }

    ScreenBg {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(20.dp)
                .padding(top = 34.dp)
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                LangToggle(lang, onLang)
            }
            Gap(8)
            Brand(lang)
            Gap(20)

            AppCard {
                Text(S.loginTitle.t(lang), color = C.primaryDeep, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                Gap(4)
                Text(S.loginHint.t(lang), color = C.muted, fontSize = 13.sp)
                Gap(16)
                ErrorBanner(error)
                LabeledField(S.landId.t(lang), landId, { landId = it }, placeholder = "උදා: K7F9Q2")
                LabeledField(S.password.t(lang), password, { password = it }, placeholder = "••••••", password = true)
                PrimaryButton("→  ${S.signIn.t(lang)}", ::submit, loading = busy)
            }

            Gap(16)
            // Register call-to-action
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(C.primary)
                    .clickable { onGoRegister() }
                    .padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(S.noAccount.t(lang), color = C.white, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                    Gap(5)
                    Text(S.registerHint.t(lang), color = Color(0xFFDCFCE7), fontSize = 12.sp, lineHeight = 17.sp)
                }
                WGap(10)
                Text("→", color = C.white, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            }

            Gap(4)
            Row(
                Modifier.fillMaxWidth().clickable { showServer = !showServer }.padding(16.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                Text(
                    "⚙  ${S.serverSettings.t(lang)} ${if (showServer) "▲" else "▼"}",
                    color = C.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                )
            }

            if (showServer) {
                AppCard {
                    LabeledField(S.serverUrl.t(lang), serverUrl, { serverUrl = it },
                        placeholder = "http://10.0.2.2:8000", keyboardType = KeyboardType.Uri)
                    Text(S.serverHint.t(lang), color = C.subtle, fontSize = 11.sp)
                    Gap(12)
                    PrimaryButton(S.save.t(lang), {
                        Api.apiBase = serverUrl
                        serverUrl = Api.apiBase
                        showServer = false
                    })
                }
            }
            Gap(30)
        }
    }
}
