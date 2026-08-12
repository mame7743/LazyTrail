# LazyTrail

**コードを書く。履歴は勝手に残る。**

面倒なGit運用（コミット忘れ、巨大コミット、ブランチ運用、端末間同期）を自動化し、開発への集中を優先するVS Code拡張です。Gitの標準オブジェクト・refsのみを使い、LazyTrail独自のDBは持ちません。

## セットアップ

```bash
npm install
npm run build      # out/extension.js を生成
npm run watch       # 開発中はこちらでウォッチビルド
npm run typecheck
```

`F5` でExtension Development Hostを起動して動作確認できます。

## VSIXパッケージング

```bash
npm run package     # lazytrail.vsix をローカルに生成（@vscode/vsce使用）
```

`v*.*.*` 形式のタグをpushするか、GitHub Actionsの `Build Draft VSIX Release` ワークフローを手動実行（`workflow_dispatch`）すると、vsixをビルドして **draft** のGitHub Releaseとして添付します。内容を確認してから手動でPublishしてください。

## 主な機能

- **Initialize Project**: 未初期化フォルダに `README.md` を追加して初回コミットし、`main` → `dev` → 初期Work（`work/initial-development`）を自動作成、worktreeを開きます。
- **Work Manager**（サイドバー `LAZYTRAIL`）: `main` / `dev` / `work/*` を一覧表示し、クリックでworktreeを切り替えます。
- **New Work**: 日本語の表示名からブランチ名候補（`work/<slug>`）を決定論的に生成（手動修正可）し、branch + worktreeを自動作成します。
- **Auto WIP Snapshot**: ファイル保存のたびに `GIT_INDEX_FILE` を使ったgit plumbingで `refs/lazytrail/wip/<work>` にスナップショットを記録します。作業ツリー・通常のindex・HEADには一切干渉しません。
- **Verification**: L1は保存後にVS Code Diagnosticsのエラー数を確認する軽量チェック、L2は `lazytrail.verifyCommand` に設定した任意コマンド（例: `npm test`）を実行し、成功時に `refs/lazytrail/verified/<work>` を更新します。
- **Review & Commit**: 差分を確認し、種別（Add/Fix/Change/Refactor/Other）を選んで短い説明を入力するとConventional Commits形式でコミットし、自動でpushします。
- **Finish Work**: 検証を実行し、`dev` へマージ、worktreeとブランチを整理します。
- **Snapshot History**: WIP / Verified スナップショットの履歴からCompare / Restore / Open as Worktreeを実行できます。
- **Auto Sync**: 起動時・Work切替時にfetchし、fast-forward可能なときのみpull。分岐時は自動で履歴を書き換えません。

## 設定

| 設定キー | 説明 | 既定値 |
| --- | --- | --- |
| `lazytrail.verifyCommand` | L2検証で実行するコマンド | `""`（無効） |
| `lazytrail.reviewPressure.yellowLines` / `redLines` | Review Pressureの行数しきい値 | `150` / `400` |
| `lazytrail.reviewPressure.yellowFiles` / `redFiles` | Review Pressureのファイル数しきい値 | `8` / `20` |
| `lazytrail.autoWipDebounceMs` | 保存からAuto WIP Snapshotまでのdebounce | `2000` |
| `lazytrail.worktreeRoot` | worktreeの作成先ルート | リポジトリの親ディレクトリ |
| `lazytrail.autoPush` | Review & Commit後の自動push | `true` |

## 実装原則

- Git標準オブジェクト・refsのみを利用し、拡張独自のDBに依存しない
- 危険な操作（force push、履歴書き換え、コンフリクト解消）は常にユーザー確認
- 自動記録（Auto WIP）と事後レビュー（Review & Commit）を明確に分離
