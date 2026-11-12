# Клодик — пиксельный Claude на рабочем столе Windows.
# Окно без рамки поверх всех окон: таскай мышкой куда угодно.
# Что делает Claude, берёт из файла, который пишет плагин agents-cost:
#   %USERPROFILE%\.claude\klodik\status.json
# Дремлет в простое, подпрыгивает, пока Claude работает, потеет при лимите от 80%.
# Наведи курсор — лимиты; двойной клик — сводка; правый клик — меню.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Только один Клодик на экране
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\Klodik', [ref]$created)
if (-not $created) { return }

$dir = Join-Path $env:USERPROFILE '.claude\klodik'
$statusPath = Join-Path $dir 'status.json'
$posPath = Join-Path $dir 'pos.txt'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$ru = [System.Globalization.CultureInfo]::GetCultureInfo('ru-RU')
$STALE_MS = 180000 # статус старше 3 минут — Claude Code не запущен, Клодик спит

# Спрайт 12x10 клеток: o — тело, e — глаз, a — ручка (в прыжке поднимается на строку выше)
$sprite = @(
  '............',
  '..oooooooo..',
  '.oooooooooo.',
  '.ooeooooeoo.',
  'aooeooooeooa',
  '.oooooooooo.',
  '.oooooooooo.',
  '..oooooooo..',
  '..o.o..o.o..',
  '..o.o..o.o..'
)
$CELL = 6                 # пикселей на клетку
$OX = 19; $OY = 30        # где спрайт внутри окна (сверху место для значков)

$cOrange = [System.Drawing.Color]::FromArgb(217, 119, 87)
$cHot = [System.Drawing.Color]::FromArgb(200, 70, 55)
$cEye = [System.Drawing.Color]::FromArgb(31, 31, 31)
$cSweat = [System.Drawing.Color]::FromArgb(110, 198, 255)
$cBadge = [System.Drawing.Color]::FromArgb(43, 43, 43)
$cZ = [System.Drawing.Color]::FromArgb(160, 160, 160)
$cKey = [System.Drawing.Color]::FromArgb(255, 0, 255) # прозрачный цвет окна

$script:status = $null
$script:tick = 0
$script:drag = $false
$script:dragFrom = $null
$script:formFrom = $null
$script:tipText = ''

function Get-Num($v) { if ($null -eq $v) { return $null } return [double]$v }

# «2ч 10м (01:00)», «3д 4ч (пн 15:00)»
function Format-Reset($resetsAt) {
  if (-not $resetsAt) { return '' }
  try {
    if ($resetsAt -is [datetime]) { $at = [DateTimeOffset]$resetsAt } else { $at = [DateTimeOffset]::Parse([string]$resetsAt) }
  } catch { return '' }
  $left = $at - [DateTimeOffset]::Now
  if ($left.TotalMinutes -lt 0) { $left = [TimeSpan]::Zero }
  $local = $at.ToLocalTime()
  if ($left.TotalHours -lt 1) { $span = '{0}м' -f [int][math]::Floor($left.TotalMinutes) }
  elseif ($left.TotalHours -lt 24) { $span = '{0}ч {1}м' -f [int][math]::Floor($left.TotalHours), $left.Minutes }
  else { $span = '{0}д {1}ч' -f $left.Days, $left.Hours }
  if ($left.TotalHours -lt 24) { $clock = $local.ToString('HH:mm', $ru) } else { $clock = $local.ToString('ddd HH:mm', $ru) }
  return " · сброс через $span ($clock)"
}

function Test-Stale {
  if ($null -eq $script:status) { return $true }
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  return ($now - (Get-Num $script:status.updatedAt)) -gt $STALE_MS
}

function Get-MaxPercent {
  $max = 0
  if ($script:status -and $script:status.limits) {
    foreach ($l in $script:status.limits) { if ((Get-Num $l.percentUsed) -gt $max) { $max = Get-Num $l.percentUsed } }
  }
  return $max
}

