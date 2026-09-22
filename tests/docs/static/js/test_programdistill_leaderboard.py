import re
from pathlib import Path


def test_shared_leaderboard_columns_put_harness_after_model():
    script = (
        Path(__file__).resolve().parents[4]
        / "docs/static/js/programdistill-leaderboard.js"
    ).read_text()
    columns = re.search(r"const columns\s*=\s*\[(.*?)\n\s*\];", script, re.S)

    assert columns is not None
    keys = [
        key.strip().strip("'\"")
        for key in re.findall(r"\[\s*([^,]+),", columns.group(1))
    ]
    assert keys[:3] == ["label", "harness", "primary"]
