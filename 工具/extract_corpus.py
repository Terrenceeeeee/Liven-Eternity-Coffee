# -*- coding: utf-8 -*-
"""从工作区内的 docx 提取 Liven 相关文本语料。"""
import csv
import os
import re
from pathlib import Path

from docx import Document

WORKSPACE = Path(r"E:\我也是创作上了")
OUT = Path(r"E:\我也是创作上了\虚拟Liven\knowledge\corpus")
OUT.mkdir(parents=True, exist_ok=True)

TARGET_DIRS = [
    "短篇故事集",
    "A LONG DREAM",
    "Fantasizing",
    "关于知晓过去的少年",
    "悲剧与银河之声",
]


def safe_name(text: str) -> str:
    text = re.sub(r"[\\/:*?\"<>|]", "_", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120]


def extract(path: Path) -> str:
    doc = Document(str(path))
    parts = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if t:
            parts.append(t)
    # 表格里偶尔也有正文
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n\n".join(parts)


rows = []
for rel in TARGET_DIRS:
    base = WORKSPACE / rel
    if not base.exists():
        continue
    for path in sorted(base.rglob("*.docx")):
        if path.name.startswith("~$"):
            continue
        try:
            text = extract(path)
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {path}: {exc}")
            continue
        if not text.strip():
            print(f"EMPTY {path}")
            continue
        rel_name = path.relative_to(WORKSPACE).as_posix()
        out_path = OUT / (safe_name(rel_name.replace("/", "__").rsplit(".", 1)[0]) + ".txt")
        header = f"<!-- 源文件: {rel_name} -->\n\n"
        out_path.write_text(header + text, encoding="utf-8")
        rows.append(
            {
                "source": rel_name,
                "chars": len(re.sub(r"\s", "", text)),
                "mtime": path.stat().st_mtime,
                "out": out_path.name,
            }
        )
        print(f"OK {len(text):>7} {rel_name}")

with (OUT / "_manifest.csv").open("w", encoding="utf-8-sig", newline="") as fh:
    writer = csv.DictWriter(fh, fieldnames=["source", "chars", "mtime", "out"])
    writer.writeheader()
    writer.writerows(rows)

print(f"\n共 {len(rows)} 篇，总字数 {sum(r['chars'] for r in rows):,}")
