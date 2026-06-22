package com.example.epicc.ui.main

import android.annotation.SuppressLint
import android.app.Dialog
import android.os.Message
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation3.runtime.NavKey

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MainScreen(
  onItemClick: (NavKey) -> Unit,
  modifier: Modifier = Modifier,
) {
  AndroidView(
    factory = { context ->
      WebView(context).apply {
        layoutParams = ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
        webViewClient = object : WebViewClient() {
          @Deprecated("Deprecated in Java")
          override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
            return false // Let WebView load the URL directly
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
    modifier = modifier.fillMaxSize()
  )
}
