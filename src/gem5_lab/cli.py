from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import ExperimentEngine
from .models import ExperimentSpec
from .runner import SyntheticRubyRunner
from .store import Store
from .events import EventImporter


def main() -> None:
    parser = argparse.ArgumentParser(prog="gem5-lab")
    parser.add_argument("--db", default="var/gem5-lab.db")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run-synthetic", help="run the full closed loop with the synthetic adapter")
    run.add_argument("spec")
    show = sub.add_parser("show")
    show.add_argument("experiment_id")
    import_events = sub.add_parser("import-events", help="import Loop Agent JSON event files")
    import_events.add_argument("path")
    args = parser.parse_args()
    store = Store(args.db)
    if args.command == "run-synthetic":
        spec = ExperimentSpec.from_dict(json.loads(Path(args.spec).read_text()))
        engine = ExperimentEngine(store, SyntheticRubyRunner(), Path(args.db).parent / "artifacts")
        experiment_id = engine.create(spec)
        detail = engine.run(experiment_id, spec)
        print(json.dumps({
            "experiment_id": experiment_id,
            "state": detail["state"],
            "stop_reason": detail["stop_reason"],
            "champion": detail["champion"],
        }, indent=2))
    elif args.command == "show":
        detail = store.detail(args.experiment_id)
        if not detail:
            parser.error("experiment not found")
        print(json.dumps(detail, indent=2))
    else:
        print(json.dumps(EventImporter(store, args.path).scan(), indent=2))


if __name__ == "__main__":
    main()
