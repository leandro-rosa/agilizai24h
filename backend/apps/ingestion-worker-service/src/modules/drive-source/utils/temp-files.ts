import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PREFIX = 'agiliz-drive-'

export interface TempWorkspace {
  dir: string
  /** A path inside the workspace for a downloaded file. */
  filePath(name: string): string
  /** Removes the workspace and everything in it. Safe to call twice. */
  cleanup(): Promise<void>
}

/**
 * A private directory (0700, by `mkdtemp`) for one download. A file that came from
 * the Drive sits here only while it is being read, and `cleanup` — called from a
 * `finally` — removes it whatever happened.
 */
export async function createTempWorkspace(base: string = tmpdir()): Promise<TempWorkspace> {
  const dir = await mkdtemp(join(base, PREFIX))

  return {
    dir,
    filePath: name => join(dir, name.replace(/[^\w.-]/g, '_')),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

/**
 * Removes workspaces left behind by a process that died mid-download. Only those
 * older than `olderThanMs`, so another replica that is validating right now keeps
 * its file. Returns how many were removed.
 */
export async function sweepTempWorkspaces(base: string = tmpdir(), olderThanMs = 60 * 60 * 1000): Promise<number> {
  let removed = 0

  for (const entry of await readdir(base)) {
    if (!entry.startsWith(PREFIX)) continue

    const path = join(base, entry)
    try {
      if (Date.now() - (await stat(path)).mtimeMs >= olderThanMs) {
        await rm(path, { recursive: true, force: true })
        removed++
      }
    } catch {
      // Gone already, or not ours to read: leave it.
    }
  }

  return removed
}
