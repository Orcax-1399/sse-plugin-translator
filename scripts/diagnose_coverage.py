#!/usr/bin/env python3
"""
Offline diagnostics for coverage extraction stalls.

This script is read-only: it only performs SELECT queries on coverage.db.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Diagnose coverage extraction progress from coverage.db."
    )
    parser.add_argument(
        "--coverage-db",
        required=True,
        help="Absolute path to coverage.db",
    )
    parser.add_argument(
        "--loadorder",
        default="",
        help="Absolute path to loadorder.txt (optional). If omitted, try auto-detection.",
    )
    parser.add_argument(
        "--data-dir",
        default="",
        help="Absolute path to Skyrim Data directory (optional, for suspect plugin file checks).",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=15,
        help="How many tail positions to show in top_mod_counts (default: 15).",
    )
    parser.add_argument(
        "--max-gap-output",
        type=int,
        default=200,
        help="Maximum number of missing positions printed in missing_pos_list (default: 200).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print JSON only.",
    )
    return parser.parse_args()


def detect_default_loadorder_path() -> Path | None:
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    if not local_appdata:
        return None

    candidates = [
        Path(local_appdata) / "Skyrim Special Edition" / "loadorder.txt",
        Path(local_appdata) / "Skyrim VR" / "loadorder.txt",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def parse_loadorder(path: Path) -> list[str]:
    # utf-8-sig handles BOM; ignore decode errors to avoid hard failure.
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = [line.strip() for line in text.splitlines()]
    return [line for line in lines if line and not line.startswith("#")]


def read_snapshot_map(conn: sqlite3.Connection) -> dict[int, str]:
    rows = conn.execute(
        "SELECT position, plugin_name FROM coverage_load_order ORDER BY position ASC"
    ).fetchall()
    return {int(pos): str(name) for pos, name in rows}


def resolve_mod_name(
    pos: int,
    loadorder: list[str],
    snapshot_map: dict[int, str],
) -> str | None:
    if 0 <= pos < len(loadorder):
        return loadorder[pos]
    return snapshot_map.get(pos)


def build_data_dir_index(data_dir: Path) -> dict[str, Path]:
    index: dict[str, Path] = {}
    if not data_dir.exists() or not data_dir.is_dir():
        return index
    for child in data_dir.iterdir():
        if child.is_file():
            index[child.name.lower()] = child
    return index


def plugin_file_info(plugin_name: str | None, data_dir: Path | None) -> dict[str, Any] | None:
    if not plugin_name or data_dir is None:
        return None

    index = build_data_dir_index(data_dir)
    target = index.get(plugin_name.lower())
    if target is None:
        return {
            "plugin": plugin_name,
            "exists": False,
            "path": str(data_dir / plugin_name),
            "size_bytes": None,
        }

    size_bytes = None
    try:
        size_bytes = target.stat().st_size
    except OSError:
        size_bytes = None

    return {
        "plugin": plugin_name,
        "exists": True,
        "path": str(target),
        "size_bytes": size_bytes,
    }


def fetch_scalar(conn: sqlite3.Connection, sql: str) -> Any:
    return conn.execute(sql).fetchone()[0]


def collect_report(
    db_path: Path,
    loadorder_path: Path | None,
    data_dir: Path | None,
    top_n: int,
    max_gap_output: int,
) -> dict[str, Any]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        entries_total = int(fetch_scalar(conn, "SELECT COUNT(*) FROM coverage_entries") or 0)
        snapshot_count = int(fetch_scalar(conn, "SELECT COUNT(*) FROM coverage_load_order") or 0)
        snapshot_max_pos = fetch_scalar(conn, "SELECT MAX(position) FROM coverage_load_order")
        snapshot_last_ts = fetch_scalar(conn, "SELECT MAX(extracted_at) FROM coverage_load_order")
        max_committed_pos = fetch_scalar(conn, "SELECT MAX(load_order_pos) FROM coverage_entries")
        diag_last_raw = conn.execute(
            "SELECT value FROM coverage_meta WHERE key = 'coverage_diag_last'"
        ).fetchone()
        diag_last_raw_value = diag_last_raw[0] if diag_last_raw else None
        diag_last = None
        if diag_last_raw_value:
            try:
                diag_last = json.loads(diag_last_raw_value)
            except json.JSONDecodeError:
                diag_last = {"raw": diag_last_raw_value}

        loadorder: list[str] = []
        loadorder_source = None
        if loadorder_path is not None and loadorder_path.exists():
            loadorder = parse_loadorder(loadorder_path)
            loadorder_source = str(loadorder_path)

        snapshot_map = read_snapshot_map(conn)

        pos_counts_rows = conn.execute(
            "SELECT load_order_pos, COUNT(*) AS c FROM coverage_entries "
            "GROUP BY load_order_pos ORDER BY load_order_pos ASC"
        ).fetchall()
        pos_counts = {int(row["load_order_pos"]): int(row["c"]) for row in pos_counts_rows}

        tail_positions = sorted(pos_counts.keys(), reverse=True)[: max(top_n, 1)]
        top_mod_counts = [
            {
                "position": pos,
                "mod": resolve_mod_name(pos, loadorder, snapshot_map),
                "records": pos_counts[pos],
            }
            for pos in tail_positions
        ]

        missing_positions: list[int] = []
        if max_committed_pos is not None:
            max_pos_int = int(max_committed_pos)
            for pos in range(0, max_pos_int + 1):
                if pos not in pos_counts:
                    missing_positions.append(pos)

        if max_committed_pos is None:
            first_suspect_pos = 0 if loadorder or snapshot_map else None
        else:
            first_suspect_pos = int(max_committed_pos) + 1

        last_success_mod = None
        if max_committed_pos is not None:
            last_success_mod = resolve_mod_name(int(max_committed_pos), loadorder, snapshot_map)

        first_suspect_mod = None
        if first_suspect_pos is not None:
            first_suspect_mod = resolve_mod_name(first_suspect_pos, loadorder, snapshot_map)

        snapshot_mismatch = bool(entries_total > 0 and snapshot_count == 0)

        suspect_file_check = plugin_file_info(first_suspect_mod, data_dir)

        return {
            "coverage_db": str(db_path),
            "db_exists": db_path.exists(),
            "db_size_bytes": db_path.stat().st_size if db_path.exists() else None,
            "loadorder_source": loadorder_source,
            "loadorder_count": len(loadorder),
            "entries_total": entries_total,
            "snapshot_count": snapshot_count,
            "snapshot_max_pos": snapshot_max_pos,
            "snapshot_last_ts": snapshot_last_ts,
            "max_committed_pos": max_committed_pos,
            "last_success_mod": last_success_mod,
            "first_suspect_pos": first_suspect_pos,
            "first_suspect_mod": first_suspect_mod,
            "missing_pos_count": len(missing_positions),
            "missing_pos_list": missing_positions[: max(max_gap_output, 0)],
            "top_mod_counts": top_mod_counts,
            "snapshot_mismatch": snapshot_mismatch,
            "suspect_file_check": suspect_file_check,
            "diag_last": diag_last,
        }
    finally:
        conn.close()


def main() -> int:
    args = parse_args()

    db_path = Path(args.coverage_db).expanduser().resolve()
    if not db_path.exists():
        print(f"ERROR: coverage db not found: {db_path}")
        return 2

    loadorder_path: Path | None = None
    if args.loadorder:
        candidate = Path(args.loadorder).expanduser().resolve()
        if candidate.exists():
            loadorder_path = candidate
    else:
        loadorder_path = detect_default_loadorder_path()

    data_dir: Path | None = None
    if args.data_dir:
        data_dir = Path(args.data_dir).expanduser().resolve()
        if not data_dir.exists() or not data_dir.is_dir():
            data_dir = None

    try:
        report = collect_report(
            db_path=db_path,
            loadorder_path=loadorder_path,
            data_dir=data_dir,
            top_n=args.top_n,
            max_gap_output=args.max_gap_output,
        )
    except sqlite3.Error as exc:
        print(f"ERROR: sqlite query failed: {exc}")
        return 3

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    ordered_keys = [
        "coverage_db",
        "db_exists",
        "db_size_bytes",
        "loadorder_source",
        "loadorder_count",
        "entries_total",
        "snapshot_count",
        "snapshot_max_pos",
        "snapshot_last_ts",
        "max_committed_pos",
        "last_success_mod",
        "first_suspect_pos",
        "first_suspect_mod",
        "missing_pos_count",
        "missing_pos_list",
        "snapshot_mismatch",
        "suspect_file_check",
        "diag_last",
    ]

    for key in ordered_keys:
        print(f"{key}: {report.get(key)}")

    print("top_mod_counts:")
    for item in report["top_mod_counts"]:
        print(f"  - pos={item['position']}, mod={item['mod']}, records={item['records']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
