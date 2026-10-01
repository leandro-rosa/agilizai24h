import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const SRC = join(__dirname, '..', '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

/**
 * This service recommends and never acts (design D1): every call to a sibling
 * service is a read. The single exception is the owner-triggered packaging
 * import, isolated in one file. A new write anywhere else fails this test and
 * has to be argued for, not slipped in.
 */
describe('writes to other services', () => {
  const sources = files(SRC).filter(path => path.endsWith('.ts') && !path.endsWith('.spec.ts'))

  it('happen only in the packaging writer', () => {
    const offenders = sources.filter(path => /http_method:\s*'(patch|put|delete)'/.test(readFileSync(path, 'utf8')))

    expect(offenders.map(path => path.slice(SRC.length + 1))).toEqual(['modules/baseline/product-packaging.writer.ts'])
  })

  it('never come from the engine or the source clients', () => {
    const engine = sources.filter(path => /modules\/(engine|sources|backtest|runs)\//.test(path))

    for (const path of engine) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/ProductPackagingWriter|http_method:\s*'(patch|put|delete)'/)
    }
  })

  it('the only POST in a source client is the cost lookup, which reads', () => {
    const posts = sources.filter(path => path.includes('modules/sources/') && /http_method:\s*'post'/.test(readFileSync(path, 'utf8')))

    expect(posts.map(path => path.slice(SRC.length + 1))).toEqual(['modules/sources/products.client.ts'])
    expect(readFileSync(join(SRC, 'modules/sources/products.client.ts'), 'utf8')).toMatch(/costs\/bulk/)
  })
})
