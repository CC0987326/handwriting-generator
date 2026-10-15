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
    private static final int CONNECT_TIMEOUT = 15000;
    private static final int READ_TIMEOUT = 15000;                  // 单次读阻塞上限（非整包上限）：流式下慢速源也能持续传完
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

    /** active 指针指向的热更目录，是否含齐全的必需文件（半截包会缺 js/*）。 */
    private static boolean activeDirComplete(File root, String ver) {
        if (ver == null || ver.isEmpty()) return false;
        File d = new File(root, ver);
        return new File(d, "index.html").isFile()
                && new File(d, "js/catalog.js").isFile()
                && new File(d, "js/app.js").isFile()
                && new File(d, "css/paper.css").isFile();
    }

    /** 启动时调用：清掉「残缺的 active 目录」；若上次换了包却没 ack（pending 还在），回滚到上一版。 */
    public static void rollbackIfUnconfirmed(File root) {
        // (A) 无条件体检查：active 指向的目录必需文件不全（半截包/被清过）→ 直接弃用，回退内置资源。
        //     这一条不依赖 pending —— 老版本曾把「界面新、js 缺」的残缺包 ack 成了正式版，靠这里自愈。
        try {
            File cur = activePtr(root);
            if (cur.isFile()) {
                String v = readSmallFile(cur);
                if (!activeDirComplete(root, v)) {
                    Log.w(TAG, "active dir incomplete (" + v + "), discarding");
                    cur.delete();
                    deleteRec(new File(root, v));
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "active heal failed", e);
        }

        File pend = pendingPtr(root);
        if (!pend.isFile()) return;
        try {
            String prev = new File(root, "previous").isFile() ? readSmallFile(prevPtr(root)) : "";
            Log.w(TAG, "watchdog: pending boot not confirmed, rolling back to " + prev);
            pend.delete();
            File cur = activePtr(root);
            if (!prev.isEmpty() && activeDirComplete(root, prev)) {
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
            if (!isValidZip(tmpZip)) return "下载的更新包不完整";
            // 版本号核对：目标版本必须与包内 catalog.js 一致，杜绝「装错版/半截包」
            String zv = zipAppVersion(tmpZip);
            if (!zv.isEmpty() && !zv.equals(version.replace("v", ""))) {
                return "更新包版本不符（包内 " + zv + "，期望 " + version + "）";
            }
            deleteRec(stage);                          // 同版本重装：先清旧的
            if (!stage.mkdirs()) return "无法创建更新目录";
            unzip(tmpZip, stage);
            // 必需文件齐全才算装成功（半截包通常缺 js/*）
            if (!new File(stage, "index.html").isFile()
                    || !new File(stage, "js/catalog.js").isFile()
                    || !new File(stage, "js/app.js").isFile()
                    || !new File(stage, "css/paper.css").isFile()) {
                deleteRec(stage);
                return "更新包缺少必要文件（下载可能不完整）";
            }

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

    // 由原始链接生成候选下载地址：原样 + 各镜像前缀。
    // 若链接本身已带镜像前缀，先剥回原始 github 链接，再重新铺一遍所有镜像 ——
    // 这样「网页层已选中的镜像」在原生侧下不动时，仍能回退到其它镜像，而不是死守一个源。
    private static String[] candidates(String url) {
        String base = stripMirror(url);
        java.util.ArrayList<String> list = new java.util.ArrayList<String>();
        list.add(url);                                   // 网页层已择优的 URL 排第一，先用它
        for (String m : MIRRORS) list.add(m + base);     // 其余镜像兜底
        return list.toArray(new String[0]);
    }

    private static void download(String url, File out) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        // 读超时是「单次读阻塞」上限，不是整包时限 —— 流式下载下慢速源只要持续有数据就不会触发。
        // 之前设 60000 又叠加「网页层已选出镜像 → candidates 只剩一个源」→ 慢源上极易判 timeout。
        conn.setReadTimeout(READ_TIMEOUT);
        conn.setInstanceFollowRedirects(true);
        conn.connect();
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
        long declared = conn.getContentLength();
        long cap = declared > 0 ? Math.min(declared, MAX_ZIP_BYTES) : MAX_ZIP_BYTES;
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
            if (total <= 0) throw new IOException("下载为空");   // 空文件别当成功，交给下一个源
            // 关键修复：镜像/连接中途被掐断时，read() 会「正常」返回 -1（不抛异常），
            // 旧代码据此当成下完，装出「半截包」——界面变新、js 全缺、版本号不变。
            // 这里用 Content-Length 对照，字节数对不上就当失败，换下一个源。
            if (declared > 0 && total != declared) {
                throw new IOException("下载不完整：" + total + "/" + declared + " 字节");
            }
        } finally {
            try { in.close(); } catch (IOException ignored) { }
            try { fos.close(); } catch (IOException ignored) { }
        }
    }

    /** 某个源失败后，从它的 URL 里剥出原始 github.com 链接，供换镜像重试。 */
    private static String stripMirror(String url) {
        for (String m : MIRRORS) {
            if (!m.isEmpty() && url.startsWith(m)) return url.substring(m.length());
        }
        return url;
    }

    /**
     * 校验热更包是否**完整**。
     * 旧实现只看头 2 字节是不是 'PK' —— 被截断的半截 zip 开头同样是 PK，照样放行，
     * 于是「界面新、功能废」的残缺包被装上。这里改为结构性校验：
     *   1) 头 tail 8 字节必须是中央目录结束记录（EOCD, 'PK\x05\x06'）——截断文件没有；
     *   2) 头部 4 字节是本地文件头（'PK\x03\x04'）；
     *   3) EOCD 里记的「中央目录偏移 + 长度」必须正好落在文件末尾 —— 精确防截断。
     */
    private static boolean isValidZip(File f) {
        if (!f.isFile() || f.length() < 22) return false;   // EOCD 最小 22 字节
        long len = f.length();
        try {
            java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r");
            try {
                byte[] h = new byte[4];
                raf.seek(0);
                if (raf.read(h) != 4) return false;
                if (!(h[0] == 'P' && h[1] == 'K' && h[2] == 3 && h[3] == 4)) return false;   // 本地文件头

                // 在末尾 64KB 内从后往前找 EOCD 签名
                int win = (int) Math.min(len, 65557);
                byte[] tail = new byte[win];
                raf.seek(len - win);
                int got = 0;
                while (got < win) { int n = raf.read(tail, got, win - got); if (n < 0) break; got += n; }
                int eocd = -1;
                for (int i = got - 22; i >= 0; i--) {
                    if (tail[i] == 'P' && tail[i + 1] == 'K' && tail[i + 2] == 5 && tail[i + 3] == 6) { eocd = i; break; }
                }
                if (eocd < 0) return false;   // 没有中央目录 → 截断包
                long cdSize = u32(tail, eocd + 12);
                long cdOff = u32(tail, eocd + 16);
                long eocdStart = (len - win) + eocd;
                // 中央目录偏移应等于「EOCD 起点 - 中央目录长度」；对不上说明缺数据
                return cdOff + cdSize == eocdStart;
            } finally { raf.close(); }
        } catch (IOException e) { return false; }
    }

    private static long u32(byte[] b, int off) {
        return (b[off] & 0xFFL) | ((b[off + 1] & 0xFFL) << 8)
                | ((b[off + 2] & 0xFFL) << 16) | ((b[off + 3] & 0xFFL) << 24);
    }

    /** 从热更包里的 js/catalog.js 里读出 appVersion（形如 '1.3.7'）。读不到返回 ''。 */
    private static String zipAppVersion(File zip) {
        try {
            ZipInputStream zin = new ZipInputStream(new FileInputStream(zip));
            try {
                ZipEntry e;
                while ((e = zin.getNextEntry()) != null) {
                    if ("js/catalog.js".equals(e.getName().replace('\\', '/'))) {
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = zin.read(buf)) > 0) bos.write(buf, 0, n);
                        String t = new String(bos.toByteArray(), "UTF-8");
                        java.util.regex.Matcher m =
                                java.util.regex.Pattern.compile("appVersion\\s*=\\s*'([0-9]+\\.[0-9]+\\.[0-9]+)'").matcher(t);
                        return m.find() ? m.group(1) : "";
                    }
                }
            } finally { zin.close(); }
        } catch (Exception e) { /* 读不出就让调用方按“无法核对”处理 */ }
        return "";
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
