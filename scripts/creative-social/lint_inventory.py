"""Build portable, reconciled audit artifacts from actual ESLint JSON runs.

Run at repository root. This script never edits application code or lint rules.
Before source comparison uses the pinned staging commit, not the working tree.
"""
import argparse
import collections
import csv
import difflib
import hashlib
from functools import lru_cache
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--before', required=True)
parser.add_argument('--after', required=True)
parser.add_argument('--staging', default='81a871438ad2db9456d4e7cbc86d584c7095d9e6')
parser.add_argument('--base', default='4d13c6a2a84796ea5000baf08459417ec015ef3d')
parser.add_argument('--upstream', required=True)
parser.add_argument('--output', default='docs/creative-social/audit')
args = parser.parse_args()
root = Path.cwd()
out = root / args.output
out.mkdir(parents=True, exist_ok=True)
reviews = json.loads((out / 'review-notes.json').read_text(encoding='utf8'))

def load(path):
    raw = json.loads(Path(path).read_text(encoding='utf8'))
    files = []
    for source in raw:
        rel = Path(source['filePath']).relative_to(root).as_posix()
        # Preserve full diagnostic text/positions; replace host-specific paths.
        messages = json.loads(json.dumps(source['messages']).replace(
            json.dumps(str(root))[1:-1], '<repo>'))
        files.append({'filePath': rel, 'messages': messages,
                      'errorCount': source['errorCount'],
                      'warningCount': source['warningCount']})
    assert sum(f['errorCount'] for f in files) == sum(m['severity'] == 2 for f in files for m in f['messages'])
    assert sum(f['warningCount'] for f in files) == sum(m['severity'] == 1 for f in files for m in f['messages'])
    return files

before, after = load(args.before), load(args.after)
for name, files in [('lint-before.json', before), ('lint-after.json', after)]:
    (out / name).write_text(json.dumps(files, indent=2) + '\n', encoding='utf8')

@lru_cache(maxsize=None)
def blob(ref, path):
    result = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True)
    return None if result.returncode else result.stdout.replace(b'\r\n', b'\n')

file_comparison = {}
for f in before:
    if not f['messages']:
        continue
    path = f['filePath']
    staging, baseline, upstream = (blob(ref, path) for ref in (args.staging, args.base, args.upstream))
    file_comparison[path] = {
        'baselineIdentical': baseline is not None and staging == baseline,
        'upstreamIdentical': upstream is not None and staging == upstream,
        'presentUpstream': upstream is not None,
        'stagingNormalizedSha256': hashlib.sha256(staging or b'').hexdigest(),
        'upstreamNormalizedSha256': hashlib.sha256(upstream or b'').hexdigest() if upstream is not None else None,
    }
    if f['errorCount']:
        assert path in reviews, f'Error file needs explicit review: {path}'

remaining = collections.defaultdict(list)
for f in after:
    for m in f['messages']:
        remaining[(f['filePath'], m['ruleId'], m['severity'], m['message'].split('\n')[0])].append(m.get('line'))

