import { callAgent,modelFor } from './provider.js';
import { segments,validateAIFindings } from './engine.js';
import { audit,digest } from './security.js';
import {EDITORIAL_PROTOCOL,editorialChecks,validateCategories} from './editorial.js';
import {taskPlan} from './tasks.js';
const str={type:'string'};
const arr=items=>({type:'array',items,maxItems:40});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const documentSchema=obj({summary:str,content:str,items:arr(str)});
const articleSchema=obj({summary:str,title:str,article:str});
export const reviewSchema=obj({findings:arr(obj({category:{type:'string',enum:['引用','数値','表記','文意','構成','文体']},severity:{type:'string',enum:['check','style']},title:str,explanation:str,quote:str,source_id:str,evidence:str,suggestion:str}))});
const researchSchema=obj({summary:str,themes:arr(str),facts:arr(obj({claim:str,source_id:str,evidence:str})),gaps:arr(str)});
const titlesSchema=obj({summary:str,titles:arr(str),headings:arr(str),tags:arr(str),categories:arr(str)});
const socialSchema=obj({summary:str,posts:arr(obj({platform:str,text:str}))});
const evidenceInstruction='根拠は入力されたTまたはRのsource_idのみ。quoteは原稿の連続文字列を完全一致で抜き出し、evidenceはそのIDの資料の連続文字列を完全一致で抜き出す。suggestionはquote全体を置き換える文章、判断できない場合は空文字。根拠のない指摘は出さず0件でもよい。最大10件。';
export const REVIEW_AGENTS=[
  {id:'facts',name:'事実・引用エージェント',short:'事実・引用',role:'review',instruction:'取材の発言、数値、固有名詞、対象範囲、条件、断定の強さを専門に確認する。カテゴリーは引用・数値・文意を使用する。'+evidenceInstruction},
  {id:'style',name:'表記・校正エージェント',short:'表記・校正',role:'review',instruction:'入力された編集ルールに沿って表記、文体、誤記を確認する。存在しないルールを追加しない。カテゴリーは表記・文体を使用する。'+evidenceInstruction},
  {id:'structure',name:'構成エージェント',short:'構成',role:'review',instruction:'記事の目的、読者、構成について、入力された編集ルールに反する箇所を確認する。カテゴリーは構成・文意を使用する。好みだけの修正はしない。'+evidenceInstruction}
];
export const WORKFLOW_AGENTS=[
  {id:'research',name:'調査・企画テーマ',role:'research',group:'企画',description:'資料と公開情報を整理し、企画の切り口を提案',schema:researchSchema,instruction:'企画テーマの調査担当。読者と目的に沿う切り口を3つまで提案。factsは入力された資料のIDと完全一致のevidenceで裏づける。ウェブ検索を利用した場合source_idは取得結果のURLとする。根拠がない主張はfactsに入れずgapsに確認事項を入れる。自社資料と業界情報を区別する。'},
  {id:'planning',name:'企画・構成',role:'generation',group:'企画',description:'企画会議用の提案と記事構成を作成',schema:documentSchema,instruction:'調査資料に基づき記事の切り口、読者の課題、構成、必要な取材、企画会議の判断項目を作成。会議を実施したとは書かない。'},
  {id:'coordination',name:'識者・依頼調整',role:'generation',group:'取材準備',description:'必要な識者像と依頼メールの下書きを作成',schema:documentSchema,instruction:'取材に必要な識者・ライター・企業の選定条件と依頼メールの下書き、日程確認事項を作成。実在の連絡先を捏造しない。メールは送信されず下書きであると示す。'},
  {id:'interview',name:'取材設計',role:'generation',group:'取材準備',description:'質問と当日の確認事項を準備',schema:documentSchema,instruction:'企画を深める取材質問、数字の定義・対象範囲・例外・掲載許諾の確認項目、取材者用のメモ欄を用意する。取材の実施は人が行う。'},
  {id:'transcript',name:'取材素材の整理',role:'generation',group:'執筆',description:'文字起こしから発言・数値・要確認事項を整理',schema:documentSchema,instruction:'文字起こしの話者、数値、条件、固有名詞、主要な発言を整理する。引用はTのIDと原文を保持する。曖昧な固有名詞は勝手に直さず要確認。録音の文字起こし自体は利用者が提供したもの。'},
  {id:'writing',name:'初稿執筆',role:'generation',group:'執筆',description:'構成と取材資料から初稿を作成',schema:articleSchema,instruction:'企画構成と取材資料に沿った記事の初稿を日本語で作成。引用は原文と意図を保つ。取材にない発言・成果・人名を追加しない。不明な事項は［要確認：内容］とする。指定文字数を目安にし、titleとarticleを返す。'},
  ...REVIEW_AGENTS.map(a=>({...a,group:'校正',description:a.id==='facts'?'取材発言・数値・断定のずれを検出':a.id==='style'?'媒体ルールと表記を照合':'読者・目的と文章の構成を照合',schema:reviewSchema})),
  {id:'rewrite',name:'リライト',role:'generation',group:'校正',description:'根拠を検証できた指摘から修正稿を作成',schema:articleSchema,instruction:'検証済みの指摘をもとに記事全体の修正案を作成。取材根拠を超える断定を避け、根拠を確認できない事項は［要確認］を残す。提案段階であり外部校正者の承認済みとは書かない。'},
  {id:'final_check',name:'最終の根拠照合',role:'review',group:'校正',description:'リライト後の原稿をもう一度照合',schema:reviewSchema,instruction:'リライト後の原稿を取材発言・数字・条件・媒体ルールと照合。公開前の確認候補を列挙する。'+evidenceInstruction},
  {id:'titles',name:'タイトル・見出し',role:'generation',group:'公開準備',description:'タイトル・見出し・タグ候補を提案',schema:titlesSchema,instruction:'原稿の根拠の範囲で、誇張しないタイトル候補3件、見出し、タグ・カテゴリの候補を作成。原稿や取材にない成果をタイトルに追加しない。'},
  {id:'visuals',name:'画像準備',role:'generation',group:'公開準備',description:'写真選定の条件・加工指示・代替テキストを提案',schema:documentSchema,instruction:'原稿に合う写真選定条件、素材を探すキーワード、掲載許諾の確認、トリミング・サイズの指示、画像が用意された際の代替テキストの案を作成。画像そのものは生成・取得・加工していないことを明示する。'},
  {id:'publishing',name:'入稿準備',role:'generation',group:'公開準備',description:'WordPress用の概要と公開前チェックを作成',schema:documentSchema,instruction:'原稿の概要、抜粋、タグ・カテゴリ設定の候補、引用・権利・未確認事項の公開前チェックリストを作成。WordPressへの登録や公開はしていない。'},
  {id:'social',name:'SNS展開',role:'generation',group:'公開準備',description:'X・LinkedIn向け投稿の下書きを作成',schema:socialSchema,instruction:'取材根拠の範囲でX、LinkedIn、Instagram、YouTube向けの投稿案を作成。Instagramはキャプション、YouTubeは「タイトル：」「概要欄：」で分けた動画紹介の文案をtextに記載する。InstagramとYouTubeは500文字以内。画像・動画の制作やアップロードを行ったとは書かない。Xは本文と［記事URL］込みで140文字以内。URLが未確定なら［記事URL］とする。投稿予約や実際の投稿は行っていない。'},
  {id:'archive',name:'アーカイブ',role:'local',group:'振り返り',description:'素材・原稿・指摘・成果物をひとつに整理'},
  {id:'analytics',name:'分析・振り返り',role:'generation',group:'振り返り',description:'実績数値から改善案を作成',schema:documentSchema,instruction:'入力された公開後のPV、問い合わせ、制作時間などの実績だけを分析し、改善仮説と次の実験を提案。実績がない値や因果関係を捏造しない。削減率は前後の実測がある場合に限る。'}
];
for(const agent of WORKFLOW_AGENTS)if(agent.instruction)agent.instruction+='\n'+EDITORIAL_PROTOCOL;
WORKFLOW_AGENTS.find(a=>a.id==='interview').instruction+='\n過去記事と同じ説明を繰り返さず、今回新しく確認することを質問にする。効果の分母・期間・費用・導入前後・例外と、企業の主張を検証できる資料を質問する。';
WORKFLOW_AGENTS.find(a=>a.id==='planning').instruction+='\n参考記事が選択されている場合、既存の切り口と今回取材すべき新しい疑問を分けて示す。宣伝、解説、インタビュー、体験、告知のどれに近い企画かを提案し、媒体の掲載区分は人が判断する。';
WORKFLOW_AGENTS.find(a=>a.id==='writing').instruction+='\n媒体に合う場合は冒頭に根拠のある要点を2〜3項目まとめ、背景から取材による説明へつなぐ。参考記事の広告コード・目次の重複・写真キャプションを本文に混ぜない。';
WORKFLOW_AGENTS.find(a=>a.id==='titles').instruction+='\neditorialContext.categoryNamesがある場合、カテゴリはそこにある名称だけを選ぶ。根拠のない期待感や不安をあおる言い回しは避け、今回の原稿の問いと答えを伝える。';

