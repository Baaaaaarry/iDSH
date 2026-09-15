import tempfile
import unittest
from pathlib import Path

from gem5_lab.events import AgentEventWriter, EventImporter, make_event
from gem5_lab.store import Store


class EventPipelineTests(unittest.TestCase):
    def test_event_files_import_idempotently_and_update_live_trial(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            store = Store(root / "lab.db")
            writer = AgentEventWriter(root / "events")
            importer = EventImporter(store, root / "events")
            experiment_id = "exp-live"
            writer.write(make_event("e1", experiment_id, "EXPERIMENT_UPSERT", {
                "name": "live lmbench",
                "state": "CREATED",
                "current_stage": "CREATE_EXPERIMENT",
                "spec": {
                    "baseline_score": 100.0,
                    "dimensions": [{"name": "p_core.l2.dataAccessLatency", "values": [6, 8]}],
                    "stop": {"max_trials": 10, "max_iterations": 3},
                },
                "metadata": {"benchmark_kind": "lmbench", "execution_mode": "single_core", "core_scope": "p_core"},
            }))
            writer.write(make_event("e2", experiment_id, "TRIAL_STARTED", {
                "trial_id": "trial-1", "iteration": 0, "config_hash": "abc",
                "config": {"p_core.l2.dataAccessLatency": 8},
                "changed_parameters": [{"path": "p_core.l2.dataAccessLatency", "old_value": 10, "new_value": 8}],
                "benchmark_kind": "lmbench", "core_scope": "p_core", "stage": "GKB_QUICK_TEST",
            }))
            writer.write(make_event("e3", experiment_id, "TRIAL_PROGRESS", {
                "trial_id": "trial-1", "stage": "GKB_QUICK_TEST", "progress": 0.5,
                "progress_detail": {"current_test": "lat_mem_rd", "completed_commands": 2, "total_commands": 4},
            }))
            first = importer.scan()
            second = importer.scan()
            self.assertEqual(first["imported"], 3)
            self.assertEqual(second["duplicates"], 3)
            detail = store.detail(experiment_id)
            self.assertEqual(detail["current_stage"], "GKB_QUICK_TEST")
            self.assertEqual(detail["current_trial"]["progress"], 0.5)
            self.assertEqual(detail["current_trial"]["progress_detail"]["current_test"], "lat_mem_rd")
            self.assertEqual(len(detail["events"]), 3)


if __name__ == "__main__":
    unittest.main()
