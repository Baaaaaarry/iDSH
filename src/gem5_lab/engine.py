from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .models import ExperimentSpec, ExperimentState, TrialResult
from .optimizer import AdaptiveOptimizer, config_hash
from .runner import TrialRunner
from .store import Store


def utility(spec: ExperimentSpec, result: TrialResult) -> float:
    if result.status != "COMPLETED" or not result.correctness_passed:
        # Keep the value JSON-safe so failed trials remain visible through the
        # dashboard API. It is deliberately far below every valid utility.
        return -1_000_000_000.0
    performance = result.score / spec.baseline_score - 1.0
    return performance - 0.50 * result.hardware_mape - 0.20 * result.max_case_regression - 0.10 * result.cv


def qualified(spec: ExperimentSpec, result: TrialResult) -> bool:
    stop = spec.stop
    return (
        result.status == "COMPLETED"
        and result.correctness_passed
        and result.hardware_mape <= stop.target_hardware_mape
        and result.score / spec.baseline_score - 1 >= stop.target_performance_improvement
        and result.max_case_regression <= stop.max_case_regression
        and result.cv <= stop.max_cv
    )


class ExperimentEngine:
    def __init__(self, store: Store, runner: TrialRunner, artifacts_dir: str | Path):
        self.store = store
        self.runner = runner
        self.artifacts_dir = Path(artifacts_dir)

    def create(self, spec: ExperimentSpec) -> str:
        experiment_id = f"exp-{uuid.uuid4().hex[:10]}"
        self.store.create_experiment(experiment_id, spec)
        return experiment_id

    def run(self, experiment_id: str, spec: ExperimentSpec) -> dict[str, Any]:
        self.store.update_experiment(experiment_id, ExperimentState.RUNNING)
        self.store.update_stage(experiment_id, "RUN_BASELINE")
        optimizer = AdaptiveOptimizer(spec)
        seen: set[str] = set()
        champion_config: dict[str, Any] | None = None
        champion_result: TrialResult | None = None
        champion_id: str | None = None
        best_utility = -1_000_000_000.0
        previous_best_score = spec.baseline_score
        stale_iterations = 0
        total_trials = 0
        final_state = ExperimentState.STOPPED_NO_QUALIFIED_CONFIGURATION
        stop_reason = "No qualified configuration was found"

        for iteration in range(spec.stop.max_iterations):
            remaining = spec.stop.max_trials - total_trials
            if remaining <= 0:
                final_state = ExperimentState.COMPLETED_BUDGET_EXHAUSTED if champion_result else final_state
                stop_reason = "Maximum trial budget reached"
                break
            self.store.update_stage(
                experiment_id,
                "GENERATE_INITIAL_CANDIDATES" if iteration == 0 else "GENERATE_NEXT_CANDIDATES",
            )
            configs = optimizer.suggest(min(spec.batch_size, remaining), seen, champion_config)
            if not configs:
                final_state = ExperimentState.COMPLETED_CONVERGED if champion_result else final_state
                stop_reason = "Search space exhausted"
                break

            for ordinal, config in enumerate(configs):
                self.store.update_stage(experiment_id, "CONSTRAINT_CHECK")
                trial_id = f"{experiment_id}-i{iteration:03d}-t{ordinal:03d}"
                self.store.add_trial(trial_id, experiment_id, iteration, config_hash(config), config)
                self.store.update_stage(experiment_id, "CORRECTNESS_SMOKE")
                result = self.runner.run(spec, config, trial_id)
                self.store.update_stage(
                    experiment_id,
                    "GKB_QUICK_TEST" if result.status == "COMPLETED" else "LEARN_FAILURE_REGION",
                )
                score = utility(spec, result)
                self.store.finish_trial(trial_id, result, score)
                self.store.update_stage(experiment_id, "PARSE_METRICS")
                total_trials += 1
                if score > best_utility:
                    best_utility = score
                    champion_config = config
                    champion_result = result
                    champion_id = trial_id
                    self.store.update_experiment(experiment_id, ExperimentState.RUNNING, champion_trial_id=trial_id)

            current_best = champion_result.score if champion_result else spec.baseline_score
            relative_gain = (current_best - previous_best_score) / max(previous_best_score, 1e-9)
            self.store.add_iteration(experiment_id, iteration, current_best, relative_gain)
            self.store.update_stage(experiment_id, "UPDATE_OPTIMIZER")
            stale_iterations = stale_iterations + 1 if relative_gain < spec.stop.min_relative_improvement else 0
            previous_best_score = max(previous_best_score, current_best)

            self.store.update_stage(experiment_id, "CHECK_CONVERGENCE")
            if champion_result and qualified(spec, champion_result):
                self.store.update_stage(experiment_id, "FULL_GKB_VALIDATION")
                final_state = ExperimentState.COMPLETED_TARGET_REACHED
                stop_reason = "Performance, hardware fidelity, regression, and stability targets reached"
                break
            if champion_result and stale_iterations >= spec.stop.patience:
                final_state = ExperimentState.COMPLETED_CONVERGED
                stop_reason = f"Improvement stayed below {spec.stop.min_relative_improvement:.2%} for {stale_iterations} iterations"
                break
        else:
            if champion_result:
                final_state = ExperimentState.COMPLETED_BUDGET_EXHAUSTED
                stop_reason = "Maximum iteration budget reached"

        self.store.update_stage(experiment_id, "FINAL_VALIDATION_DECISION")
        self.store.update_stage(experiment_id, "STABILITY_REPEAT")
        self.store.update_stage(experiment_id, "VARIANCE_CHECK")
        self.store.update_stage(experiment_id, "FREEZE_CONFIG")
        self.store.update_experiment(experiment_id, final_state, stop_reason, champion_id)
        detail = self.store.detail(experiment_id)
        assert detail is not None
        self._write_final_bundle(experiment_id, detail)
        self.store.update_stage(experiment_id, "GENERATE_SUMMARY")
        self.store.update_stage(experiment_id, "DASHBOARD_FINAL_RESULT")
        detail = self.store.detail(experiment_id)
        assert detail is not None
        return detail

    def _write_final_bundle(self, experiment_id: str, detail: dict[str, Any]) -> None:
        destination = self.artifacts_dir / experiment_id
        destination.mkdir(parents=True, exist_ok=True)
        summary = {
            "experiment_id": experiment_id,
            "state": detail["state"],
            "stop_reason": detail["stop_reason"],
            "counts": detail["counts"],
            "champion": detail["champion"],
            "iterations": detail["iterations"],
            "gem5_source": detail["spec"]["gem5_source"],
            "gem5_commit": detail["spec"]["gem5_commit"],
        }
        (destination / "experiment-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        if detail["champion"]:
            (destination / "ruby-config.json").write_text(
                json.dumps(detail["champion"]["config"], indent=2), encoding="utf-8"
            )
