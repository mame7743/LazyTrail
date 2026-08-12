import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { WorkService, STABLE_BRANCH, DEVELOP_BRANCH } from '../services/workService';

const INITIAL_WORK_DISPLAY_NAME = '初期開発';
const INITIAL_WORK_SLUG = 'initial-development';

export async function initializeProject(repoRoot: string): Promise<void> {
  const git = new GitService(repoRoot);

  if (await git.isGitRepo(repoRoot)) {
    vscode.window.showInformationMessage('LazyTrail: このフォルダは既にGitリポジトリです。');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'LazyTrail: プロジェクトを初期化しています…' },
    async () => {
      await git.init(repoRoot);
      await git.execRaw(['symbolic-ref', 'HEAD', `refs/heads/${STABLE_BRANCH}`], repoRoot);

      const readmePath = path.join(repoRoot, 'README.md');
      const exists = await fs.stat(readmePath).then(() => true).catch(() => false);
      if (!exists) {
        await fs.writeFile(readmePath, `# ${path.basename(repoRoot)}\n`, 'utf8');
      }

      await git.addAll(repoRoot);
      await git.commit('chore: initialize repository', repoRoot);

      await git.createBranch(DEVELOP_BRANCH, STABLE_BRANCH, repoRoot);

      const workService = new WorkService(git, repoRoot);
      const branch = `work/${INITIAL_WORK_SLUG}`;
      await git.createBranch(branch, DEVELOP_BRANCH, repoRoot);
      await workService.setDisplayName(branch, INITIAL_WORK_DISPLAY_NAME);
      const worktreePath = workService.defaultWorktreePath(INITIAL_WORK_SLUG);
      await git.addWorktree(worktreePath, branch);

      const remoteUrl = await vscode.window.showInputBox({
        prompt: 'LazyTrail: リモートリポジトリURL（任意・空欄でスキップ）',
        placeHolder: 'git@github.com:user/repo.git',
      });
      if (remoteUrl && remoteUrl.trim().length > 0) {
        await git.addRemote('origin', remoteUrl.trim());
        for (const b of [STABLE_BRANCH, DEVELOP_BRANCH]) {
          await git.push(b, repoRoot, true).catch(() => undefined);
        }
        await git.push(branch, worktreePath, true).catch(() => undefined);
      }

      const open = await vscode.window.showInformationMessage(
        `LazyTrail: 初期化が完了しました。Work「${INITIAL_WORK_DISPLAY_NAME}」を開きますか？`,
        'Open',
        'Later'
      );
      if (open === 'Open') {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), { forceNewWindow: false });
      }
    }
  );
}
