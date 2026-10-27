// WEAVE PROTECTED FILE — server-controlled entry point.
// Generated code must provide `@Composable fun WeaveApp()` in package com.weave.app.
package com.weave.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.weave.app.ui.theme.WeaveTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            WeaveTheme {
                WeaveApp()
            }
        }
    }
}
