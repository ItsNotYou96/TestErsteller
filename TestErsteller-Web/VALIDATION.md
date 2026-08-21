# v2.2 validation

## Anti-hallucination PDF flow

- PDF text layer is authoritative for task boundaries.
- Vision never creates new tasks when a trusted text skeleton exists.
- Visual math correction is rejected if task numbers change, an original subtask disappears, numeric literals change, prose overlap falls below 78 %, or output length changes implausibly.
- PDFs without a trusted text/task skeleton are not auto-converted into Groq-invented tasks.

## Fraction handling

- Normalizes common PDF multiplication/division glyphs to LaTeX-like notation.
- Repairs the common line-broken fraction pattern where a visual `3/4 x` is emitted as `4` on one line and `3 x` on the next.
- Also handles a mixed-number continuation after that common fraction pattern.
- Complex multi-fraction layouts remain candidates for the guarded visual math correction rather than unsafe guessing.

## Duplicate similarity

- Numbers are no longer erased before comparison.
- Score now combines literal tokens, prose tokens, character similarity, number-normalized structure, math tokens, title and exact number overlap.
- Different number sets only reduce similarity when prose is not already strongly aligned, so "same task with changed values" can still be surfaced.
- Candidate threshold: 74 %. Auto-exclusion threshold: 96 % (previously 86 %).

## PDF numbering regression

The existing task-start rules remain unchanged for:
- numbered worksheets without point values (`1. ...` through `10. ...`), and
- worksheets with point blocks such as `1 (7 P.) ...`.

## Build

Changed TS/TSX files are syntax-checked locally. Full Next.js integration build is still delegated to Vercel because npm registry installation is unavailable in this environment.

## Local regression probes

Anti-hallucination validator:
- same tasks + `4\n3 x` repaired to `\\frac{3}{4}x` -> accepted;
- added task number -> rejected;
- added subtask -> rejected;
- changed numeric literal -> rejected.

Duplicate score probes:
- exact copy -> 1.000;
- same substantive rectangle task with only side lengths changed -> ~0.837 (shown as similar, not auto-excluded);
- generic equation instruction with different equations -> ~0.266 (not shown);
- unrelated coordinate/statistics tasks -> ~0.116 (not shown).
