# ============================================================
# 手写作业生成器 · Android APK 打包
# 产物：dist-apk\手写作业生成器-<版本>.apk （Release 签名）
#       dist-apk\web-<版本>.zip    （网页热更包，随 Release 一起发）
# 依赖：已装 Android SDK（build-tools 34 / platform android-34）+ JDK17
#   首次会由 gradlew 自动下载 Gradle 发行包（需联网）。
# 用法：powershell -NoProfile -File build-apk.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
$root   = $PSScriptRoot
$and    = Join-Path $root 'android'
$webDst = Join-Path $and 'app\src\main\assets\web'
$outDir = Join-Path $root 'dist-apk'

Write-Host '== 手写作业生成器 · Android APK 打包 ==' -ForegroundColor Cyan

# 0) 从 js/catalog.js 读版本号（单一出处）
$cat = Get-Content (Join-Path $root 'js\catalog.js') -Raw -Encoding UTF8
$m = [Regex]::Match($cat, "appVersion\s*=\s*'([0-9]+\.[0-9]+\.[0-9]+)'")
if (-not $m.Success) { throw '找不到 js/catalog.js 里的 HW.appVersion' }
$ver = $m.Groups[1].Value
$parts = $ver.Split('.')
$verCode = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]
Write-Host "版本 = $ver (code $verCode)"

# 1) 收集网页资源 → android/app/src/main/assets/web
Write-Host '[1/4] 收集网页资源...'
if (Test-Path $webDst) { Remove-Item $webDst -Recurse -Force }
New-Item -ItemType Directory -Force -Path $webDst | Out-Null
Copy-Item (Join-Path $root 'index.html') (Join-Path $webDst 'index.html') -Force
foreach ($d in 'js','css','fonts','assets') {
  Copy-Item (Join-Path $root $d) (Join-Path $webDst $d) -Recurse -Force
}

# 2) 打网页热更包 web-<ver>.zip（内容与 assets/web 相同，供 App 内热更）
Write-Host '[2/4] 打网页热更包...'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$webzip = Join-Path $outDir ("web-$ver.zip")
if (Test-Path $webzip) { Remove-Item $webzip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($webDst, $webzip,
  [System.IO.Compression.CompressionLevel]::Optimal, $false)
Write-Host ("      web-$ver.zip  " + [Math]::Round((Get-Item $webzip).Length/1MB,1) + ' MB')

# 3) 编译 APK（gradlew 自动下 Gradle；首次会拉 AGP 依赖，较慢）
Write-Host '[3/4] 编译 APK（首次较慢）...'
Push-Location $and
try {
  # 优先用环境变量 JAVA_HOME；没有就试几个常见位置
  if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) {
    $cands = @((Join-Path (Split-Path (Split-Path $root)) 'JDK'), 'E:\develop\JDK', "$env:ProgramFiles\Android\Android Studio\jbr")
    foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $env:JAVA_HOME = $c; break } }
  }
  Write-Host "      JAVA_HOME = $env:JAVA_HOME"
  & (Join-Path $and 'gradlew.bat') --no-daemon assembleRelease "-PappVer=$ver" "-PappVerCode=$verCode"
  if ($LASTEXITCODE -ne 0) { throw "gradle 编译失败（退出码 $LASTEXITCODE）" }
} finally { Pop-Location }

# 4) 拷产物
Write-Host '[4/4] 拷产物...'
$apk = Join-Path $and 'app\build\outputs\apk\release\app-release.apk'
if (!(Test-Path $apk)) { throw "找不到 $apk" }
$dst = Join-Path $outDir ("手写作业生成器-$ver.apk")
Copy-Item $apk $dst -Force
Write-Host ''
Write-Host ("完成：" + $dst + "  " + [Math]::Round((Get-Item $dst).Length/1MB,1) + ' MB') -ForegroundColor Green
Write-Host ("热更包：" + $webzip) -ForegroundColor Green
Write-Host '把 .apk 和 web-<版本>.zip 都传到 GitHub Release（附件名 ASCII）即可。'
