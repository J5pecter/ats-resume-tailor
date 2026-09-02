"""The command line.

    pytailor --resume cv.pdf --jd posting.txt --out ./build

Writes resume.docx, resume.pdf and report.json. The report is not decoration:
it is where the tool tells you what it refused to write and why, and reading it
is the difference between a resume you can defend and one you cannot.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import pipeline
from .llm import LlmConfigError, LlmError


def read_document(path: Path) -> str:
    """Plain text, PDF or DOCX. Plain text needs no dependency at all."""
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            raise SystemExit(
                "Reading a PDF needs pypdf. Install it with:  pip install pypdf\n"
                "Or export your resume as .txt and pass that instead."
            ) from None
        return "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages)

    if suffix == ".docx":
        try:
            from docx import Document
        except ImportError:
            raise SystemExit("Reading a .docx needs python-docx:  pip install python-docx") from None
        return "\n".join(p.text for p in Document(str(path)).paragraphs)

    return path.read_text(encoding="utf-8", errors="replace")


def _summarise(outcome: pipeline.TailorOutcome) -> dict:
    retention = outcome.retention
    return {
        "role": outcome.jd_profile.get("roleTitle", ""),
        "atsScoreBefore": outcome.analysis.get("atsScore"),
        "projectedScore": outcome.projected_score,
        "honestGaps": [m.get("term", "") for m in outcome.analysis.get("missing") or []],
        "evidence": {
            "checked": outcome.evidence.checked,
            "rejected": len(outcome.evidence.failures),
            "failures": [
                {
                    "reason": f.reason,
                    "where": f.where,
                    "claim": f.text,
                    "cited": f.source_evidence,
                    "overlap": round(f.overlap, 2),
                }
                for f in outcome.evidence.failures
            ],
        },
        "gapKeywordsRemoved": [
            {"kind": r.kind, "where": r.where, "text": r.text, "term": r.term}
            for r in outcome.forbidden_removed
        ],
        "gapKeywordsSurviving": outcome.forbidden_hits,
        "retention": None
        if retention is None
        else {
            "headline": retention.headline(),
            "substantialLoss": retention.substantial_loss,
            "dropped": [{"kind": d.kind, "where": d.where, "text": d.text} for d in retention.dropped],
            "lostFromSource": [
                {"kind": d.kind, "where": d.where, "text": d.text} for d in retention.lost_from_source
            ],
        },
        "changeLog": outcome.change_log,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="pytailor",
        description="Tailor a resume to a job posting without inventing anything.",
    )
    parser.add_argument("--resume", required=True, type=Path, help=".pdf, .docx or .txt")
    parser.add_argument("--jd", required=True, type=Path, help="the job posting, as a text file")
    parser.add_argument("--out", type=Path, default=Path("build"), help="output directory")
    parser.add_argument("--quiet", action="store_true", help="only print the summary")
    args = parser.parse_args(argv)

    for path in (args.resume, args.jd):
        if not path.exists():
            print(f"No such file: {path}", file=sys.stderr)
            return 2

    def say(message: str) -> None:
        if not args.quiet:
            print(f"  {message}", flush=True)

    raw_resume = read_document(args.resume)
    raw_jd = read_document(args.jd)

    if len(raw_resume.strip()) < 120:
        print(
            f"That resume came out as {len(raw_resume.strip())} characters, which is too little to "
            "work with. If it is a PDF of a scan, the text layer is missing — export it as .txt.",
            file=sys.stderr,
        )
        return 2

    try:
        outcome = pipeline.run(raw_resume, raw_jd, say=say)
    except LlmConfigError as err:
        print(f"\n{err}", file=sys.stderr)
        return 3
    except LlmError as err:
        print(f"\nThe model call failed: {err}", file=sys.stderr)
        return 4

    args.out.mkdir(parents=True, exist_ok=True)
    report = _summarise(outcome)
    (args.out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (args.out / "resume.json").write_text(json.dumps(outcome.resume, indent=2), encoding="utf-8")

    from .exports import write_docx, write_pdf

    write_docx(outcome.resume, args.out / "resume.docx")
    write_pdf(outcome.resume, args.out / "resume.pdf")

    print()
    print(f"  role            : {report['role']}")
    print(f"  score before    : {report['atsScoreBefore']}")
    print(f"  projected after : {report['projectedScore']}")
    ev = report["evidence"]
    print(f"  evidence        : {ev['rejected']} rejected of {ev['checked']} checked")
    for failure in ev["failures"][:5]:
        print(f"      {failure['reason']:<11} {failure['where']}")
        print(f"        claim  {failure['claim'][:78]}")
        print(f"        cited  {failure['cited'][:78]}  (overlap {failure['overlap']})")
    if report["retention"]:
        print(f"  retention       : {report['retention']['headline']}")
        for dropped in report["retention"]["dropped"][:8]:
            print(f"      dropped {dropped['kind']:<7} {dropped['text'][:64]}")
        lost = report["retention"]["lostFromSource"]
        if lost:
            # Measured against the candidate's own words, so this catches what
            # the parser lost as well as what the rewrite dropped.
            print(f"  !! {len(lost)} line(s) of your resume reached nothing in the output:")
            for item in lost[:10]:
                print(f"      {item['text'][:76]}")
    if report["gapKeywordsRemoved"]:
        print(f"  gap keywords    : {len(report['gapKeywordsRemoved'])} item(s) removed")
    if report["gapKeywordsSurviving"]:
        # Should be impossible. Loud, because it means a guard did not hold.
        print(f"  !! gap keywords survived: {report['gapKeywordsSurviving']}")
    if report["honestGaps"]:
        print(f"  honest gaps     : {', '.join(report['honestGaps'])}")
    print()
    print(f"  wrote {args.out / 'resume.docx'}")
    print(f"  wrote {args.out / 'resume.pdf'}")
    print(f"  wrote {args.out / 'report.json'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
