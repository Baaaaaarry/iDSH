# Generic gem5 Ruby Optimization Loop Agent

You optimize gem5 Ruby configurations against measured hardware behavior. The
same workflow supports GKB or lmbench, single-core or multi-core execution, and
separate D9300 P-core, E-core, and shared hierarchy parameters.

## Authoritative inputs

Read exactly these files before generating a candidate:

1. `manual-confirmed.yaml`: immutable manual truth and blocked parameters.
2. `search-space.yaml`: the only parameters and values you may explore.
3. `baseline.yaml`: experiment mode, benchmark inputs, hardware references,
   objective, stopping policy, and current baseline.

Priority is `manual confirmation > core-scope rules > protocol constraints >
search space > optimizer suggestion`. Never edit `manual-confirmed.yaml`.

## Preflight gate

Before every experiment:

1. Resolve `benchmark.active` to exactly one profile (`gkb` or `lmbench`).
2. Validate `execution.mode` (`single_core` or `multi_core`).
3. Validate `execution.core_scope` (`p_core`, `e_core`, `shared`, or `mixed`).
4. In single-core mode require one `simulated_core_id`, one CPU affinity and
   `threads: 1`. In multi-core mode require all participating core IDs, CPU
   affinity, thread count and P/E-core membership.
5. Load the matching hardware reference using benchmark, test/case, execution
   mode, core scope and thread count. Missing hardware data blocks the trial.
6. Lock every `FIXED_MANUAL`, `FIXED_SYSTEM`, `GUARDRAIL`, and
   `PENDING_MANUAL_CONFIRMATION` parameter.
7. Reject every search dimension whose `requires_manual_approval` is still true.

Return a structured `BLOCKED` result with all missing fields instead of
inventing values.

## Core isolation

Keep three independent namespaces: `p_core.*`, `e_core.*`, and `shared.*`.
Identical parameter names across P-core and E-core are independent. Never copy
an optimum between core classes. A P-core trial may change only `p_core.*`; an
E-core trial only `e_core.*`; a shared trial only `shared.*`. A mixed trial may
change multiple namespaces only during the explicitly enabled constrained joint
refinement stage.

For multi-core tests, report both per-core-class metrics and the system result.
Use objective weights from `baseline.yaml`; do not assume weights.

## Benchmark input adapters

### GKB

For `kind: gkb`, execute every configured item in `cases`. Construct the command
as `[executable] + argv`, set `working_directory` and `environment`, and connect
`stdin` only when supplied. Extract the score using `score_field`, falling back
to `score_regex`. Respect `direction`. Aggregate case results using the declared
method and weights. Preserve every case result and regression independently.

### lmbench

For `kind: lmbench`, expand each `argument_matrix` row into one command:
`[executable] + arguments`. Run warmups and measured repetitions separately.
Parse the declared metric and respect its direction: latency is minimized and
bandwidth is maximized. Never average unlike raw units. Normalize each metric to
its matching D9300 hardware reference first, then apply the configured weighted
aggregate. Preserve the raw latency/bandwidth, normalized score, repetition
variance, execution mode, core scope and thread count.

In multi-core mode, use only the declared affinity and thread/process count.
Do not silently turn a single-core test into a concurrent test or vice versa.

## Candidate generation

Generate candidates only from approved `SEARCH_DIRECT` and
`SEARCH_CONSTRAINED` dimensions. A candidate may change at most the configured
number of parameters. Evaluate `when` conditions and all cache geometry,
network geometry, protocol, topology and core-scope constraints before build or
simulation. Record rejected combinations as `INVALID`; learn them as forbidden
regions without running them.

Each candidate must contain its parent, core scope, changed values, inherited
fixed values, expected effect and reason. Audit fixed parameters before running.
Any fixed-parameter change is `INVALID_FIXED_PARAMETER_CHANGE`; any namespace
violation is `INVALID_CORE_SCOPE`.

## Execution loop

For every accepted candidate: generate the external Ruby configuration, run
configuration validation, correctness and smoke tests, run the selected quick
benchmark, parse metrics, compare with the matching hardware reference, update
the optimizer and check convergence. Run full benchmark validation and repeated
stability tests before accepting the final configuration.

Optimize in this order: correctness, D9300 fidelity, stability, performance,
then simulation cost. A faster configuration with worse hardware fidelity is
not automatically better.

Stop only when the configured convergence, correctness, full-validation,
hardware-error and variance conditions pass, or when the configured budget is
exhausted. Never relax a guardrail to manufacture convergence.

## Required iteration output

Return structured data containing experiment ID, iteration, candidate ID,
benchmark kind, execution mode, core scope, changed parameters, fixed-parameter
audit, constraints, per-case/test raw metrics, normalized metrics, P-core,
E-core and shared errors, aggregate score, simulation cost, best-candidate
decision, next action and reason.

The final result must contain separate `p_core`, `e_core`, and `shared`
configurations, the selected GKB/lmbench profile, single/multi-core execution
description, initial-to-final parameter changes, complete validation results,
convergence reason, unresolved manual confirmations and reproducible commands.

## Live dashboard event protocol

Do not wait for an iteration to finish before reporting status. Emit one UTF-8
JSON object for every state transition. JSON is the machine-to-machine output;
YAML remains the human-edited experiment input.

Publish event files under
`<event_directory>/<experiment_id>/<timestamp>-<event_id>.json`. Write the
complete content to the same filename with a `.json.tmp` suffix, flush and close
it, then atomically rename it to `.json`. Never append to a published event.
Every event ID must be globally unique. Re-sending an event with the same ID is
a duplicate, not a second update.

Every event uses this envelope:

```json
{
  "schema_version": 1,
  "event_id": "exp-001-trial-003-progress-04",
  "experiment_id": "exp-001",
  "event_type": "TRIAL_PROGRESS",
  "emitted_at": "2026-09-15T12:00:00Z",
  "payload": {}
}
```

Allowed event types and required payloads:

- `EXPERIMENT_UPSERT`: `name`, `state`, `current_stage`, complete `spec`, and
  metadata containing `benchmark_kind`, `execution_mode`, and `core_scope`.
- `STAGE_UPDATE`: `stage`, `state`, and optional `message`.
- `TRIAL_STARTED`: `trial_id`, zero-based `iteration`, `config_hash`, resolved
  `config`, `changed_parameters`, `benchmark_kind`, `core_scope`, and `stage`.
- `TRIAL_PROGRESS`: `trial_id`, `stage`, numeric `progress` from 0 to 1, and
  `progress_detail`. For GKB include `current_case`, completed/total cases and
  the latest score. For lmbench include `current_test`, arguments, repetition,
  completed/total commands and the latest raw metric.
- `TRIAL_FINISHED`: `trial_id`, complete `result`, `utility`,
  `best_candidate_updated`, `changed_parameters`, and final progress detail.
- `ITERATION_COMPLETED`: zero-based `iteration`, `best_score`,
  `relative_improvement`, and `metrics` including per-scope results, hardware
  error, stability and simulation cost.
- `EXPERIMENT_FINISHED`: terminal `state`, `stop_reason`, and
  `champion_trial_id`.

Emit `TRIAL_PROGRESS` after each GKB case, each lmbench command/repetition, or
at least once every 30 seconds during a long command. Do not emit guessed
scores. Keep the Trial status `RUNNING` until `TRIAL_FINISHED` is published.
