# gem5-lab

`gem5-lab` is a non-invasive control plane for autonomous gem5 Ruby
configuration experiments. The gem5 repository is treated as a read-only input;
builds, generated configurations, run output, metrics, and dashboard state live
outside it.

## Current MVP

- Mixed discrete and conditional Ruby search spaces.
- Deterministic parameter validation before a trial.
- Iterative global exploration and champion-neighborhood refinement.
- Correctness, performance, hardware-MAPE, per-case regression, and stability scoring.
- Automatic target, convergence, search-space, and budget stopping.
- SQLite experiment history and immutable final-result bundles.
- FastAPI dashboard with iteration trends, trial history, stop reason, and final config.
- Animated workflow topology driven by the persisted orchestrator stage.
- Synthetic runner to validate the complete loop before connecting costly GKB runs.
- Idempotent Loop Agent event ingestion from atomic JSON files or `POST /api/events`.
- Live trial progress, current GKB case/lmbench test, changed parameters, and per-iteration metrics.
- DeepSeek Harness integration as an installable out-of-tree Cordis bundle.

## DeepSeek Harness deployment

The official `deepseek-ai/deepseek-harness` repository is pinned as the
`third_party/deepseek-harness` Git submodule. The submodule is never patched.
The local integration is the independent bundle under `plugins/dsh-gem5-lab`;
it contributes four model-facing tools:

- `gem5_lab_optimization_contract` loads the fixed/search/baseline contract.
- `gem5_lab_run_experiment` runs the deterministic end-to-end optimizer demo.
- `gem5_lab_experiment_status` reads live and final dashboard state.
- `gem5_lab_submit_event` accepts standard events from real GKB/lmbench workers.

Install the Python service, build the pinned DSH source, create a dedicated DSH
profile, and install the bundle:

```bash
cd /Users/libo/Work/gem5-lab
cp .env.example .env
# Set DEEPSEEK_API_KEY in .env when model-backed DSH turns are required.
./scripts/install.sh
./scripts/doctor.sh
```

Start the DSH Web UI and optimization dashboard together:

```bash
./scripts/start.sh
```

- DSH Web UI: `http://127.0.0.1:3080`
- Ruby optimization dashboard: `http://127.0.0.1:18080`

Suggested first DSH instruction: “先调用 `gem5_lab_optimization_contract`，确认
固定参数与搜索空间，然后运行 `examples/demo-experiment.json`，持续读取实验状态
直到停止，最后总结 champion 配置、收敛原因和各 case 趋势。”

Real GKB/lmbench CI workers use `gem5_lab_submit_event` or `POST /api/events`.
They remain responsible for site-specific binaries, hardware-reference data,
gem5 build caching, and ephemeral workspaces. This keeps both gem5 and the DSH
submodule read-only during trials.

The real gem5/GKB execution boundary is the `TrialRunner` interface. A deployment
adapter should clone the requested gem5 commit into an ephemeral CI workspace,
reuse a build artifact keyed by commit/protocol/toolchain, invoke an external
Ruby configuration script, and return a `TrialResult`. It must not build in or
write to the source path recorded in the experiment.

## Run the closed-loop demo

```bash
cd /Users/libo/Work/gem5-lab
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/gem5-lab run-synthetic examples/demo-experiment.json
.venv/bin/uvicorn gem5_lab.api:app --reload --port 8080
```

Open `http://127.0.0.1:8080`. The database and final configuration bundle are
written under `var/`, never under the gem5 source repository.

## Live Loop Agent results

The generic agent contract is in
`configurations/loop-agent/loop-agent-prompt.md`. The agent writes one immutable
JSON event per state change under `var/agent-events/<experiment-id>/`. It must
write a `.json.tmp` file first and atomically rename it to `.json` when complete.
The dashboard API imports new files on every refresh and deduplicates them by
`event_id`.

Events may also be sent directly:

```bash
curl -X POST http://127.0.0.1:18080/api/events \
  -H 'content-type: application/json' \
  --data-binary @event.json
```

For an explicit batch import:

```bash
.venv/bin/gem5-lab import-events var/agent-events
```

See `examples/loop-agent-event.json` for the stable event envelope. Supported
types are `EXPERIMENT_UPSERT`, `STAGE_UPDATE`, `TRIAL_STARTED`,
`TRIAL_PROGRESS`, `TRIAL_FINISHED`, `ITERATION_COMPLETED`, and
`EXPERIMENT_FINISHED`.

## Production adapter contract

Implement `TrialRunner.run(spec, config, trial_id)` and return:

```json
{
  "status": "COMPLETED",
  "score": 1124.5,
  "hardware_mape": 0.072,
  "case_scores": {"crypto": 1130.0},
  "case_regressions": {"crypto": 0.0},
  "cv": 0.011,
  "sim_seconds": 7200,
  "correctness_passed": true
}
```

Recommended production implementations are a container runner for local use and
a Kubernetes/CI runner for parallel trials. GKB commands, checksums, score
parsing, hardware reference datasets, and artifact storage are site-specific
adapters rather than assumptions in the optimization engine.
