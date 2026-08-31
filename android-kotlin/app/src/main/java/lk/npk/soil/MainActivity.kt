package lk.npk.soil

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(applicationContext)
        setContent {
            MaterialTheme { AppRoot() }
        }
    }
}

@Composable
private fun AppRoot() {
    var lang by remember { mutableStateOf(Api.lang) }

    val restored = remember {
        val json = Api.savedLandJson()
        if (Api.token != null && json != null) {
            runCatching { Land.from(JSONObject(json)) }.getOrNull()
        } else null
    }
    var land by remember { mutableStateOf(restored) }
    var route by remember { mutableStateOf(if (restored != null) "dashboard" else "login") }

    val setLang: (String) -> Unit = { l -> lang = l; Api.lang = l }
    val onLoggedIn: (AuthResult) -> Unit = { r -> land = r.land; route = "dashboard" }
    val onLogout: () -> Unit = { land = null; route = "login" }

    val currentLand = land
    when {
        route == "dashboard" && currentLand != null ->
            DashboardScreen(lang, currentLand, setLang, onLogout)
        route == "register" ->
            RegisterScreen(lang, setLang, onLoggedIn, onGoLogin = { route = "login" })
        else ->
            LoginScreen(lang, setLang, onLoggedIn, onGoRegister = { route = "register" })
    }
}
