const aliases={research:['調査','リサーチ','検索','調べる','調べて','情報収集','業界'],planning:['企画','企画案','構成案','テーマ'],coordination:['取材相手','専門家','識者','依頼','メール','日程'],interview:['取材準備','取材設計','質問','インタビュー'],transcript:['文字起こし','取材素材','発言整理'],writing:['執筆','初稿','記事を書く','記事を書いて','文章を書く'],facts:['事実','引用','数値','ファクトチェック'],style:['表記','誤字','校正'],structure:['構成','読みやすさ'],rewrite:['修正稿','リライト','書き直し'],final_check:['最終確認','根拠照合','最終チェック'],titles:['タイトル','見出し','タグ','分類'],visuals:['画像','写真','サムネイル'],publishing:['入稿','公開準備','wordpress'],social:['sns','投稿案','x向け','linkedin'],archive:['制作資料','資料をまとめる','アーカイブ','制作記録','成果物をまとめる'],analytics:['振り返り','分析','実績','pv']};
const normal=s=>String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,'').trim();
export function findTasks(query,agents){
  const q=normal(query);if(!q)return agents;
  return agents.map(a=>{const words=[a.name.replace('エージェント',''),...(aliases[a.id]||[])].map(normal);let score=0;for(const word of words)if(q.includes(word)||(q.length>=2&&word.includes(q)))score=Math.max(score,a.id==='research'&&['調べる','調べて','検索'].includes(word)?2:word.length+10);if(!score&&normal(a.description+a.group).includes(q))score=1;return {a,score};}).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).map(r=>r.a);
}
export function isProductionRequest(query){return /記事.*制作.*(始め|開始)|制作.*(始め|開始|再開)|続き.*(進め|再開)|最初から/.test(normal(query));}
export const TASK_GROUPS=[['research'],['planning'],['coordination','interview'],['transcript'],['writing'],['facts','style','structure'],['rewrite'],['final_check'],['titles','visuals'],['publishing','social'],['archive'],['analytics']];
export function taskPlan(target){
  if(target==='all')return TASK_GROUPS.flat();const index=TASK_GROUPS.findIndex(g=>g.includes(target));if(index<0)throw new Error('この作業は実行できません。');return TASK_GROUPS.slice(0,index+1).flat().filter(id=>!['coordination','interview'].includes(target)||!['coordination','interview'].includes(id)||id===target);
}
