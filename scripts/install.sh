#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dsh_dir="$project_dir/third_party/deepseek-harness"
dsh_home="$project_dir/.dsh-home"
pnpm_bin="${PNPM_BIN:-pnpm}"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_minor="$(node -p 'process.versions.node.split(".")[1]')"
if (( node_major < 22 || (node_major == 22 && node_minor < 19) )); then
  echo "DeepSeek Harness requires Node.js 22.19+ or 24+." >&2
  exit 1
fi

if [[ ! -x "$dsh_dir/node_modules/.bin/tsx" ]]; then
  if ! node -e "require('node:dns').promises.lookup('registry.npmjs.org').catch(() => process.exit(1))"; then
    echo "Cannot resolve registry.npmjs.org; DSH dependencies are not cached." >&2
    echo "Restore DNS/network access and rerun this script. The submodule and local plugin are already present." >&2
    exit 2
  fi
fi

git -C "$project_dir" submodule update --init --recursive
python3 -m venv "$project_dir/.venv"
"$project_dir/.venv/bin/pip" install --no-build-isolation -e "$project_dir"

cd "$dsh_dir"
COREPACK_ENABLE_PROJECT_SPEC=0 "$pnpm_bin" install --frozen-lockfile
COREPACK_ENABLE_PROJECT_SPEC=0 "$pnpm_bin" run build

export DSH_HOME="$dsh_home"
export GEM5_LAB_ROOT="$project_dir"
export GEM5_LAB_PYTHON="$project_dir/.venv/bin/python"
export GEM5_LAB_DASHBOARD_URL="http://127.0.0.1:18080"
COREPACK_ENABLE_PROJECT_SPEC=0 "$pnpm_bin" dsh --profile gem5-lab --from-default-profile web --dump-config >/dev/null
COREPACK_ENABLE_PROJECT_SPEC=0 "$pnpm_bin" dsh plugin --profile gem5-lab add "file:$project_dir/plugins/dsh-gem5-lab"

echo "Installation complete. Run: $project_dir/scripts/start.sh"
