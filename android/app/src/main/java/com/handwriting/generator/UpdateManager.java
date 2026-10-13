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

    // 国内可达的 GitHub 加速镜像前缀（含空串=直连）。网页层已择优，这里再兜一层：
    // 网页给的 URL 下不动时，自动换其它镜像重试（国内直连 github.com 常被墙）。
    private static final String[] MIRRORS = {
        "https://gh-proxy.com/",
        "https://ghproxy.net/",
        "https://ghfast.top/",
        "https://gh.llkk.cc/",
        ""
    };
    private static final long MAX_ZIP_BYTES = 200L * 1024 * 1024;   // 热更包体积上限，防恶意/异常大文件写爆 filesDir
    // 单飞：同一时刻只允许一个热更安装，避免两次并发共用同一个临时文件/目录互相破坏
    private static final java.util.concurrent.atomic.AtomicBoolean INSTALLING =
            new java.util.concurrent.atomic.AtomicBoolean(false);

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
        if (!INSTALLING.compareAndSet(false, true)) return "已有更新正在进行中";
        File tmpZip = new File(root, "download." + System.nanoTime() + ".tmp.zip");   // 唯一临时名，避免并发互踩
        String safeVer = sanitizeVersion(version);
        File stage = new File(root, safeVer);          // 目录名 = 清洗后的版本号，与 active 指针一致
        try {
            if (safeVer.isEmpty()) return "版本号非法";
            downloadAny(zipUrl, tmpZip);
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
            writeSmallFile(pendingPtr(root), safeVer);   // 看门狗：等网页 ack
            writeSmallFile(active, safeVer);
            return null;
        } catch (Exception e) {
            Log.e(TAG, "install failed", e);
            deleteRec(stage);                          // 装失败就把半成品清掉
            return String.valueOf(e.getMessage());
        } finally {
            tmpZip.delete();
            INSTALLING.set(false);
        }
    }

    // 版本号当目录名用：只允许 [0-9A-Za-z._-]，其余剔除，防目录注入
    private static String sanitizeVersion(String v) {
        if (v == null) return "";
        return v.replaceAll("[^0-9A-Za-z._-]", "");
    }

    // ---------- 下载：优先用网页给的 URL，失败则依次换镜像前缀重试 ----------
    private static void downloadAny(String url, File out) throws IOException {
        IOException last = null;
        String[] cands = candidates(url);
        for (String u : cands) {
            try { download(u, out); return; }
            catch (IOException e) { last = e; Log.w(TAG, "下载失败，换源：" + u + " (" + e.getMessage() + ")"); }
        }
        throw (last != null ? last : new IOException("无可用的下载源"));
    }

    // 由原始链接生成候选下载地址：原样 + 各镜像前缀（已是镜像的就不再套）
    private static String[] candidates(String url) {
        java.util.ArrayList<String> list = new java.util.ArrayList<String>();
        list.add(url);
        boolean mirrored = false;
        for (String m : MIRRORS) {
            if (!m.isEmpty() && url.startsWith(m)) { mirrored = true; break; }
        }
        if (!mirrored) for (String m : MIRRORS) list.add(m + url);
        return list.toArray(new String[0]);
    }

    private static void download(String url, File out) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setInstanceFollowRedirects(true);
        conn.connect();
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
        long cap = conn.getContentLength() > 0 ? Math.min((long) conn.getContentLength(), MAX_ZIP_BYTES) : MAX_ZIP_BYTES;
        InputStream in = conn.getInputStream();
        FileOutputStream fos = new FileOutputStream(out);
        try {
            byte[] buf = new byte[65536];
            long total = 0; int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > cap) throw new IOException("更新包超过体积上限");
                fos.write(buf, 0, n);
            }
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
                // 用「目标根 + 分隔符」比较，避免前缀相同的兄弟目录（.../web/1.2 vs .../web/1.20）被误判为在内部
                String destRoot = dest.getCanonicalPath() + File.separator;
                if (!out.getCanonicalPath().startsWith(destRoot)) {
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
