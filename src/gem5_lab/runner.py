from __future__ import annotations

import hashlib
import math
import random
from abc import ABC, abstractmethod
from typing import Any

from .models import ExperimentSpec, TrialResult


class TrialRunner(ABC):
    @abstractmethod
    def run(self, spec: ExperimentSpec, config: dict[str, Any], trial_id: str) -> TrialResult:
        raise NotImplementedError


class SyntheticRubyRunner(TrialRunner):
    """Deterministic simulator for testing the orchestration loop end to end."""

    TARGET = {
        "network": "garnet",
        "l1d_size": "64KiB",
        "l1d_assoc": 8,
        "l2_size": "2MiB",
        "l2_assoc": 16,
        "l2_banks": 4,
        "vcs_per_vnet": 4,
        "ni_flit_size": 16,
        "buffers_per_data_vc": 4,
        "router_latency": 2,
        "cache_line_size": 64,
    }

    def run(self, spec: ExperimentSpec, config: dict[str, Any], trial_id: str) -> TrialResult:
        seed = int(hashlib.sha256(trial_id.encode()).hexdigest()[:12], 16)
        rng = random.Random(seed)
        active = [key for key in self.TARGET if key in config]
        matches = sum(config[key] == self.TARGET[key] for key in active)
        quality = matches / max(len(active), 1)

        if config.get("network") == "garnet" and config.get("vcs_per_vnet", 1) == 1:
            return TrialResult(status="FAILED", failure_reason="synthetic Ruby deadlock")

        improvement = 0.14 * quality + rng.uniform(-0.003, 0.003)
        score = spec.baseline_score * (1 + improvement)
        hardware_mape = max(0.035, 0.24 - 0.20 * quality + rng.uniform(-0.004, 0.004))
        case_scores: dict[str, float] = {}
        regressions: dict[str, float] = {}
        for index, case in enumerate(spec.cases):
            case_factor = 1 + improvement + math.sin(index + 1) * 0.007
            case_scores[case] = spec.baseline_score * case_factor
            regressions[case] = max(0.0, 1.0 - case_factor)
        return TrialResult(
            status="COMPLETED",
            score=score,
            hardware_mape=hardware_mape,
            case_scores=case_scores,
            case_regressions=regressions,
            cv=max(0.004, 0.025 - 0.02 * quality),
            sim_seconds=30 + rng.random() * 60,
            correctness_passed=True,
        )


class ExternalGem5Runner(TrialRunner):
    """Extension point for a container/CI-backed gem5 and GKB runner."""

    def run(self, spec: ExperimentSpec, config: dict[str, Any], trial_id: str) -> TrialResult:
        raise NotImplementedError(
            "Configure a site-specific build/run adapter; gem5 source remains read-only"
        )