function Get-Summary {
  if (Test-Stale) { return "Клодик спит: Claude Code не запущен.`nЗапусти claude — и он проснётся." }
  $s = $script:status
  $lines = @()
  if (-not $s.limits -or @($s.limits).Count -eq 0) { $lines += 'Лимиты появятся после первого ответа' }
  foreach ($l in @($s.limits)) {
    switch ($l.kind) { 'five_hour' { $label = '5ч' } 'seven_day' { $label = 'Неделя' } 'spend_limit' { $label = 'Бюджет' } default { $label = $l.kind } }
    $lines += ('{0}: {1}%{2}' -f $label, [int][math]::Round((Get-Num $l.percentUsed)), (Format-Reset $l.resetsAt))
  }
  if ($s.isBusy) { $state = 'Claude работает' } else { $state = 'Claude ждёт тебя' }
  $lines += ''
  $lines += ('{0} · агентов: {1}' -f $state, $s.agents)
  if ($null -ne $s.totalUsd) {
    $usd = (Get-Num $s.totalUsd).ToString('0.00', [System.Globalization.CultureInfo]::InvariantCulture)
    $lines += "Эта сессия: `$$usd (по ценам API)"
  }
  return ($lines -join "`n")
}

function Read-Status {
  try {
    if (Test-Path $statusPath) {
      $script:status = Get-Content -Raw -Encoding UTF8 -Path $statusPath | ConvertFrom-Json
    }
  } catch { } # файл пишется прямо сейчас — прочитаем в следующий раз
  $text = Get-Summary
  if ($text -ne $script:tipText) {
    $script:tipText = $text
    $tip.SetToolTip($form, $text)
  }
}

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.Size = New-Object System.Drawing.Size(110, 96)
$form.BackColor = $cKey
$form.TransparencyKey = $cKey
$form.Text = 'Клодик'
$form.GetType().GetProperty('DoubleBuffered', [System.Reflection.BindingFlags]'NonPublic,Instance').SetValue($form, $true, $null)

# Позиция: где оставили в прошлый раз, иначе правый нижний угол
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object System.Drawing.Point(($area.Right - $form.Width - 24), ($area.Bottom - $form.Height - 8))
if (Test-Path $posPath) {
  try {
    $xy = (Get-Content -Path $posPath -Raw).Trim().Split(',')
    $p = New-Object System.Drawing.Point([int]$xy[0], [int]$xy[1])
    foreach ($scr in [System.Windows.Forms.Screen]::AllScreens) {
      if ($scr.WorkingArea.Contains($p)) { $form.Location = $p; break }
    }
  } catch { }
}

$tip = New-Object System.Windows.Forms.ToolTip
$tip.InitialDelay = 300
$tip.AutoPopDelay = 20000

