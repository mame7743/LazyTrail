import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { SyncService } from '../services/syncService';

export async function syncNow(repoRoot: string, git: GitService, sync: SyncService, onDone: () => void): Promise<void> {
  const branch = await git.currentBranch(repoRoot);
  if (!branch) return;

  if (await git.hasUncommittedChanges(repoRoot)) {
    vscode.window.showInformationMessage('LazyTrail: 未コミットの変更があります。Auto WIPで保存済みですが、Pullはコミット後に実行してください。');
    return;
  }

  const state = await sync.autoSync(branch, repoRoot);
  onDone();

  const messages: Record<string, string> = {
    synced: '同期済みです。',
    ahead: 'ローカルの変更を未push。pushしますか？',
    behind: '最新化しました（fast-forward pull）。',
    diverged: 'リモートと分岐しています。手動でのmerge/rebaseが必要です。',
    offline: 'リモート未接続、またはオフラインです。',
  };
  if (state === 'ahead') {
    const push = await vscode.window.showInformationMessage(`LazyTrail: ${messages[state]}`, 'Push');
    if (push === 'Push') {
      await sync.push(branch, repoRoot);
      onDone();
    }
    return;
  }
  vscode.window.showInformationMessage(`LazyTrail: ${messages[state] ?? state}`);
}
