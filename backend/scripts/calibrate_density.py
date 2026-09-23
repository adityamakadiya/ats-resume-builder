"""Measures how much text each rung of the density ladder actually holds.

The fit loop picks a rung from a single measurement, which only works if the
capacity figures in ``render/density.py`` are real. Guessing them means the
loop picks wrong and pays for extra renders, or overshoots and sets a resume
in 9pt that would have fitted at 10.

So they are measured. This renders the same sample at every rung, records the
text extent, and prints the ladder with capacities relative to rung 0. Paste
the output into LADDER. Re-run it after a rendercv upgrade, because a change
to a theme's internal spacing moves these numbers.

    python scripts/calibrate_density.py
"""

from __future__ import annotations

import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sample import facts, tailored  # noqa: E402

from atsresume.config import get_settings  # noqa: E402
from atsresume.render.density import LADDER  # noqa: E402
from atsresume.render.rendercv_adapter import (  # noqa: E402
    _render_once,
    build_cv_dict,
    measure,
)

# Calibrating against one theme would bake that theme's own spacing into the
# ladder. These three bracket the range: the densest default, the roomiest, and
# the one with ruled headings that cost vertical space.
THEMES = ("engineeringresumes", "opal", "engineeringclassic")


def main() -> int:
    cv = build_cv_dict(tailored(), facts())
    timeout = get_settings().render_timeout_s
    render_settings = {
        "render_command": {"dont_generate_png": True, "dont_generate_markdown": True}
    }

    print(f"Rendering {len(LADDER)} rungs x {len(THEMES)} themes\n")
    extents: list[float] = []

    for index, rung in enumerate(LADDER):
        per_theme: list[float] = []
        for theme in THEMES:
            pdf = _render_once(
                {"cv": cv, "design": rung.design(theme), "settings": render_settings},
                timeout,
            )
            pages, extent = measure(pdf)
            # Extent is in units of that rung's own usable page height, so the
            # reciprocal is how many sample-resumes fit on one page: the thing
            # the ladder needs to know.
            per_theme.append(1 / extent if extent else 0.0)
            print(f"  rung {index} {theme:20s} {pages} pages, extent {extent:.3f}")
        extents.append(sum(per_theme) / len(per_theme))

    base = extents[0]
    print("\nPaste into LADDER (last column):\n")
    for rung, value in zip(LADDER, extents, strict=True):
        capacity = value / base
        print(
            f"    Rung({rung.margin_in}, {rung.body_pt}, {rung.line_spacing_em}, "
            f"{rung.space_above_title_cm}, {rung.space_below_title_cm}, "
            f"{rung.space_between_entries_cm}, {rung.space_between_text_entries_cm}, "
            f"{rung.space_below_name_cm}, {rung.space_below_headline_cm}, "
            f"{rung.space_below_connections_cm}, {capacity:.3f}),"
            f"{'   # currently ' + format(rung.capacity, '.3f') if abs(capacity - rung.capacity) > 0.02 else ''}"
        )

    if any(b <= a for a, b in itertools.pairwise(extents)):
        print("\nWARNING: a rung holds no more than the one above it. The ladder is not monotonic.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
