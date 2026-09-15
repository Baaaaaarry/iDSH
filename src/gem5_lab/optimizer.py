from __future__ import annotations

import hashlib
import json
import random
from typing import Any

from .constraints import validate_ruby_config
from .models import ExperimentSpec


def config_hash(config: dict[str, Any]) -> str:
    payload = json.dumps(config, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


class AdaptiveOptimizer:
    """Dependency-free mixed-space optimizer suitable for an MVP.

    The first iteration explores globally. Later iterations mutate the best
    known configuration while retaining global samples to avoid local lock-in.
    """

    def __init__(self, spec: ExperimentSpec):
        self.spec = spec
        self.rng = random.Random(spec.seed)

    def _random_config(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for dim in self.spec.dimensions:
            if dim.when and any(result.get(k) != v for k, v in dim.when.items()):
                continue
            result[dim.name] = self.rng.choice(dim.values)
        return result

    def _mutate(self, champion: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        changed = False
        for dim in self.spec.dimensions:
            if dim.when and any(result.get(k) != v for k, v in dim.when.items()):
                continue
            old = champion.get(dim.name)
            if old in dim.values and self.rng.random() < 0.70:
                value = old
            else:
                value = self.rng.choice(dim.values)
                changed = changed or value != old
            result[dim.name] = value
        if not changed:
            mutable = [d for d in self.spec.dimensions if d.name in result and len(d.values) > 1]
            if mutable:
                dim = self.rng.choice(mutable)
                alternatives = [v for v in dim.values if v != result[dim.name]]
                result[dim.name] = self.rng.choice(alternatives)
        return result

    def suggest(
        self,
        count: int,
        seen: set[str],
        champion: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        suggestions: list[dict[str, Any]] = []
        attempts = 0
        while len(suggestions) < count and attempts < count * 100:
            attempts += 1
            explore = champion is None or self.rng.random() < 0.25
            candidate = self._random_config() if explore else self._mutate(champion)
            key = config_hash(candidate)
            if key in seen or validate_ruby_config(candidate):
                continue
            seen.add(key)
            suggestions.append(candidate)
        return suggestions

