#!/usr/bin/env python3
"""M066 controlled smoke formatter: fixes the intentional README double-space and emits a bounded diff."""
from pathlib import Path
import subprocess

path = Path("README.md")
text = path.read_text()
formatted = text.replace("Kodiai  is", "Kodiai is", 1)
if formatted != text:
    path.write_text(formatted)
subprocess.run(["git", "diff", "--", "README.md"], check=False)
