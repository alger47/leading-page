# Flip the AI Engine to a real free LLM (Groq, OpenAI-compatible) WITHOUT
# touching the committed stub defaults.
#
# It writes apps/ai-engine/config/routing.local.yaml (a copy of routing.yaml
# with `fast`/`premium` pointed at Groq models). The engine picks it up via the
# `AI_ROUTING_CONFIG_PATH` env var; `git diff routing.yaml` stays empty and
# tests/nightly keep the deterministic stub.
#
# Usage (run from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/flip-groq.ps1            # enable
#   powershell -ExecutionPolicy Bypass -File scripts/flip-groq.ps1 -Revert    # back to stub
#
# Then set in apps/ai-engine/.env and restart the engine:
#   AI_OPENAI_API_KEY=gsk_...
#   AI_OPENAI_BASE_URL=https://api.groq.com/openai/v1
#   AI_ROUTING_CONFIG_PATH=config/routing.local.yaml

param([switch]$Revert)

$ErrorActionPreference = 'Stop'
$yaml = 'apps/ai-engine/config/routing.yaml'
$local = 'apps/ai-engine/config/routing.local.yaml'

if ($Revert) {
    if (Test-Path -LiteralPath $local) { Remove-Item -LiteralPath $local -Force }
    Write-Output '[flip-groq] reverted: routing now uses the committed stub defaults.'
    Write-Output '[flip-groq] remove AI_ROUTING_CONFIG_PATH from apps/ai-engine/.env and restart the engine.'
    exit 0
}

if (-not (Test-Path -LiteralPath $yaml)) { throw "not found: $yaml (run from the repo root)" }

$content = Get-Content -LiteralPath $yaml -Raw

# Swap the `fast` and `premium` model blocks (today's free-tier IDs; verify
# structured-output support per model at console.groq.com/docs/models).
$fastModel = 'openai/gpt-oss-20b'
$premModel = 'openai/gpt-oss-120b'

$fastPattern = '(?ms)^(\s+fast:.*?^\s+provider: )stub(\s+model_id: )"stub-fast"'
$premPattern = '(?ms)^(\s+premium:.*?^\s+provider: )stub(\s+model_id: )"stub-premium"'

$swapped = $content -replace $fastPattern, ('$1openai$2"' + $fastModel + '"')
$swapped = $swapped -replace $premPattern, ('$1openai$2"' + $premModel + '"')

if (($swapped -notmatch ('model_id: "' + $fastModel + '"')) -or ($swapped -notmatch ('model_id: "' + $premModel + '"')) -or ($swapped -match 'provider: stub')) {
    Write-Error '[flip-groq] the YAML replace did not match - routing.yaml shape may have changed. No file written.'
    exit 1
}

Set-Content -LiteralPath $local -Value $swapped -Encoding utf8
Write-Output "[flip-groq] wrote $local"
Write-Output "[flip-groq] fast=$fastModel premium=$premModel"
Write-Output '[flip-groq] costs were left at stub levels; update cost_per_1k_* in routing.local.yaml for honest ledger figures.'
Write-Output '[flip-groq] next, in apps/ai-engine/.env:'
Write-Output '    AI_OPENAI_API_KEY=gsk_...'
Write-Output '    AI_OPENAI_BASE_URL=https://api.groq.com/openai/v1'
Write-Output '    AI_ROUTING_CONFIG_PATH=config/routing.local.yaml'
Write-Output '[flip-groq] restart the engine and regenerate - the UI banner flips to generation_mode=llm.'