warning_work = {
    'react-hooks/exhaustive-deps': 'Review captured values at this exact callback/effect; add identity/cancellation regression tests before changing dependencies, especially single-use OAuth or payment operations.',
    '@typescript-eslint/no-unused-expressions': 'Vendor bundle statement/receiver semantics: rebuild or replace reviewed vendor source; do not mass-autofix compiled expressions.',
    '@next/next/no-img-element': 'Profile/media/app images: review trusted origin, sizing and remote-image policy before adopting optimized images; add fallback/layout coverage.',
    'jsx-a11y/alt-text': 'Review the image purpose at this location and add meaningful alt text or decorative semantics with accessibility checks.',
    '@next/next/no-location-assign-relative-destination': 'Review navigation semantics and required cookie/full reload behavior before using router navigation; keep validated external OAuth redirects intact.',
    'react-hooks/incompatible-library': 'Review React Hook Form/library compiler compatibility with form behavior tests; an optimization skip is not a runtime test.',
    'import/no-anonymous-default-export': 'Name the exported configuration/object in a focused style change; do not alter rules to clear diagnostics.',
    None: 'Review and remove stale eslint-disable directives in a focused cleanup; no new suppression was introduced by this audit.',
}
records = []
for f in before:
    path = f['filePath']
    review = reviews.get(path)
    function = review['functionality'] if review else path.rsplit('/', 1)[-1].rsplit('.', 1)[0] + ' (' + '/'.join(path.split('/')[:-1]) + ')'
    comparison = file_comparison.get(path, {})
    origin = 'inherited-identical-current-upstream' if comparison.get('upstreamIdentical') else 'upstream-file-modified-review-context' if comparison.get('presentUpstream') else 'Creative-Social-only-file'
    staging_lines = (blob(args.staging, path) or b'').decode('utf8').splitlines()
    upstream_lines = (blob(args.upstream, path) or b'').decode('utf8').splitlines()
    matching = difflib.SequenceMatcher(None, staging_lines, upstream_lines, autojunk=False).get_matching_blocks() if not comparison.get('upstreamIdentical') else []
    for m in f['messages']:
        upstream_line = m.get('line') if comparison.get('upstreamIdentical') else None
        context_lines = len(staging_lines) if comparison.get('upstreamIdentical') else 0
        for block in matching:
            offset = m.get('line', 0) - 1 - block.a
            if 0 <= offset < block.size:
                upstream_line = block.b + offset + 1
                context_lines = block.size
                break
        priority = review['priority'] if m['severity'] == 2 else 'P1' if review and review['priority'] == 'P1' and m['ruleId'] == 'react-hooks/exhaustive-deps' and 'unnecessary dependencies' not in m['message'] else 'P2'
        fingerprint = (path, m['ruleId'], m['severity'], m['message'].split('\n')[0])
        matches = remaining[fingerprint]
        current_line = matches.pop(0) if matches else None
        records.append({
            'id': f'L{len(records)+1:04d}', 'file': path,
            'line': m.get('line'), 'column': m.get('column'),
            'rule': m['ruleId'], 'eslintSeverity': m['severity'],
            'priority': priority, 'functionality': function, 'sourceOrigin': origin,
            'upstreamLine': upstream_line, 'upstreamMatchedContextLines': context_lines,
            'diagnostic': m['message'].split('\n')[0],
            'review': review['review'] if m['severity'] == 2 else warning_work.get(m['ruleId'], 'Requires rule-specific source and behavior review before a focused fix.'),
            'afterStatus': 'remaining' if current_line is not None else 'resolved',
            'afterLine': current_line,
        })

assert not any(remaining.values()), 'New diagnostics require explicit review before publishing the inventory'

(out / 'inventory.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf8')
for name, severity in [('errors.csv', 2), ('warnings.csv', 1)]:
    with (out / name).open('w', encoding='utf8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(r for r in records if r['eslintSeverity'] == severity)

rules = lambda files, severity: dict(sorted(collections.Counter(m['ruleId'] or 'unused-eslint-disable' for f in files for m in f['messages'] if m['severity'] == severity).items()))
counts = lambda files: {'filesAnalyzed': len(files), 'errors': sum(f['errorCount'] for f in files), 'warnings': sum(f['warningCount'] for f in files), 'errorFiles': sum(f['errorCount'] > 0 for f in files), 'errorRules': rules(files, 2), 'warningRules': rules(files, 1)}
summary = {
    'stagingCommit': args.staging, 'upstreamBase': args.base, 'upstreamCurrent': args.upstream,
    'normalization': 'Repository-relative filenames and <repo> in messages; source hashes normalize CRLF to LF.',
    'before': counts(before), 'after': counts(after),
    'beforeErrorPriorities': dict(collections.Counter(r['priority'] for r in records if r['eslintSeverity'] == 2)),
    'remainingReviewedP1Diagnostics': [r['id'] for r in records if r['priority'] == 'P1' and r['afterStatus'] == 'remaining'],
    'fileComparison': file_comparison,
}
assert len(records) == summary['before']['errors'] + summary['before']['warnings']
(out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf8')
print(json.dumps({k:summary[k] for k in ['before','after','beforeErrorPriorities','remainingReviewedP1Diagnostics']}, indent=2))
