/* ============================================================
 * 手写作业生成器 · 轻量单文件外壳（WinForms + WebView2）
 * 一个 exe 搞定：界面、字体、纸张纹理全部压进 exe 尾部，
 * 首次运行自解压到 %LOCALAPPDATA%\手写作业生成器\ 后启动。
 * 不捆绑 Chromium —— 直接用 Windows 自带的 Edge WebView2 内核。
 * ============================================================ */
using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace HandwritingApp
{
    internal static class Program
    {
        public const string AppName = "手写作业生成器";
        public const string AppVer  = "1.3.1";                 // 载荷变了就改这里，强制重新解压
        public const string WV2_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
        private const ulong MAGIC   = 0x484C574154544552UL;    // 'HLWATTER' 尾部标记
        private const int   TRAILER = 16;                      // [uint64 长度][uint64 标记]

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr LoadLibraryW(string path);

        private static string _payloadDir;   // 载荷解压目录（StartUi 之前设定好）

        // 入口：挂程序集解析 → 先解压（不碰任何 WebView2 类型）→ 再起界面
        [STAThread]
        private static void Main()
        {
            AppDomain.CurrentDomain.AssemblyResolve += OnResolve;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try { _payloadDir = EnsureExtracted(); }
            catch (Exception ex)
            {
                MessageBox.Show("首次解压运行组件失败：\n" + ex.Message + "\n\n请把本程序放到有写入权限的位置再试。",
                    AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            StartUi();
        }

        // WebView2 托管程序集从解压目录按需加载（此刻文件已落盘）
        private static Assembly OnResolve(object sender, ResolveEventArgs args)
        {
            var simple = new AssemblyName(args.Name).Name;
            if (simple != "Microsoft.Web.WebView2.Core" && simple != "Microsoft.Web.WebView2.WinForms")
                return null;
            if (string.IsNullOrEmpty(_payloadDir)) return null;
            var p = Path.Combine(_payloadDir, simple + ".dll");
            try { return File.Exists(p) ? Assembly.LoadFrom(p) : null; }
            catch (Exception) { return null; }
        }

        // 把 exe 尾部嵌入的 payload.zip 定位成流
        private static Stream OpenPayloadStream()
        {
            var fs = new FileStream(Application.ExecutablePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            long total = fs.Length;
            if (total <= TRAILER) throw new InvalidDataException("文件不完整");
            fs.Seek(total - TRAILER, SeekOrigin.Begin);
            var tail = new byte[TRAILER];
            fs.Read(tail, 0, TRAILER);
            ulong len = BitConverter.ToUInt64(tail, 0);
            ulong magic = BitConverter.ToUInt64(tail, 8);
            if (magic != MAGIC || (long)len <= 0 || (long)len > total - TRAILER)
                throw new InvalidDataException("未找到内嵌数据（请勿拆分此 exe）");
            long start = total - TRAILER - (long)len;
            return new SubStream(fs, start, (long)len);
        }

        private static string EnsureExtracted()
        {
            string payloadDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                AppName, "app-" + AppVer);
            var okPath = Path.Combine(payloadDir, ".ok");
            bool ready = false;
            try { ready = File.Exists(okPath) && File.ReadAllText(okPath).Trim() == AppVer
                          && File.Exists(Path.Combine(payloadDir, "view", "index.html")); }
            catch (Exception) { ready = false; }
            if (!ready) ExtractPayload(payloadDir);
            return payloadDir;
        }

        // 只在解压完成、文件落盘之后才被调用 —— 里面才会碰 WebView2 类型
        private static void StartUi()
        {
            string payloadDir = _payloadDir;
            string index = Path.Combine(payloadDir, "view", "index.html");

            if (!File.Exists(index))
            {
                MessageBox.Show("界面文件缺失，请重新获取完整的程序文件。", AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // 原生 WebView2Loader.dll 必须能被 [DllImport] 找到：从载荷目录预加载
            try { LoadLibraryW(Path.Combine(payloadDir, "WebView2Loader.dll")); } catch (Exception) { }

            string ver = null;
            try { ver = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (Exception) { ver = null; }
            if (string.IsNullOrEmpty(ver))
            {
                var r = MessageBox.Show(
                    "本机缺少 Microsoft Edge WebView2 运行时。\n\n" +
                    "Windows 10/11 一般自带；个别精简版或老系统需要补装一次（微软官方、免费、约十几秒）。\n\n" +
                    "是否现在打开官方安装页？装好后再双击本程序即可。",
                    AppName + " · 需要补装运行组件",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (r == DialogResult.Yes)
                {
                    try { System.Diagnostics.Process.Start(WV2_URL); } catch (Exception) { }
                }
                return;
            }

            Application.Run(new MainForm(index, payloadDir));
        }

        // 首次运行：把内嵌载荷解压到 payloadDir，并落一个 .ok 标记
        private static void ExtractPayload(string payloadDir)
        {
            if (Directory.Exists(payloadDir)) { try { Directory.Delete(payloadDir, true); } catch (Exception) { } }
            Directory.CreateDirectory(payloadDir);

            using (var splash = new Splash())
            {
                splash.Show();
                Application.DoEvents();
                using (var payload = OpenPayloadStream())
                using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    string rootFull = Path.GetFullPath(payloadDir) + Path.DirectorySeparatorChar;
                    foreach (var e in zip.Entries)
                    {
                        string dest = Path.Combine(payloadDir, e.FullName.Replace('/', Path.DirectorySeparatorChar));
                        // 防 Zip Slip：条目名带 ..\ 或绝对路径可能逃出 payloadDir
                        if (!Path.GetFullPath(dest).StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
                            throw new IOException("载荷条目非法路径：" + e.FullName);
                        if (string.IsNullOrEmpty(e.Name)) { Directory.CreateDirectory(dest); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        using (var es = e.Open())
                        using (var fs = File.Create(dest))
                            es.CopyTo(fs);
                        Application.DoEvents();
                    }
                }
                splash.Close();
            }
            File.WriteAllText(Path.Combine(payloadDir, ".ok"), AppVer);
        }
    }

    // 首次解压时的小提示窗
    internal sealed class Splash : Form
    {
        public Splash()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(340, 92);
            BackColor = Color.FromArgb(0xF4, 0xF1, 0xE8);
            ShowInTaskbar = true;
            var lbl = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter,
                ForeColor = Color.FromArgb(0x1E, 0x23, 0x28),
                Font = new Font("Microsoft YaHei UI", 10.5f),
                Text = Program.AppName + "\n首次启动，正在准备（约十几秒）…"
            };
            Controls.Add(lbl);
        }
    }

    // 只读、定长子流：把 exe 里的一段字节伪装成一个流给 ZipArchive
    internal sealed class SubStream : Stream
    {
        private readonly Stream _base;
        private readonly long _start, _len, _end;
        private long _pos;
        public SubStream(Stream b, long start, long len) { _base = b; _start = start; _len = len; _end = start + len; _pos = 0; }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return _len; } }
        public override long Position { get { return _pos; } set { _pos = value; } }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_pos >= _len) return 0;
            _base.Seek(_start + _pos, SeekOrigin.Begin);
            int want = (int)Math.Min(count, _len - _pos);
            int got = _base.Read(buffer, offset, want);
            _pos += got;
            return got;
        }
        public override long Seek(long off, SeekOrigin origin)
        {
            long np = origin == SeekOrigin.Begin ? off : origin == SeekOrigin.Current ? _pos + off : _len + off;
            _pos = Math.Max(0, Math.Min(_len, np));
            return _pos;
        }
        public override void SetLength(long v) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
        public override void Flush() { }
        protected override void Dispose(bool disposing)
        {
            // 释放底层 exe 文件流：否则 using(SubStream) 只关了包装、底流要等 GC 终结才关
            if (disposing) { try { if (_base != null) _base.Dispose(); } catch (Exception) { } }
            base.Dispose(disposing);
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly WebView2 _wv;
        private CoreWebView2Environment _env;
        private readonly string _userData;
        private readonly string _indexUrl;
        private string _savePath;   // 本次导出：单文件的目标路径
        private string _saveDir;    // 本次导出：多文件的目标文件夹

        public MainForm(string indexPath, string payloadDir)
        {
            Text = Program.AppName;
            Width = 1360; Height = 900;
            MinimumSize = new Size(900, 620);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(0xE3, 0xDD, 0xCC);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            _indexUrl = new Uri(indexPath).AbsoluteUri;
            _userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                Program.AppName, "WebView2");

            _wv = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(0xE3, 0xDD, 0xCC)
            };
            Controls.Add(_wv);

            Load += async (s, e) =>
            {
                try { Directory.CreateDirectory(_userData); } catch (Exception) { }
                var opts = new CoreWebView2EnvironmentOptions("--allow-file-access-from-files");
                _env = await CoreWebView2Environment.CreateAsync(null, _userData, opts);
                await _wv.EnsureCoreWebView2Async(_env);

                var st = _wv.CoreWebView2.Settings;
                st.AreDefaultContextMenusEnabled = false;
                st.IsStatusBarEnabled = false;
                st.AreDevToolsEnabled = false;
                st.IsZoomControlEnabled = true;

                Hook(_wv.CoreWebView2);
                _wv.CoreWebView2.Navigate(_indexUrl);
            };
        }

        private void Hook(CoreWebView2 core)
        {
            core.NewWindowRequested += async (s, e) =>
            {
                // 外链（http/https，如更新提示里的「去下载」）→ 交给系统默认浏览器，不在本程序里开
                var uri = e.Uri ?? "";
                if (uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                    uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    e.Handled = true;
                    try { System.Diagnostics.Process.Start(uri); } catch (Exception) { }
                    return;
                }

                // 其余（about:blank / file://，打印用 newWindow）→ 内嵌子窗口，保留打印流程
                var deferral = e.GetDeferral();
                try
                {
                    var child = new Form { Text = "打印手写稿", Width = 900, Height = 720,
                        StartPosition = FormStartPosition.CenterParent, Icon = this.Icon };
                    var cw = new WebView2 { Dock = DockStyle.Fill };
                    child.Controls.Add(cw);
                    child.FormClosed += (cs, ce) => { try { cw.Dispose(); } catch (Exception) { } };
                    child.Show(this);
                    await cw.EnsureCoreWebView2Async(_env);
                    Hook(cw.CoreWebView2);
                    e.NewWindow = cw.CoreWebView2;
                }
                catch (Exception) { }
                finally { deferral.Complete(); }
            };

            // 导出落盘：页面把 PNG/PDF 通过 postMessage 交过来，这里弹原生对话框写盘，
            // 不再走浏览器下载通道（也就没有「下载多个文件」的拦截）。
            core.WebMessageReceived += (s, e) => HandleWebMessage(core, e);

            core.DownloadStarting += (s, e) =>
            {
                try
                {
                    var name = Path.GetFileName(e.ResultFilePath);
                    e.ResultFilePath = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                        "Downloads", name);
                }
                catch (Exception) { }
            };
        }

        // 处理页面的原生保存请求（协议见 js/native.js）
        private void HandleWebMessage(CoreWebView2 core, CoreWebView2WebMessageReceivedEventArgs e)
        {
            // 只接受本地页面（file://）发来的保存请求
            string src = null;
            try { src = e.Source; } catch (Exception) { }
            if (string.IsNullOrEmpty(src) ||
                src.IndexOf("file://", StringComparison.OrdinalIgnoreCase) != 0) return;

            string line = null;
            try { line = e.TryGetWebMessageAsString(); } catch (Exception) { }
            if (string.IsNullOrEmpty(line)) return;
            var f = line.Split('\t');
            if (f.Length < 2) return;
            string type = f[0], id = f[1];

            try
            {
                if (type == "p")                       // 选目标：1 张 → 另存为；多张 → 选文件夹
                {
                    int count = 0; int.TryParse(f.Length > 2 ? f[2] : "1", out count);
                    string first = f.Length > 3 ? f[3] : "手写稿.png";
                    bool ok = false; string label = "";
                    if (count > 1)
                    {
                        using (var dlg = new FolderBrowserDialog())
                        {
                            dlg.Description = "选择保存位置（本次导出的 " + count + " 个文件都存这里）";
                            if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath))
                            { _saveDir = dlg.SelectedPath; _savePath = null; ok = true; label = dlg.SelectedPath; }
                        }
                    }
                    else
                    {
                        using (var dlg = new SaveFileDialog())
                        {
                            dlg.Title = "保存文件";
                            dlg.FileName = SafeName(first);
                            dlg.Filter = FilterFor(first);
                            dlg.OverwritePrompt = true;
                            if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.FileName))
                            { _savePath = dlg.FileName; _saveDir = null; ok = true; label = dlg.FileName; }
                        }
                    }
                    Reply(core, ok ? ("ok\t" + id + "\t" + label) : ("no\t" + id));
                }
                else if (type == "w")                  // 写一个文件：w \t id \t 文件名 \t base64
                {
                    if (f.Length < 4) { Reply(core, "err\t" + id + "\t缺少内容"); return; }
                    string name = SafeName(f[2]);
                    string target = (_savePath != null) ? _savePath : Path.Combine(_saveDir, name);
                    byte[] bytes = Convert.FromBase64String(f[3]);
                    File.WriteAllBytes(target, bytes);
                    Reply(core, "ok\t" + id + "\t" + target);
                }
            }
            catch (Exception ex)
            {
                try { Reply(core, "err\t" + id + "\t" + ex.Message.Replace('\t', ' ')); } catch (Exception) { }
            }
        }

        private void Reply(CoreWebView2 core, string msg)
        {
            try { core.PostWebMessageAsString(msg); } catch (Exception) { }
        }

        private static string SafeName(string n)
        {
            if (string.IsNullOrEmpty(n)) return "手写稿.png";
            foreach (var c in Path.GetInvalidFileNameChars()) n = n.Replace(c, '_');
            // 只取文件名，去掉可能带进来的路径
            n = Path.GetFileName(n);
            return string.IsNullOrEmpty(n) ? "手写稿.png" : n;
        }

        private static string FilterFor(string name)
        {
            string ext = (Path.GetExtension(name) ?? "").TrimStart('.').ToLowerInvariant();
            if (ext == "pdf") return "PDF 文件 (*.pdf)|*.pdf|所有文件 (*.*)|*.*";
            if (ext == "jpg" || ext == "jpeg") return "JPEG 图片 (*.jpg)|*.jpg|所有文件 (*.*)|*.*";
            return "PNG 图片 (*.png)|*.png|所有文件 (*.*)|*.*";
        }
    }
}
