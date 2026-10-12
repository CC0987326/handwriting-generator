package com.handwriting.generator;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;
import android.webkit.WebResourceResponse;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 网页资源的「双源」路由：优先读热更目录（filesDir/web/<active>/），否则回退 APK 内置 assets/web/。
 *
 * 关键点：所有请求都走同一个 host（appassets.androidplatform.net），所以 localStorage/IndexedDB
 * 在热更前后属于同一 origin —— 草稿、纸张设置不会因为热更而丢失。
 */
public class WebAssetRouter implements WebViewAssetLoader.PathHandler {

    private static final String TAG = "HW-Router";
    private final Context ctx;
    private final AssetManager assets;
    private final File liveDir;   // filesDir/web 根；active 指针指向其中一个子目录

    public WebAssetRouter(Context ctx, File liveDir) {
        this.ctx = ctx;
        this.assets = ctx.getAssets();
        this.liveDir = liveDir;
    }

    /** 当前生效的热更网页根目录（无则 null，表示用 APK 内置资源） */
    private File activeRoot() {
        File ptr = new File(liveDir, "active");
        if (!ptr.isFile()) return null;
        try {
            String v = UpdateManager.readSmallFile(ptr).trim();
            if (v.isEmpty()) return null;
            File dir = new File(liveDir, v);
            if (new File(dir, "index.html").isFile()) return dir;
        } catch (IOException e) {
            Log.w(TAG, "read active ptr failed", e);
        }
        return null;
    }

    @Nullable
    @Override
    public WebResourceResponse handle(@NonNull String path) {
        // path 形如 "/index.html" 或 "/js/app.js"
        String rel = path.startsWith("/") ? path.substring(1) : path;
        if (rel.isEmpty()) rel = "index.html";

        File live = activeRoot();
        if (live != null) {
            File f = new File(live, rel);
            // 防目录穿越
            if (f.isFile() && f.getAbsolutePath().startsWith(live.getAbsolutePath())) {
                try {
                    InputStream in = new FileInputStream(f);
                    return new WebResourceResponse(mimeOf(rel), null, 200, "OK",
                            headers(), in);
                } catch (IOException e) {
                    Log.w(TAG, "open live file failed: " + rel, e);
                }
            }
        }

        // 回退：APK 内置 assets/web/
        try {
            InputStream in = assets.open("web/" + rel);
            return new WebResourceResponse(mimeOf(rel), null, 200, "OK", headers(), in);
        } catch (IOException e) {
            // 404
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers(), null);
        }
    }

    private Map<String, String> headers() {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Cache-Control", "no-cache");
        return h;
    }

    private static String mimeOf(String rel) {
        String p = rel.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }
}
