# GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md
#!/usr/bin/env python3
"""Validate specification contracts and fixtures; not application behavior."""
from pathlib import Path
from copy import deepcopy
from datetime import datetime
from math import ceil
import hashlib
import json
import importlib.metadata
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from openapi_spec_validator import OpenAPIV31SpecValidator

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'specs/001-curriculum-platform'
CON=BASE/'contracts'
EX=BASE/'examples'
report={'json_schema_meta_checks':0,'openapi_schema_checks':0,'positive_fixtures':0,
        'negative_fixtures':0,'semantic_checks':[],'errors':[],
        'validator_versions':{name:importlib.metadata.version(name) for name in ['jsonschema','openapi-spec-validator']}}
schemas={}
registry=Registry()
for p in sorted(CON.glob('*.schema.json')):
    data=json.loads(p.read_text())
    schemas[p.name]=data
    Draft202012Validator.check_schema(data)
    report['json_schema_meta_checks']+=1
    resource=Resource.from_contents(data)
    registry=registry.with_resource(data['$id'],resource).with_resource(p.as_uri(),resource)
oas_path=CON/'openapi.yaml'
oas=yaml.safe_load(oas_path.read_text())
registry=registry.with_resource(oas_path.as_uri(),Resource.from_contents(oas,default_specification=DRAFT202012))
errors=list(OpenAPIV31SpecValidator(oas,base_uri=oas_path.as_uri()).iter_errors())
if errors:
    report['errors'].extend([(e.message+' at '+str(list(e.path))) for e in errors])
else:
    report['openapi_schema_checks']+=1
companion_oas_path=CON/'app-companion.openapi.yaml'
companion_oas=yaml.safe_load(companion_oas_path.read_text())
registry=registry.with_resource(companion_oas_path.as_uri(),Resource.from_contents(companion_oas,default_specification=DRAFT202012))
companion_errors=list(OpenAPIV31SpecValidator(companion_oas,base_uri=companion_oas_path.as_uri()).iter_errors())
if companion_errors:
    report['errors'].extend([('app-companion.openapi.yaml: '+e.message+' at '+str(list(e.path))) for e in companion_errors])
else:
    report['openapi_schema_checks']+=1

def validate_ref(data,target):
    schema={'$schema':'https://json-schema.org/draft/2020-12/schema','$ref':target}
    validator=Draft202012Validator(schema,registry=registry,format_checker=FormatChecker())
    return list(validator.iter_errors(data))
def uri(name,fragment=''):
    return (CON/name).as_uri()+fragment
def oas_uri(name):
    return oas_path.as_uri()+'#/components/schemas/'+name

positive_targets={
'owned-publications.synthetic.json':oas_uri('OwnedPublicationPage'),
'owned-publication-revisions.synthetic.json':oas_uri('OwnedPublicationRevisionPage'),
'generation-request.hosted.synthetic.json':uri('generation-request.schema.json'),
'generation-request.byok.synthetic.json':uri('generation-request.schema.json'),
'resource.synthetic.json':uri('resource.schema.json'),
'resource-unknown-price.synthetic.json':uri('resource.schema.json'),
'curriculum-candidate.synthetic.json':uri('curriculum.schema.json','#/$defs/modelCandidate'),
'curriculum.synthetic.json':uri('curriculum.schema.json'),
'schedule.synthetic.json':oas_uri('Schedule'),
'progress-event.synthetic.json':oas_uri('ProgressEventRequest'),
'generation-request.formal-math.synthetic.json':uri('generation-request.schema.json'),
'proficiency.synthetic.json':uri('proficiency.schema.json'),
'public-curriculum.synthetic.json':uri('public-curriculum.schema.json'),
'publication-preview.synthetic.json':oas_uri('PublicationPreview'),
'adaptation-proposal.synthetic.json':uri('adaptation-proposal.schema.json'),
'diagnostic-session.synthetic.json':oas_uri('DiagnosticSession'),
'adoption-request.synthetic.json':oas_uri('AdoptionRequest'),
'adoption-request.hosted.synthetic.json':oas_uri('AdoptionRequest'),
'adoption-request.byok.synthetic.json':oas_uri('AdoptionRequest')
}
fixtures={}
for filename,target in positive_targets.items():
    data=json.loads((EX/filename).read_text())
    fixtures[filename]=data
    errors=validate_ref(data,target)
    if errors:
        report['errors'].extend([filename+': '+(e.message+' at '+str(list(e.path))) for e in errors])
    else:
        report['positive_fixtures']+=1

