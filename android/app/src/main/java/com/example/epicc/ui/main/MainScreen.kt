package com.example.epicc.ui.main

import android.annotation.SuppressLint
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
        layoutParams = android.view.ViewGroup.LayoutParams(
          android.view.ViewGroup.LayoutParams.MATCH_PARENT,
          android.view.ViewGroup.LayoutParams.MATCH_PARENT
        )
        webViewClient = object : WebViewClient() {
          @Deprecated("Deprecated in Java")
          override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
            return false // Let WebView load the URL directly
          }
        }
        settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          databaseEnabled = true
          mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        loadUrl("https://epicc-ai-chat.onrender.com")
      }
    },
    modifier = Modifier.fillMaxSize()
  )
}
