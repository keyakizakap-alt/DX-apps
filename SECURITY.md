# Security and information handling

## Trust boundaries

On Vercel, `api/index.mjs` uses `server/vercel-handler.mjs` to provide intentional public access without a login, password, or authentication cookie. This adapter replaces caller-supplied Sites identity headers with one shared public identity; this is compatibility context for the Worker, not authenticated visitor identity. Only configured HTTPS deployment origins are accepted, and state-changing requests must have a matching Origin. API keys are exclusively operator-managed secrets (`OPENROUTER_API_KEY`), never client code or source files. The client has no key input or key override capability. Incoming `X-OpenRouter-Key` headers are rejected. The status API exposes only whether the server is configured, not its key. Anonymous callers can incur charges on the operator account. Configure provider-side spending caps and platform access/rate restrictions. The Worker provides a shared per-instance maximum of 3 active calls and 60 calls/minute, not a global spending limit or user identity management. User materials are kept in request memory and the individual browser; there is no shared data listing or persistence.

Sites dispatch authenticates the visitor and supplies `oai-authenticated-user-id` and `oai-authenticated-user-email`. The Worker also requires the email to be in `ALLOWED_USER_EMAILS`. Do not deploy this Worker on a public origin that permits callers to supply those headers directly. Preserve the owner-private Sites audience. The development server supplies a synthetic identity and binds only to loopback; never expose it to the internet.

All materials and generated output are untrusted. The API accepts only a fixed agent ID, allowlisted model, data object, and search boolean. System instructions and schemas are pinned server-side. The model has no mail, publishing, filesystem, GitHub, shell, or arbitrary HTTP tools. Web search is explicit, research-only, and restricted to public material.

## Enforced controls

- Private Sites identity and owner allowlist; intentional public access on Vercel; same-origin POST; JSON only; no cross-origin CORS.
- CSP allows scripts/styles/connections only from the same origin; no inline script or third-party font loading. Output is HTML-escaped, including WordPress exports.
- Maximum request 750 kB and upstream response 1.5 MB; bounded streaming reads; 3 concurrent calls and 60 calls/minute per identity per Worker instance; 100-second upstream timeout.
- No API key in model input, artifacts, source, or application logs. Only the operator-managed server secret is used. Client-supplied keys are rejected.
- Missing consent, restricted classification, internal web search, internal unmasked input, credential-like material, and secret-like model output are denied.
- No-training and ZDR routing requirements; no relaxation after provider failure.
- Literal citation and source-ID checks; output schema validation; supervisor intervention for unverifiable findings and unconfirmed claims.
- Publication package approval is bound to artifact hashes. No connected external publication capability exists.
- No material stored in server persistence, cookies, localStorage or IndexedDB. Cache-Control no-store, including Vercel/CDN cache headers. Explicit downloads are the user's responsibility.

## Residual risks and operational requirements

Prompt injection cannot be eliminated by a prompt. The containment boundary is the absence of privileged model tools and the server's fixed egress/capability policy. Citation existence is not proof of truth. PII detectors do not cover all names, addresses, or contextual identifiers; custom redaction and human source review remain mandatory. Network and platform administrators may operate infrastructure logs outside this application's control.

The in-memory audit chain detects modification to a saved chain unless the entire chain is regenerated; it is not an independently signed or durable audit record. Multi-user enterprise deployment requires durable append-only audit storage and organization membership management. Per-instance throttling is not a global spending limit. Use restricted OpenRouter keys and configure a financial cap. Verify OpenRouter, upstream providers, optional search, and hosting data-processing terms, location, and retention before live confidential material is used.

## Secrets and incident handling

Configure `OPENROUTER_API_KEY` as a hosting secret, not as a source file. No Vercel access password or session signing secret is required. Restrict models with `ALLOWED_MODELS`. Rotate exposed keys immediately in OpenRouter, remove server/session credentials, inspect account usage, and review access. Do not put sensitive data into GitHub issues. Contact the repository owner privately for incident reports; no external security report is sent automatically by this application.

## Required verification before changes