export function mergeReviewResults(results) {
  const findings=[],seen=new Set();let rejected=0;
  for(const {id,result} of results){
    rejected+=result.rejected;
    for(const finding of result.findings){
      const signature=finding.quote+'|'+finding.category+'|'+finding.suggestion;
      if(seen.has(signature))continue;seen.add(signature);
      findings.push({...finding,id:`${id}-${findings.length}`,agent:id});
    }
  }
  return {findings,rejected};
}

export async function runReviewTeam({draft,transcript,rules,signal,onStatus=()=>{}}) {
  const results=await Promise.allSettled(REVIEW_AGENTS.map(async agent=>{
    onStatus(agent.id,'running');
    try{
      const response=await callAgent({id:agent.id,role:agent.role,instruction:agent.instruction,input:{draft,transcript:segments(transcript),rules:segments(rules,'R')},schema:reviewSchema,signal});
      const result=validateAIFindings(response.output.findings,draft,transcript,rules);
      onStatus(agent.id,'done');return {id:agent.id,result,usage:response.usage};
    }catch(e){onStatus(agent.id,e.name==='AbortError'?'cancelled':'failed',e.message);throw e;}
  }));
  const succeeded=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  const failures=results.filter(r=>r.status==='rejected').map(r=>r.reason.message);
  if(!succeeded.length)throw new Error(failures[0]||'レビューを完了できませんでした。');
  return {...mergeReviewResults(succeeded),failures,usage:succeeded.map(r=>r.usage)};
}

