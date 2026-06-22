package com.example.epicc.ui.main

import android.accounts.Account
import android.annotation.SuppressLint
import android.app.Dialog
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation3.runtime.NavKey
import com.example.epicc.R
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MainScreen(
  onItemClick: (NavKey) -> Unit,
  modifier: Modifier = Modifier,
) {
  var showSplash by remember { mutableStateOf(true) }
  val handler = remember { Handler(Looper.getMainLooper()) }
  val context = LocalContext.current
  var webViewInstance by remember { mutableStateOf<WebView?>(null) }

  val googleSignInLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
    try {
      val account = task.getResult(ApiException::class.java)
      // Run in a background thread because GoogleAuthUtil.getToken performs network requests
      Thread {
        try {
          val scopeStr = "oauth2:https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email"
          val token = GoogleAuthUtil.getToken(
            context,
            account.account ?: Account(account.email ?: "", "com.google"),
            scopeStr
          )
          val photoUrl = account.photoUrl?.toString() ?: ""
          handler.post {
            webViewInstance?.evaluateJavascript(
              "window.DriveSync.onNativeSignInSuccess(" +
                "'$token', " +
                "'${account.email}', " +
                "'${account.displayName?.replace("'", "\\'")}', " +
                "'$photoUrl'" +
                ")",
              null
            )
          }
        } catch (e: Exception) {
          e.printStackTrace()
          val errMsg = e.message ?: "Authentication token acquisition failed"
          handler.post {
            webViewInstance?.evaluateJavascript(
              "window.DriveSync.onNativeSignInError('${errMsg.replace("'", "\\'")}')",
              null
            )
          }
        }
      }.start()
    } catch (e: ApiException) {
      e.printStackTrace()
      val statusCode = e.statusCode
      val friendlyMsg = when (statusCode) {
        10 -> "Developer Error (10): Ensure SHA-1 fingerprint (44:1A:1B:40:C8:A3:67:D6:62:89:82:2A:37:6F:B6:9F:11:99:68:73) is registered in Google Cloud Console, and Web Client ID is correct."
        7 -> "Network Error: Check your device internet connection."
        12500 -> "Configuration Mismatch (12500): Check your Client ID configuration in Google Cloud."
        12501 -> "Sign-in cancelled by user."
        12502 -> "Sign-in already in progress."
        else -> e.message ?: "Google Sign-In failed (code $statusCode)"
      }
      webViewInstance?.evaluateJavascript(
        "window.DriveSync.onNativeSignInError('${friendlyMsg.replace("'", "\\'")}')",
        null
      )
    }
  }

  Box(modifier = modifier.fillMaxSize()) {
    // ─── WebView Layer ──────────────────────────────────────────────────
    AndroidView(
      factory = { context ->
        WebView(context).apply {
          webViewInstance = this
          layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
          )

          // JavaScript interface to bridge functionality to Web
          addJavascriptInterface(object {
            @JavascriptInterface
            fun appReady() {
              handler.post { showSplash = false }
            }

            @JavascriptInterface
            fun googleSignIn(clientId: String) {
              handler.post {
                val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                  .requestEmail()
                  .requestScopes(
                    Scope("https://www.googleapis.com/auth/drive.appdata"),
                    Scope("https://www.googleapis.com/auth/userinfo.profile"),
                    Scope("https://www.googleapis.com/auth/userinfo.email")
                  )
                  .let { builder ->
                    if (clientId.isNotEmpty()) {
                      builder.requestIdToken(clientId)
                    } else {
                      builder
                    }
                  }
                  .build()
                val client = GoogleSignIn.getClient(context, gso)
                client.signOut().addOnCompleteListener {
                  googleSignInLauncher.launch(client.signInIntent)
                }
              }
            }
          }, "EpiccBridge")

          webViewClient = object : WebViewClient() {
            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
              return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
              super.onPageFinished(view, url)
              // Inject a poller that checks for the real app's DOM element.
              // The Render loading page won't have #sidebar; our app will.
              view?.evaluateJavascript(
                """
                (function() {
                  function check() {
                    if (document.getElementById('sidebar')) {
                      EpiccBridge.appReady();
                    } else {
                      setTimeout(check, 500);
                    }
                  }
                  check();
                })();
                """.trimIndent(),
                null
              )
            }
          }

          // Configure CookieManager for cookie persistence
          android.webkit.CookieManager.getInstance().setAcceptCookie(true)
          android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
          
          // Enable popup support for Google OAuth
          webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
              view: WebView?,
              isDialog: Boolean,
              isUserGesture: Boolean,
              resultMsg: Message?
            ): Boolean {
              val newWebView = WebView(context).apply {
                webViewClient = object : WebViewClient() {
                  @Deprecated("Deprecated in Java")
                  override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                    return false
                  }
                }
                // Enable cookies for the popup WebView
                android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                settings.apply {
                  javaScriptEnabled = true
                  domStorageEnabled = true
                  databaseEnabled = true
                  setSupportMultipleWindows(true)
                  javaScriptCanOpenWindowsAutomatically = true
                  userAgentString = view?.settings?.userAgentString
                }
              }

              val dialog = Dialog(context).apply {
                setContentView(newWebView)
                window?.setLayout(
                  ViewGroup.LayoutParams.MATCH_PARENT,
                  ViewGroup.LayoutParams.MATCH_PARENT
                )
                setOnDismissListener {
                  newWebView.destroy()
                }
              }

              newWebView.webChromeClient = object : WebChromeClient() {
                override fun onCloseWindow(window: WebView?) {
                  dialog.dismiss()
                }
              }

              dialog.show()

              val transport = resultMsg?.obj as? WebView.WebViewTransport
              transport?.webView = newWebView
              resultMsg?.sendToTarget()
              return true
            }
          }

          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            
            // Support window opening for OAuth popups
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true

            // Bypass Google Sign-In WebView blocking by removing "Version/X.X" and "; wv"
            val defaultUserAgent = userAgentString
            userAgentString = defaultUserAgent
              .replace("; wv", "")
              .replace("Version/[0-9.]+".toRegex(), "")
          }
          loadUrl("https://epicc-ai-chat.onrender.com")
        }
      },
      modifier = Modifier.fillMaxSize()
    )

    // ─── Splash Overlay (hides Render loading page) ─────────────────────
    AnimatedVisibility(
      visible = showSplash,
      exit = fadeOut(animationSpec = tween(durationMillis = 400))
    ) {
      EpiccSplashScreen()
    }
  }
}