candidate=fixtures['curriculum-candidate.synthetic.json']
canonical=fixtures['curriculum.synthetic.json']
gen=fixtures['generation-request.hosted.synthetic.json']
byok=fixtures['generation-request.byok.synthetic.json']
resource=fixtures['resource.synthetic.json']
schedule=fixtures['schedule.synthetic.json']
negative=[]
x=deepcopy(candidate);x['html']='<script>alert(1)</script>'
negative.append(('candidate executable field',x,positive_targets['curriculum-candidate.synthetic.json']))
x=deepcopy(candidate);x['activities'][3]['content']['answer_key']=['secret']
negative.append(('assessment key leakage',x,positive_targets['curriculum-candidate.synthetic.json']))
x=deepcopy(canonical);x['mastered']=True
negative.append(('model mastery field',x,positive_targets['curriculum.synthetic.json']))
x=deepcopy(gen);x['api_key']='not-a-real-key'
negative.append(('raw key in generation',x,positive_targets['generation-request.hosted.synthetic.json']))
x=deepcopy(byok);x['inference']['base_url']='https://example.invalid'
negative.append(('arbitrary provider endpoint',x,positive_targets['generation-request.byok.synthetic.json']))
x=deepcopy(byok);del x['inference']['credential_ref']
negative.append(('missing BYOK credential ref',x,positive_targets['generation-request.byok.synthetic.json']))
x=deepcopy(gen);x['budgets']['materials']['max_minor_units']=100
negative.append(('free-only new material spend',x,positive_targets['generation-request.hosted.synthetic.json']))
x=deepcopy(gen);x['constraints']['deadline_policy']='no_deadline'
negative.append(('no-deadline with a date',x,positive_targets['generation-request.hosted.synthetic.json']))
x=deepcopy(fixtures['resource-unknown-price.synthetic.json']);x['access']['price']['amount']={'currency':'USD','amount_minor_units':0}
negative.append(('unknown price silently zeroed',x,positive_targets['resource-unknown-price.synthetic.json']))
negative.append(('hosted start without reservation',{'request':deepcopy(gen)},oas_uri('GenerationStartRequest')))
negative.append(('BYOK start with hosted reservation',{'request':deepcopy(byok),'reservation_id':'fake-reservation'},oas_uri('GenerationStartRequest')))
x=deepcopy(fixtures['owned-publications.synthetic.json']);x['items'][0]['account_id']='private-marker'
negative.append(('owner list rejects extra private identity',x,oas_uri('OwnedPublicationPage')))
x=deepcopy(fixtures['owned-publication-revisions.synthetic.json']);x['items'][0]['reporter_identity']='private-marker'
negative.append(('owner history rejects reporter identity',x,oas_uri('OwnedPublicationRevisionPage')))
public=fixtures['public-curriculum.synthetic.json']
prof=fixtures['proficiency.synthetic.json']
adapt=fixtures['adaptation-proposal.synthetic.json']
formal=fixtures['generation-request.formal-math.synthetic.json']
adoption=fixtures['adoption-request.synthetic.json']
x=deepcopy(public);x['account_id']='private-account-marker'
negative.append(('private account in public snapshot',x,positive_targets['public-curriculum.synthetic.json']))
x=deepcopy(public);x['content']['objectives'][0]['prior_evidence_refs']=['private-attempt-marker']
negative.append(('private prior evidence in public objective',x,positive_targets['public-curriculum.synthetic.json']))
x=deepcopy(public);x['content']['activities'][0]['assessment_expectation']={'objective_ids':x['content']['activities'][0]['objective_ids'],'assurance':'reviewed_anchor_available','description':'Synthetic','answer_key':'private-solution-marker'}
negative.append(('public assessment solution leakage',x,positive_targets['public-curriculum.synthetic.json']))
x=deepcopy(public);x['content']['schedule']={'timezone':'private-timezone-marker'}
negative.append(('private schedule in public content',x,positive_targets['public-curriculum.synthetic.json']))
x=deepcopy(public);x['content']['owned_subscription_ids']=['private-subscription-marker']
negative.append(('private owned access in publication',x,positive_targets['public-curriculum.synthetic.json']))
x=deepcopy(prof);x['objective_evidence'][0]['mastery_probability']=0.99
negative.append(('uncalibrated ability probability',x,positive_targets['proficiency.synthetic.json']))
x=deepcopy(prof);x['objective_evidence'][1]['status']='demonstrated'
negative.append(('demonstrated without evidence',x,positive_targets['proficiency.synthetic.json']))
x=deepcopy(candidate);x['adaptation_context']=deepcopy(canonical['adaptation_context'])
negative.append(('model assigns server adaptation context',x,positive_targets['curriculum-candidate.synthetic.json']))
x=deepcopy(adapt);x['proposed_waivers'][0]['qualifying_evidence_refs']=[]
negative.append(('waiver without qualifying references',x,positive_targets['adaptation-proposal.synthetic.json']))
x=deepcopy(formal);x['instruction_preferences']['math_depth']='expert'
negative.append(('ability used as math-depth mode',x,positive_targets['generation-request.formal-math.synthetic.json']))
x=deepcopy(byok);x['inference']['allow_hosted_fallback']=True
negative.append(('implicit hosted fallback requested',x,positive_targets['generation-request.byok.synthetic.json']))
x=deepcopy(byok);del x['inference']['credential_version_ref']
negative.append(('unpinned BYOK credential version',x,positive_targets['generation-request.byok.synthetic.json']))
x=deepcopy(fixtures['adoption-request.hosted.synthetic.json']);del x['reservation_id']
negative.append(('generated hosted adoption without reservation',x,positive_targets['adoption-request.synthetic.json']))
x=deepcopy(adoption);x['reservation_id']='hosted-reservation-for-copy'
negative.append(('deterministic adoption carries charge authority',x,positive_targets['adoption-request.synthetic.json']))
x={'preview_id':'preview-001','expected_preview_sha256':'0'*64,'publication_terms_policy_id':'terms-001','accept_publication_terms':False}
negative.append(('publication without accepted terms',x,oas_uri('PublicationConfirmRequest')))
x=deepcopy(fixtures['adoption-request.byok.synthetic.json']);x['reservation_id']='hosted-reservation'
negative.append(('generated BYOK adoption carries hosted reservation',x,oas_uri('AdoptionRequest')))
x=deepcopy(adoption);x['planning']['inference']=deepcopy(byok['inference'])
negative.append(('deterministic adoption contains credentials',x,oas_uri('AdoptionRequest')))
x=deepcopy(adapt);x['changes'][0]['kind']='reschedule'
negative.append(('curriculum proposal used for schedule-only change',x,positive_targets['adaptation-proposal.synthetic.json']))
x=deepcopy(adapt);del x['base_schedule_revision_id']
negative.append(('adaptation lacks schedule concurrency binding',x,positive_targets['adaptation-proposal.synthetic.json']))
x=deepcopy(fixtures['publication-preview.synthetic.json']);del x['publisher']
negative.append(('publication preview omits public identity',x,oas_uri('PublicationPreview')))
x=deepcopy(adoption);x['planning']['template_origin']=None
negative.append(('adoption without bound public origin',x,oas_uri('AdoptionRequest')))
x=deepcopy(canonical);x['activities'][0]['mastery_gated']='yes'
negative.append(('non-boolean mastery_gated rejected',x,positive_targets['curriculum.synthetic.json']))
x=deepcopy(schedule);x['review_schedule_items']=[{'review_item_id':'rev-1','objective_id':'obj-1','activity_id':'act-1','status':'invalid_state','due_at':None,'interval_policy_version':'policy-v1'}]
negative.append(('invalid ReviewScheduleItem status rejected',x,positive_targets['schedule.synthetic.json']))
for name,data,target in negative:
    errors=validate_ref(data,target)
    if errors:
        report['negative_fixtures']+=1
    else:
        report['errors'].append('Negative fixture unexpectedly accepted: '+name)

