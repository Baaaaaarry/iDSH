#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
check() { if "$@" >/dev/null 2>&1; then printf 'PASS  %s\n' "$*"; else printf 'FAIL  %s\n' "$*"; fail=1; fi; }

check test -f "$project_dir/.gitmodules"
check test -f "$project_dir/third_party/deepseek-harness/package.json"
check test "$(git -C "$project_dir/third_party/deepseek-harness" rev-parse HEAD)" = "0d1f50007f9bca3f52b06e1c3074fa14d5fb0720"
check test -x "$project_dir/.venv/bin/gem5-lab"
check test -f "$project_dir/plugins/dsh-gem5-lab/index.js"
check test -f "$project_dir/.dsh-home/profiles/gem5-lab/package.json"
check "$project_dir/.venv/bin/python" -m unittest discover -s "$project_dir/tests" -q
exit "$fail"
