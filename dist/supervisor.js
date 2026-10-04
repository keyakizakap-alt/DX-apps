// Deterministic supervisor: AI outputs cannot authorize tools or bypass human gates.
export function nextAction(run) {
  if (!run) return {kind:'brief',title:'記事のテーマと資料を準備',reason:'テーマ・読者・記事の目的を入力すると、制作サポートが企画から進めます。',label:'企画・取材資料を開く →'};
  if(['awaiting_metrics','completed'].includes(run.status)&&!run.approvals.publication)return {kind:'publication',title:'公開前の確認をお願いします',reason:'原稿・タイトル・投稿案・画像の権利を確認してください。確認後、入稿用ファイルを保存できます。',label:'公開前の確認へ →'};
  const map={
    running:['running','記事を作成しています','完了した作成した内容を確認できます。必要ならいつでも実行を停止できます。','作業中の工程を見る →'],
    task_completed:['continue','選択した作業が完了しました','作成した内容を確認して、次の制作工程を進められます。','制作の続きを開く →'],
    awaiting_transcript:['transcript','取材メモ・文字起こしを追加','取材の質問を準備しました。取材メモや文字起こしを貼り付けるか読み込んで、続きから再開してください。','取材資料を追加 →'],
    awaiting_review:['risk','原稿と根拠を確認','確認候補または検証できない根拠があるため停止しました。判断理由を記録すると再開します。','確認・承認画面へ →'],
    awaiting_metrics:['metrics','公開準備を確認し、実績を追加','原稿を確認し、入稿用ファイルを保存してください。記事を公開した後、PVなどの実績を追加すると振り返りを進められます。','公開後の実績を追加 →'],
    completed:['complete','作成した内容と振り返りを確認','各工程の作成した内容を確認・保存できます。公開用データの保存には承認が必要です。','作成した内容を開く →'],
    failed:['retry','停止した工程から再開','完了済みの工程は保持しています。停止理由を確認してから、未完了の工程だけ再開できます。','停止箇所を確認 →'],
    cancelled:['retry','続きを進める準備ができています','停止前に完了した作成した内容を引き継いで、続きから再開できます。','制作画面を開く →'],
    budget_exceeded:['limit','処理回数の上限に達しました','この制作での追加実行を停止しました。作成した内容を保存し、必要な範囲に絞って新しい制作を始めてください。','作成した内容を確認 →']
  };
  const [kind,title,reason,label]=map[run.status]||['brief','制作を開始・再開','資料を確認して制作サポートを動かしてください。','企画・取材資料を開く →'];
  return {kind,title,reason,label};
}
export function attentionItems(run) {
  if (!run) return [];
  const items=[];
  if(run.agents?.find(a=>a.id==='coordination')?.status==='failed')items.push({id:'coordination',title:'取材依頼メールを作り直せます',description:'他の作業は続けられます。メールが必要な場合は、取材相手・依頼メールの作業を開いて再実行してください。',action:'retry'});
  if(run.status==='awaiting_review')items.push({id:'risk',title:run.reviewScope==='public'?'タイトル・SNS文案の確認':'最終原稿と根拠の確認',description:'根拠・未確認事項を確認し、判断理由を記録してください。',action:'risk'});
  if(run.status==='awaiting_transcript')items.push({id:'transcript',title:'取材資料の追加',description:'取材メモや文字起こしを貼り付けるか読み込むと、記事の下書きを作成できます。',action:'transcript'});
  if(['awaiting_metrics','completed'].includes(run.status)&&!run.approvals.publication)items.push({id:'publication',title:'公開用データの承認',description:'原稿・タイトル・SNS案・画像の権利を確認してください。',action:'publication'});
  if(run.status==='awaiting_metrics')items.push({id:'metrics',title:'公開後の実績入力',description:'公開後に実績を追加すると振り返りを実行できます。',action:'metrics'});
  if(['failed','budget_exceeded'].includes(run.status))items.push({id:'failure',title:run.status==='failed'?'停止した工程の確認':'処理回数の上限',description:'作成した内容は保持しています。制作画面で状況を確認してください。',action:'retry'});
  return items;
}
export function attentionKey(run, item) {
  // Revision-bound: a changed article must raise a fresh intervention notification.
  return JSON.stringify([run.id,item.id,run.revision||0,item.id==='failure'?run.attempts:item.id==='risk'?run.interventionVersion||0:0]);
}
