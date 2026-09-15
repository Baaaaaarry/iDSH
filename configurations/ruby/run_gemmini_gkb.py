"""External Ruby replacement for gem5/configs/gemmini/se-run.py.

This file intentionally lives outside the gem5 source tree.  Run it with a
gem5 binary compiled for X86 and MESI_Two_Level.  CPU data requests retain the
original Gemmini interposition, while Gemmini-originated memory requests enter
Ruby through a DMA controller.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def discover_gem5_root() -> Path:
    bootstrap = argparse.ArgumentParser(add_help=False)
    bootstrap.add_argument(
        "--gem5-root",
        default=os.environ.get("GEM5_SOURCE", "/Users/libo/Work/gem5"),
    )
    args, _ = bootstrap.parse_known_args()
    root = Path(args.gem5_root).resolve()
    required = root / "configs" / "ruby" / "Ruby.py"
    if not required.is_file():
        raise SystemExit(f"Invalid --gem5-root: missing {required}")
    return root


GEM5_ROOT = discover_gem5_root()
sys.path[:0] = [str(GEM5_ROOT / "configs"), str(GEM5_ROOT / "configs" / "deprecated")]

import m5
from m5.defines import buildEnv
from m5.objects import (
    AddrRange,
    GemminiDevA,
    Process,
    Root,
    SEWorkload,
    SrcClockDomain,
    System,
    VoltageDomain,
    X86MinorCPU,
)

from common import Options
from ruby import Ruby


def parse_args():
    parser = argparse.ArgumentParser(
        description="Non-invasive Gemmini + MESI_Two_Level Ruby configuration"
    )
    Options.addCommonOptions(parser)
    Options.addSEOptions(parser)
    Ruby.define_options(parser)
    parser.add_argument("--gem5-root", default=str(GEM5_ROOT))
    parser.add_argument("--ndp-ctrl-start", default="0x40000000")
    parser.add_argument("--ndp-ctrl-end", default="0x40001000")
    parser.add_argument("--ndp-data-end", default="0x80000000")
    parser.add_argument("--gemmini-max-rsze", type=lambda x: int(x, 0), default=0x40)
    parser.add_argument("--gemmini-max-reqs", type=int, default=64)
    parser.set_defaults(
        ruby=True,
        cpu_type="X86MinorCPU",
        num_cpus=1,
        num_dirs=1,
        num_l2caches=1,
        cacheline_size=64,
        l1i_size="32KiB",
        l1i_assoc=2,
        l1d_size="64KiB",
        l1d_assoc=2,
        l2_size="2MiB",
        l2_assoc=8,
        mem_type="DDR3_1600_8x8",
        mem_size="2GiB",
        sys_clock="2GHz",
        cpu_clock="2GHz",
        ruby_clock="2GHz",
        network="simple",
        topology="Crossbar",
    )
    args = parser.parse_args()
    if not args.cmd:
        args.cmd = str(GEM5_ROOT / "tests/test-progs/gemmini-apps/bench")
    return args


def require_compatible_binary() -> None:
    if not buildEnv.get("USE_X86_ISA"):
        raise SystemExit("This configuration requires an X86 gem5 binary")
    protocol = buildEnv.get("PROTOCOL")
    if protocol != "MESI_Two_Level":
        raise SystemExit(
            f"Expected PROTOCOL=MESI_Two_Level, binary contains {protocol!r}"
        )


def build_system(args):
    system = System()
    system.voltage_domain = VoltageDomain()
    system.clk_domain = SrcClockDomain(
        clock=args.sys_clock,
        voltage_domain=system.voltage_domain,
    )
    system.mem_mode = "timing"
    system.mem_ranges = [AddrRange(args.mem_size)]
    system.cache_line_size = args.cacheline_size

    system.cpu = X86MinorCPU(cpu_id=0)
    system.cpu.clk_domain = SrcClockDomain(
        clock=args.cpu_clock,
        voltage_domain=system.voltage_domain,
    )
    system.gemmini_dev = GemminiDevA(
        ndp_ctrl=(args.ndp_ctrl_start, args.ndp_ctrl_end),
        ndp_data=(args.ndp_ctrl_end, args.ndp_data_end),
        max_rsze=args.gemmini_max_rsze,
        max_reqs=args.gemmini_max_reqs,
    )

    # Ruby creates the L1/L2/directory/network and a DMA controller bound to
    # the accelerator's request port. It also creates DRAM controllers.
    Ruby.create_system(
        args,
        full_system=False,
        system=system,
        dma_ports=[system.gemmini_dev.dma_port],
        cpus=[system.cpu],
    )
    system.ruby.clk_domain = SrcClockDomain(
        clock=args.ruby_clock,
        voltage_domain=system.voltage_domain,
    )
    ruby_port = system.ruby._cpu_ports[0]

    # Preserve the original topology: I-fetch goes directly to the memory
    # hierarchy, while CPU data traffic passes through Gemmini first.
    system.cpu.icache_port = ruby_port.in_ports
    system.gemmini_dev.cpu_side = system.cpu.dcache_port
    system.gemmini_dev.mem_side = ruby_port.in_ports
    system.cpu.mmu.connectWalkerPorts(ruby_port.in_ports, ruby_port.in_ports)
    system.cpu.createInterruptController()
    system.cpu.connectUncachedPorts(
        ruby_port.in_ports,
        ruby_port.interrupt_out_port,
    )

    binary = Path(args.cmd).resolve()
    if not binary.is_file():
        raise SystemExit(f"Benchmark binary not found: {binary}")
    process = Process(executable=str(binary))
    process.cmd = [str(binary)] + (args.options.split() if args.options else [])
    system.workload = SEWorkload.init_compatible(str(binary))
    system.cpu.workload = process
    system.cpu.createThreads()
    return system


def main() -> None:
    args = parse_args()
    require_compatible_binary()
    system = build_system(args)
    root = Root(full_system=False, system=system)
    m5.instantiate()
    system.cpu.workload[0].map(
        int(args.ndp_ctrl_start, 0),
        int(args.ndp_ctrl_start, 0),
        int(args.ndp_data_end, 0) - int(args.ndp_ctrl_start, 0),
        cacheable=False,
    )
    print("========== Beginning Ruby simulation ==========")
    exit_event = m5.simulate(args.abs_max_tick)
    print(f"Exiting @ tick {m5.curTick()} because {exit_event.getCause()}")


if __name__ == "__m5_main__":
    main()

