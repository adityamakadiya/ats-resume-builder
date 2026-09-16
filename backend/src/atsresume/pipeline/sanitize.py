"""Typographic cleanup applied to everything the model writes.

Two reasons this is enforced in code rather than asked for in the prompt.

The em dash is the single most recognisable tell that a document was drafted by
a language model. A recruiter who spots one in a bullet has a reason to discount
the rest, and that is a terrible trade for a punctuation mark. Models reach for
them constantly and an instruction alone does not reliably stop it.

The rest is an ATS-parsing concern. Smart quotes, ellipsis characters,
non-breaking spaces and zero-width joiners are non-ASCII, and keyword matching
against them is inconsistent across parsers: a resume reading "don't" with a
curly apostrophe can fail a literal match for "don't".

Runs before the truth guard, so the guard verifies the text that will actually
be rendered rather than a draft of it.
"""

from __future__ import annotations

import re

from ..models import TailoredResume

# Spaced dash separating clauses. A comma is the standard de-dash and keeps the
# sentence readable without inventing a different structure.
_SPACED_DASH = re.compile(r"\s*[–—]\s+")
# Unspaced dash is nearly always standing in for a hyphen or a range.
_TIGHT_DASH = re.compile(r"[–—]")

_REPLACEMENTS = {
    "‘": "'",
    "’": "'",
    "‚": "'",
    "“": '"',
    "”": '"',
    "„": '"',
    "…": "...",
    " ": " ",
    " ": " ",
    " ": " ",
    "​": "",
    "‌": "",
    "‍": "",
    "﻿": "",
    "−": "-",
    "­": "",
    "•": "-",
    "●": "-",
    "→": "->",
    "✓": "",
    "·": ",",
}

_TIDY = [
    (re.compile(r"\s*,\s*,+"), ", "),
    (re.compile(r",\s*([.;:!?])"), r"\1"),
    (re.compile(r"\s+([.,;:!?])"), r"\1"),
    (re.compile(r"[ \t]{2,}"), " "),
]


def clean_text(value: str, *, separator: str = ", ") -> str:
    """ASCII-safe, dash-free text.

    ``separator`` is what a spaced dash becomes. A headline reads better with a
    pipe, which is ordinary resume convention; prose wants a comma.
    """
    if not value:
        return value

    text = value
    for bad, good in _REPLACEMENTS.items():
        text = text.replace(bad, good)

    text = _SPACED_DASH.sub(separator, text)
    text = _TIGHT_DASH.sub("-", text)

    for pattern, repl in _TIDY:
        text = pattern.sub(repl, text)

    return text.strip()


def _clean_bullets(bullets: list) -> None:
    for bullet in bullets:
        bullet.text = clean_text(bullet.text)


def sanitize(tailored: TailoredResume) -> TailoredResume:
    """Clean every field the model authored. Ids and dates are left alone."""
    tailored.headline = clean_text(tailored.headline, separator=" | ")
    tailored.summary.text = clean_text(tailored.summary.text)

    for group in tailored.skills:
        group.category = clean_text(group.category)
        group.items = [clean_text(item) for item in group.items if item.strip()]

    for exp in tailored.experience:
        exp.company = clean_text(exp.company)
        exp.title = clean_text(exp.title)
        exp.location = clean_text(exp.location)
        _clean_bullets(exp.bullets)

    for proj in tailored.projects:
        proj.name = clean_text(proj.name)
        _clean_bullets(proj.bullets)

    for edu in tailored.education:
        edu.institution = clean_text(edu.institution)
        edu.degree = clean_text(edu.degree)

    for cert in tailored.certifications:
        cert.text = clean_text(cert.text)

    for section in tailored.other_sections:
        section.heading = clean_text(section.heading)
        _clean_bullets(section.bullets)

    tailored.rewrite_notes = [clean_text(note) for note in tailored.rewrite_notes]
    return tailored


def contains_tells(tailored: TailoredResume) -> list[str]:
    """Any text still carrying a dash or a non-ASCII character. Used by tests."""
    offenders: list[str] = []
    fields = [tailored.headline, tailored.summary.text]
    for group in tailored.skills:
        fields.append(group.category)
        fields.extend(group.items)
    for exp in tailored.experience:
        fields.extend([exp.company, exp.title])
        fields.extend(b.text for b in exp.bullets)
    for proj in tailored.projects:
        fields.append(proj.name)
        fields.extend(b.text for b in proj.bullets)
    for cert in tailored.certifications:
        fields.append(cert.text)
    for section in tailored.other_sections:
        fields.append(section.heading)
        fields.extend(b.text for b in section.bullets)

    for text in fields:
        if any(ord(ch) > 127 for ch in text):
            offenders.append(text)
    return offenders
