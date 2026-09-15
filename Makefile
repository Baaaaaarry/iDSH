.PHONY: install start test doctor demo

install:
	./scripts/install.sh

start:
	./scripts/start.sh

test:
	.venv/bin/python -m pytest -q

doctor:
	./scripts/doctor.sh

demo:
	.venv/bin/gem5-lab --db var/gem5-lab.db run-synthetic examples/demo-experiment.json
