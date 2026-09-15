#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dsh_dir="$project_dir/third_party/deepseek-harness"
if [[ -n "${PNPM_BIN:-}" ]]; then
  pnpm_command=("$PNPM_BIN")
else
  pnpm_command=(corepack pnpm)
fi
mkdir -p "$project_dir/.run"

if [[ -f "$project_dir/.env" ]]; then
  set -a
  source "$project_dir/.env"
  set +a
fi

export DSH_HOME="$project_dir/.dsh-home"
export GEM5_LAB_ROOT="$project_dir"
export GEM5_LAB_PYTHON="$project_dir/.venv/bin/python"
export GEM5_LAB_DB="$project_dir/var/gem5-lab.db"
export GEM5_LAB_EVENTS="$project_dir/var/agent-events"

dashboard_host="${GEM5_LAB_HOST:-127.0.0.1}"
dashboard_port="${GEM5_LAB_PORT:-18080}"
export GEM5_LAB_DASHBOARD_URL="http://$dashboard_host:$dashboard_port"

cleanup() {
  [[ -n "${dashboard_pid:-}" ]] && kill "$dashboard_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$project_dir"
"$project_dir/.venv/bin/uvicorn" gem5_lab.api:app --host "$dashboard_host" --port "$dashboard_port" \
  >"$project_dir/.run/dashboard.log" 2>&1 &
dashboard_pid=$!

for _ in {1..50}; do
  if curl -fsS "http://$dashboard_host:$dashboard_port/api/health" >/dev/null; then break; fi
  sleep 0.2
done
curl -fsS "http://$dashboard_host:$dashboard_port/api/health" >/dev/null

echo "gem5-lab Dashboard: http://$dashboard_host:$dashboard_port"
echo "DeepSeek Harness:   http://${DSH_HOST:-127.0.0.1}:${DSH_PORT:-3080}"
cd "$dsh_dir"
"${pnpm_command[@]}" dsh --profile gem5-lab --no-open \
  --host "${DSH_HOST:-127.0.0.1}" --port "${DSH_PORT:-3080}"
