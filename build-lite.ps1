# ============================================================
# 手写作业生成器 · 轻量单文件打包（WebView2 外壳）
# 产物：dist-lite\手写作业生成器.exe —— 一个文件，拷给别人双击即用
#   界面/字体/纸张纹理压进 exe；首次运行自解压到
#   %LOCALAPPDATA%\手写作业生成器\app-<指纹>\ ，之后直接启动。
#   不捆绑 Chromium：用 Windows 自带的 Edge WebView2 内核。
# 依赖：Windows 自带的 .NET Framework（csc.exe）与 Edge WebView2 运行时（Win10/11 基本都有）
# 注意：载荷一变，指纹变，用户端自动重新解压；无需手动清缓存。
# ============================================================
$ErrorActionPreference = 'Stop'
$root  = $PSScriptRoot
$csc   = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$wv    = Join-Path $root 'launcher\webview2'
$outDir= Join-Path $root 'dist-lite'
$tmp   = Join-Path $env:TEMP ('hwbuild_' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $tmp 'payload'
$MAGIC = [UInt64]0x484C574154544552   # 'HLWATTER'

Write-Host '== 手写作业生成器 · 轻量单文件打包 ==' -ForegroundColor Cyan
if (!(Test-Path $csc)) { throw '找不到 csc.exe，请确认 .NET Framework 已安装' }
New-Item -ItemType Directory -Force -Path $outDir,$stage,(Join-Path $stage 'view') | Out-Null

# 1) 收集载荷：界面 + 字体 + WebView2 组件
Write-Host '[1/4] 收集载荷（约 210MB，大头是手写字体）...'
Copy-Item (Join-Path $root 'index.html') (Join-Path $stage 'index.html') -Force
Copy-Item (Join-Path $wv 'WebView2Loader.dll')                  $stage -Force
Copy-Item (Join-Path $wv 'Microsoft.Web.WebView2.Core.dll')     $stage -Force
Copy-Item (Join-Path $wv 'Microsoft.Web.WebView2.WinForms.dll') $stage -Force
Copy-Item (Join-Path $root 'index.html') (Join-Path $stage 'view\index.html') -Force
foreach ($d in 'js','css','fonts','assets') {
  Copy-Item (Join-Path $root $d) (Join-Path $stage ('view\' + $d)) -Recurse -Force
}

# 2) 打成 payload.zip（.NET 自带压缩，条目名用正斜杠，与外壳解压逻辑一致）
Write-Host '[2/4] 压缩载荷 ...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $tmp 'payload.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# 3) 用载荷指纹当版本号：内容一变，用户端自动重新解压
$fp = (Get-FileHash $zip -Algorithm SHA256).Hash.Substring(0,10).ToLower()
Write-Host ("[3/4] 载荷指纹 = $fp，编译外壳 ...")
$src = Get-Content (Join-Path $root 'launcher\App.cs') -Raw -Encoding UTF8
$src = [Regex]::Replace($src, 'public const string AppVer\s*=\s*"[^"]*"', ('public const string AppVer  = "' + $fp + '"'))
$cs  = Join-Path $tmp 'App.gen.cs'
[IO.File]::WriteAllText($cs, $src, (New-Object Text.UTF8Encoding($false)))
$exePart = Join-Path $tmp 'app.exe'
& $csc -nologo -target:winexe -platform:x64 -optimize+ `
  "-out:$exePart" `
  "-win32icon:$(Join-Path $root 'assets\icon.ico')" `
  $cs `
  "-r:$(Join-Path $wv 'Microsoft.Web.WebView2.Core.dll')" `
  "-r:$(Join-Path $wv 'Microsoft.Web.WebView2.WinForms.dll')" `
  -r:System.Windows.Forms.dll -r:System.Drawing.dll `
  -r:System.IO.Compression.dll -r:System.IO.Compression.FileSystem.dll
if ($LASTEXITCODE -ne 0) { throw '编译失败' }

# 4) 拼接：外壳 exe + payload.zip + 尾部[长度,标记]
Write-Host '[4/4] 生成单文件 ...'
$eb = [IO.File]::ReadAllBytes($exePart)
$pb = [IO.File]::ReadAllBytes($zip)
$final = Join-Path $outDir '手写作业生成器.exe'
$fs = [IO.File]::Create($final)
try {
  $fs.Write($eb, 0, $eb.Length)
  $fs.Write($pb, 0, $pb.Length)
  $lb = [BitConverter]::GetBytes([UInt64]$pb.Length); $fs.Write($lb, 0, 8)
  $mb = [BitConverter]::GetBytes($MAGIC);            $fs.Write($mb, 0, 8)
} finally { $fs.Close() }

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
$size = (Get-Item $final).Length / 1MB
Write-Host ("完成：{0}（{1:N1} MB，指纹 {2}）" -f $final, $size, $fp) -ForegroundColor Green
Write-Host '把这一个 exe 发给别人，双击即用；首次启动约十几秒（自解压），之后 2 秒内开。' -ForegroundColor Green
