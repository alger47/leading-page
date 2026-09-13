#!/usr/bin/env python3
"""
Export all project source code files into a single text file.
Useful for documentation, analysis, or providing to AI assistants.

Tailored for the "LEADING PAGE" monorepo (pnpm + turbo + Next.js web app
and FastAPI AI engine):
  - Tuned extension set (TypeScript/React, Python, Prisma, configs, docs).
  - Skips node_modules, build outputs (.next, dist, out), Python venv and
    caches, Turbo cache, npm/pnpm lockfiles, generated codegen dirs, and
    secret-bearing .env files (only *.env.example is exported).

Usage:
    python export_codes.py <path_to_project> [output_path]

Output: <project_name>_codes.txt in the same directory as the project.
"""

import os
import sys
from pathlib import Path

SUPPORTED_EXTENSIONS = {
    ".py": "Python",
    ".pyi": "Python (Stub)",
    ".js": "JavaScript",
    ".jsx": "JavaScript (React)",
    ".ts": "TypeScript",
    ".tsx": "TypeScript (React)",
    ".mjs": "JavaScript (ESM)",
    ".cjs": "JavaScript (CommonJS)",
    ".json": "JSON",
    ".md": "Markdown",
    ".rst": "reStructuredText",
    ".txt": "Text",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".sql": "SQL",
    ".prisma": "Prisma Schema",
    ".css": "CSS",
    ".sh": "Shell",
    ".bat": "Batch",
    ".ps1": "PowerShell",
    ".xml": "XML",
    ".xslt": "XSLT",
    ".example": "Environment Example",
    "Dockerfile": "Dockerfile",
    "Makefile": "Makefile",
    ".gitignore": "Git Ignore",
    ".gitattributes": "Git Attributes",
    ".sass": "SASS",
    ".scss": "SCSS",
    ".less": "Less",
    ".graphql": "GraphQL",
    ".gql": "GraphQL",
    ".svg": "SVG",
    ".htaccess": "Apache Config",
    ".editorconfig": "EditorConfig",
}

# Directories pruned by exact segment name.
EXCLUDE_DIRS = {
    ".git", ".next", ".nuxt", ".turbo", ".cache", ".dart_tool",
    "node_modules", ".venv", "venv", ".tox", ".nox",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "dist", "build", "out", "coverage", ".nyc_output",
    ".idea", ".vscode", ".vs",
    "zod", "pydantic", "types",  # codegen outputs (page-schema)
}

# Directories pruned by name suffix (e.g. foo.egg-info/).
EXCLUDE_DIR_SUFFIXES = (".egg-info", ".dist-info")

# Directories pruned by name prefix.
EXCLUDE_DIR_PREFIXES = ("vendor-",)

# Binary / derived / lock file extensions always skipped.
EXCLUDE_EXTENSIONS = {
    ".pyc", ".pyo", ".so", ".pyd", ".dylib", ".dll", ".exe", ".bin",
    ".o", ".obj", ".class", ".jar", ".war", ".zip", ".tar", ".gz",
    ".rar", ".7z", ".png", ".jpg", ".jpeg", ".gif", ".ico",
    ".webp", ".bmp", ".tiff", ".woff", ".woff2", ".ttf", ".eot",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".mp4", ".mp3", ".avi", ".mov", ".mkv", ".wav", ".flac", ".ogg",
    ".pem", ".key", ".crt", ".lock",
    ".tsbuildinfo",
}

# Single files always skipped (basename match, case-insensitive).
EXCLUDE_FILES = {
    "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
    ".DS_Store", "Thumbs.db", ".gitkeep", ".python-version",
    "turbo.json", "tsconfig.tsbuildinfo",
}


def should_include(file_path, root):
    rel_path = os.path.relpath(file_path, root)
    parts = rel_path.replace("\\", "/").split("/")

    for part in parts:
        if part in EXCLUDE_DIRS:
            return False
        lower = part.lower()
        if lower.endswith(EXCLUDE_DIR_SUFFIXES):
            return False
        if lower.startswith(EXCLUDE_DIR_PREFIXES):
            return False

    _, ext = os.path.splitext(file_path)
    if ext.lower() in EXCLUDE_EXTENSIONS:
        return False

    basename = os.path.basename(file_path)
    basename_lower = basename.lower()
    if basename in EXCLUDE_FILES or basename_lower in EXCLUDE_FILES:
        return False

    # Env safety: skip .env / .env.local / .env.<env>; keep only *.env.example.
    if basename.startswith(".env") and not basename.endswith(".env.example"):
        return False

    if ext.lower() in SUPPORTED_EXTENSIONS:
        return True

    if basename in SUPPORTED_EXTENSIONS or basename_lower in SUPPORTED_EXTENSIONS:
        return True

    return False


