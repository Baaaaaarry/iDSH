from __future__ import annotations

from typing import Any


def validate_ruby_config(config: dict[str, Any]) -> list[str]:
    """Return deterministic validation errors without touching gem5."""
    errors: list[str] = []
    network = config.get("network")
    if network not in {"simple", "garnet"}:
        errors.append("network must be simple or garnet")

    banks = config.get("l2_banks")
    if not isinstance(banks, int) or banks < 1 or banks & (banks - 1):
        errors.append("l2_banks must be a positive power of two")

    line = config.get("cache_line_size", 64)
    if line not in {32, 64, 128}:
        errors.append("cache_line_size must be 32, 64, or 128 bytes")

    if network == "simple":
        garnet_only = {
            "vcs_per_vnet",
            "ni_flit_size",
            "buffers_per_data_vc",
            "router_latency",
        }
        present = sorted(key for key in garnet_only if key in config)
        if present:
            errors.append(f"Garnet-only parameters used with simple network: {present}")
    else:
        if config.get("vcs_per_vnet", 0) < 1:
            errors.append("vcs_per_vnet must be positive")
        flit = config.get("ni_flit_size", 0)
        if flit not in {8, 16, 32, 64}:
            errors.append("ni_flit_size must be 8, 16, 32, or 64 bytes")

    return errors