export const MAX_WORKFLOW_CALLS=48;
export function createRun(input) {
  return {version:3,revision:0,id:`run-${Date.now()}`,input:{...input},createdAt:new Date().toISOString(),status:'ready',agents:WORKFLOW_AGENTS.map(a=>({id:a.id,status:'queued',output:null,error:'',durationMs:0,usage:null,annotations:[]})),reviewFindings:[],rejected:0,audit:[],approvals:{},attempts:0,usageRecords:[]};
}
export function agentState(run,id){return run.agents.find(a=>a.id===id);}
export function exportRun(run){return JSON.parse(JSON.stringify(run));}
export async function artifactDigest(run){return digest({article:agentState(run,'rewrite').output,titles:agentState(run,'titles').output,social:agentState(run,'social').output,publishing:agentState(run,'publishing').output});}
async function riskDigest(run){return digest({article:agentState(run,'rewrite').output,titles:agentState(run,'titles').output,social:agentState(run,'social').output});}
export async function approveRisk(run,reason){
  if(run.status!=='awaiting_review'||typeof reason!=='string'||reason.trim().length<10)throw new Error('確認した内容と再開する理由を10文字以上で記録してください。');
  const publicReview=run.reviewScope==='public',hash=publicReview?await riskDigest(run):await digest(agentState(run,'rewrite').output);
  run.approvals[publicReview?'publicRisk':'risk']={time:new Date().toISOString(),reason:reason.trim(),hash};await audit(run,'supervisor_risk_approved',{artifactHash:hash,scope:run.reviewScope||'draft',reason:reason.trim()});
}
export async function approvePublication(run,reason){
  if(!['awaiting_metrics','completed'].includes(run.status)||typeof reason!=='string'||reason.trim().length<10)throw new Error('制作完了後、確認内容を10文字以上で記録してください。');
  const hash=await artifactDigest(run);run.approvals.publication={time:new Date().toISOString(),reason:reason.trim(),hash};await audit(run,'publication_package_approved',{artifactHash:hash,reason:reason.trim()});
}
export async function publicationApproved(run){return !!run.approvals.publication&&run.approvals.publication.hash===await artifactDigest(run);}
export async function applyEditorialRevision(run,article){
  const rewrite=agentState(run,'rewrite');
  if(!rewrite.output||rewrite.output.article===article)return;
  rewrite.output={...rewrite.output,article};run.revision=(run.revision||0)+1;run.approvals={};run.finalFindings=[];run.status='ready';
  // Old final-check rejections belong to the previous article revision.
  run.rejected=['facts','style','structure'].reduce((sum,id)=>sum+(agentState(run,id).validated?.rejected||0),0);
  for(const id of ['final_check','titles','visuals','publishing','social','archive','analytics']){
    const state=agentState(run,id);state.status='queued';state.output=null;state.error='';state.usage=null;state.validated=null;
  }
  await audit(run,'editorial_revision_applied',{outputHash:await digest(rewrite.output),approvalsInvalidated:true});
}
export function makeWordPressHTML(title,article) {
  const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<!-- WordPress下書き用。公開前に編集者が最終確認してください。 -->\n<h1>${escape(title)}</h1>\n`+article.split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${escape(p).replace(/\n/g,'<br>')}</p>`).join('\n');
}
export async function runWorkflow(run,{signal,onUpdate=()=>{},target='all',executeAgent=callAgent}={}) {
  taskPlan(target);run.requestedTask=target;
  const reached=group=>{if(target==='all'||!group.includes(target))return false;run.status='task_completed';onUpdate(run);return true;};
  const context=()=>{
    const draft=agentState(run,'rewrite').output?.article||agentState(run,'writing').output?.article||run.input.draft||'';
    const rules=[run.input.rules,`読者：${run.input.audience}`,`目的：${run.input.goal}`].filter(Boolean).join('\n');
    return {topic:run.input.topic,audience:run.input.audience,goal:run.input.goal,targetLength:run.input.targetLength,media:run.input.media,draft,transcript:segments(run.input.transcript),rules:segments(rules,'R'),sourceMaterial:segments(run.input.sources,'S'),editorialContext:run.input.editorialContext,artifacts:Object.fromEntries(run.agents.filter(s=>s.status==='done'&&s.id!=='archive').map(s=>[s.id,s.output])),verifiedFindings:run.reviewFindings,metrics:run.input.metrics};
  };
  const stage=async id=>{
    const state=agentState(run,id),agent=WORKFLOW_AGENTS.find(a=>a.id===id);
    if(state.status==='done')return;
    if(signal?.aborted){const error=new Error('実行を停止しました。');error.name='AbortError';throw error;}
    state.status='running';state.error='';state.model=run.demo?'demo':modelFor(agent.role);await audit(run,'agent_started',{agent:id,model:state.model});onUpdate(run);
    const started=Date.now();
    try{
      if(id==='archive'){
        const title=agentState(run,'rewrite').output?.title||agentState(run,'writing').output?.title||run.input.topic;
        const article=context().draft;
        state.output={summary:'取材資料・原稿・校正結果をまとめました。',content:makeWordPressHTML(title,article),items:['「制作記録を保存」で、成果物をまとめて保存できます。','担当者が写真の掲載許可と原稿の内容を確認し、公開してください。']};
      }else{
        let payload=context();
        if(id==='research')payload={topic:run.input.topic,audience:run.input.audience,goal:run.input.goal,sourceMaterial:segments(run.input.sources,'S'),editorialContext:run.input.editorialContext,webSearchEnabled:run.input.webSearch};
        if(run.attempts>=MAX_WORKFLOW_CALLS){const error=new Error('この制作のAI処理は48回を上限に停止しました。成果物を保存し、制作の範囲を見直してください。');error.name='ExecutionLimitError';throw error;}
        run.attempts++;const response=await executeAgent({id,role:agent.role,instruction:agent.instruction,input:payload,schema:agent.schema,signal,web:id==='research'&&run.input.webSearch,maxTokens:['writing','rewrite'].includes(id)?8000:4000});
        run.usageRecords.push({agent:id,time:new Date().toISOString(),...response.usage});
        state.output=response.output;state.annotations=response.annotations;state.usage=response.usage;
        if(id==='titles'){
          const result=validateCategories(state.output.categories,run.input.editorialContext?.categoryNames);
          state.output.categories=result.categories;
          if(result.removed.length){state.output.summary+=' 分類マスターにない候補は除外しました。';state.categoryRejections=result.removed.length;}
        }
        if(id==='research'){
          const sourceMaterial=segments(run.input.sources,'S');
          const all=response.output.facts;
          state.output.facts=all.filter(f=>{
            const source=sourceMaterial.find(s=>s.id===f.source_id);
            if(source)return !!f.evidence&&source.text.includes(f.evidence);
            const citation=response.annotations.find(a=>a.url===f.source_id);
            return !!citation?.content&&!!f.evidence&&citation.content.includes(f.evidence);
          });
          const removed=all.length-state.output.facts.length;
          if(removed)state.output.gaps.push(`${removed}件の主張は引用元を検証できなかったため除外。公開情報のリンクも原文確認が必要。`);
        }
        if(['facts','style','structure','final_check'].includes(id)){
          const rules=payload.rules.map(r=>r.text).join('\n');
          const validated=validateAIFindings(state.output.findings,payload.draft,run.input.transcript,rules);
          state.validated=validated;
          run.rejected+=validated.rejected;
          state.output={...state.output,findings:validated.findings};
          if(id==='final_check')run.finalFindings=validated.findings.map((f,i)=>({...f,id:`final-${i}`,agent:'final_check'}));
        }
      }
      state.status='done';state.durationMs=Date.now()-started;await audit(run,'agent_completed',{agent:id,outputHash:await digest(state.output),durationMs:state.durationMs});onUpdate(run);
    }catch(e){state.status=e.name==='AbortError'?'cancelled':'failed';state.error=e.message;state.durationMs=Date.now()-started;await audit(run,'agent_interrupted',{agent:id,status:state.status});onUpdate(run);throw e;}
  };
  const group=async ids=>{
    const results=await Promise.allSettled(ids.map(stage));
    const error=results.find(r=>r.status==='rejected');if(error)throw error.reason;
  };
  run.status='running';onUpdate(run);
  try{
    await stage('research');if(reached(['research']))return run;
    await stage('planning');if(reached(['planning']))return run;
    await group(['coordination','interview']);if(reached(['coordination','interview']))return run;
    if(!run.input.transcript.trim()){
      agentState(run,'transcript').status='awaiting';run.status='awaiting_transcript';onUpdate(run);return run;
    }
    await stage('transcript');if(reached(['transcript']))return run;
    await stage('writing');if(reached(['writing']))return run;
    await group(['facts','style','structure']);
    const merged=mergeReviewResults(['facts','style','structure'].map(id=>({id,result:agentState(run,id).validated||{findings:[],rejected:0}})));
    run.reviewFindings=merged.findings;
    if(reached(['facts','style','structure']))return run;
    await stage('rewrite');if(reached(['rewrite']))return run;
    await stage('final_check');
    const revision=agentState(run,'rewrite').output;
    run.editorialChecks=editorialChecks(revision.article,run.input.sources,run.input.transcript);
    const risky=run.rejected>0||(run.finalFindings||[]).length>0||run.editorialChecks.length>0||/［要確認|\[要確認/.test(revision.article);
    const riskHash=await digest(revision);
    if(risky&&run.approvals.risk?.hash!==riskHash){
      run.reviewScope='draft';if(run.interventionHash!==riskHash){run.interventionHash=riskHash;run.interventionVersion=(run.interventionVersion||0)+1;}
      run.status='awaiting_review';await audit(run,'supervisor_required',{rejected:run.rejected,findings:run.finalFindings?.length||0,artifactHash:riskHash});onUpdate(run);return run;
    }
    if(reached(['final_check']))return run;
    await group(['titles','visuals']);
    if(!['titles','visuals'].includes(target))await group(['publishing','social']);
    const publicText=[...(agentState(run,'titles').output?.titles||[]),...(agentState(run,'social').output?.posts||[]).map(p=>p.text)].join('\n');
    const publicChecks=editorialChecks(publicText,run.input.sources,run.input.transcript);
    run.editorialChecks=[...run.editorialChecks,...publicChecks.map(c=>({...c,title:'タイトル・SNS：'+c.title}))];
    const publicHash=await riskDigest(run);
    if(publicChecks.length&&run.approvals.publicRisk?.hash!==publicHash){run.reviewScope='public';if(run.interventionHash!==publicHash){run.interventionHash=publicHash;run.interventionVersion=(run.interventionVersion||0)+1;}run.status='awaiting_review';await audit(run,'supervisor_required',{publicChecks:publicChecks.length,artifactHash:publicHash});onUpdate(run);return run;}
    if(reached(['titles','visuals','publishing','social']))return run;
    await stage('archive');
    if(reached(['archive']))return run;
    if(!run.input.metrics.trim()){
      agentState(run,'analytics').status='awaiting';run.status='awaiting_metrics';onUpdate(run);return run;
    }
    await stage('analytics');run.status='completed';onUpdate(run);return run;
  }catch(e){run.status=e.name==='AbortError'?'cancelled':e.name==='ExecutionLimitError'?'budget_exceeded':'failed';run.error=e.message;onUpdate(run);return run;}
}
