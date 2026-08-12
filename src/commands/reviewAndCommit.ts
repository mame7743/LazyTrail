import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { SyncService } from '../services/syncService';

const TYPE_OPTIONS: { label: string; prefix: string; detail: string }[] = [
  { label: 'Add', prefix: 'feat', detail: '新しい機能・ファイルの追加' },
  { label: 'Fix', prefix: 'fix', detail: '不具合の修正' },
  { label: 'Change', prefix: 'chore', detail: '既存の挙動・設定の変更' },
  { label: 'Refactor', prefix: 'refactor', detail: '挙動を変えない構造変更' },
  { label: 'Other', prefix: 'chore', detail: 'その他' },
];

export async function reviewAndCommit(repoRoot: string, git: GitService, sync: SyncService, onDone: () => void): Promise<void> {
  const stat = await git.diffStat(repoRoot);
  if (stat.filesChanged === 0) {
    vscode.window.showInformationMessage('LazyTrail: コミットする変更がありません。');
    return;
  }

  await vscode.commands.executeCommand('workbench.view.scm');
  const proceed = await vscode.window.showInformationMessage(
    `LazyTrail: 現在の差分 +${stat.insertions} -${stat.deletions} (${stat.filesChanged} files) をレビューしてください。`,
    { modal: false },
    'Review完了・Commitへ',
    'キャンセル'
  );
  if (proceed !== 'Review完了・Commitへ') return;

  const type = await vscode.window.showQuickPick(
    TYPE_OPTIONS.map((t) => ({ label: t.label, description: t.prefix, detail: t.detail })),
    { placeHolder: 'LazyTrail: 変更の種類を選択してください' }
  );
  if (!type) return;
  const chosen = TYPE_OPTIONS.find((t) => t.label === type.label)!;

  const summary = await vscode.window.showInputBox({
    prompt: 'LazyTrail: 短い説明（コミットメッセージ本文）',
    placeHolder: '例: ログインフォームのバリデーションを追加',
    validateInput: (v) => (v.trim().length === 0 ? '説明を入力してください' : undefined),
  });
  if (!summary) return;

  const message = `${chosen.prefix}: ${summary.trim()}`;
  await git.addAll(repoRoot);
  await git.commit(message, repoRoot);
  onDone();

  const autoPush = vscode.workspace.getConfiguration('lazytrail').get<boolean>('autoPush', true);
  if (autoPush) {
    const branch = await git.currentBranch(repoRoot);
    if (branch) {
      const pushed = await sync.push(branch, repoRoot);
      vscode.window.setStatusBarMessage(
        pushed ? `LazyTrail: commit & push 完了 (${message})` : `LazyTrail: commit完了・push未実施 (${message})`,
        4000
      );
      return;
    }
  }
  vscode.window.setStatusBarMessage(`LazyTrail: commit完了 (${message})`, 4000);
}
