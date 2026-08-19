# sync-clover-links.ps1
# clover-pages に公開されているページ一覧を、そのまま Wardbook の
# clover-pages タブへ写す（index.html の CLOVER_LINKS を書き換える）。
#
# なぜ：タブの一覧はもともと手打ちの14件で、clover-pages に新しいページを
# 公開しても増えなかった。台帳を1か所（clover-pages 側）にして、二重管理を無くす。
#
# 使い方：
#   .\tools\sync-clover-links.ps1            # 既定パス（..\..\clover-pages）を見る
#   .\tools\sync-clover-links.ps1 -WhatIf    # 書き換えずに差分だけ見る
# 通常は clover-pages の publish.ps1 が公開のたびに自動で呼ぶ。
#
# 並び順・題名・種類の決め方は clover-pages\publish.ps1 と必ず同じにすること
# （目次と画面がずれると、探しているページが「無い」ように見えるため）。

[CmdletBinding()]
param(
    # clover-pages リポジトリの場所（public\ と meta.json がある所）
    [string]$CloverRoot,
    # 書き換える対象（Wardbook 本体）
    [string]$AppPath,
    # 書き換えずに結果だけ表示する
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

if (-not $CloverRoot) {
    $devRoot   = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $CloverRoot = Join-Path $devRoot "clover-pages"
}
if (-not $AppPath) {
    $AppPath = Join-Path (Split-Path $PSScriptRoot -Parent) "index.html"
}

$PublicDir = Join-Path $CloverRoot "public"
$MetaPath  = Join-Path $CloverRoot "meta.json"

if (-not (Test-Path $PublicDir)) { throw "clover-pages の public が見つかりません: $PublicDir" }
if (-not (Test-Path $MetaPath))  { throw "clover-pages の meta.json が見つかりません: $MetaPath" }
if (-not (Test-Path $AppPath))   { throw "Wardbook 本体が見つかりません: $AppPath" }

# ---------------------------------------------------------------- 部品

# 日本語をそのまま置くと index.html が非ASCIIまみれになるので \uXXXX に直す。
# Wardbook はソースを純ASCIIに保つ方針（文字化け事故を根で断つため）。
function ConvertTo-JsAscii([string]$text) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $text.ToCharArray()) {
        $code = [int]$ch
        if     ($ch -eq '"')  { [void]$sb.Append('\"') }
        elseif ($ch -eq '\')  { [void]$sb.Append('\\') }
        elseif ($code -lt 32 -or $code -gt 126) { [void]$sb.AppendFormat('\u{0:x4}', $code) }
        else                  { [void]$sb.Append($ch) }
    }
    $sb.ToString()
}

# id はパスから作る（同じページなら毎回同じ id になる）。
# 症例に残る「開いた資料」は名前を保存しているので、id が変わっても記録は壊れない。
function Get-PathId([string]$rel) {
    $sha1  = [System.Security.Cryptography.SHA1]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($rel)
        $hex   = ($sha1.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
    } finally { $sha1.Dispose() }
    $hex.Substring(0, 8)
}

# ---------------------------------------------------------------- 1. 台帳を読む
$meta  = [System.IO.File]::ReadAllText($MetaPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$kinds = @($meta.kinds)

$metaByPath = @{}
foreach ($it in $meta.items) { $metaByPath[$it.path] = $it }

# ---------------------------------------------------------------- 2. 公開物を調べる
$files = Get-ChildItem $PublicDir -Recurse -Filter *.html |
    Where-Object { $_.FullName -ne (Join-Path $PublicDir "index.html") }

$entries = @()
foreach ($f in $files) {
    $rel = $f.FullName.Substring($PublicDir.Length + 1) -replace "\\", "/"
    $m   = $metaByPath[$rel]

    if ($m -and $m.hidden) { continue }   # 目次に出さないものはタブにも出さない

    $raw = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)

    # 題名：HTML の <title> を使い、無ければファイル名
    $title = $f.BaseName
    if ($raw -match "(?s)<title[^>]*>(.*?)</title>") {
        $t = ($Matches[1] -replace "\s+", " ").Trim()
        if ($t) { $title = $t }
    }

    # 種類：① HTML の meta ② 台帳 ③ 未分類
    $kind = $null
    if     ($raw -match '(?is)<meta[^>]*name="mitsuba:kind"[^>]*content="([^"]+)"') { $kind = $Matches[1].Trim() }
    elseif ($raw -match '(?is)<meta[^>]*content="([^"]+)"[^>]*name="mitsuba:kind"') { $kind = $Matches[1].Trim() }
    elseif ($m -and $m.kind) { $kind = [string]$m.kind }
    if (-not $kind) { $kind = "未分類" }

    $entries += [pscustomobject]@{
        Rel   = $rel
        Title = $title
        Kind  = $kind
        Date  = $f.LastWriteTime
    }
}

