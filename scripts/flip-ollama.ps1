# Flip the AI Engine to a LOCAL LLM (Ollama, OpenAI-compatible) WITHOUT
# touching the committed stub defaults.
#
# It writes apps/ai-engine/config/routing.local.yaml (a copy of routing.yaml
# with `fast`/`premium` pointed at a local llama3.1). The engine picks it up via
# the `AI_ROUTING_CONFIG_PATH` env var; `git diff routing.yaml` stays empty and
# tests/nightly keep the deterministic stub.
#
# Usage (run from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/flip-ollama.ps1            # enable
#   powershell -ExecutionPolicy Bypass -File scripts/flip-ollama.ps1 -Revert    # back to stub
#
# Prereqs: `ollama pull llama3.1` and `ollama serve` running on 127.0.0.1:11434.
# Then in apps/ai-engine/.env and restart the engine:
#   AI_ROUTING_CONFIG_PATH=config/routing.local.yaml
# (ollama is keyless; AI_OLLAMA_BASE_URL defaults to http://localhost:11434/v1)

param([switch]$Revert)

$ErrorActionPreference = 'Stop'
$yaml = 'apps/ai-engine/config/routing.yaml'
$local = 'apps/ai-engine/config/routing.local.yaml'

if ($Revert) {
    if (Test-Path -LiteralPath $local) { Remove-Item -LiteralPath $local -Force }
    Write-Output '[flip-ollama] reverted: routing now uses the committed stub defaults.'
    Write-Output '[flip-ollama] remove AI_ROUTING_CONFIG_PATH from apps/ai-engine/.env and restart the engine.'
    exit 0
}

if (-not (Test-Path -LiteralPath $yaml)) { throw "not found: $yaml (run from the repo root)" }

$model = 'llama3.1'

$content = Get-Content -LiteralPath $yaml -Raw

$fastPattern = '(?ms)^(\s+fast:.*?^\s+provider: )stub(\s+model_id: )"stub-fast"'
$premPattern = '(?ms)^(\s+premium:.*?^\s+provider: )stub(\s+model_id: )"stub-premium"'

$swapped = $content -replace $fastPattern, ('$1ollama$2"' + $model + '"')
$swapped = $swapped -replace $premPattern, ('$1ollama$2"' + $model + '"')

if (($swapped -notmatch ('model_id: "' + $model + '"')) -or ($swapped -match 'provider: stub')) {
    Write-Error '[flip-ollama] the YAML replace did not match - routing.yaml shape may have changed. No file written.'
    exit 1
}

Set-Content -LiteralPath $local -Value $swapped -Encoding utf8
Write-Output "[flip-ollama] wrote $local"
Write-Output "[flip-ollama] fast=$model premium=$model (provider: ollama, local + free, no rate limit)"
Write-Output '[flip-ollama] costs were left at stub levels; update cost_per_1k_* in routing.local.yaml for honest ledger figures.'
Write-Output '[flip-ollama] next, in apps/ai-engine/.env:'
Write-Output '    AI_ROUTING_CONFIG_PATH=config/routing.local.yaml'
Write-Output '[flip-ollama] restart the engine and regenerate - the UI banner flips to generation_mode=llm.'