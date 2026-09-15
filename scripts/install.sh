#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dsh_dir="$project_dir/third_party/deepseek-harness"
dsh_home="$project_dir/.dsh-home"
if [[ -n "${PNPM_BIN:-}" ]]; then
  pnpm_command=("$PNPM_BIN")
else
  pnpm_command=(corepack pnpm)
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_minor="$(node -p 'process.versions.node.split(".")[1]')"
if (( node_major < 22 || (node_major == 22 && node_minor < 19) )); then
  echo "DeepSeek Harness requires Node.js 22.19+ or 24+." >&2
  exit 1
fi

pnpm_version="$(cd "$dsh_dir" && "${pnpm_command[@]}" --version)"
if [[ "$pnpm_version" != "11.7.0" ]]; then
  echo "DeepSeek Harness pins pnpm 11.7.0, but resolved pnpm $pnpm_version." >&2
  echo "Enable Corepack or set PNPM_BIN to a pnpm 11.7.0 executable." >&2
  exit 4
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
venv_python="$project_dir/.venv/bin/python"

# Python 3.12+ virtual environments may contain pip without setuptools.  The
# project uses setuptools.build_meta, so install the backend before disabling
# build isolation.  PIP_INDEX_URL/PIP_EXTRA_INDEX_URL remain user-configurable.
"$venv_python" -m ensurepip --upgrade
if ! "$venv_python" -m pip install --upgrade "setuptools>=68" wheel; then
  echo "Failed to install the Python build backend (setuptools.build_meta)." >&2
  echo "Check PIP_INDEX_URL, proxy, DNS, and TLS settings, then rerun install.sh." >&2
  exit 3
fi
"$venv_python" -c "import setuptools.build_meta"
"$venv_python" -m pip install --no-build-isolation -e "$project_dir"

cd "$dsh_dir"
# DSH's contributor postinstall configures worktree-local Git hooks. In a Git
# submodule, Git necessarily stores core.worktree in the common module config,
# which that installer intentionally refuses to migrate. This checkout is a
# pinned dependency rather than a DSH contributor worktree, so use the
# upstream-supported CI path to skip contributor-only Lefthook installation.
CI=true "${pnpm_command[@]}" install --frozen-lockfile
CI=true "${pnpm_command[@]}" run build

export DSH_HOME="$dsh_home"
export GEM5_LAB_ROOT="$project_dir"
export GEM5_LAB_PYTHON="$project_dir/.venv/bin/python"
export GEM5_LAB_DASHBOARD_URL="http://127.0.0.1:18080"
CI=true "${pnpm_command[@]}" dsh --profile gem5-lab --from-default-profile web --dump-config >/dev/null
CI=true "${pnpm_command[@]}" dsh plugin --profile gem5-lab add "file:$project_dir/plugins/dsh-gem5-lab"

echo "Installation complete. Run: $project_dir/scripts/start.sh"
