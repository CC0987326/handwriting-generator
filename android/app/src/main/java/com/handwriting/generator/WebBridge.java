package com.handwriting.generator;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * 暴露给网页的 window.HWAndroid。所有方法都返回 JSON 字符串（或用 evaluateJavascript 回调）。
 * 页面里的 js/native.js（androidBackend）和 js/updater.js、js/mobile.js 都会调这里。
 */
public class WebBridge {

    private static final String TAG = "HW-Bridge";
    // 专用单线程：热更下载耗时且可能几分钟，不能占用 WebView 的 JavaBridge 线程（会串死其它桥调用）
    private static final java.util.concurrent.ExecutorService UPDATE_EXEC =
            java.util.concurrent.Executors.newSingleThreadExecutor();
    private final MainActivity act;
    private final WebView web;
    private final File liveRoot;

    public WebBridge(MainActivity act, WebView web, File liveRoot) {
        this.act = act;
        this.web = web;
        this.liveRoot = liveRoot;
    }

    /** 存一张 PNG/JPEG 进系统相册（Pictures/手写作业生成器），返回 content:// URI。 */
    @JavascriptInterface
    public String saveImage(String name, String b64) {
        JSONObject r = new JSONObject();
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            String safe = (name == null || name.isEmpty()) ? "手写稿.png" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
            String mime = safe.toLowerCase().endsWith(".jpg") || safe.toLowerCase().endsWith(".jpeg")
                    ? "image/jpeg" : "image/png";
            Uri uri = writeToGallery(act, safe, mime, bytes);
            r.put("ok", uri != null);
            if (uri != null) r.put("uri", uri.toString());
            else r.put("error", "写入相册失败");
        } catch (Exception e) {
            Log.e(TAG, "saveImage failed", e);
            try { r.put("ok", false); r.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return r.toString();
    }

    private static Uri writeToGallery(Context ctx, String name, String mime, byte[] bytes) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            cv.put(MediaStore.Images.Media.MIME_TYPE, mime);
            cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/手写作业生成器");
            cv.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = ctx.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) return null;
            OutputStream os = ctx.getContentResolver().openOutputStream(uri);
            try { os.write(bytes); } finally { os.close(); }
            cv.clear();
            cv.put(MediaStore.Images.Media.IS_PENDING, 0);
            ctx.getContentResolver().update(uri, cv, null, null);
            return uri;
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "手写作业生成器");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, name);
            FileOutputStream fos = new FileOutputStream(f);
            try { fos.write(bytes); } finally { fos.close(); }
            // 通知相册刷新
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Images.Media.DATA, f.getAbsolutePath());
            return ctx.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
        }
    }

    /** 拉起系统分享面板，把刚导出的图片发出去。 */
    @JavascriptInterface
    public String shareImage(String urisJson) {
        try {
            JSONArray arr = new JSONArray(urisJson);
            ArrayList<Uri> uris = new ArrayList<Uri>();
            for (int i = 0; i < arr.length(); i++) uris.add(Uri.parse(arr.getString(i)));
            if (uris.isEmpty()) return "{\"ok\":false,\"error\":\"没有可分享的图片\"}";
            Intent intent;
            if (uris.size() == 1) {
                intent = new Intent(Intent.ACTION_SEND);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            } else {
                intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
                intent.setType("image/*");
                intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(intent, "分享手写稿");
            act.startActivity(chooser);
            return "{\"ok\":true}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 热更新：下载并切换网页包。放独立单线程执行器，别占用 WebView 的 JavaBridge 线程。 */
    @JavascriptInterface
    public void installUpdate(final String zipUrl, final String version) {
        UPDATE_EXEC.execute(new Runnable() {
            @Override public void run() {
                final String err = UpdateManager.install(liveRoot, zipUrl, version);
                act.runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (act.isFinishing() || act.isDestroyed()) return;   // Activity 已销毁：别回网页/重载
                        if (err == null) {
                            callback("update", true, "");
                            act.reloadApp();
                        } else {
                            callback("update", false, err);
                        }
                    }
                });
            }
        });
    }

    /** 启动成功确认（撤销看门狗回滚标记）。 */
    @JavascriptInterface
    public void bootOk() { UpdateManager.confirmBoot(liveRoot); }

    /** 网页崩溃主动上报 → 回滚。 */
    @JavascriptInterface
    public void bootFail() { UpdateManager.bootFail(liveRoot); }

    /** 原生外壳版本（versionName），供网页判断是否需要整体升级 APK。 */
    @JavascriptInterface
    public String nativeVersion() {
        try { return "{\"version\":\"" + act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName + "\"}"; }
        catch (Exception e) { return "{\"version\":\"\"}"; }
    }

    /** 用系统浏览器打开外链（更新下载页等）。 */
    @JavascriptInterface
    public void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) { Log.e(TAG, "openExternal failed", e); }
    }

    /** 打印当前网页（系统打印服务）。 */
    @JavascriptInterface
    public void print() {
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (web == null || act.isFinishing() || act.isDestroyed()) return;
                try {
                    PrintManager pm = (PrintManager) act.getSystemService(Context.PRINT_SERVICE);
                    String job = act.getPackageName() + " 手写稿";
                    pm.print(job, web.createPrintDocumentAdapter(job),
                            new PrintAttributes.Builder().build());
                } catch (Exception e) { Log.e(TAG, "print failed", e); }
            }
        });
    }

    /**
     * 拉起系统相机实时拍照（自定义纸张用）。WebView 会无视 <input capture>，
     * 必须原生 ACTION_IMAGE_CAPTURE。拍完经 onCameraResult 压成 JPEG base64 回传网页。
     */
    @JavascriptInterface
    public void takePhoto() {
        act.runOnUiThread(new Runnable() {
            @Override public void run() { act.startCameraCapture(); }
        });
    }

    private void callback(String kind, boolean ok, String msg) {
        final String js = "window.__hwNativeCb && window.__hwNativeCb(" +
                JSONObject.quote(kind) + "," + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")";
        web.post(new Runnable() {
            @Override public void run() { web.evaluateJavascript(js, null); }
        });
    }
}
