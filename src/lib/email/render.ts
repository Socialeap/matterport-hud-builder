import type * as React from 'react'

type ReactDomServerModule = {
  renderToReadableStream?: (
    element: React.ReactNode,
    options?: {
      progressiveChunkSize?: number
      onError?: (error: unknown) => void
    }
  ) => Promise<ReadableStream<Uint8Array> & { allReady?: Promise<void> }>
  renderToStaticMarkup?: (element: React.ReactNode) => string
}

async function loadReactDomServer(): Promise<ReactDomServerModule> {
  try {
    return await import('react-dom/server.edge')
  } catch {
    return await import('react-dom/server')
  }
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let output = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      output += decoder.decode(value, { stream: true })
    }
  }

  output += decoder.decode()
  return output
}

function ensureDoctype(html: string): string {
  const trimmed = html.trimStart()
  if (/^<!doctype/i.test(trimmed)) {
    return trimmed
  }

  return `<!DOCTYPE html>${trimmed}`
}

function decodeHtmlEntities(input: string): string {
  const namedEntities: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'",
  }

  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase()

    if (normalized in namedEntities) {
      return namedEntities[normalized]
    }

    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }

    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }

    return match
  })
}

export async function renderEmailHtml(element: React.ReactElement): Promise<string> {
  const reactDomServer = await loadReactDomServer()

  if (reactDomServer.renderToReadableStream) {
    const stream = await reactDomServer.renderToReadableStream(element, {
      progressiveChunkSize: Number.POSITIVE_INFINITY,
    })

    await stream.allReady
    return ensureDoctype(await readStream(stream))
  }

  if (reactDomServer.renderToStaticMarkup) {
    return ensureDoctype(reactDomServer.renderToStaticMarkup(element))
  }

  throw new Error('No compatible React DOM server renderer is available')
}

export function htmlToPlainText(html: string): string {
  const withoutIgnoredSections = html.replace(
    /<(script|style|head|title|svg|noscript)[^>]*>[\s\S]*?<\/\1>/gi,
    ' '
  )

  const withStructure = withoutIgnoredSections
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|section|article|header|footer|aside|main|h[1-6]|li|tr|table)\s*>/gi, '\n')

  const stripped = withStructure.replace(/<[^>]+>/g, ' ')
  const decoded = decodeHtmlEntities(stripped)

  return decoded
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
