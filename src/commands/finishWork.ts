import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { SnapshotService } from '../services/snapshotService';
import { SyncService } from '../services/syncService';
import { WorkService, WORK_PREFIX, DEVELOP_BRANCH } from '../services/workService';
import { runL2Command } from '../services/verificationService';

export async function finishWork(
  repoRoot: string,
  git: GitService,
  workService: WorkService,
  snapshotService: SnapshotService,
  sync: SyncService,
  onDone: () => void
): Promise<void> {
  const branch = await git.currentBranch(repoRoot);
  if (!branch || !branch.startsWith(WORK_PREFIX)) {
    vscode.window.showWarningMessage('LazyTrail: Work（work/*）ブランチでのみ実行できます。');
    return;
  }

  if (await git.hasUncommittedChanges(repoRoot)) {
    vscode.window.showWarningMessage('LazyTrail: 未コミットの変更があります。先にReview & Commitを実行してください。');
    return;
  }

  const verifyCommand = vscode.workspace.getConfiguration('lazytrail').get<string>('verifyCommand', '');
  if (verifyCommand && verifyCommand.trim().length > 0) {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `LazyTrail: 検証中 (${verifyCommand})…` },
      () => runL2Command(verifyCommand, repoRoot)
    );
    if (result.success) {
      await snapshotService.markVerified(repoRoot, branch);
    } else {
      const cont = await vscode.window.showWarningMessage(
        'LazyTrail: 検証コマンドが失敗しました。それでもFinish Workを続けますか？',
        '続ける',
        'キャンセル'
      );
      if (cont !== '続ける') return;
    }
  }

  const worktreeMap = await workService.listWorktreeMap();
  const devPath = worktreeMap.get(DEVELOP_BRANCH);
  if (!devPath) {
    vscode.window.showErrorMessage('LazyTrail: devブランチのworktreeが見つかりません。');
    return;
  }

  const displayName = await workService.getDisplayName(branch);
  const merged = await git.mergeNoFastForward(branch, `Merge work: ${displayName} (${branch})`, devPath);
  if (!merged) {
    vscode.window.showErrorMessage(
      `LazyTrail: ${branch} を dev へマージできませんでした（コンフリクトの可能性があります）。devのworktreeで手動解決してください: ${devPath}`
    );
    return;
  }

  const branchWorktree = worktreeMap.get(branch);
  if (branchWorktree) {
    try {
      await git.removeWorktree(branchWorktree);
    } catch {
      vscode.window.showWarningMessage(`LazyTrail: worktree (${branchWorktree}) の削除に失敗しました。手動で削除してください。`);
    }
  }

  const deleteBranch = await vscode.window.showInformationMessage(
    `LazyTrail: Work「${displayName}」をdevに統合しました。ブランチ ${branch} を削除しますか？`,
    '削除する',
    '残す'
  );
  if (deleteBranch === '削除する') {
    await git.deleteBranch(branch, devPath, true).catch(() => undefined);
  }

  const pushed = await sync.push(DEVELOP_BRANCH, devPath);
  onDone();
  vscode.window.showInformationMessage(
    `LazyTrail: Work「${displayName}」を完了しました。${pushed ? '(dev をpush済み)' : ''}`
  );
}