if (-not $entries -or @($entries).Count -eq 0) { throw "公開物が1件も見つかりません（パスの指定間違い？）: $PublicDir" }

# 種類の並び：台帳の kinds の順 → 台帳に無い種類 → 未分類は必ず最後
# ※ PowerShell 5.1 は要素1つで配列がほどけるので、数える所は必ず @() で包む
$allKinds = @($entries | ForEach-Object { $_.Kind })
$known    = @($kinds | Where-Object { $allKinds -contains $_ })
$extra    = @($allKinds | Sort-Object -Unique |
             Where-Object { $kinds -notcontains $_ -and $_ -ne "未分類" })
$ordered  = $known + $extra
if ($allKinds -contains "未分類") { $ordered += "未分類" }

# ---------------------------------------------------------------- 3. JS の配列を組む
$lines = @()
$seenIds = @{}
$count = 0
foreach ($kind in $ordered) {
    $inKind = @($entries | Where-Object { $_.Kind -eq $kind } | Sort-Object Date -Descending)
    foreach ($e in $inKind) {
        $id = Get-PathId $e.Rel
        if ($seenIds.ContainsKey($id)) { throw "id が重複しました（まず起きない）: $id / $($e.Rel)" }
        $seenIds[$id] = $true

        # URL はセグメントごとに百分率エンコード（目次の href と同じ形）
        $path = ($e.Rel.Split("/") | ForEach-Object { [uri]::EscapeDataString($_) }) -join "/"

        $lines += '  { id:"' + $id + '", name:"' + (ConvertTo-JsAscii $e.Title) +
                  '", group:"' + (ConvertTo-JsAscii $kind) + '", path:"' + $path + '" }'
        $count++
    }
}

$block = "var CLOVER_LINKS = [`n" + (($lines) -join ",`n") + "`n];"

# ---------------------------------------------------------------- 4. 本体を書き換える
$html = [System.IO.File]::ReadAllText($AppPath, [System.Text.Encoding]::UTF8)

$startMark = "// >>> clover-links (generated)"
$endMark   = "// <<< clover-links"
$pattern   = "(?s)" + [regex]::Escape($startMark) + "\r?\n.*?\r?\n" + [regex]::Escape($endMark)

if ($html -notmatch $pattern) {
    throw "差し込み位置の目印が見つかりません（$startMark / $endMark）: $AppPath"
}

$replacement = $startMark + "`n" + $block + "`n" + $endMark
$updated = [regex]::Replace($html, $pattern, { param($m) $replacement }, 1)

if ($updated -eq $html) {
    Write-Host "clover-pages 一覧：変更なし（$count 件）"
    exit 0
}

if ($WhatIf) {
    Write-Host "clover-pages 一覧：$count 件に更新される見込み（-WhatIf のため書き換えていません）"
    exit 0
}

# index.html は BOM なし UTF-8。BOM を付けるとブラウザ・テストの両方で事故る。
[System.IO.File]::WriteAllText($AppPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "clover-pages 一覧を更新しました：$count 件 → $AppPath"
Write-Host "反映するには Wardbook を push（GitHub Pages）してください。"
