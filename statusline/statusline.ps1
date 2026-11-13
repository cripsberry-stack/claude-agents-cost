# Строка статуса Claude Code для Windows (под полем ввода в десктоп-приложении и в терминале):
#   🤖 2 · ■■■■□□□□ 49% · 5ч 75% ↻2ч10м · нед 46% ↻3д4ч · 💸 $0.30 · Σ $4.33 API
# 🤖 — сколько агентов работает (если стоит плагин agents-cost), полоска — заполнение контекста,
# 5ч / нед — лимиты подписки, 💸 — сколько стоил текущий запрос, Σ — вся сессия по ценам API.
# Настройка в ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "powershell -NoProfile -File C:/Users/<ты>/.claude/statusline.ps1", "refreshInterval": 2 }

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$esc = [char]27

try { $j = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { Write-Output 'statusline: нет данных'; exit 0 }

function Paint($code, $text) { return "$esc[${code}m$text$esc[0m" }
function Heat($p) { if ($p -ge 90) { return '31' } elseif ($p -ge 70) { return '33' } else { return '32' } }
function Money($v) {
  $v = [double]$v
  if ($v -gt 0 -and $v -lt 0.01) { return '<$0.01' }
  return '$' + $v.ToString('0.00', $inv)
}
# «45м», «2ч10м», «3д4ч» до сброса окна
function Left($resetsAt) {
  if (-not $resetsAt) { return '' }
  try { $left = [DateTimeOffset]::FromUnixTimeSeconds([int64]$resetsAt) - [DateTimeOffset]::UtcNow } catch { return '' }
  if ($left.TotalMinutes -lt 0) { return '' }
  if ($left.TotalHours -lt 1) { return " ↻$([int][math]::Floor($left.TotalMinutes))м" }
  if ($left.TotalHours -lt 24) { return " ↻$([int][math]::Floor($left.TotalHours))ч$($left.Minutes)м" }
  return " ↻$($left.Days)д$($left.Hours)ч"
}
function Limit($label, $w) {
  if ($null -eq $w -or $null -eq $w.used_percentage) { return $null }
  $p = [double]$w.used_percentage
  return (Paint (Heat $p) "$label $([int][math]::Round($p))%") + (Paint '90' (Left $w.resets_at))
}

$parts = @()

# Агенты — из файла, который пишет плагин agents-cost (если он стоит и Claude Code жив)
$klodik = Join-Path $env:USERPROFILE '.claude\klodik\status.json'
if (Test-Path $klodik) {
  try {
    $k = Get-Content -Raw -Encoding UTF8 -Path $klodik | ConvertFrom-Json
    $age = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$k.updatedAt
    if ($age -lt 180000) { $parts += "🤖 $([int]$k.agents)" }
  } catch { }
}

# Полоска контекста
$ctx = $j.context_window.used_percentage
if ($null -ne $ctx) {
  $p = [double]$ctx
  $n = [int][math]::Round($p / 12.5)
  if ($n -gt 8) { $n = 8 }
  $parts += (Paint (Heat $p) ('■' * $n)) + (Paint '90' ('■' * (8 - $n))) + " $([int][math]::Round($p))%"
}

# Лимиты подписки
$five = Limit '5ч' $j.rate_limits.five_hour
if ($five) { $parts += $five }
$week = Limit 'нед' $j.rate_limits.seven_day
if ($week) { $parts += $week }

# Стоимость: запрос = рост суммы с начала текущего запроса (по prompt_id), сессия = итог по ценам API
$total = $j.cost.total_cost_usd
if ($null -ne $total) {
  $total = [double]$total
  $statePath = Join-Path $env:TEMP ('claude-statusline-' + $j.session_id + '.json')
  $start = $total
  if (Test-Path $statePath) {
    try {
      $st = Get-Content -Raw -Path $statePath | ConvertFrom-Json
      if ($st.prompt_id -eq $j.prompt_id) { $start = [double]$st.start } else { $start = [double]$st.last }
    } catch { }
  }
  try {
    @{ prompt_id = $j.prompt_id; start = $start; last = $total } | ConvertTo-Json -Compress | Set-Content -Path $statePath
  } catch { }
  $parts += "💸 $(Money ([math]::Max(0, $total - $start)))"
  $parts += "Σ $(Money $total) API"
}

Write-Output ($parts -join ' · ')
