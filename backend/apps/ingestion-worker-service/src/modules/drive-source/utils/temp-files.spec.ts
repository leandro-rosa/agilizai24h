import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTempWorkspace, sweepTempWorkspaces } from './temp-files'

describe('temp workspaces', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'temp-files-spec-'))
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('creates a private directory and removes it with everything in it', async () => {
    const workspace = await createTempWorkspace(base)
    writeFileSync(workspace.filePath('report.xlsx'), 'bytes')

    expect(statSync(workspace.dir).mode & 0o777).toBe(0o700)
    await workspace.cleanup()

    expect(existsSync(workspace.dir)).toBe(false)
    await expect(workspace.cleanup()).resolves.toBeUndefined()
  })

  it('keeps a downloaded file inside the workspace whatever its name says', async () => {
    const workspace = await createTempWorkspace(base)

    expect(workspace.filePath('../../etc/passwd')).toBe(join(workspace.dir, '.._.._etc_passwd'))
    expect(workspace.filePath('Relatório_2026.xlsx').startsWith(workspace.dir)).toBe(true)
  })

  it('sweeps only the abandoned workspaces, leaving recent ones and anything that is not ours', async () => {
    const old = await createTempWorkspace(base)
    const recent = await createTempWorkspace(base)
    const foreign = join(base, 'something-else')
    mkdirSync(foreign)
    const longAgo = new Date(Date.now() - 3 * 3600 * 1000)
    utimesSync(old.dir, longAgo, longAgo)
    utimesSync(foreign, longAgo, longAgo)

    expect(await sweepTempWorkspaces(base, 3600 * 1000)).toBe(1)

    expect(existsSync(old.dir)).toBe(false)
    expect(existsSync(recent.dir)).toBe(true)
    expect(existsSync(foreign)).toBe(true)
  })
})
