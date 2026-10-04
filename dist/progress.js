import {WORKFLOW_AGENTS} from './agents.js';
export function productionProgress(run) {
  const states=run?.agents||[],completed=states.filter(s=>s.status==='done').length;
  const groups=[...new Set(WORKFLOW_AGENTS.map(a=>a.group))];
  const stages=groups.map(group=>{
    const agents=WORKFLOW_AGENTS.filter(a=>a.group===group),items=states.filter(s=>agents.some(a=>a.id===s.id)),done=items.filter(a=>a.status==='done').length;
    let state=done===agents.length?'done':'queued',label=state==='done'?'完了':'これから';
    if(items.some(a=>a.status==='running')){state='running';label='作成中';}
    if(items.some(a=>a.status==='failed')){state='attention';label=group==='取材準備'&&items.every(a=>a.status==='done'||a.id==='coordination')?'依頼文はあとで作成':'確認が必要';}
    if(run?.status==='awaiting_transcript'&&group==='執筆'){state='waiting';label='取材資料待ち';}
    if(run?.status==='awaiting_review'&&group==='校正'){state='waiting';label='原稿の確認待ち';}
    if(['awaiting_metrics','completed'].includes(run?.status)&&!run.approvals?.publication&&group==='公開準備'){state='waiting';label='公開前の確認待ち';}
    if(run?.status==='awaiting_metrics'&&group==='振り返り'){state='waiting';label='公開後に入力';}
    return {group,firstAgent:agents[0].id,done,total:agents.length,state,label};
  });
  return {completed,total:WORKFLOW_AGENTS.length,percent:Math.round(completed/WORKFLOW_AGENTS.length*100),stages};
}