def get_language(file_path):
    _, ext = os.path.splitext(file_path)
    lang = SUPPORTED_EXTENSIONS.get(ext.lower())
    if lang:
        return lang
    basename = os.path.basename(file_path)
    return SUPPORTED_EXTENSIONS.get(basename, SUPPORTED_EXTENSIONS.get(basename.lower(), "Unknown"))


def should_exclude_dir(name):
    """Prune a directory during os.walk (name-level)."""
    if name in EXCLUDE_DIRS:
        return True
    lower = name.lower()
    if lower.endswith(EXCLUDE_DIR_SUFFIXES):
        return True
    if lower.startswith(EXCLUDE_DIR_PREFIXES):
        return True
    return False


def export_codes(project_path, output_path=None):
    root = os.path.abspath(project_path)
    if not os.path.isdir(root):
        print(f"[ERROR] Path does not exist or is not a directory: {root}")
        sys.exit(1)

    if output_path is None:
        project_name = os.path.basename(root)
        output_path = os.path.join(os.path.dirname(root), f"{project_name}_codes.txt")

    print(f"[*] Scanning project: {root}")
    print(f"[*] Output: {output_path}")
    print()

    all_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not should_exclude_dir(d)]
        for filename in filenames:
            file_path = os.path.join(dirpath, filename)
            if should_include(file_path, root):
                all_files.append(file_path)

    all_files.sort(key=lambda f: (os.path.splitext(f)[1].lower(), f))
    total_files = len(all_files)

    if total_files == 0:
        print("[WARNING] No supported files found.")
        return output_path

    print(f"[*] Found {total_files} files to export")
    print()

    lang_stats = {}
    for f in all_files:
        lang = get_language(f)
        lang_stats[lang] = lang_stats.get(lang, 0) + 1

    print("[*] Language statistics:")
    max_count = max(lang_stats.values()) if lang_stats else 1
    for lang, count in sorted(lang_stats.items(), key=lambda x: -x[1]):
        bar_len = count * 30 // max_count
        bar = "#" * bar_len
        print(f"  {lang:25s} : {count:3d}  {bar}")
    print()

    written = 0
    skipped = 0
    written_bytes = 0

    with open(output_path, "w", encoding="utf-8", errors="replace") as out:
        out.write("=" * 80 + "\n")
        out.write(f" PROJECT CODE EXPORT\n")
        out.write(f" Source: {root}\n")
        out.write(f" Date: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        out.write(f" Total files: {total_files}\n")
        out.write("=" * 80 + "\n\n")

        for i, file_path in enumerate(all_files, 1):
            rel_path = os.path.relpath(file_path, root)
            lang = get_language(file_path)

            out.write("-" * 80 + "\n")
            out.write(f" [{i}/{total_files}] {rel_path}\n")
            out.write(f" Language: {lang}\n")
            out.write("-" * 80 + "\n\n")

            try:
                with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()

                if "\0" in content:
                    skipped += 1
                    out.write("[BINARY FILE - SKIPPED]\n\n")
                    continue

                out.write(content)
                written += 1
                written_bytes += len(content.encode("utf-8"))
                if not content.endswith("\n"):
                    out.write("\n")
                out.write("\n")

            except Exception as e:
                out.write(f"[ERROR: {e}]\n\n")
                skipped += 1

            if i % 10 == 0 or i == total_files:
                pct = i * 100 // total_files
                print(f"  [Progress] {i}/{total_files} ({pct}%)", end="\r")

    print()
    print()
    print("=" * 60)
    print(f" [DONE] Export completed successfully!")
    print(f" [OK] Files included: {written}")
    print(f" [SKIP] Files skipped: {skipped}")
    print(f" [SIZE] Output size: {written_bytes / 1024:.1f} KB")
    print(f" [PATH] {output_path}")
    print("=" * 60)

    return output_path


if __name__ == "__main__":
    project_path = sys.argv[1] if len(sys.argv) > 1 else r"F:\PRATIQUE\LEADING PAGE"
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    export_codes(project_path, output_path)