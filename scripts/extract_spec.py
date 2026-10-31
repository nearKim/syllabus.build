# GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md
#!/usr/bin/env python3
"""Extract or verify integrity-checked machine assets and generated slice contexts from specs/product.md."""
from collections import defaultdict
from pathlib import Path, PurePosixPath
import argparse
import csv
import hashlib
import io
import json
import re
import sys

GENERATED_MARKER = 'GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md'
EXAMPLES_NOTICE_REL = 'specs/001-syllabus-platform/examples/.generated-notice'
examples_notice_text = (
    '# ' + GENERATED_MARKER + '\n'
    '# Synthetic JSON fixtures in this directory are extracted byte-for-byte from specs/product.md\n'
    '# so their cryptographic SHA-256 and RFC 8785 JCS digests remain immutable.\n'
)

ASSET_RE = re.compile(
    r'^<!-- embedded-asset: (?P<path>\S+) sha256=(?P<digest>[0-9a-f]{64}) -->\n'
    r'(?P<fence>`{3,})[A-Za-z0-9_+.-]*\n(?P<body>.*?)^(?P=fence)\n'
    r'<!-- /embedded-asset -->', re.M | re.S
)

SLICE_METADATA = {
    'T00': ('Slice 0 — Baseline, Polyglot Workspace, Spec Drift Gate & Contract Harness', 'Tier 1: Private Alpha (Foundation Tracer Bullet)'),
    'T01': ('Slice 1 — Identity, Tenant Isolation, HTTP Concurrency & Transactional Outbox', 'Tier 1: Private Alpha (Foundation Tracer Bullet)'),
    'T02': ('Slice 3 — Small Reviewed Catalog & Deterministic Metadata Filtering', 'Tier 1: Private Alpha (Foundation Tracer Bullet)'),
    'T03': ('Slice 4 — Goal Intake, Async Generation & Deterministic Semantic Validator', 'Tier 1: Private Alpha (Foundation Tracer Bullet)'),
    'T04': ('Slice 5 — Responsive Syllabus (Outline + Basic Map), Today View & Activation', 'Tier 1: Private Alpha (Foundation Tracer Bullet)'),
    'T05': ('Slice 6 — Practice, Reviewed Anchor Assessments, Mastery Gates & Honest Progress', 'Tier 2: Closed Beta'),
    'T06': ('Slice 7 — Workload Math, ScheduleRevision, ReviewScheduleItem & Offline Sync', 'Tier 2: Closed Beta'),
    'T07': ('Slices 9A–9D — BYOK Custody, Live Providers, Hosted Ledger & Checkout (Parent Task)', 'Tier 2: Closed Beta (T07A) / Tier 3: Public Beta (T07B–T07D)'),
    'T07A': ('Slice 9A — Server-Mediated Encrypted BYOK Custody & OpenAI Live Provider (reqwest)', 'Tier 2: Closed Beta (Requires D11 Auth Gate)'),
    'T07B': ('Slice 9B — Hosted Inference Credit Ledger, Quotes, Reservations & Settlements', 'Tier 3: Public Beta'),
    'T07C': ('Slice 9C — Additional Live Providers (Anthropic & Google Gemini via reqwest)', 'Tier 3: Public Beta'),
    'T07D': ('Slice 9D — Payment Checkout Sessions, Signed Webhooks & Ambiguous-Timeout Reconciliation', 'Tier 3: Public Beta (Requires D07 & D11 Gates)'),
    'T08': ('Slice 10 — Transactional Reminder Outbox, Timezone/DST Policy & Installable PWA', 'Tier 2: Closed Beta'),
    'T09': ('Slice 13 — Release Operations, Export/Deletion, Backup Restore & Public-Beta Gate', 'Tier 3: Public Beta'),
    'T10': ('Slice 14 — Native Clients & Precise OS Alarms (If Selected)', 'Post-Public-Beta Extension'),
    'T11': ('Slice 15 — Pedagogical Evaluation Workstream, Delayed Learning/Transfer Study & Scope Expansion', 'Continuous Evaluation & Post-Public-Beta'),
    'T12': ('Slice 8 — Objective Diagnostics, Prerequisite Waivers & Syllabus Adaptation', 'Tier 2: Closed Beta'),
    'T13': ('Slice 11 — Public Templates, Discovery, Partial Adoption, Upvotes & Moderation', 'Tier 3: Public Beta (Requires D11 & D16 Gates)'),
    'T14': ('Slices 2 & 12 — Responsive UI Shell (T14-Core) & Complete UI/Accessibility Evidence (T14-Full)', 'Tier 1: Private Alpha (T14-Core) / Tier 3: Public Beta (T14-Full)'),
    'T14-Core': ('Slice 2 — Design Tokens, Fail-Closed SafeActivityRenderer & Learn/Explore/Settings Shell', 'Tier 1: Private Alpha (Foundation Tracer Bullet)'),
    'T14-Full': ('Slice 12 — Complete Screen Inventory, Automated A11y Checks & Manual WCAG 2.2 AA Evidence', 'Tier 3: Public Beta (Separate from T09)'),
}

