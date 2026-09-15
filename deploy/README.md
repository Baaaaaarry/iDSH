# Deployment layout

`scripts/install.sh` creates a project-local Python environment, builds the
pinned DSH submodule, creates `$PROJECT/.dsh-home/profiles/gem5-lab`, and
installs the local `dsh-gem5-lab` bundle. No global package or gem5 source file
is changed.

`scripts/start.sh` owns two same-host processes:

- gem5-lab API and dashboard on `127.0.0.1:18080`;
- the DSH `gem5-lab` Web profile on `127.0.0.1:3080`.

The launcher rejects public DSH binding. Put an authenticated reverse proxy or
SSH port forwarding in front of loopback services for remote access. Keep
`DEEPSEEK_API_KEY` only in the ignored `.env` file or a secret manager.

The production benchmark executor remains deployment-specific. It must clone
the selected gem5 commit into an ephemeral workspace and publish standard
events to `/api/events`; it must not write into the source tree recorded in the
experiment.