$form.Add_Paint({
  param($src, $e)
  $g = $e.Graphics
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $stale = Test-Stale
  $busy = (-not $stale) -and ($script:status.isBusy -or ((Get-Num $script:status.agents) -gt 0))
  $max = if ($stale) { 0 } else { Get-MaxPercent }
  $t = $script:tick

  # Анимация: прыжки в работе, дыхание в простое, сон без Claude Code
  $yOff = 0; $armsUp = $false; $eyesClosed = $false; $blink = $false
  if ($stale) { $eyesClosed = $true }
  elseif ($busy) { $phase = [math]::Floor($t / 2) % 2; if ($phase -eq 1) { $yOff = -4; $armsUp = $true } }
  else { if (([math]::Floor($t / 5) % 2) -eq 1) { $yOff = 1 }; if (($t % 20) -lt 2) { $blink = $true } }

  $bodyColor = if ($max -ge 95) { $cHot } else { $cOrange }
  $bodyBrush = New-Object System.Drawing.SolidBrush($bodyColor)
  $eyeBrush = New-Object System.Drawing.SolidBrush($cEye)

  for ($row = 0; $row -lt $sprite.Count; $row++) {
    $line = $sprite[$row]
    for ($col = 0; $col -lt $line.Length; $col++) {
      $ch = $line[$col]
      $x = $OX + $col * $CELL
      $y = $OY + $row * $CELL + $yOff
      if ($ch -eq 'o') { $g.FillRectangle($bodyBrush, $x, $y, $CELL, $CELL) }
      elseif ($ch -eq 'a') {
        if ($armsUp) { $y -= $CELL }
        $g.FillRectangle($bodyBrush, $x, $y, $CELL, $CELL)
      }
      elseif ($ch -eq 'e') {
        if ($eyesClosed -or $blink) {
          # закрытые глаза: тело на верхней клетке, полоска на нижней
          $g.FillRectangle($bodyBrush, $x, $y, $CELL, $CELL)
          if ($row -eq 4) { $g.FillRectangle($eyeBrush, $x - 1, $y + 2, $CELL + 2, 2) }
        } else { $g.FillRectangle($eyeBrush, $x, $y, $CELL, $CELL) }
      }
    }
  }

  # Пот при лимите от 80%
  if ($max -ge 80) {
    $drop = New-Object System.Drawing.SolidBrush($cSweat)
    $dy = ($t % 10) * 2
    $g.FillEllipse($drop, $OX + 12 * $CELL + 2, $OY + 6 + $dy + $yOff, 6, 9)
    $drop.Dispose()
  }

  # Сон: плывущие «z»
  if ($stale) {
    $zBrush = New-Object System.Drawing.SolidBrush($cZ)
    $font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $zy = 18 - ([math]::Floor($t / 3) % 6) * 2
    $g.DrawString('z', $font, $zBrush, $OX + 60, $OY + $zy - 14)
    $g.DrawString('Z', $font, $zBrush, $OX + 70, $OY + $zy - 26)
    $font.Dispose(); $zBrush.Dispose()
  }

  # Значок с числом агентов
  $agents = if ($stale) { 0 } else { [int](Get-Num $script:status.agents) }
  if ($agents -gt 0) {
    $badge = New-Object System.Drawing.SolidBrush($cBadge)
    $g.FillEllipse($badge, $OX + 56, 6, 20, 20)
    $font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $txt = [string]$agents
    $size = $g.MeasureString($txt, $font)
    $g.DrawString($txt, $font, [System.Drawing.Brushes]::White, ($OX + 66 - $size.Width / 2), (16 - $size.Height / 2))
    $font.Dispose(); $badge.Dispose()
  }

  $bodyBrush.Dispose(); $eyeBrush.Dispose()
})

# Перетаскивание мышкой
$form.Add_MouseDown({
  param($src, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $script:drag = $true
    $script:dragFrom = [System.Windows.Forms.Cursor]::Position
    $script:formFrom = $form.Location
  }
})
$form.Add_MouseMove({
  if ($script:drag) {
    $p = [System.Windows.Forms.Cursor]::Position
    $form.Location = New-Object System.Drawing.Point(($script:formFrom.X + $p.X - $script:dragFrom.X), ($script:formFrom.Y + $p.Y - $script:dragFrom.Y))
  }
})
$form.Add_MouseUp({
  if ($script:drag) {
    $script:drag = $false
    try { Set-Content -Path $posPath -Value ('{0},{1}' -f $form.Location.X, $form.Location.Y) } catch { }
  }
})
$form.Add_DoubleClick({ [System.Windows.Forms.MessageBox]::Show((Get-Summary), 'Клодик') | Out-Null })

# Меню по правому клику
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemLimits = $menu.Items.Add('Лимиты')
$itemLimits.Add_Click({ [System.Windows.Forms.MessageBox]::Show((Get-Summary), 'Клодик') | Out-Null })
$itemTop = New-Object System.Windows.Forms.ToolStripMenuItem('Поверх всех окон')
$itemTop.Checked = $true
$itemTop.CheckOnClick = $true
$itemTop.Add_Click({ $form.TopMost = $itemTop.Checked })
$menu.Items.Add($itemTop) | Out-Null
$menu.Items.Add('-') | Out-Null
$itemExit = $menu.Items.Add('Выход')
$itemExit.Add_Click({ $form.Close() })
$form.ContextMenuStrip = $menu

# Кадры анимации — 5 в секунду; статус — раз в 2 секунды
$anim = New-Object System.Windows.Forms.Timer
$anim.Interval = 200
$anim.Add_Tick({ $script:tick++; $form.Invalidate() })
$poll = New-Object System.Windows.Forms.Timer
$poll.Interval = 2000
$poll.Add_Tick({ Read-Status })

Read-Status
$anim.Start()
$poll.Start()
[System.Windows.Forms.Application]::Run($form)

$anim.Stop(); $poll.Stop()
$mutex.ReleaseMutex()
