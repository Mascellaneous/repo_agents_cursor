# Fast stage with git archive (Git for Windows). Run from repo_agents_cursor.
param(
  [string]$DataRoot = $env:ECON_DATA_ROOT,
  [switch]$Check
)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path ".").Path
function Find-Sha {
  $sha = (git rev-parse HEAD).Trim()
  for ($i=0; $i -lt 80; $i++) {
    git cat-file -e "${sha}:econ-database/data/database.json" 2>$null
    if ($LASTEXITCODE -eq 0) { return $sha }
    $p = git rev-parse "${sha}^" 2>$null
    if ($LASTEXITCODE -ne 0) { break }
    $sha = $p.Trim()
  }
  throw "No ancestor with database.json"
}
$sha = Find-Sha
Write-Host "source: $sha"
if ($Check) {
  foreach ($p in @("econ-database/diagrams","econ-database/originals","MockTests","PastPaper")) {
    $n = (git ls-tree -r --name-only $sha $p | Measure-Object).Count
    Write-Host "  $p : $n"
  }
  exit 0
}
if (-not $DataRoot) { throw "Set ECON_DATA_ROOT or -DataRoot" }
$shared = Join-Path $DataRoot "shared"
New-Item -ItemType Directory -Force -Path $shared | Out-Null
$tmp = Join-Path $env:TEMP ("econ-stage-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $maps = @(
    @{Src="econ-database/diagrams"; Dest="diagrams"},
    @{Src="econ-database/originals"; Dest="originals"},
    @{Src="MockTests"; Dest="papers/mock-tests"},
    @{Src="PastPaper"; Dest="papers/past-papers"}
  )
  $sw = [Diagnostics.Stopwatch]::StartNew()
  foreach ($m in $maps) {
    $dest = Join-Path $shared $m.Dest
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $tar = Join-Path $tmp ($m.Dest -replace '[\\/]','_') + ".tar"
    git archive --format=tar -o $tar $sha $m.Src
    if ($LASTEXITCODE -ne 0) { Write-Host "skip $($m.Src)"; continue }
    # extract with tar.exe (Windows 10+)
    $extract = Join-Path $tmp "x_$($m.Dest -replace '[\\/]','_')"
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    tar -xf $tar -C $extract
    $srcRoot = Join-Path $extract ($m.Src -replace '/','\')
    if (Test-Path $srcRoot) {
      robocopy $srcRoot $dest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    }
    Write-Host "  $($m.Dest) done"
  }
  foreach ($pair in @(
    @("econ-database/data/database.json","data/database.json"),
    @("econ-database/data/database.js","data/database.js"),
    @("econ-database/data/vocabulary.json","data/vocabulary.json"),
    @("econ-database/_readme_stem_stats.json","build/_readme_stem_stats.json")
  )) {
    git cat-file -e "$sha:$($pair[0])" 2>$null
    if ($LASTEXITCODE -eq 0) {
      $out = Join-Path $shared $pair[1]
      New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
      git show "${sha}:$($pair[0])" | Set-Content -Encoding Byte -Path $out -ErrorAction SilentlyContinue
      # fallback
      git show "${sha}:$($pair[0])" > $out 2>$null
      Write-Host "  wrote $($pair[1])"
    }
  }
  Write-Host "elapsed $($sw.Elapsed.TotalSeconds)s -> $shared"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
