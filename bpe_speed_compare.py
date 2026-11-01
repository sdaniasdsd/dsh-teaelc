from __future__ import annotations

import argparse
import hashlib
import importlib.util
import statistics
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


VOCAB_SIZE = 500
REPEATS = 3
OFFICIAL_LIMIT_SECONDS = 1.5
SPECIAL_TOKEN = "<|endoftext|>"
DEFAULT_REPO = Path(__file__).resolve().parent / "assignment1-basics"


@dataclass(frozen=True)
class DatasetInfo:
    repo_path: Path
    dataset_path: Path
    size_bytes: int
    sha256: str
    python_version: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview and optionally compare official BPE training configurations."
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=DEFAULT_REPO,
        help=f"assignment repository (default: {DEFAULT_REPO})",
    )
    parser.add_argument(
        "--run",
        action="store_true",
        help="request the comparison (a second interactive y confirmation is required)",
    )
    return parser


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as corpus_file:
        for chunk in iter(lambda: corpus_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _dataset_path(repo: Path) -> tuple[Path, Path]:
    repo_path = repo.expanduser().resolve()
    dataset_path = (repo_path / "tests" / "fixtures" / "corpus.en").resolve()
    try:
        dataset_path.relative_to(repo_path)
    except ValueError as exc:
        raise ValueError(f"Dataset path resolves outside the repository: {dataset_path}") from exc
    return repo_path, dataset_path


def inspect_dataset(repo: Path) -> DatasetInfo:
    repo_path, dataset_path = _dataset_path(repo)
    if not dataset_path.is_file():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")
    try:
        size_bytes = dataset_path.stat().st_size
        digest = _sha256(dataset_path)
    except OSError as exc:
        raise OSError(f"Cannot read dataset {dataset_path}: {exc}") from exc
    return DatasetInfo(
        repo_path=repo_path,
        dataset_path=dataset_path,
        size_bytes=size_bytes,
        sha256=digest,
        python_version=sys.version.split()[0],
    )


def _print_preview(info: DatasetInfo) -> None:
    print("BPE benchmark preview (no tokenizer code loaded; no training performed)")
    print(f"Repository: {info.repo_path}")
    print(f"Dataset:    {info.dataset_path}")
    print(f"Size:       {info.size_bytes} bytes")
    print(f"SHA-256:    {info.sha256}")
    print(f"Python:     {info.python_version}")
    print(f"Vocab size: {VOCAB_SIZE}")
    print(f"Repeats:    {REPEATS} paired rounds")
    print(f"Official limit: special-token condition must be < {OFFICIAL_LIMIT_SECONDS:.1f} seconds")
    print("Configurations:")
    print("  ordinary: special_tokens=[]")
    print(f'  special:  special_tokens=["{SPECIAL_TOKEN}"]')


def _load_adapter(repo: Path):
    adapter_path = repo / "tests" / "adapters.py"
    if not adapter_path.is_file():
        raise FileNotFoundError(f"BPE adapter not found: {adapter_path}")
    spec = importlib.util.spec_from_file_location("_bpe_speed_compare_adapters", adapter_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load BPE adapter from {adapter_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(spec.name, None)
        raise
    runner = getattr(module, "run_train_bpe", None)
    if not callable(runner):
        sys.modules.pop(spec.name, None)
        raise ImportError(f"BPE adapter has no callable run_train_bpe: {adapter_path}")
    return module, runner


def _print_report(ordinary: list[float], special: list[float]) -> None:
    print("\nPaired training times (seconds):")
    for round_index, (ordinary_time, special_time) in enumerate(zip(ordinary, special), start=1):
        print(
            f"  round {round_index}: ordinary={ordinary_time:.3f}, "
            f"special-token={special_time:.3f}"
        )
    ordinary_median = statistics.median(ordinary)
    special_median = statistics.median(special)
    difference = special_median - ordinary_median
    if ordinary_median == 0:
        percentage = "n/a (ordinary median is zero)"
    else:
        percentage = f"{difference / ordinary_median * 100:.1f}%"
    print(f"ordinary median: {ordinary_median:.2f} seconds")
    print(f"special-token median: {special_median:.2f} seconds")
    print(f"special minus ordinary: {difference:+.2f} seconds ({percentage})")
    print(
        f"Official criterion: special-token median is tested against "
        f"the < {OFFICIAL_LIMIT_SECONDS:.1f} seconds limit."
    )
    if special_median < OFFICIAL_LIMIT_SECONDS:
        print("Special-token condition: below the official time limit.")
    else:
        print("Special-token condition: does not meet the official time limit.")


@contextmanager
def _without_bytecode_writes() -> Iterator[None]:
    original = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        yield
    finally:
        sys.dont_write_bytecode = original


@contextmanager
def _repository_on_sys_path(repo: Path) -> Iterator[None]:
    repo_string = str(repo)
    sys.path.insert(0, repo_string)
    try:
        yield
    finally:
        try:
            sys.path.remove(repo_string)
        except ValueError:
            pass


def _verify_dataset_unchanged(dataset_path: Path, before_hash: str) -> bool:
    try:
        after_hash = _sha256(dataset_path)
    except OSError as exc:
        print(f"Results invalid: cannot verify dataset after the run: {exc}")
        return False
    if before_hash != after_hash:
        print("Results invalid: dataset SHA-256 changed during the benchmark.")
        return False
    print(f"Dataset SHA-256 unchanged: {after_hash}")
    return True


def run_comparison(
    repo: Path,
    input_fn: Callable[[str], str] = input,
    clock: Callable[[], float] = time.perf_counter,
    expected_hash: str | None = None,
) -> int:
    repo_path = repo.expanduser().resolve()
    answer = input_fn("Start the BPE comparison now? Type y to continue: ")
    if answer.strip().lower() != "y":
        print("Benchmark cancelled; no adapter was imported and no training was run.")
        return 0

    dataset_path: Path | None = None
    before_hash: str | None = None
    ordinary_times: list[float] = []
    special_times: list[float] = []
    benchmark_error: Exception | None = None
    with _without_bytecode_writes(), _repository_on_sys_path(repo_path):
        try:
            _repo_path, dataset_path = _dataset_path(repo_path)
            before_hash = _sha256(dataset_path)
            if expected_hash is not None and before_hash != expected_hash:
                print(
                    "Dataset changed since preview; refusing to benchmark. Run preview again.",
                    file=sys.stderr,
                )
                return 1
            _module, runner = _load_adapter(repo_path)
        except Exception as exc:
            if dataset_path is not None and before_hash is not None:
                _verify_dataset_unchanged(dataset_path, before_hash)
            print(f"Cannot start benchmark: {exc}", file=sys.stderr)
            return 1

        configurations = {
            "ordinary": [],
            "special": [SPECIAL_TOKEN],
        }
        try:
            for round_index in range(REPEATS):
                order = ("ordinary", "special") if round_index % 2 == 0 else ("special", "ordinary")
                round_times: dict[str, float] = {}
                for condition in order:
                    start = clock()
                    runner(
                        input_path=dataset_path,
                        vocab_size=VOCAB_SIZE,
                        special_tokens=list(configurations[condition]),
                    )
                    round_times[condition] = clock() - start
                ordinary_times.append(round_times["ordinary"])
                special_times.append(round_times["special"])
        except Exception as exc:
            benchmark_error = exc

    hash_unchanged = _verify_dataset_unchanged(dataset_path, before_hash)
    if benchmark_error is not None:
        print(f"Benchmark failed: {benchmark_error}", file=sys.stderr)
        return 1
    _print_report(ordinary_times, special_times)
    return 0 if hash_unchanged else 1


def main(
    argv: Sequence[str] | None = None,
    *,
    input_fn: Callable[[str], str] = input,
    clock: Callable[[], float] = time.perf_counter,
) -> int:
    args = build_parser().parse_args(argv)
    try:
        info = inspect_dataset(args.repo)
    except (OSError, ValueError) as exc:
        print(f"Cannot inspect dataset: {exc}", file=sys.stderr)
        return 1
    _print_preview(info)
    if not args.run:
        return 0
    return run_comparison(
        args.repo, input_fn=input_fn, clock=clock, expected_hash=info.sha256
    )


if __name__ == "__main__":
    raise SystemExit(main())
