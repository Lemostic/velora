<#
Velora 一键构建脚本（Windows）

统一构建入口，一条命令出最新安装包：
  类型检查（可跳过）→ 前端 dist（tauri beforeBuildCommand 自动跑 pnpm build）
  → Rust release → MSI / NSIS 安装包

用法：
  powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1
  pnpm build:release            # 等价（已注册为 package.json script）

可选参数：
  -SkipLint      跳过 pnpm lint（tsc --noEmit）
  -Bundles <fmt> 只打指定格式：msi | nsis | all（默认交给 tauri 配置，即 all）
  -Install       先执行 pnpm install（换机 / 首次构建用）

产物：src-tauri/target/release/bundle/{msi,nsis}/
#>
[CmdletBinding()]
param(
  [switch]$SkipLint,
  [ValidateSet("msi", "nsis", "all", "")]
  [string]$Bundles = "",
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

function Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}
function Fail([string]$msg) {
  Write-Host "ERROR: $msg" -ForegroundColor Red
  exit 1
}

Write-Host "Velora release build" -ForegroundColor Magenta
Write-Host ("root : {0}" -f $root)
Write-Host ("param: SkipLint={0} Bundles='{1}' Install={2}" -f $SkipLint, $Bundles, $Install)

# ── 1. 工具链检查 ──
Step "检查工具链（pnpm / cargo）"
foreach ($tool in @("pnpm", "cargo")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Fail "缺少 $tool，请先安装（pnpm: https://pnpm.io，Rust: https://rustup.rs）"
  }
}
if ($Install) {
  Step "pnpm install"
  & pnpm install
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install 失败 (exit $LASTEXITCODE)" }
}

# ── 2. TypeScript 类型检查 ──
if (-not $SkipLint) {
  Step "pnpm lint（tsc --noEmit）"
  & pnpm lint
  if ($LASTEXITCODE -ne 0) { Fail "TypeScript 类型检查未通过 (exit $LASTEXITCODE)" }
}

# ── 3. Tauri 打包 ──
# beforeBuildCommand = "pnpm build"，tauri 会先自动产出前端 dist，无需手动跑
Step "pnpm tauri build（含前端 pnpm build）"
$tauriArgs = @("tauri", "build")
if ($Bundles) { $tauriArgs += @("--bundles", $Bundles) }
& pnpm @tauriArgs
if ($LASTEXITCODE -ne 0) { Fail "tauri build 失败 (exit $LASTEXITCODE)" }

# ── 4. 产物汇总 ──
Step "产物清单"
$bundleDir = Join-Path $root "src-tauri\target\release\bundle"
if (Test-Path $bundleDir) {
  $artifacts = Get-ChildItem $bundleDir -Recurse -File |
    Where-Object { $_.Extension -in ".msi", ".exe", ".sig" } |
    Sort-Object LastWriteTime -Descending
  if ($artifacts) {
    foreach ($f in $artifacts) {
      Write-Host ("  {0,-44} {1,10:N0} KB   {2:yyyy-MM-dd HH:mm}" -f $f.Name, ($f.Length / 1KB), $f.LastWriteTime)
    }
  } else {
    Fail "bundle 目录里没有找到 .msi / .exe / .sig 产物"
  }
} else {
  Fail "未找到打包产物目录: $bundleDir"
}

Write-Host ""
Write-Host "构建完成。安装包位于 src-tauri/target/release/bundle/{msi,nsis}/" -ForegroundColor Green
exit 0
