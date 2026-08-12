import { execFile } from 'child_process';
import * as path from 'path';
import { DiffStat } from './types';

export class GitError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
  }
}

/**
 * Thin wrapper around the git CLI. All commands are executed as argv arrays
 * (never through a shell) to avoid injection from branch/work names.
 */
export class GitService {
  constructor(private readonly repoRoot: string) {}

  private exec(args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        { cwd: opts?.cwd ?? this.repoRoot, env: opts?.env ?? process.env, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new GitError(`git ${args.join(' ')} failed: ${stderr || err.message}`, stderr));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });
  }

  /** Same as exec but resolves to null instead of throwing on non-zero exit. */
  private async execOrNull(args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<string | null> {
    try {
      return await this.exec(args, opts);
    } catch {
      return null;
    }
  }

  /** Escape hatch for callers (e.g. snapshot plumbing) that need custom env (GIT_DIR, GIT_INDEX_FILE, ...). */
  async execRaw(args: string[], cwd?: string, extraEnv?: NodeJS.ProcessEnv): Promise<string> {
    return this.exec(args, { cwd, env: extraEnv ? { ...process.env, ...extraEnv } : undefined });
  }

  async execRawOrNull(args: string[], cwd?: string, extraEnv?: NodeJS.ProcessEnv): Promise<string | null> {
    return this.execOrNull(args, { cwd, env: extraEnv ? { ...process.env, ...extraEnv } : undefined });
  }

  async isGitRepo(dir: string): Promise<boolean> {
    return (await this.execOrNull(['rev-parse', '--is-inside-work-tree'], { cwd: dir })) === 'true';
  }

  async init(dir: string): Promise<void> {
    await this.exec(['init'], { cwd: dir });
  }

  async config(key: string, cwd?: string): Promise<string | null> {
    return this.execOrNull(['config', '--local', '--get', key], { cwd });
  }

  async setConfig(key: string, value: string, cwd?: string): Promise<void> {
    await this.exec(['config', '--local', key, value], { cwd });
  }

  async unsetConfig(key: string, cwd?: string): Promise<void> {
    await this.execOrNull(['config', '--local', '--unset', key], { cwd });
  }

  async listConfigSubsections(sectionPrefix: string, cwd?: string): Promise<string[]> {
    const out = await this.execOrNull(['config', '--local', '--name-only', '--get-regexp', `^${sectionPrefix}\\.`], { cwd });
    if (!out) return [];
    const set = new Set<string>();
    for (const line of out.split('\n')) {
      const rest = line.slice(sectionPrefix.length + 1);
      const idx = rest.lastIndexOf('.');
      if (idx > 0) set.add(rest.slice(0, idx));
    }
    return [...set];
  }

  async currentBranch(cwd?: string): Promise<string | null> {
    const out = await this.execOrNull(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd });
    return out || null;
  }

  async revParse(ref: string, cwd?: string): Promise<string | null> {
    return this.execOrNull(['rev-parse', '--verify', '-q', ref], { cwd });
  }

  async branchExists(name: string, cwd?: string): Promise<boolean> {
    return (await this.revParse(`refs/heads/${name}`, cwd)) !== null;
  }

  async listLocalBranches(cwd?: string): Promise<string[]> {
    const out = await this.execOrNull(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd });
    if (!out) return [];
    return out.split('\n').filter(Boolean);
  }

  async createBranch(name: string, startPoint: string, cwd?: string): Promise<void> {
    await this.exec(['branch', name, startPoint], { cwd });
  }

  async deleteBranch(name: string, cwd?: string, force = false): Promise<void> {
    await this.exec(['branch', force ? '-D' : '-d', name], { cwd });
  }

  async gitDir(cwd?: string): Promise<string> {
    const out = await this.exec(['rev-parse', '--path-format=absolute', '--git-dir'], { cwd });
    return path.resolve(out);
  }

  async commonGitDir(cwd?: string): Promise<string> {
    const out = await this.exec(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
    return path.resolve(out);
  }

  // ---- worktrees ----

  async listWorktrees(): Promise<{ path: string; branch: string | null; head: string }[]> {
    const out = await this.execOrNull(['worktree', 'list', '--porcelain']);
    if (!out) return [];
    const entries: { path: string; branch: string | null; head: string }[] = [];
    let cur: { path?: string; branch?: string | null; head?: string } = {};
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? '' });
        cur = { path: line.slice('worktree '.length) };
      } else if (line.startsWith('branch ')) {
        cur.branch = line.slice('branch '.length).replace('refs/heads/', '');
      } else if (line.startsWith('HEAD ')) {
        cur.head = line.slice('HEAD '.length);
      } else if (line === 'detached') {
        cur.branch = null;
      }
    }
    if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? '' });
    return entries;
  }

  async addWorktree(worktreePath: string, branch: string): Promise<void> {
    await this.exec(['worktree', 'add', worktreePath, branch]);
  }

  async removeWorktree(worktreePath: string, force = false): Promise<void> {
    await this.exec(['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]);
  }

  async pruneWorktrees(): Promise<void> {
    await this.execOrNull(['worktree', 'prune']);
  }

  // ---- status / diff ----

  async statusPorcelain(cwd?: string): Promise<string> {
    return (await this.execOrNull(['status', '--porcelain=v1'], { cwd })) ?? '';
  }

  async hasUncommittedChanges(cwd?: string): Promise<boolean> {
    return (await this.statusPorcelain(cwd)).length > 0;
  }

  async diffStat(cwd?: string): Promise<DiffStat> {
    const out = await this.execOrNull(['diff', 'HEAD', '--numstat'], { cwd });
    let insertions = 0;
    let deletions = 0;
    let filesChanged = 0;
    if (out) {
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const [ins, del] = line.split('\t');
        filesChanged++;
        if (ins !== '-') insertions += parseInt(ins, 10) || 0;
        if (del !== '-') deletions += parseInt(del, 10) || 0;
      }
    }
    return { filesChanged, insertions, deletions };
  }

  async addAll(cwd?: string): Promise<void> {
    await this.exec(['add', '-A'], { cwd });
  }

  async commit(message: string, cwd?: string): Promise<string> {
    await this.exec(['commit', '-m', message], { cwd });
    return this.exec(['rev-parse', 'HEAD'], { cwd });
  }

  // ---- remote sync ----

  async hasRemote(name = 'origin'): Promise<boolean> {
    return (await this.execOrNull(['remote', 'get-url', name])) !== null;
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.exec(['remote', 'add', name, url]);
  }

  async fetch(remote = 'origin'): Promise<boolean> {
    const out = await this.execOrNull(['fetch', remote]);
    return out !== null;
  }

  async aheadBehind(branch: string, upstream: string, cwd?: string): Promise<{ ahead: number; behind: number } | null> {
    const out = await this.execOrNull(['rev-list', '--left-right', '--count', `${branch}...${upstream}`], { cwd });
    if (!out) return null;
    const [ahead, behind] = out.split(/\s+/).map((n) => parseInt(n, 10));
    return { ahead, behind };
  }

  async hasUpstream(branch: string, cwd?: string): Promise<boolean> {
    return (await this.execOrNull(['rev-parse', '--verify', '-q', `${branch}@{upstream}`], { cwd })) !== null;
  }

  async pullFastForwardOnly(cwd?: string): Promise<'pulled' | 'up-to-date' | 'diverged' | 'no-upstream' | 'offline'> {
    const branch = await this.currentBranch(cwd);
    if (!branch) return 'diverged';
    if (!(await this.hasUpstream(branch, cwd))) return 'no-upstream';
    const beforeHash = await this.revParse('HEAD', cwd);
    try {
      await this.exec(['pull', '--ff-only'], { cwd });
    } catch (e) {
      const err = e as GitError;
      if (/could not resolve host|network|Could not read from remote/i.test(err.stderr)) return 'offline';
      return 'diverged';
    }
    const afterHash = await this.revParse('HEAD', cwd);
    return beforeHash === afterHash ? 'up-to-date' : 'pulled';
  }

  async push(branch: string, cwd?: string, setUpstream = false): Promise<boolean> {
    const args = ['push'];
    if (setUpstream) args.push('-u', 'origin', branch);
    const out = await this.execOrNull(args, { cwd });
    return out !== null;
  }

  // ---- merge ----

  async mergeFastForward(branch: string, cwd?: string): Promise<boolean> {
    const out = await this.execOrNull(['merge', '--ff-only', branch], { cwd });
    return out !== null;
  }

  async mergeNoFastForward(branch: string, message: string, cwd?: string): Promise<boolean> {
    const out = await this.execOrNull(['merge', '--no-ff', '-m', message, branch], { cwd });
    return out !== null;
  }

  // ---- refs ----

  async updateRef(ref: string, hash: string, cwd?: string): Promise<void> {
    await this.exec(['update-ref', ref, hash], { cwd });
  }

  async deleteRef(ref: string, cwd?: string): Promise<void> {
    await this.execOrNull(['update-ref', '-d', ref], { cwd });
  }

  async listRefs(pattern: string, cwd?: string): Promise<{ ref: string; hash: string }[]> {
    const out = await this.execOrNull(['for-each-ref', '--format=%(objectname) %(refname)', pattern], { cwd });
    if (!out) return [];
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, ref] = line.split(' ');
        return { hash, ref };
      });
  }

  async commitInfo(hash: string, cwd?: string): Promise<{ hash: string; timestamp: number; message: string; tree: string } | null> {
    const out = await this.execOrNull(['log', '-1', '--format=%H%x1f%ct%x1f%s%x1f%T', hash], { cwd });
    if (!out) return null;
    const [h, ts, msg, tree] = out.split('\x1f');
    return { hash: h, timestamp: parseInt(ts, 10) * 1000, message: msg, tree };
  }
}
