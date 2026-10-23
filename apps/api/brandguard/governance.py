"""Scoped review queues and governance counts from actual human decisions."""
from collections import defaultdict
from typing import Literal
from fastapi import APIRouter,Depends,Query
from sqlalchemy import select,func,or_
from sqlalchemy.orm import Session
from .core import db,identity,manager,Problem
from .models import (ContentItem,ContentRevision,ReviewRun,Finding,FindingResolution,SourceVersion,AuditEvent)
from .review import brand_for,revision_for,audit,approval_is_stale
from .schemas import (ContentPageOut,ContentSummaryOut,AmbiguityInput,AmbiguityOut,InsightsOut)

router=APIRouter(prefix='/api/v1')


@router.get('/content',response_model=ContentPageOut)
def content_queue(member=Depends(identity),session:Session=Depends(db),limit:int=Query(20,ge=1,le=50),
                  offset:int=Query(0,ge=0,le=10000),
                  q:str=Query('',max_length=200),
                  state:Literal['draft','analysing','needs_changes','ready_for_review','incomplete','in_review','approved','changes_requested']|None=None):
    conditions=[ContentItem.org_id==member.org_id]
    if member.role!='manager':
        conditions.append(or_(ContentItem.creator_id==member.id,ContentItem.reviewer_id==member.id))
    if state:conditions.append(ContentItem.state==state)
    search=q.strip()
    if search:
        # Treat user-entered SQL LIKE wildcards as literal characters.
        pattern='%' + search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
        conditions.append(or_(ContentItem.title.ilike(pattern,escape='\\'),ContentItem.id.ilike(pattern,escape='\\')))
    total=session.scalar(select(func.count()).select_from(ContentItem).where(*conditions))
    items=list(session.scalars(select(ContentItem).where(*conditions).order_by(
        ContentItem.created_at.desc(),ContentItem.id.desc()).limit(limit).offset(offset)))
    return ContentPageOut(items=[ContentSummaryOut(id=i.id,brand_id=i.brand_id,title=i.title,
        creator_id=i.creator_id,reviewer_id=i.reviewer_id,state=i.state,current_revision=i.current_revision,
        workflow_version=i.workflow_version,approval_stale=approval_is_stale(session,i),created_at=i.created_at)
        for i in items],total=total,limit=limit,offset=offset)


@router.post('/sources/{source_id}/ambiguity-reports',status_code=201,response_model=AmbiguityOut)
def report_ambiguity(source_id:str,body:AmbiguityInput,member=Depends(identity),session:Session=Depends(db)):
    source=session.scalar(select(SourceVersion).where(SourceVersion.id==source_id,SourceVersion.org_id==member.org_id))
    if source is None:raise Problem(404,'not_found','Source not found.')
    if body.rule_id is not None and body.rule_id not in {r['id'] for r in source.rules}:
        raise Problem(422,'invalid_rule','Choose a rule from this source version.')
    if body.revision_id:
        revision,item=revision_for(session,member,body.revision_id)
        if item.brand_id!=source.brand_id:
            raise Problem(422,'invalid_context','The revision and source must belong to the same brand.')
    # Reported ambiguity is feedback, not a verified guideline defect or finding dismissal.
    event=audit(session,member,'source.ambiguity_reported',source.id,rule_id=body.rule_id,
        revision_id=body.revision_id,rationale=body.rationale)
    session.flush()
    result=AmbiguityOut(id=event.id,source_id=source.id,actor_id=member.id,rule_id=body.rule_id,
        revision_id=body.revision_id,rationale=body.rationale,created_at=event.created_at)
    session.commit()
    return result


@router.get('/brands/{brand_id}/insights',response_model=InsightsOut)
def brand_insights(brand_id:str,member=Depends(manager),session:Session=Depends(db)):
    brand_for(session,member,brand_id)
    denominator=session.scalar(select(func.count(func.distinct(ContentRevision.item_id))).select_from(ReviewRun).join(
        ContentRevision,ReviewRun.revision_id==ContentRevision.id).join(ContentItem,ContentRevision.item_id==ContentItem.id).where(
        ReviewRun.org_id==member.org_id,ContentItem.org_id==member.org_id,ContentItem.brand_id==brand_id,
        ReviewRun.status.in_(('complete','incomplete','failed'))))
    rows=session.execute(select(FindingResolution,Finding,ContentRevision.item_id,SourceVersion.source_key).join(
        Finding,FindingResolution.finding_id==Finding.id).join(ContentRevision,Finding.revision_id==ContentRevision.id).join(
        ContentItem,ContentRevision.item_id==ContentItem.id).join(SourceVersion,Finding.source_version_id==SourceVersion.id).where(
        FindingResolution.org_id==member.org_id,ContentItem.org_id==member.org_id,ContentItem.brand_id==brand_id,
        FindingResolution.action.in_(('confirm','dismiss','grant_exception','reject_exception'))).order_by(
        FindingResolution.created_at,FindingResolution.id)).all()
    # One latest human disposition per content item + stable source/rule/category across reanalysis.
    latest={}
    for entry,finding,item_id,source_key in rows:
        latest[(item_id,source_key,finding.rule_id,finding.category)]=entry.action
    grouped=defaultdict(lambda:dict(confirmed_items=0,dismissed_items=0,exception_items=0))
    columns={'confirm':'confirmed_items','dismiss':'dismissed_items','grant_exception':'exception_items'}
    for (_,key,rule,category),action in latest.items():
        if action in columns:grouped[(key,rule,category)][columns[action]]+=1
    rules=[dict(source_key=key,rule_id=rule,category=cat,**counts,
                confirmed_per_reviewed_item=counts['confirmed_items']/denominator if denominator else None)
           for (key,rule,cat),counts in sorted(grouped.items())]
    events=session.scalars(select(AuditEvent).join(SourceVersion,AuditEvent.object_id==SourceVersion.id).where(
        AuditEvent.org_id==member.org_id,AuditEvent.action=='source.ambiguity_reported',
        SourceVersion.org_id==member.org_id,SourceVersion.brand_id==brand_id))
    unique_reports={(e.actor_id,e.object_id,e.details.get('rule_id'),e.details.get('revision_id')) for e in events}
    return InsightsOut(brand_id=brand_id,reviewed_items_denominator=denominator,
        denominator_definition='Distinct content items with at least one terminal analysis; includes incomplete analyses.',
        confirmed_total=sum(r['confirmed_items'] for r in rules),dismissed_total=sum(r['dismissed_items'] for r in rules),
        exception_total=sum(r['exception_items'] for r in rules),ambiguous_total=len(unique_reports),rules=rules,
        ambiguity_definition='Distinct reporter/source-version/rule/revision reports; feedback, not proven defects.')
