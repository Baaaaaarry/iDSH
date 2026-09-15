import json
import tempfile
import unittest
from pathlib import Path

from gem5_lab.constraints import validate_ruby_config
from gem5_lab.engine import ExperimentEngine
from gem5_lab.models import ExperimentSpec
from gem5_lab.runner import SyntheticRubyRunner
from gem5_lab.store import Store


ROOT = Path(__file__).parents[1]


class CoreTests(unittest.TestCase):
    def test_constraints(self):
        self.assertTrue(validate_ruby_config({"network": "simple", "l2_banks": 3}))
        self.assertTrue(validate_ruby_config({"network": "simple", "l2_banks": 2, "vcs_per_vnet": 4}))
        self.assertFalse(validate_ruby_config({"network": "garnet", "l2_banks": 4, "vcs_per_vnet": 4, "ni_flit_size": 16}))

    def test_closed_loop_stops_and_writes_bundle(self):
        spec = ExperimentSpec.from_dict(json.loads((ROOT / "examples/demo-experiment.json").read_text()))
        with tempfile.TemporaryDirectory() as temp:
            store = Store(Path(temp) / "lab.db")
            engine = ExperimentEngine(store, SyntheticRubyRunner(), Path(temp) / "artifacts")
            experiment_id = engine.create(spec)
            detail = engine.run(experiment_id, spec)
            self.assertTrue(detail["state"].startswith("COMPLETED"))
            self.assertGreater(detail["counts"]["total"], 0)
            self.assertIsNotNone(detail["champion"])
            self.assertEqual(detail["current_stage"], "DASHBOARD_FINAL_RESULT")
            self.assertTrue((Path(temp) / "artifacts" / experiment_id / "ruby-config.json").exists())


if __name__ == "__main__":
    unittest.main()