def sem(name,test):
    if not test: report['errors'].append('Semantic check failed: '+name)
    else: report['semantic_checks'].append(name)
def acyclic(nodes,edges):
    adj={n:[] for n in nodes};indeg={n:0 for n in nodes}
    for source,target in edges:
        if source not in adj or target not in adj:return False
        adj[source].append(target);indeg[target]+=1
    stack=[n for n,d in indeg.items() if d==0];visited=0
    while stack:
        node=stack.pop();visited+=1
        for nxt in adj[node]:
            indeg[nxt]-=1
            if indeg[nxt]==0:stack.append(nxt)
    return visited==len(nodes)
a={a['activity_id']:a for a in canonical['activities']}
o={o['objective_id']:o for o in canonical['objectives']}
m={m['module_id']:m for m in canonical['modules']}
sem('unique activity/objective/module IDs',len(a)==len(canonical['activities']) and len(o)==len(canonical['objectives']) and len(m)==len(canonical['modules']))
sem('objective references resolve',all(set(v['objective_ids'])<=set(o) for v in a.values()))
sem('module references resolve',all(set(v['activity_ids'])<=set(a) and set(v['objective_ids'])<=set(o) for v in m.values()))
objective_edges=[(e['from_objective_id'],e['to_objective_id']) for e in canonical['prerequisite_edges']]
activity_edges=[(p,v['activity_id']) for v in a.values() for p in v['prerequisite_activity_ids']]
sem('objective graph acyclic',acyclic(o,objective_edges))
sem('activity graph acyclic',acyclic(a,activity_edges))
sem('negative cycle detected',not acyclic(['aaa','bbb'],[('aaa','bbb'),('bbb','aaa')]))
sem('assessment paths align',all(all(aid in a and oid in a[aid]['objective_ids'] and a[aid]['content'].get('assessment_ref') for aid in obj['assessment_activity_ids']) for oid,obj in o.items()))
for oid,obj in o.items():
    linked=[v for v in a.values() if oid in v['objective_ids']]
    sem('objective '+oid+' has instruction/practice/assessment',
        any(v['type'] in ['theory','worked_example'] for v in linked)
        and any(v['type'] in ['worked_example','coding','project'] for v in linked)
        and bool(obj['assessment_activity_ids']))
