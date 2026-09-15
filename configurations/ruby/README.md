# External Ruby configuration

`run_gemmini_gkb.py` is the non-invasive MESI Two Level replacement for
`gem5/configs/gemmini/se-run.py`. It keeps gem5 read-only and accepts standard
Ruby options, so the optimizer can change cache and network parameters without
generating Python source.

Example:

```bash
/external/build/X86/gem5.opt \
  /Users/libo/Work/gem5-lab/configurations/ruby/run_gemmini_gkb.py \
  --gem5-root /Users/libo/Work/gem5 \
  --cmd /absolute/path/to/gkb-case \
  --network garnet \
  --topology Crossbar \
  --l1d_size 64KiB \
  --l1d_assoc 8 \
  --l2_size 2MiB \
  --l2_assoc 16 \
  --num-l2caches 4 \
  --vcs-per-vnet 4 \
  --link-width-bits 128 \
  --router-latency 2
```

The gem5 binary must be built with X86, the local Gemmini objects, and
`MESI_Two_Level`. Build it in an ephemeral clone or CI workspace rather than in
the source path recorded by the experiment.