@Composable
private fun EpiccSplashScreen() {
  val infiniteTransition = rememberInfiniteTransition(label = "splash")
  val scale by infiniteTransition.animateFloat(
    initialValue = 0.92f,
    targetValue = 1.08f,
    animationSpec = infiniteRepeatable(
      animation = tween(durationMillis = 1200, easing = LinearEasing),
      repeatMode = RepeatMode.Reverse
    ),
    label = "pulse"
  )

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(
        Brush.verticalGradient(
          colors = listOf(
            Color(0xFF0D0D0F),
            Color(0xFF131316),
            Color(0xFF0D0D0F)
          )
        )
      ),
    contentAlignment = Alignment.Center
  ) {
    Column(
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center
    ) {
      Image(
        painter = painterResource(id = R.mipmap.ic_launcher_foreground),
        contentDescription = "Epicc Logo",
        modifier = Modifier
          .size(100.dp)
          .scale(scale)
          .clip(CircleShape)
      )
      Spacer(modifier = Modifier.height(24.dp))
      Text(
        text = "Epicc",
        color = Color.White,
        fontSize = 28.sp,
        fontWeight = FontWeight.Bold
      )
      Spacer(modifier = Modifier.height(8.dp))
      Text(
        text = "Loading your experience...",
        color = Color(0xFF888899),
        fontSize = 14.sp,
        fontWeight = FontWeight.Normal
      )
    }
  }
}
