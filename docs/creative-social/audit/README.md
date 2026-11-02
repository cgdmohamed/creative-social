# Lint audit artifacts

Read [the audit](../PRE_STAGING_AUDIT.md) first. These are measured results, not
assumed totals. ESLint severity (1 warning / 2 error) differs from reviewed risk
priority (P0/P1/P2). A P2 record is a follow-up scope, not a harmlessness claim.

- `lint-before.json`, `lint-after.json`: complete JSON diagnostic arrays, portable paths.
- `inventory.json`: one classified row per original diagnostic, including duplicates,
  upstream comparison location/context, remediation and matching after location/status.
- `errors.csv`: all 134 original errors, one row per diagnostic.
- `warnings.csv`: all 1,109 original warnings, one row per diagnostic.
- `review-notes.json`: reviewed functionality/behavior for all 75 error files.
- `summary.json`: actual before/after totals/rules and normalized source hashes.
- `VALIDATION.md`: verified checks and remaining runtime blockers.

Reproduce from repository root after obtaining before/after JSON snapshots:

```sh
pnpm exec eslint . --format json --output-file /tmp/lint-after.json
# ESLint exits 1 for the documented remaining errors; it still writes JSON.
python scripts/creative-social/lint_inventory.py --before /tmp/lint-before.json --after /tmp/lint-after.json --upstream 207eee0dae442a642844c1de9bd7a1574d17c95e
```

The before snapshot must be from develop commit
81a871438ad2db9456d4e7cbc86d584c7095d9e6 with the installed pinned dependencies.
The generator checks diagnostic-count reconciliation and requires explicit source
review metadata for every original error file. It compares source against both
pinned upstream revisions, normalizing only CRLF/LF. It does not run or rewrite
upstream's different lint config. Files modified upstream or by Creative Social
retain that distinction; an equal source line in a modified file is recorded with
its exact matching context size, not promoted to whole-file identity.
