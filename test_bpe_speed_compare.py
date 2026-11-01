from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from typing import Callable


MODULE_PATH = Path(__file__).with_name("bpe_speed_compare.py")


class BpeSpeedCompareTests(unittest.TestCase):
    def make_repo(self, adapter_source: str | None = None) -> tuple[Path, Path, Path]:
        root = Path(self.temp.name) / "repo"
        fixture_dir = root / "tests" / "fixtures"
        fixture_dir.mkdir(parents=True)
        corpus = fixture_dir / "corpus.en"
        corpus.write_text("sample corpus\n", encoding="utf-8")
        adapter_dir = root / "tests"
        marker = Path(self.temp.name) / "adapter-imported"
        calls = Path(self.temp.name) / "adapter-calls.jsonl"
        if adapter_source is not None:
            (adapter_dir / "adapters.py").write_text(
                "from pathlib import Path\n"
                "import json\n"
                f"Path({str(marker)!r}).write_text('loaded', encoding='utf-8')\n"
                "def run_train_bpe(input_path, vocab_size, special_tokens):\n"
                f"    with Path({str(calls)!r}).open('a', encoding='utf-8') as f:\n"
                "        f.write(json.dumps({'input_path': str(input_path), 'vocab_size': vocab_size, 'special_tokens': special_tokens}) + '\\n')\n"
                + adapter_source,
                encoding="utf-8",
            )
        return root, corpus, marker

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        if not MODULE_PATH.is_file():
            self.fail("benchmark utility module is not implemented yet")
        spec = importlib.util.spec_from_file_location("bpe_speed_compare_test_loaded", MODULE_PATH)
        if spec is None or spec.loader is None:
            self.fail("could not load benchmark utility module")
        self.benchmark = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.benchmark
        spec.loader.exec_module(self.benchmark)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def capture_main(self, argv: list[str], input_fn: Callable[[str], str] = lambda _prompt: "") -> tuple[int, str, str]:
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = self.benchmark.main(argv, input_fn=input_fn)
        return status, stdout.getvalue(), stderr.getvalue()

    def test_default_preview_does_not_import_adapter(self) -> None:
        repo, corpus, marker = self.make_repo("    return {}, []\n")
        status, out, err = self.capture_main(["--repo", str(repo)])
        self.assertEqual(status, 0, err)
        self.assertIn(str(corpus.resolve()), out)
        self.assertIn("SHA-256", out)
        self.assertIn("500", out)
        self.assertFalse(marker.exists(), "preview must not import the adapter")

    def test_resolved_dataset_path_cannot_escape_selected_repository(self) -> None:
        repo, _corpus, _marker = self.make_repo()
        outside = Path(self.temp.name) / "outside-corpus.txt"
        original_resolve = Path.resolve

        def resolve_corpus_outside(path: Path, *args, **kwargs) -> Path:
            if path.name == "corpus.en":
                return outside
            return original_resolve(path, *args, **kwargs)

        # Windows symlink creation may require privileges; simulate the resolved
        # target at pathlib's filesystem boundary instead.
        with patch.object(Path, "resolve", resolve_corpus_outside):
            with self.assertRaisesRegex(ValueError, "outside"):
                self.benchmark.inspect_dataset(repo)
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                status = self.benchmark.main(["--repo", str(repo)])
        self.assertNotEqual(status, 0)
        self.assertIn("outside", stderr.getvalue())

    def test_missing_dataset_fails_before_benchmark(self) -> None:
        repo = Path(self.temp.name) / "empty-repo"
        repo.mkdir()
        status, _out, err = self.capture_main(["--repo", str(repo)])
        self.assertNotEqual(status, 0)
        self.assertIn("corpus.en", err)

    def test_non_y_confirmation_skips_adapter_import(self) -> None:
        repo, _corpus, marker = self.make_repo("    return {}, []\n")
        status, out, _err = self.capture_main(
            ["--repo", str(repo), "--run"], input_fn=lambda _prompt: "no"
        )
        self.assertEqual(status, 0)
        self.assertIn("cancel", out.lower())
        self.assertFalse(marker.exists(), "declining must happen before adapter import")

    def test_dataset_changed_after_preview_is_not_benchmarked(self) -> None:
        repo, corpus, marker = self.make_repo("    return {}, []\n")

        def change_dataset_before_confirmation(_prompt: str) -> str:
            corpus.write_text("changed after preview", encoding="utf-8")
            return "y"

        status, _out, err = self.capture_main(
            ["--repo", str(repo), "--run"], input_fn=change_dataset_before_confirmation
        )
        self.assertNotEqual(status, 0)
        self.assertIn("changed since preview", err)
        self.assertFalse(marker.exists(), "changed preview data must stop before adapter import")

    def test_selected_repository_is_on_import_path_during_runner_calls(self) -> None:
        repo, _corpus, _marker = self.make_repo(
            "    from cs336_basics.bpe import marker\n"
            "    marker()\n"
            "    return {}, []\n"
        )
        package = repo / "cs336_basics"
        package.mkdir()
        (package / "__init__.py").write_text("", encoding="utf-8")
        (package / "bpe.py").write_text("def marker():\n    return None\n", encoding="utf-8")
        status, _out, err = self.capture_main(
            ["--repo", str(repo), "--run"], input_fn=lambda _prompt: "y"
        )
        self.assertEqual(status, 0, err)

    def test_three_rounds_use_exact_configs_and_alternate_order(self) -> None:
        repo, corpus, _marker = self.make_repo("    return {}, []\n")
        status, _out, err = self.capture_main(
            ["--repo", str(repo), "--run"], input_fn=lambda _prompt: "y"
        )
        self.assertEqual(status, 0, err)
        calls = [json.loads(line) for line in (Path(self.temp.name) / "adapter-calls.jsonl").read_text(encoding="utf-8").splitlines()]
        ordinary = {"input_path": str(corpus.resolve()), "vocab_size": 500, "special_tokens": []}
        special = {"input_path": str(corpus.resolve()), "vocab_size": 500, "special_tokens": ["<|endoftext|>"]}
        self.assertEqual(calls, [ordinary, special, special, ordinary, ordinary, special])

    def test_report_uses_medians_difference_and_official_limit(self) -> None:
        repo, _corpus, _marker = self.make_repo("    return {}, []\n")
        ticks = iter([0, 1, 10, 12, 20, 23, 30, 34, 40, 45, 50, 56])
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = self.benchmark.run_comparison(
                repo, input_fn=lambda _prompt: "y", clock=lambda: next(ticks)
            )
        report = stdout.getvalue()
        self.assertEqual(status, 0)
        self.assertIn("ordinary median: 4.00", report)
        self.assertIn("special-token median: 3.00", report)
        self.assertIn("special minus ordinary: -1.00", report)
        self.assertIn("-25.0%", report)
        self.assertIn("1.5 seconds", report)

    def test_benchmark_does_not_write_bytecode_into_selected_repo(self) -> None:
        repo, _corpus, _marker = self.make_repo("    return {}, []\n")
        original_bytecode_setting = sys.dont_write_bytecode
        with contextlib.redirect_stdout(io.StringIO()):
            status = self.benchmark.run_comparison(
                repo, input_fn=lambda _prompt: "y", clock=lambda: 1.0
            )
        self.assertEqual(status, 0)
        self.assertEqual(list(repo.rglob("*.pyc")), [])
        self.assertEqual(sys.dont_write_bytecode, original_bytecode_setting)

    def test_zero_ordinary_median_avoids_division_by_zero(self) -> None:
        repo, _corpus, _marker = self.make_repo("    return {}, []\n")
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = self.benchmark.run_comparison(
                repo, input_fn=lambda _prompt: "y", clock=lambda: 0.0
            )
        self.assertEqual(status, 0)
        self.assertIn("n/a (ordinary median is zero)", stdout.getvalue())

    def test_missing_adapter_is_reported(self) -> None:
        repo, _corpus, _marker = self.make_repo()
        status, _out, err = self.capture_main(
            ["--repo", str(repo), "--run"], input_fn=lambda _prompt: "y"
        )
        self.assertNotEqual(status, 0)
        self.assertIn("adapter", err.lower())

    def test_adapter_module_import_exception_is_reported(self) -> None:
        repo, _corpus, _marker = self.make_repo("raise ImportError('deliberate import failure')\n")
        status, _out, err = self.capture_main(
            ["--repo", str(repo), "--run"], input_fn=lambda _prompt: "y"
        )
        self.assertNotEqual(status, 0)
        self.assertIn("deliberate import failure", err)

    def test_hash_change_is_detected_when_runner_raises(self) -> None:
        corpus_path = Path(self.temp.name) / "repo" / "tests" / "fixtures" / "corpus.en"
        repo, _corpus, _marker = self.make_repo(
            f"    Path({str(corpus_path)!r}).write_text('changed', encoding='utf-8')\n"
            "    raise RuntimeError('runner failed after mutation')\n"
        )
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = self.benchmark.run_comparison(
                repo, input_fn=lambda _prompt: "y", clock=lambda: 0.0
            )
        self.assertNotEqual(status, 0)
        self.assertIn("invalid", stdout.getvalue().lower())
        self.assertIn("runner failed after mutation", stderr.getvalue())

    def test_changed_corpus_hash_marks_results_invalid(self) -> None:
        repo, corpus, _marker = self.make_repo(
            f"    Path({str(corpus_path := Path(self.temp.name) / 'repo' / 'tests' / 'fixtures' / 'corpus.en')!r}).write_text('changed', encoding='utf-8')\n"
            "    return {}, []\n"
        )
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = self.benchmark.run_comparison(
                repo, input_fn=lambda _prompt: "y", clock=lambda: 0.0
            )
        self.assertNotEqual(status, 0)
        self.assertIn("invalid", stdout.getvalue().lower())
        self.assertNotEqual(corpus.read_text(encoding="utf-8"), "sample corpus\n")


if __name__ == "__main__":
    unittest.main()