Run security and agent-state regression tests. Check anonymous/cross-origin rejection, source bounds, restricted-data denial, masking, abort/retry, model allowlist, HTML escaping, approval invalidation, and secret absence from the built client. Do not weaken routing controls to make an unsupported provider appear to work.


### 通知・新しいワークスペース機能

- ブラウザ通知は明示的な操作と権限許可の後に有効化します。OSへの通知本文は固定の確認依頼文のみ。原稿、個人名、資料、モデル出力、認証情報を含めません。
- 通知・予定日・編集メモ・検索文字列はページ内メモリのみ。外部通知サービスには接続せず、編集メモや予定日をAIに送信しません。消去操作でメモと通知記録を削除し、アプリが保持するブラウザ通知を閉じます。
- 通知クリックや制作ナビは確認画面へ案内するだけで、承認や実行を代行しません。機密区分・送信同意・原稿改訂時の承認失効・公開用データの承認要件を保持します。
- 48回の制作上限はクライアント側のループ制御です。悪意あるクライアントによるAPI直接呼び出しの課金制限ではありません。通知停止はAI送信の停止ではありません。
- 自動保存やサーバー上の制作キューを設けていないため、ページを閉じた後の通知・実行はできません。バックグラウンド通知を追加する際は、宛先の所有確認、アクセス制御、秘密情報の保管、保持期間、重複送信防止を別途設計する必要があります。


### ローカルのファイル取り込み

- Word（.docx）・テキスト・CSVはブラウザ内で処理します。変換サービスへの送信、サーバーへのファイル保存、ファイルの命令・マクロの実行をしません。読み込み操作はAI実行や送信同意を発生させません。
- 500KBの圧縮前入力上限、各欄の文字数、企画全体80,000文字を適用します。WordではZIPの境界・形式・エントリ数、展開後のXML最大1MBを確認し、暗号化・未対応圧縮・DOCTYPE/ENTITY・不正なXMLを拒否します。本文以外のZIPエントリを展開せず、外部リンクを取得しません。
- 企画ファイルの読み込みは型・長さ・許可項目を検証します。__proto__・承認情報・同意・モデル・機密区分の追加を拒否します。ファイルの内容を承認済みの制作状態として復元せず、既存の成果物と入力が変わった場合は従来の再作成確認と承認失効の処理を維持します。
- 検索の料金表示を利用画面から削除していますが、費用や検索範囲、公開情報に限る送信制限を変更していません。資料の送信先・個人情報の取り扱い・同意の説明は維持しています。
- クリップボード読み取りは利用者が「貼り付け」を押したときだけ実行し、許可されない場合は標準の貼り付けに案内します。コピー・保存は利用者の操作による元資料の書き出しです。

### ローカルの記事ライブラリ

記事本文・CSV・索引はページのメモリだけに保持し、サーバー保存、ブラウザ永続保存、ログ、公開リポジトリへの同梱を行わない。読み込みは外部通信を開始しない。ファイルの形式、件数、サイズ、各項目の文字数、認証情報を検査し、JSONの承認・同意・モデル設定などは取り込まない。広告コードは文字列として除去し、表示は常にエスケープする。URLは資格情報のないHTTPSのみ保持し、取得は行わない。

選択した最大3記事のメタデータ・冒頭各600文字と分類名称だけを、同じ機密区分・個人情報のマスキング・送信同意の対象にして制作へ渡す。参考記事はS/T/Rの検証用出典へ追加しない。取材根拠として過去記事のIDや文言を返した指摘は既存の出典検証で除外する。本文未登録・公開日未確認は明示する。消去時にライブラリと参考記事選択も破棄する。利用者が明示的に保存した記事資料には本文が含まれるため、そのファイルは利用者が適切に管理する。

原稿、タイトル・SNSの追加確認は個別の成果物ハッシュに結び付く。タイトル/SNSの新しい介入にも通知を出す。数値照合は局所的な文字列検査であり、意味や情報の最新性、すべての主張の正確性を保証しない。医療・金融・法務や掲載区分は人の最終確認を維持する。