SUBSLICE_REQ_FILTER = {
    'T07A': {'BILL-001', 'BILL-002', 'BILL-004', 'BILL-005', 'BILL-006', 'BILL-007', 'BILL-008', 'UI-018', 'NFR-001', 'NFR-002'},
    'T07B': {'BILL-001', 'BILL-003', 'BILL-004', 'BILL-005', 'BILL-008', 'UI-013'},
    'T07C': {'BILL-001', 'BILL-005', 'BILL-006', 'BILL-007', 'BILL-008'},
    'T07D': {'BILL-003', 'BILL-004', 'BILL-005', 'UI-020', 'NFR-006'},
    'T14-Core': {'UI-007', 'UI-008', 'UI-009', 'UI-010', 'UI-021', 'UI-022', 'UI-023', 'UI-024', 'NFR-002', 'NFR-003'},
    'T14-Full': {f'UI-{i:03d}' for i in range(1, 25)} | {'NFR-002', 'NFR-003'},
}

def read_assets(text):
    assets = {}
    for match in ASSET_RE.finditer(text):
        name = match['path']
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError('Unsafe asset path: ' + name)
        if path.suffix not in {'.json', '.yaml', '.feature', '.csv', '.py', '.txt'}:
            raise ValueError('Unexpected asset type: ' + name)
        if name in assets:
            raise ValueError('Duplicate asset: ' + name)
        body = match['body']
        if hashlib.sha256(body.encode('utf-8')).hexdigest() != match['digest']:
            raise ValueError('Embedded asset integrity mismatch: ' + name)
        if not name.startswith('specs/001-syllabus-platform/examples/'):
            if GENERATED_MARKER not in body:
                raise ValueError('Missing generated-file notice in embedded asset: ' + name)
        assets[name] = body
    expected = len(re.findall(r'^<!-- embedded-asset:', text, re.M))
    if not assets or len(assets) != expected:
        raise ValueError('Missing or malformed embedded asset block')
    return assets

