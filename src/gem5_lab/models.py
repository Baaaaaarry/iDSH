from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class ExperimentState(StrEnum):
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    VALIDATING_FINAL = "VALIDATING_FINAL"
    COMPLETED_TARGET_REACHED = "COMPLETED_TARGET_REACHED"
    COMPLETED_CONVERGED = "COMPLETED_CONVERGED"
    COMPLETED_BUDGET_EXHAUSTED = "COMPLETED_BUDGET_EXHAUSTED"
    STOPPED_NO_QUALIFIED_CONFIGURATION = "STOPPED_NO_QUALIFIED_CONFIGURATION"
    FAILED = "FAILED"


TERMINAL_STATES = {
    ExperimentState.COMPLETED_TARGET_REACHED,
    ExperimentState.COMPLETED_CONVERGED,
    ExperimentState.COMPLETED_BUDGET_EXHAUSTED,
    ExperimentState.STOPPED_NO_QUALIFIED_CONFIGURATION,
    ExperimentState.FAILED,
}


@dataclass(frozen=True)
class SearchDimension:
    name: str
    values: tuple[Any, ...]
    when: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StopPolicy:
    max_trials: int = 100
    max_iterations: int = 20
    min_relative_improvement: float = 0.005
    patience: int = 3
    target_hardware_mape: float = 0.10
    target_performance_improvement: float = 0.08
    max_case_regression: float = 0.03
    max_cv: float = 0.02


@dataclass(frozen=True)
class ExperimentSpec:
    name: str
    gem5_source: str
    gem5_commit: str
    baseline_score: float
    batch_size: int
    seed: int
    dimensions: tuple[SearchDimension, ...]
    stop: StopPolicy
    cases: tuple[str, ...]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExperimentSpec":
        dimensions = tuple(
            SearchDimension(
                name=item["name"],
                values=tuple(item["values"]),
                when=item.get("when", {}),
            )
            for item in data["search_space"]
        )
        return cls(
            name=data["name"],
            gem5_source=data["gem5"]["source"],
            gem5_commit=data["gem5"]["commit"],
            baseline_score=float(data["baseline_score"]),
            batch_size=int(data.get("batch_size", 8)),
            seed=int(data.get("seed", 1)),
            dimensions=dimensions,
            stop=StopPolicy(**data.get("stop", {})),
            cases=tuple(data["cases"]),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TrialResult:
    status: str
    score: float = 0.0
    hardware_mape: float = 1.0
    case_scores: dict[str, float] = field(default_factory=dict)
    case_regressions: dict[str, float] = field(default_factory=dict)
    cv: float = 1.0
    sim_seconds: float = 0.0
    correctness_passed: bool = False
    failure_reason: str | None = None

    @property
    def max_case_regression(self) -> float:
        return max(self.case_regressions.values(), default=0.0)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

