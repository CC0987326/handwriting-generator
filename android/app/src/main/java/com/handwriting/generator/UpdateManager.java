package com.handwriting.generator;

import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 网页热更新的「下载 → 校验 → 原子切换 → 看门狗回滚」。
 *
 * 目录约定（均在 filesDir/web 下）：
 *   active          —— 指针文件，内容为当前生效的版本目录名（如 "1.2.1"）
 *   pending         —— 存在即表示「刚换了新包、还没确认启动成功」（看门狗标记）
 *   previous        —— 上一个版本目录名，回滚用
 *   <ver>/          —— 解出来的网页资源（index.html、js/、css/、fonts/…）
 */
public class UpdateManager {

    private static final String TAG = "HW-Update";

    // ---------- 指针读写 ----------
    static String readSmallFile(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        try {
            byte[] buf = new byte[(int) Math.min(f.length(), 4096)];
            int n = in.read(buf);
            return n <= 0 ? "" : new String(buf, 0, n, "UTF-8").trim();
        } finally {
            try { in.close(); } catch (IOException ignored) { }
        }
    }

    private static void writeSmallFile(File f, String s) throws IOException {
        FileOutputStream out = new FileOutputStream(f);
        try {
            out.write(s.getBytes("UTF-8"));
        } finally {
            try { out.close(); } catch (IOException ignored) { }
        }
    }

    private static File activePtr(File root) { return new File(root, "active"); }
    private static File pendingPtr(File root) { return new File(root, "pending"); }
    private static File prevPtr(File root) { return new File(root, "previous"); }

    /** 启动时调用：若上次换了包却没 ack（pending 还在），自动回滚到上一版。 */
    public static void rollbackIfUnconfirmed(File root) {
        File pend = pendingPtr(root);
        if (!pend.isFile()) return;
        try {
            String prev = new File(root, "previous").isFile() ? readSmallFile(prevPtr(root)) : "";
            Log.w(TAG, "watchdog: pending boot not confirmed, rolling back to " + prev);
            pend.delete();
            File cur = activePtr(root);
            if (!prev.isEmpty() && new File(new File(root, prev), "index.html").isFile()) {
                writeSmallFile(cur, prev);
            } else {
                cur.delete();   // 没有可回滚的包 → 回到 APK 内置资源
            }
        } catch (IOException e) {
            Log.e(TAG, "rollback failed", e);
        }
    }

    /** 网页确认启动成功 → 撤销看门狗标记。 */
    public static void confirmBoot(File root) {
        File pend = pendingPtr(root);
        if (pend.isFile()) pend.delete();
    }

    /** 网页主动报告崩溃 → 立即回滚。 */
    public static void bootFail(File root) {
        rollbackIfUnconfirmed(root);
    }

    /**
     * 下载并安装一个网页热更包（同步执行，调用方应放后台线程）。
     * @return 错误信息，null 表示成功
     */
    public static String install(File root, String zipUrl, String version) {
        File tmpZip = new File(root, "download.tmp.zip");
        File stage = new File(root, version);          // 目录名 = 版本号，与 active 指针一致
        try {
            download(zipUrl, tmpZip);
            if (!isValidZip(tmpZip)) return "下载的更新包无效";
            deleteRec(stage);                          // 同版本重装：先清旧的
            if (!stage.mkdirs()) return "无法创建更新目录";
            unzip(tmpZip, stage);
            if (!new File(stage, "index.html").isFile()) { deleteRec(stage); return "更新包缺少 index.html"; }

            // 原子切换：记下当前版本为 previous，再指到新版本
            File active = activePtr(root);
            if (active.isFile()) {
                writeSmallFile(prevPtr(root), readSmallFile(active));
            }
            writeSmallFile(pendingPtr(root), version);   // 看门狗：等网页 ack
            writeSmallFile(active, version);
            return null;
        } catch (Exception e) {
            Log.e(TAG, "install failed", e);
            deleteRec(stage);                          // 装失败就把半成品清掉
            return String.valueOf(e.getMessage());
        } finally {
            tmpZip.delete();
        }
    }

    // ---------- 工具 ----------
    private static void download(String url, File out) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setInstanceFollowRedirects(true);
        conn.connect();
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
        InputStream in = conn.getInputStream();
        FileOutputStream fos = new FileOutputStream(out);
        try {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
        } finally {
            try { in.close(); } catch (IOException ignored) { }
            try { fos.close(); } catch (IOException ignored) { }
        }
    }

    private static boolean isValidZip(File f) {
        if (!f.isFile() || f.length() < 4) return false;
        try {
            FileInputStream in = new FileInputStream(f);
            try {
                byte[] h = new byte[4];
                if (in.read(h) != 4) return false;
                // 'PK\x03\x04' 或 'PK\x05\x06'(空) 或 'PK\x07\x08'
                return h[0] == 'P' && h[1] == 'K';
            } finally { in.close(); }
        } catch (IOException e) { return false; }
    }

    private static void unzip(File zip, File dest) throws IOException {
        ZipInputStream zin = new ZipInputStream(new FileInputStream(zip));
        try {
            ZipEntry e;
            byte[] buf = new byte[65536];
            while ((e = zin.getNextEntry()) != null) {
                File out = new File(dest, e.getName());
                if (!out.getCanonicalPath().startsWith(dest.getCanonicalPath())) {
                    throw new IOException("非法路径：" + e.getName());
                }
                if (e.isDirectory()) {
                    out.mkdirs();
                } else {
                    File parent = out.getParentFile();
                    if (parent != null) parent.mkdirs();
                    FileOutputStream fos = new FileOutputStream(out);
                    try {
                        int n;
                        while ((n = zin.read(buf)) > 0) fos.write(buf, 0, n);
                    } finally { fos.close(); }
                }
                zin.closeEntry();
            }
        } finally { zin.close(); }
    }

    private static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRec(k);
        }
        f.delete();
    }

    public static String sha256(File f) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            FileInputStream in = new FileInputStream(f);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            in.close();
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { return ""; }
    }
}
