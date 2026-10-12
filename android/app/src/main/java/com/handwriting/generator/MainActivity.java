package com.handwriting.generator;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;

/**
 * 主界面：一个全屏 WebView 承载现有的手写生成器网页。
 * 资源经 WebViewAssetLoader 走 https://appassets.androidplatform.net/，由 WebAssetRouter 决定
 * 从热更目录还是 APK 内置 assets 读取；同 origin 保证 localStorage 跨热更不丢。
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "HW-Main";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASE_URL = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 1001;

    private WebView web;
    private WebViewAssetLoader loader;
    private File liveRoot;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        liveRoot = new File(getFilesDir(), "web");
        if (!liveRoot.exists()) liveRoot.mkdirs();
        // 看门狗：上次热更后没确认启动成功 → 回滚，避免更新包把 App 砖掉
        UpdateManager.rollbackIfUnconfirmed(liveRoot);

        loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/", new WebAssetRouter(this, liveRoot))
                .build();

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage（草稿、主题、纸张增删）
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);           // 走 AssetLoader，不需要 file://
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                    // 不随系统字号缩放，避免布局跑偏
        s.setMediaPlaybackRequiresUserGesture(false);

        web.addJavascriptInterface(new WebBridge(this, web, liveRoot), "HWAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null) return false;
                // 非本地页 → 交给系统浏览器（更新页、外链）
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) { Log.w(TAG, "open external failed", e); }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        web.loadUrl(BASE_URL);
    }

    /** 热更后重载：router 每次请求都重读 active 指针，直接重载即生效。 */
    public void reloadApp() {
        runOnUiThread(() -> web.loadUrl(BASE_URL));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web != null && web.canGoBack()) { web.goBack(); return true; }
            // 单页应用无历史 → 直接退出
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