def _parse_csv(text):
    lines = [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    return list(csv.DictReader(io.StringIO('\n'.join(lines))))

def _parse_scenarios(feature_text):
    scenarios = {}
    lines = feature_text.splitlines()
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith('@'):
            tags = []
            start = i
            while i < len(lines) and lines[i].strip().startswith('@'):
                tags.extend(t[1:] for t in lines[i].strip().split())
                i += 1
            sids = [t for t in tags if re.fullmatch(r'S\d{2,}', t)]
            block = lines[start:i]
            while i < len(lines) and not lines[i].strip().startswith('@'):
                block.append(lines[i])
                i += 1
            if sids:
                scenarios[sids[0]] = ('\n'.join(block)).rstrip()
        else:
            i += 1
    return scenarios

def build_slice_contexts(spec_text, assets):
    spec_sha256 = hashlib.sha256(spec_text.encode('utf-8')).hexdigest()
    req_rows = {}
    for m in re.finditer(r'^\| ([A-Z]+-\d{3}) \| (P[01]) \| (.+?) \|$', spec_text, re.M):
        req_rows[m.group(1)] = (m.group(2), m.group(3).strip())
    slice_sections = {}
    for m in re.finditer(r'^### (T\d{2}) — ([^\n]+)\n(?P<body>.*?)(?=^### |^---)', spec_text, re.M | re.S):
        slice_sections[m.group(1)] = (m.group(2).strip(), m.group('body').strip())
    trace_rows = _parse_csv(assets['specs/001-syllabus-platform/traceability.csv'])
    ctrl_rows = _parse_csv(assets['specs/001-syllabus-platform/control-traceability.csv'])
    scenarios = _parse_scenarios(assets['specs/001-syllabus-platform/acceptance.feature'])

    contexts = {}
    for slice_id, (title, tier) in sorted(SLICE_METADATA.items()):
        parent_id = slice_id.split('-')[0][:3] if ('-' in slice_id or len(slice_id) > 3) else slice_id
        parent_heading, parent_body = slice_sections.get(parent_id, (title, ''))
        matched_trace = [r for r in trace_rows if parent_id in r['implementation_tasks'].split()]
        if slice_id in SUBSLICE_REQ_FILTER:
            allowed = SUBSLICE_REQ_FILTER[slice_id]
            matched_trace = [r for r in matched_trace if r['requirement_id'] in allowed]
        matched_ctrls = [c for c in ctrl_rows if parent_id in c['implementation_tasks'].split()]
        scen_ids = sorted(
            {s for r in matched_trace for s in r['acceptance_scenarios'].split()},
            key=lambda x: int(x[1:])
        )
        contracts = sorted({
            part.strip()
            for r in matched_trace
            for part in r['contract_or_component'].split(';')
            if part.strip()
        })
        out = [
            f'<!-- {GENERATED_MARKER} -->',
            f'<!-- Specification SHA-256: {spec_sha256} -->',
            '',
            f'# {slice_id}: {title}',
            '',
            f'- **Source of Truth:** `specs/product.md` (SHA-256: `{spec_sha256}`)',
            f'- **Release Tier:** {tier}',
            f'- **Canonical Parent Slice:** `{parent_id}` ({parent_heading})',
            f'- **Mapped Requirements:** {len(matched_trace)}',
            f'- **Mapped Acceptance Scenarios:** {len(scen_ids)} ({", ".join(scen_ids) if scen_ids else "none"})',
            f'- **Mapped Controls:** {len(matched_ctrls)} ({", ".join(c["control_id"] for c in matched_ctrls) if matched_ctrls else "none"})',
            '',
            '## 1. Canonical Slice Checklist (`specs/product.md` Section 18)',
            '',
            parent_body,
            '',
            '## 2. Relevant Contracts, Schemas & Components',
            '',
        ]
        for c in contracts:
            out.append(f'- `{c}`')
        out.extend([
            '',
            '## 3. Mapped Product Requirements',
            '',
            '| ID | Priority | Scenarios | Contracts / Components | Verification Method | Normative Requirement |',
            '| :--- | :--- | :--- | :--- | :--- | :--- |',
        ])
        for r in matched_trace:
            rid = r['requirement_id']
            prio, rtext = req_rows.get(rid, (r['priority'], ''))
            out.append(
                f'| `{rid}` | {prio} | `{r["acceptance_scenarios"]}` | {r["contract_or_component"]} | {r["verification_method"]} | {rtext} |'
            )
        out.extend([
            '',
            '## 4. Mapped Security, Rights & Operational Controls (`CTRL-*`)',
            '',
            '| Control ID | Parent Requirements | Notes |',
            '| :--- | :--- | :--- |',
        ])
        for c in matched_ctrls:
            out.append(f'| `{c["control_id"]}` | `{c["parent_requirement_ids"]}` | {c["notes"]} |')
        out.extend([
            '',
            '## 5. Relevant Acceptance Scenarios (`acceptance.feature`)',
            '',
            '````gherkin',
        ])
        for sid in scen_ids:
            if sid in scenarios:
                out.append(scenarios[sid])
                out.append('')
        out.extend([
            '````',
            '',
        ])
        rel_path = f'specs/001-syllabus-platform/slices/{slice_id}.context.md'
        contexts[rel_path] = '\n'.join(out)
    return contexts

def extract(spec, output, check_only=False, force=False):
    spec_text = spec.read_text(encoding='utf-8')
    assets = read_assets(spec_text)
    slice_contexts = build_slice_contexts(spec_text, assets)
    root = output.resolve()
    all_items = dict(assets)
    all_items[EXAMPLES_NOTICE_REL] = examples_notice_text
    all_items.update(slice_contexts)
    drifted = []
    targets = []
    for name, content in all_items.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Asset escapes output directory: ' + name)
        if check_only:
            if not path.exists():
                drifted.append('Missing extracted file: ' + name)
            elif path.read_text(encoding='utf-8') != content:
                drifted.append('Drifted extracted file: ' + name)
        else:
            if path.exists() and not force and path.read_text(encoding='utf-8') != content:
                raise ValueError('Refusing to overwrite changed file without --force: ' + str(path))
            targets.append((path, content))
    if check_only:
        if drifted:
            for item in drifted:
                print(item, file=sys.stderr)
            raise SystemExit(1)
        return len(assets), len(slice_contexts)
    for path, content in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8', newline='\n')
    return len(assets), len(slice_contexts)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify extracted files and slice contexts match specs/product.md without writing')
    parser.add_argument('--force', action='store_true', help='Overwrite existing extracted files from canonical specs/product.md')
    parser.add_argument('specification', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    asset_count, slice_count = extract(args.specification, args.output, check_only=args.check, force=args.force)
    mode = 'Verified' if args.check else 'Extracted'
    print(f'{mode} {asset_count} machine assets and {slice_count} generated slice context views')
