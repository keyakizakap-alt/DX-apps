// Rehearsal-only results. No network, tools, or real publication.
export const DEMO_METRICS='【架空の公開実績・デモ用】\n対象：この記事1本、公開後7日間\nPV：3,000／問い合わせ：5件\n同じ担当者・同程度の文字数の記事で比較\n従来のリライト・校正時間：35分／今回：20分\nこれらは操作説明用の仮の数値で、実際の成果ではありません。';
const article='【架空のデモ記事】\n\n企業の業務改善を支援する株式会社ネクストワーク。継続的な改善の仕組みと、AIを使う際の確認について話を聞いた。\n\nある支援先では、月次レポートの作成時間を30%削減できたという。一部のお客様で効果を確認できました。業務の内容や運用によって結果は異なる。\n\n同社はウェブ上で作業状況を共有する。AIは報告書の下書きを作成し、担当者が内容を確認する。\n\n改善を続けるには、下書きの作成と担当者の確認を組み合わせることが大切だ。';
const title='【デモ】継続的な改善を支える仕組み';
export async function demoAgent({id,schema,signal}){
  await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,300),abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('実行を停止しました。','AbortError'));};if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
  let output;
  if(id==='research')output={summary:'【デモ】継続的な改善と担当者の確認を企画の軸にします。',themes:['改善を継続する仕組み','下書きと内容確認の役割分担'],facts:[],gaps:['数値の対象と条件は取材資料で確認する']};
  else if(['writing','rewrite'].includes(id))output={summary:'【デモ】取材の対象・条件を残した原稿です。',title,article};
  else if(['facts','style','structure','final_check'].includes(id))output={findings:id==='final_check'?[{category:'文意',severity:'check',title:'成果の対象を確認',explanation:'一部のお客様の成果であることを確認してください。デモでは取材の限定条件を残しています。',quote:'一部のお客様で効果を確認できました。',source_id:'T4',evidence:'一部のお客様で効果を確認できました。',suggestion:''}]:[]};
  else if(id==='titles')output={summary:'【デモ】取材に沿った見出し案',titles:[title,'【デモ】AIの下書きを、担当者が確認する'],headings:['継続するための仕組み','対象と条件を確認する'],tags:['業務改善','編集'],categories:['ビジネス']};
  else if(id==='social')output={summary:'【デモ】SNS投稿の下書き。投稿は行いません。',posts:[{platform:'X',text:'【デモ】改善を継続する仕組みと、担当者の確認。取材から考える。［記事URL］'},{platform:'LinkedIn',text:'【デモ】下書きと確認の役割を分け、改善を継続する仕組みを考えます。［記事URL］'}]};
  else {
    const docs={planning:['継続的な改善を伝える企画','背景、取り組み、対象と条件、今後の課題の順に構成します。','成果の対象と期間を確認する'],coordination:['取材依頼の下書き','業務改善の仕組みについて取材をお願いするメール案です。実際の送信は行いません。','取材日時・掲載許諾を確認する'],interview:['取材の質問','何を改善しましたか。効果はどの対象で確認しましたか。担当者は何を確認しますか。','対象・期間・例外を質問する'],transcript:['発言と条件の整理','取材の成果は一部の支援先に限られます。AIは下書き、内容確認は担当者が担います。','原文の条件を維持する'],visuals:['写真・画像の準備','作業状況の共有を説明する図の案です。写真の取得や画像生成は行いません。','掲載許可と代替テキストを確認する'],publishing:['入稿前のチェック','原稿、取材の根拠、見出し、写真の掲載許可を確認します。記事の公開は行いません。','確認後に入稿用ファイルを保存する'],analytics:['公開後の振り返り','【架空の公開実績】公開後7日間でPV3,000、問い合わせ5件。リライト・校正時間は35分から20分で、15分短縮（約43%）。1本の仮の実績のため、記事全体の効果や因果関係は判断しません。次は同程度の記事を5本比較し、時間と品質を記録します。','次の記事で校正時間と指摘の妥当性を測る']};
    const [summary,content,item]=docs[id]||['成果物の例','架空のデータによる操作例です。','内容を確認する'];output={summary:'【デモ】'+summary,content,items:[item]};
  }
  return {output,annotations:[],usage:{model:'demo',promptTokens:0,completionTokens:0,cost:0}};
}
