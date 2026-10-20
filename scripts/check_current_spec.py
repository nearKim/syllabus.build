# GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md
#!/usr/bin/env python3
"""Check the single spec, traceability, asset integrity and static UI tokens; not the app."""
from collections import Counter, defaultdict
from pathlib import Path
import csv, io, json, re, sys
from extract_spec import read_assets

BASE = 'specs/001-curriculum-platform/'
REQ = re.compile(r'(?:GOAL|CAT|GEN|PED|PROG|UI|BILL|NOT|OPS|NFR|ADAPT|SHARE)-\d{3}')

def require(condition, message):
    if not condition:
        raise ValueError(message)

def no_duplicates(values, label):
    repeated = sorted(k for k, n in Counter(values).items() if n > 1)
    require(not repeated, 'Duplicate ' + label + ': ' + repr(repeated))

def prose_without_fences(text):
    result = []
    fence = None
    for line in text.splitlines():
        if fence is None:
            m = re.match(r'^\s*(`{3,}|~{3,})', line)
            if m:
                fence = m[1]
            else:
                result.append(line)
        elif re.fullmatch(r'\s*' + re.escape(fence[0]) + '{' + str(len(fence)) + r',}\s*', line):
            fence = None
    require(fence is None, 'Unclosed Markdown fence')
    return '\n'.join(result)

def rows_csv(text):
    clean_lines = [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    reader = csv.DictReader(io.StringIO('\n'.join(clean_lines)))
    rows = list(reader)
    require(bool(rows), 'Empty trace table')
    for row in rows:
        require(None not in row and all(v and v.strip() for v in row.values()), 'Invalid CSV row')
    return rows

def luminance(color):
    channels = [int(color[i:i+2],16)/255 for i in [1,3,5]]
    c = [v/12.92 if v <= 0.04045 else ((v+0.055)/1.055)**2.4 for v in channels]
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]

def contrast(a,b):
    lo,hi = sorted([luminance(a),luminance(b)])
    return (hi+0.05)/(lo+0.05)