components=['media_minutes','reading_minutes','practice_minutes','assessment_minutes','review_minutes']
speed=canonical['duration_policy']['playback_speed']
def effort(d):
    return ceil(d['media_minutes']/speed+sum(d[k] for k in components if k!='media_minutes'))
sem('component planning bounds ordered',all(
    v['duration_estimate']['lower_bounds'][k]<=v['duration_estimate'][k]<=v['duration_estimate']['upper_bounds'][k]
    for v in a.values() for k in components))
sem('duration point total',sum(effort(v['duration_estimate']) for v in a.values())==canonical['total_estimated_minutes'])
sem('duration lower total',sum(effort(v['duration_estimate']['lower_bounds']) for v in a.values())==canonical['total_estimate_range_minutes']['lower'])
sem('duration upper total',sum(effort(v['duration_estimate']['upper_bounds']) for v in a.values())==canonical['total_estimate_range_minutes']['upper'])
refs={r['resource_version_id'] for v in a.values() for r in v['resource_assignments']} | {c['resource_version_id'] for c in canonical['certification_options']}
sem('catalog provenance reference equality',refs==set(canonical['provenance']['source_resource_version_ids'])=={resource['resource_version_id']})
sem('candidate and canonical plan agree',all(canonical[k]==v for k,v in candidate.items() if k!='candidate_schema_version'))
sem('archived candidate hash matches',hashlib.sha256((EX/'curriculum-candidate.synthetic.json').read_bytes()).hexdigest()==canonical['provenance']['candidate_sha256'])
sem('schedule references resolve',all(set(s['activity_ids'])<=set(a) for s in schedule['sessions']))
sem('schedule point totals agree',sum(s['duration_minutes'] for s in schedule['sessions'])==canonical['total_estimated_minutes'])
sessions={aid:s['session_id'] for s in schedule['sessions'] for aid in s['activity_ids']}
sem('review is in a separate study session',sessions['activity-review']!=sessions['activity-quiz'])
sem('synthetic catalog is marked ineligible for production',resource['provenance']['is_synthetic_fixture'] is True)
sem('self-reported completion stays labeled',fixtures['progress-event.synthetic.json']['type']=='self_reported_completed')

