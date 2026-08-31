package lk.npk.soil

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Soft green vertical wash behind every screen. */
@Composable
fun ScreenBg(content: @Composable () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(C.bgTop, C.bgBottom)))
    ) { content() }
}

@Composable
fun Brand(lang: String, compact: Boolean = false) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Box(
            Modifier.size(64.dp).clip(RoundedCornerShape(20.dp)).background(C.primary),
            contentAlignment = Alignment.Center,
        ) { Text("🌱", fontSize = 30.sp) }
        Spacer(Modifier.height(12.dp))
        Text(
            S.appTitle.t(lang),
            color = C.primaryDeep,
            fontSize = 22.sp,
            fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center,
        )
        if (!compact) {
            Spacer(Modifier.height(8.dp))
            Text(
                S.appTagline.t(lang),
                color = C.muted,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                lineHeight = 19.sp,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
        }
    }
}

@Composable
fun AppCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(C.card)
            .border(1.dp, C.border, RoundedCornerShape(20.dp))
            .padding(18.dp)
    ) { content() }
}

@Composable
fun LabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    Column(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        Text(label, color = C.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            placeholder = { if (placeholder.isNotEmpty()) Text(placeholder, color = C.subtle) },
            visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = C.primary,
                unfocusedBorderColor = C.borderStrong,
                focusedContainerColor = C.fieldBg,
                unfocusedContainerColor = C.fieldBg,
                cursorColor = C.primary,
                focusedTextColor = C.ink,
                unfocusedTextColor = C.ink,
            ),
        )
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, loading: Boolean = false, enabled: Boolean = true) {
    val active = enabled && !loading
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (active) C.primary else C.borderStrong)
            .clickable(enabled = active) { onClick() }
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(color = C.white, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        } else {
            Text(text, color = C.white, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun LangToggle(lang: String, onChange: (String) -> Unit) {
    Row(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(C.white)
            .border(1.dp, C.border, RoundedCornerShape(999.dp))
            .padding(3.dp)
    ) {
        listOf("si" to "සිං", "en" to "EN").forEach { (code, label) ->
            val on = lang == code
            Box(
                Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (on) C.primary else C.white)
                    .clickable { onChange(code) }
                    .padding(horizontal = 12.dp, vertical = 5.dp)
            ) {
                Text(label, color = if (on) C.white else C.muted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun StatusPill(status: Status, lang: String) {
    val (bg, fg, label) = when (status) {
        Status.LOW -> Triple(C.lowBg, C.lowText, S.low.t(lang))
        Status.HIGH -> Triple(C.highBg, C.highText, S.high.t(lang))
        Status.OK -> Triple(C.okBg, C.okText, S.ok.t(lang))
    }
    Box(
        Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 10.dp, vertical = 3.dp)
    ) {
        Text(label, color = fg, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun ErrorBanner(message: String) {
    if (message.isEmpty()) return
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(C.lowBg)
            .padding(12.dp)
    ) { Text(message, color = C.lowText, fontSize = 13.sp) }
    Spacer(Modifier.height(14.dp))
}

@Composable
fun Gap(height: Int) = Spacer(Modifier.height(height.dp))

@Composable
fun WGap(width: Int) = Spacer(Modifier.width(width.dp))