def validate(path):
    text = path.read_text(encoding='utf-8')
    assets = read_assets(text)
    prose = prose_without_fences(text)
    definitions = re.findall(r'^\| ([A-Z]+-\d{3}) \| (P[01]) \|',prose,re.M)
    no_duplicates([r for r,p in definitions],'requirement IDs')
    require(all(REQ.fullmatch(r) for r,p in definitions),'Unknown requirement namespace')
    priorities = dict(definitions)
    p0_count = sum(1 for p in priorities.values() if p == 'P0')
    p1_count = sum(1 for p in priorities.values() if p == 'P1')
    task_list = re.findall(r'^### (T\d{2,})\b',prose,re.M)
    no_duplicates(task_list,'task IDs')
    task_ids=set(task_list)
    scenarios={}; mapped=defaultdict(set);pending=[]
    for raw in assets[BASE+'acceptance.feature'].splitlines():
        line=raw.strip()
        if not line or line.startswith('#'):continue
        if line.startswith('@'):
            pending.extend(v[1:] for v in line.split())
        elif re.match(r'Scenario(?: Outline)?:',line):
            no_duplicates(pending,'scenario tags')
            sid=[x for x in pending if re.fullmatch(r'S\d{2,}',x)]
            require(len(sid)==1 and sid[0] not in scenarios,'Invalid scenario ID')
            rr={x for x in pending if REQ.fullmatch(x)}
            require(rr and rr<=set(priorities),'Unknown or missing requirement tags')
            scenarios[sid[0]]=rr
            for r in rr:mapped[r].add(sid[0])
            pending=[]
        else:
            require(not pending,'Tags are not attached to a scenario')
    require(not pending and set(mapped)==set(priorities),'Uncovered requirement or trailing tag')
    trace=rows_csv(assets[BASE+'traceability.csv'])
    no_duplicates([r['requirement_id'] for r in trace],'trace requirement IDs')
    require({r['requirement_id'] for r in trace}==set(priorities),'Trace requirement coverage mismatch')
    for row in trace:
        r=row['requirement_id']
        require(row['priority']==priorities[r],'Trace priority mismatch '+r)
        require(set(row['acceptance_scenarios'].split())==mapped[r],'Exact scenario mapping mismatch '+r)
        ts=row['implementation_tasks'].split()
        require(ts and set(ts)<=task_ids,'Invalid task mapping '+r)
        for name in re.findall(r'\b[\w.-]+\.schema\.json\b|\b(?:app-companion\.)?openapi\.yaml\b',row['contract_or_component']):
            require(BASE+'contracts/'+name in assets,'Missing contract '+name)
    controls=re.findall(r'^`(CTRL-\d{3})`\s',prose,re.M)
    no_duplicates(controls,'control definitions')
    ctr=rows_csv(assets[BASE+'control-traceability.csv'])
    no_duplicates([r['control_id'] for r in ctr],'control trace IDs')
    require({r['control_id'] for r in ctr}==set(controls),'Control coverage mismatch')
    for row in ctr:
        require(set(row['parent_requirement_ids'].split())<=set(priorities),'Unknown control parent')
        require(set(row['implementation_tasks'].split())<=task_ids,'Unknown control task')
    anchors=set();seen=Counter()
    for title in re.findall(r'^#{1,6}\s+(.+)$',prose,re.M):
        title=title.strip().lower()
        title=''.join(c for c in title if c.isalnum() or c in '_- ')
        slug=title.replace(' ','-')
        suffix='' if seen[slug]==0 else '-'+str(seen[slug])
        anchors.add(slug+suffix);seen[slug]+=1
    for target in re.findall(r'\]\(#([^ )]+)\)',prose):
        require(target in anchors,'Broken internal anchor '+target)
    relative=re.findall(r'\]\((?!https?://|#|mailto:|sandbox:)([^)]+)\)',prose)
    require(not relative,'Unresolved relative links '+repr(relative[:10]))
    for stale in ['pending exact PolyForm scope','leading unmodified standard candidate','single owner decision needed before license adoption','remaining license-boundary question']:
        require(stale not in prose,'Stale decision: '+stale)
    design=json.loads(assets['design/ui-tokens.json'])
    palette={token:{'light':light,'dark':dark} for token,light,dark in re.findall(r'^\| ([a-z-]+) \| (#[0-9A-F]{6}) \| (#[0-9A-F]{6}) \|',prose,re.M)}
    require(palette==design['colors'],'UI prose/token color mismatch')
    pairs=[('text-primary','canvas',4.5),('text-primary','surface',4.5),('text-primary','surface-secondary',4.5),('text-secondary','canvas',4.5),('text-secondary','surface',4.5),('text-secondary','surface-secondary',4.5),('accent','surface',4.5),('accent','accent-surface',4.5),('action-text','action-fill',4.5),('success-text','success-surface',4.5),('warning-text','warning-surface',4.5),('danger-text','danger-surface',4.5),('border-control','canvas',3),('border-control','surface',3),('border-control','surface-secondary',3)]
    ratios=[]
    for theme in ['light','dark']:
        for fg,bg,minimum in pairs:
            ratio=contrast(palette[fg][theme],palette[bg][theme])
            require(ratio>=minimum,f'Insufficient static contrast {theme} {fg}/{bg}: {ratio}')
            ratios.append({'theme':theme,'foreground':fg,'background':bg,'ratio':round(ratio,2),'minimum':minimum})
    return {
        'passed':True,
        'requirements':len(priorities),
        'p0_requirements':p0_count,
        'p1_requirements':p1_count,
        'scenarios':len(scenarios),
        'tasks':len(task_ids),
        'controls':len(controls),
        'embedded_assets':len(assets),
        'static_color_pairs':len(ratios),
        'minimum_normal_text_ratio':min(v['ratio'] for v in ratios if v['minimum']==4.5),
        'minimum_non_text_ratio':min(v['ratio'] for v in ratios if v['minimum']==3),
        'internal_links':'passed',
        'asset_integrity':'passed',
        'scope':'Specification and static token checks, not runtime UI or app validation'
    }

if __name__=='__main__':
    print(json.dumps(validate(Path(sys.argv[1])),indent=2))
