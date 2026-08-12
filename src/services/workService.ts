import * as path from 'path';
import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { WorkInfo } from '../git/types';
import { dedupeSlug, slugify } from '../util/slug';

export const WORK_PREFIX = 'work/';
export const STABLE_BRANCH = 'main';
export const DEVELOP_BRANCH = 'dev';

/** Stable key used for git config sections and lazytrail refs (no slashes). */
export function workKeyFromBranch(branch: string): string {
  return branch.replace(/^work\//, '').replace(/\//g, '-');
}

export class WorkService {
  constructor(private readonly git: GitService, private readonly repoRoot: string) {}

  async proposeSlug(displayName: string): Promise<string> {
    const base = slugify(displayName);
    const branches = await this.git.listLocalBranches();
    const existing = new Set(
      branches.filter((b) => b.startsWith(WORK_PREFIX)).map((b) => b.slice(WORK_PREFIX.length))
    );
    return dedupeSlug(base, existing);
  }

  async getDisplayName(branch: string): Promise<string> {
    const key = workKeyFromBranch(branch);
    const stored = await this.git.config(`lazytrail.${key}.displayname`);
    return stored ?? branch;
  }

  async setDisplayName(branch: string, name: string): Promise<void> {
    const key = workKeyFromBranch(branch);
    await this.git.setConfig(`lazytrail.${key}.displayname`, name);
  }

  defaultWorktreePath(slug: string): string {
    const configured = vscode.workspace.getConfiguration('lazytrail').get<string>('worktreeRoot');
    const repoName = path.basename(this.repoRoot);
    const dirName = `${repoName}-work-${slug}`;
    if (configured && configured.trim().length > 0) {
      return path.join(configured, dirName);
    }
    return path.join(path.dirname(this.repoRoot), dirName);
  }

  async listWorktreeMap(): Promise<Map<string, string>> {
    const worktrees = await this.git.listWorktrees();
    const map = new Map<string, string>();
    for (const wt of worktrees) {
      if (wt.branch) map.set(wt.branch, wt.path);
    }
    return map;
  }

  async listWorks(): Promise<WorkInfo[]> {
    const branches = await this.git.listLocalBranches();
    const worktreeMap = await this.listWorktreeMap();
    const currentDir = await this.git.currentBranch();
    const results: WorkInfo[] = [];
    for (const branch of branches) {
      if (branch !== STABLE_BRANCH && branch !== DEVELOP_BRANCH && !branch.startsWith(WORK_PREFIX)) {
        continue;
      }
      const displayName = branch === STABLE_BRANCH || branch === DEVELOP_BRANCH
        ? branch
        : await this.getDisplayName(branch);
      results.push({
        branch,
        displayName,
        worktreePath: worktreeMap.get(branch),
        isCurrent: branch === currentDir,
      });
    }
    // Stable ordering: main, dev, then work/* alphabetically by display name.
    results.sort((a, b) => {
      const rank = (i: WorkInfo) => (i.branch === STABLE_BRANCH ? 0 : i.branch === DEVELOP_BRANCH ? 1 : 2);
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.displayName.localeCompare(b.displayName, 'ja');
    });
    return results;
  }

  async createWork(displayName: string, slugOverride?: string): Promise<WorkInfo> {
    const slug = slugOverride ?? (await this.proposeSlug(displayName));
    const branch = `${WORK_PREFIX}${slug}`;
    if (await this.git.branchExists(branch)) {
      throw new Error(`ブランチ ${branch} は既に存在します。`);
    }
    await this.git.createBranch(branch, DEVELOP_BRANCH);
    await this.setDisplayName(branch, displayName);
    const worktreePath = this.defaultWorktreePath(slug);
    await this.git.addWorktree(worktreePath, branch);
    return { branch, displayName, worktreePath, isCurrent: false };
  }
}