# These checks validate a finite synthetic specification example, not a running
# proficiency service, publication service, or production authorization boundary.
def stable_fixture_hash(value):
    # The fixtures use the simple JSON value subset on which this encoding agrees
    # with the specified JCS hash. Production must use a full RFC 8785 library.
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
sem('public content digest matches preview and snapshot',stable_fixture_hash(public['content'])==public['content_sha256']==fixtures['publication-preview.synthetic.json']['content_sha256'])
preview=fixtures['publication-preview.synthetic.json']
envelope={'content':preview['public_content'],'publisher':preview['publisher'],'publication_terms':preview['publication_terms'],'origin':preview['origin'],'visibility':preview['visibility']}
sem('preview digest covers every reviewed public field',stable_fixture_hash(envelope)==preview['preview_sha256'] and all(preview[k]==public[k] for k in ['publisher','publication_terms','origin']))
altered=deepcopy(envelope);altered['publisher']['display_name']='A changed attribution'
sem('changed public attribution invalidates preview digest',stable_fixture_hash(altered)!=preview['preview_sha256'])
sem('adaptation proposal digest matches',stable_fixture_hash({k:v for k,v in adapt.items() if k!='proposal_sha256'})==adapt['proposal_sha256'])
sem('formal depth and application-first coexist',formal['instruction_preferences']['math_depth']=='formal' and formal['constraints']['sequence_preference']=='application_first')
sem('specific linear algebra evidence leaves matrix calculus unknown',prof['objective_evidence'][0]['status']=='demonstrated' and prof['objective_evidence'][1]['status']=='unknown' and prof['topic_coverage'][0]['coverage_label']=='partial')
observations={v['objective_version_id']:v for v in prof['objective_evidence']}
sem('waivers match exact demonstrated objective and evidence',all(w['objective_version_id'] in observations and observations[w['objective_version_id']]['status']=='demonstrated' and set(w['qualifying_evidence_refs'])<=set(observations[w['objective_version_id']]['evidence_refs']) and w['criterion_policy_id']==observations[w['objective_version_id']]['criterion_policy_id'] for w in adapt['proposed_waivers']))
sem('adaptation keeps requested formal depth',adapt['instruction_preferences_applied']==formal['instruction_preferences'])
sem('unknown objective is not waived',not(set(adapt['unassessed_objective_version_ids']) & {w['objective_version_id'] for w in adapt['proposed_waivers']}))
diag=fixtures['diagnostic-session.synthetic.json']
sem('diagnostic coverage partitions its target objectives',not(set(diag['assessed_objective_version_ids']) & set(diag['unassessed_objective_version_ids'])) and set(diag['assessed_objective_version_ids'])|set(diag['unassessed_objective_version_ids'])==set(diag['target_objective_version_ids']))
pc=public['content'];pa={v['activity_id']:v for v in pc['activities']};po={v['objective_id']:v for v in pc['objectives']}
sem('public graph references and uniqueness',len(pa)==len(pc['activities']) and len(po)==len(pc['objectives']) and all(set(v['objective_ids'])<=set(po) for v in pa.values()) and all(set(v['activity_ids'])<=set(pa) and set(v['objective_ids'])<=set(po) for v in pc['modules']))
sem('public module and activity IDs do not reuse private IDs',not(set(pa)&set(a)) and not({v['module_id'] for v in pc['modules']}&set(m)))
sem('public prerequisite and activity graphs acyclic',acyclic(po,[(v['from_objective_id'],v['to_objective_id']) for v in pc['prerequisite_edges']]) and acyclic(pa,[(p,v['activity_id']) for v in pa.values() for p in v['prerequisite_activity_ids']]))
sem('public source inventory matches assignments',set(pc['resource_version_ids'])=={r['resource_version_id'] for v in pa.values() for r in v['resource_assignments']}|{v['resource_version_id'] for v in pc['certification_options']})
sem('public effort estimates retained without a calendar',pc['effort']['estimated_minutes']==canonical['total_estimated_minutes'] and pc['effort']['range_minutes']==canonical['total_estimate_range_minutes'])
forbidden={'account_id','credential_ref','credential_version_ref','api_key','prior_evidence_refs','diagnostic_result_refs','profile_revision_id','proficiency_snapshot_ref','answer_key','private_rubric','schedule','progress','owned_subscription_ids','request_snapshot_id','generation_job_id'}
def keys_recursive(value):
    if isinstance(value,dict):return set(value)|set().union(*(keys_recursive(v) for v in value.values()))
    if isinstance(value,list):return set().union(*(keys_recursive(v) for v in value))
    return set()
