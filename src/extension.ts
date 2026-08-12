import * as vscode from 'vscode';
import { GitService } from './git/gitService';
import { WorkService } from './services/workService';
import { SnapshotService } from './services/snapshotService';
import { SyncService } from './services/syncService';
import { WorkManagerProvider } from './views/workManagerProvider';
import { StatusBarManager } from './statusBar/statusBarManager';
import { AutoWipWatcher } from './autoWip/autoWipWatcher';
import { initializeProject } from './commands/initializeProject';
import { newWork } from './commands/newWork';
import { switchWork } from './commands/switchWork';
import { reviewAndCommit } from './commands/reviewAndCommit';
import { finishWork } from './commands/finishWork';
import { showHistory } from './commands/showHistory';
import { syncNow } from './commands/syncNow';
import { verifyNow } from './commands/verifyNow';
import { WorkInfo } from './git/types';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand('lazytrail.initializeProject', async () => {
      if (!repoRoot) {
        vscode.window.showErrorMessage('LazyTrail: フォルダを開いてから実行してください。');
        return;
      }
      await initializeProject(repoRoot);
    })
  );

  if (!repoRoot) return;

  const git = new GitService(repoRoot);
  if (!(await git.isGitRepo(repoRoot))) {
    // Not yet a git repo: only "Initialize Project" is meaningful until then.
    void vscode.commands.executeCommand('setContext', 'lazytrail.isGitRepo', false);
    return;
  }
  void vscode.commands.executeCommand('setContext', 'lazytrail.isGitRepo', true);

  const workService = new WorkService(git, repoRoot);
  const snapshotService = new SnapshotService(git);
  const syncService = new SyncService(git);

  const treeProvider = new WorkManagerProvider(git, workService, snapshotService, syncService);
  const treeView = vscode.window.createTreeView('lazytrail.workManager', { treeDataProvider: treeProvider });
  context.subscriptions.push(treeView);

  const statusBar = new StatusBarManager(repoRoot, git, workService, snapshotService, syncService);
  context.subscriptions.push(statusBar);
  void statusBar.refresh();

  const refreshAll = () => {
    treeProvider.refresh();
    void statusBar.refresh();
  };

  const autoWip = new AutoWipWatcher(repoRoot, git, snapshotService);
  context.subscriptions.push(autoWip);
  autoWip.onDidSnapshot(() => refreshAll());

  context.subscriptions.push(
    vscode.commands.registerCommand('lazytrail.newWork', () => newWork(workService, refreshAll)),
    vscode.commands.registerCommand('lazytrail.switchWork', (work: WorkInfo) => switchWork(work)),
    vscode.commands.registerCommand('lazytrail.reviewAndCommit', () => {
      reviewAndCommit(repoRoot, git, syncService, () => {
        statusBar.noteCommit();
        refreshAll();
      });
    }),
    vscode.commands.registerCommand('lazytrail.finishWork', () =>
      finishWork(repoRoot, git, workService, snapshotService, syncService, refreshAll)
    ),
    vscode.commands.registerCommand('lazytrail.showHistory', () => showHistory(repoRoot, git, snapshotService, refreshAll)),
    vscode.commands.registerCommand('lazytrail.refreshWorkManager', refreshAll),
    vscode.commands.registerCommand('lazytrail.syncNow', () => syncNow(repoRoot, git, syncService, refreshAll)),
    vscode.commands.registerCommand('lazytrail.verifyNow', async () => {
      const branch = await git.currentBranch(repoRoot);
      if (branch) await verifyNow(repoRoot, branch, snapshotService, refreshAll);
    })
  );

  // Auto Fetch on startup, and fast-forward Auto Pull only when the
  // worktree is clean. Diverged/conflicted states are never auto-resolved.
  void (async () => {
    const branch = await git.currentBranch(repoRoot);
    if (!branch) return;
    if (await git.hasUncommittedChanges(repoRoot)) {
      await snapshotService.writeWipSnapshot(repoRoot, branch);
      await syncService.fetch();
    } else {
      await syncService.autoSync(branch, repoRoot);
    }
    refreshAll();
  })();

  // Refresh Work Manager / StatusBar whenever the user switches to a
  // different work's window is out of scope (separate window = separate
  // activation), but branch changes within this window (e.g. external
  // checkout) should still be reflected.
  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD');
  fsWatcher.onDidChange(refreshAll);
  context.subscriptions.push(fsWatcher);
}

export function deactivate(): void {
  // Nothing to clean up beyond context.subscriptions, which VS Code disposes automatically.
}
