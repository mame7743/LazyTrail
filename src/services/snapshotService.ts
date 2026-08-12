import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitService } from '../git/gitService';
import { SnapshotEntry, VerifyState } from '../git/types';
import { workKeyFromBranch } from './workService';

function wipRef(branch: string): string {
  return `refs/lazytrail/wip/${workKeyFromBranch(branch)}`;
}

function verifiedRef(branch: string): string {
  return `refs/lazytrail/verified/${workKeyFromBranch(branch)}`;
}

/**
 * Writes WIP / Verified snapshots using git plumbing against a throwaway
 * GIT_INDEX_FILE, so the real working tree, index, and HEAD are never
 * touched. Snapshots live under refs/lazytrail/{wip,verified}/<work> and are
 * never pushed (Auto Sync only pushes refs/heads/*).
 */
export class SnapshotService {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly git: GitService) {}

  /** Serializes snapshot operations per-branch so debounced saves never race. */
  private enqueue<T>(branch: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(branch) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.queues.set(branch, next.catch(() => undefined));
    return next;
  }

  /** Returns the new WIP commit hash, or null if nothing changed since the last snapshot. */
  async writeWipSnapshot(worktreePath: string, branch: string): Promise<string | null> {
    return this.enqueue(branch, () => this.writeWipSnapshotUnlocked(worktreePath, branch));
  }

  private async writeWipSnapshotUnlocked(worktreePath: string, branch: string): Promise<string | null> {
    const gitDir = await this.git.gitDir(worktreePath);
    const tmpIndex = path.join(
      os.tmpdir(),
      `lazytrail-index-${workKeyFromBranch(branch)}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.idx`
    );
    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: worktreePath, GIT_INDEX_FILE: tmpIndex };
    try {
      const head = await this.git.execRawOrNull(['rev-parse', 'HEAD'], worktreePath, env);
      if (!head) return null; // unborn branch, nothing to snapshot against
      await this.git.execRaw(['read-tree', 'HEAD'], worktreePath, env);
      await this.git.execRaw(['add', '-A'], worktreePath, env);
      const tree = await this.git.execRaw(['write-tree'], worktreePath, env);

      const ref = wipRef(branch);
      const parent = (await this.git.execRawOrNull(['rev-parse', '-q', '--verify', ref], worktreePath, env)) ?? head;
      const parentTree = await this.git.execRaw(['rev-parse', `${parent}^{tree}`], worktreePath, env);
      if (parentTree === tree) return null;

      const message = `wip: ${new Date().toISOString()}`;
      const commit = await this.git.execRaw(['commit-tree', tree, '-p', parent, '-m', message], worktreePath, env);
      await this.git.execRaw(['update-ref', ref, commit], worktreePath, env);
      return commit;
    } finally {
      await fs.rm(tmpIndex, { force: true });
    }
  }

  /** Marks the current WIP snapshot (or HEAD, if no WIP exists yet) as Verified. */
  async markVerified(worktreePath: string, branch: string): Promise<string | null> {
    const gitDir = await this.git.gitDir(worktreePath);
    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: worktreePath };
    const target = (await this.git.execRawOrNull(['rev-parse', '-q', '--verify', wipRef(branch)], worktreePath, env))
      ?? (await this.git.execRawOrNull(['rev-parse', 'HEAD'], worktreePath, env));
    if (!target) return null;
    await this.git.execRaw(['update-ref', verifiedRef(branch), target], worktreePath, env);
    return target;
  }

  async verifyState(worktreePath: string, branch: string): Promise<VerifyState> {
    const gitDir = await this.git.gitDir(worktreePath);
    const env = { GIT_DIR: gitDir };
    const verified = await this.git.execRawOrNull(['rev-parse', '-q', '--verify', verifiedRef(branch)], worktreePath, env);
    const wip = await this.git.execRawOrNull(['rev-parse', '-q', '--verify', wipRef(branch)], worktreePath, env);
    const head = await this.git.execRawOrNull(['rev-parse', 'HEAD'], worktreePath, env);
    const latest = wip ?? head;
    if (verified && latest && verified === latest) return 'Verified';
    if (verified) return 'Failed'; // a verified snapshot exists but newer changes are unverified
    return 'Unknown';
  }

  async listSnapshots(worktreePath: string, branch: string): Promise<SnapshotEntry[]> {
    const gitDir = await this.git.gitDir(worktreePath);
    const env = { GIT_DIR: gitDir };
    const entries: SnapshotEntry[] = [];
    for (const [kind, ref] of [['wip', wipRef(branch)], ['verified', verifiedRef(branch)]] as const) {
      const hash = await this.git.execRawOrNull(['rev-parse', '-q', '--verify', ref], worktreePath, env);
      if (!hash) continue;
      const info = await this.git.commitInfo(hash, worktreePath);
      if (!info) continue;
      entries.push({ kind, work: branch, commitHash: info.hash, timestamp: info.timestamp, message: info.message });
    }
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  wipRefName(branch: string): string {
    return wipRef(branch);
  }

  verifiedRefName(branch: string): string {
    return verifiedRef(branch);
  }
}