sem('public fixture excludes private keys at every level',not (keys_recursive(public)&forbidden))
sem('private canonical object rejected by public schema',bool(validate_ref(canonical,positive_targets['public-curriculum.synthetic.json'])))
sem('public collection operations explicitly unauthenticated',oas['paths']['/publications']['get'].get('security')==[] and oas['paths']['/publications/{publication_id}']['get'].get('security')==[])
sem('private proficiency cannot be overwritten through a modeled endpoint',set(oas['paths']['/me/proficiency'])=={'get'} and oas['paths']['/me/proficiency']['get'].get('security')!=[])
sem('vote mutations use idempotent set and remove',set(oas['paths']['/publications/{publication_id}/revisions/{publication_revision_id}/my-vote'])=={'get','put','delete'})
sem('deterministic adoption has no inference authorization',adoption['execution']=='deterministic' and not ({'quote_id','reservation_id'} & set(adoption)))
sem('deterministic adoption needs no AI credentials or budget','inference' not in adoption['planning'] and 'inference' not in adoption['planning']['budgets'])
sem('adoption origin binds the exact public revision',adoption['planning']['template_origin']=={'publication_id':public['publication_id'],'publication_revision_id':public['publication_revision_id'],'expected_content_sha256':public['content_sha256']})
sem('owner publication state supplies mutation precondition token','ETag' in oas['paths']['/me/publications/{publication_id}']['get']['responses']['200']['headers'] and oas['paths']['/me/publications/{publication_id}']['get'].get('security')!=[])
sem('owner list inherits authenticated security',oas['paths']['/me/publications']['get'].get('security')!=[] and bool(oas['security']))
sem('owner history inherits authenticated security',oas['paths']['/me/publications/{publication_id}/revisions']['get'].get('security')!=[] and bool(oas['security']))
sem('owner navigation is explicitly no-store',all(oas['paths'][p]['get']['responses']['200']['headers']['Cache-Control']['schema']['const']=='no-store' for p in ['/me/publications','/me/publications/{publication_id}/revisions']))
sem('withheld owner counts are not fabricated as zero',fixtures['owned-publications.synthetic.json']['items'][1]['current_revision_upvote_count'] is None and fixtures['owned-publications.synthetic.json']['items'][1]['display_title'] is None)
# Verify all local JSON pointers and external refs in all artifacts resolve.
def pointer(doc,frag):
    cur=doc
    for part in frag.lstrip('/').split('/') if frag else []:
        part=part.replace('~1','/').replace('~0','~')
        cur=cur[int(part)] if isinstance(cur,list) else cur[part]
    return cur
def walk_refs(value,root,source_path):
    if isinstance(value,dict):
        if '$ref' in value:
            r=value['$ref']
            path,_,fragment=r.partition('#')
            if not path: pointer(root,fragment)
            elif path.startswith('./'):
                p=(source_path.parent/path).resolve()
                doc=json.loads(p.read_text()) if p.suffix=='.json' else yaml.safe_load(p.read_text())
                pointer(doc,fragment)
            elif path.startswith('https://curriculum.example.invalid/'):
                matches=[s for s in schemas.values() if s.get('$id')==path]
                if len(matches)!=1:raise ValueError('Unresolved schema ID '+path)
                pointer(matches[0],fragment)
            else:raise ValueError('Unexpected remote ref '+r)
        for v in value.values():walk_refs(v,root,source_path)
    elif isinstance(value,list):
        for v in value:walk_refs(v,root,source_path)
try:
    for name,data in schemas.items():walk_refs(data,data,CON/name)
    walk_refs(oas,oas,oas_path)
    walk_refs(companion_oas,companion_oas,companion_oas_path)
    report['semantic_checks'].append('all local and canonical JSON references resolve')
except Exception as e:
    report['errors'].append('Reference resolution: '+repr(e))
sem('mastery_gated and prerequisite audit events modeled',
    'prerequisite_override_recorded' in oas['components']['schemas']['ProgressEventRequest']['properties']['type']['enum']
    and 'unverified_prerequisite_acknowledged' in oas['components']['schemas']['ProgressEventRequest']['properties']['type']['enum'])
sem('ReviewScheduleItem modeled on Schedule','ReviewScheduleItem' in oas['components']['schemas'] and 'review_schedule_items' in oas['components']['schemas']['Schedule']['properties'])
core_ops=sum(len([m for m in methods if m in ['get','post','put','patch','delete']]) for methods in oas['paths'].values())
companion_ops=sum(len([m for m in methods if m in ['get','post','put','patch','delete']]) for methods in companion_oas['paths'].values())
sem('companion contract operations all declare unique operationIds',companion_ops>0 and len({m['operationId'] for methods in companion_oas['paths'].values() for k,m in methods.items() if k in ['get','post','put','patch','delete']})==companion_ops)
report['core_operation_count']=core_ops
report['companion_operation_count']=companion_ops
report['operation_count']=core_ops+companion_ops
report['semantic_check_count']=len(report['semantic_checks'])
report['passed']=not report['errors']
(ROOT/'docs').mkdir(exist_ok=True)
(ROOT/'docs/contract-validation-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
if report['errors']:raise SystemExit(1)
