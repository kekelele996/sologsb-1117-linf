/** tsx 运行时的最小 tsconfig paths 解析（仅用于本目录下的验证脚本） */
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function resolveAlias(specifier) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2)
    const candidates = [path.join(root, 'src', rel + '.ts'), path.join(root, 'src', rel, 'index.ts')]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  const hit = resolveAlias(specifier)
  if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  return nextResolve(specifier, context)
}
