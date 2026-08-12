import * as path from 'path';
import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { SnapshotService } from '../services/snapshotService';

const outputChannel = vscode.window.createOutputChannel('LazyTrail');

export async function showHistory(repoRoot: string, git: GitService, snapshotService: SnapshotService, onDone: () => void): Promise<void> {
  const branch = await git.currentBranch(repoRoot);
  if (!branch) return;

  const entries = await snapshotService.listSnapshots(repoRoot, branch);
  if (entries.length === 0) {
    vscode.window.showInformationMessage('LazyTrail: スナップショットはまだありません。');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: `${entry.kind === 'verified' ? '$(check) Verified' : '$(circle-outline) WIP'} ${new Date(entry.timestamp).toLocaleString('ja-JP')}`,
      description: entry.commitHash.slice(0, 7),
      detail: entry.message,
      entry,
    })),
    { placeHolder: 'LazyTrail: スナップショット履歴' }
  );
  if (!picked) return;

  const action = await vscode.window.showQuickPick(
    [
      { label: '$(diff) Compare', action: 'compare' as const },
      { label: '$(history) Restore', action: 'restore' as const },
      { label: '$(folder-opened) Open as Worktree', action: 'worktree' as const },
    ],
    { placeHolder: `${picked.description} に対する操作を選択` }
  );
  if (!action) return;

  const hash = picked.entry.commitHash;

  if (action.action === 'compare') {
    const diff = await git.execRawOrNull(['diff', '--stat', hash, 'HEAD'], repoRoot);
    outputChannel.clear();
    outputChannel.appendLine(`LazyTrail: ${hash.slice(0, 7)} と 現在のHEAD の差分\n`);
    outputChannel.appendLine(diff ?? '(差分なし)');
    outputChannel.show();
    return;
  }

  if (action.action === 'restore') {
    const confirm = await vscode.window.showWarningMessage(
      `LazyTrail: 現在のワーキングツリーを ${hash.slice(0, 7)} の状態に復元します。現在の状態は復元前に自動でWIP保存されます。続けますか？`,
      { modal: true },
      '復元する'
    );
    if (confirm !== '復元する') return;

    await snapshotService.writeWipSnapshot(repoRoot, branch);
    await git.execRaw(['read-tree', '-u', '--reset', hash], repoRoot);
    onDone();
    vscode.window.showInformationMessage(`LazyTrail: ${hash.slice(0, 7)} の状態に復元しました。`);
    return;
  }

  if (action.action === 'worktree') {
    const tempPath = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-snapshot-${hash.slice(0, 7)}`);
    try {
      await git.execRaw(['worktree', 'add', '--detach', tempPath, hash], repoRoot);
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(tempPath), { forceNewWindow: true });
    } catch (e) {
      vscode.window.showErrorMessage(`LazyTrail: worktreeの作成に失敗しました: ${(e as Error).message}`);
    }
  }
}
