/**
 * Lazy-loaded Mermaid diagram renderer.
 * Detects code blocks with language "mermaid" and renders them as SVG diagrams.
 * Mermaid generates SVG output which is inherently safe (no script execution).
 */

let mermaidModule: typeof import('mermaid') | null = null
let mermaidId = 0

async function getMermaid() {
  if (!mermaidModule) {
    mermaidModule = await import('mermaid')
    const mermaid = mermaidModule.default
    mermaid.initialize({
      startOnLoad: false,
      theme: isDarkTheme() ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'var(--font)',
    })
  }
  return mermaidModule.default
}

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    || window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Find code blocks with language "mermaid" and render them as SVG diagrams.
 */
export async function renderMermaidBlocks(root: HTMLElement | ShadowRoot): Promise<void> {
  const codeBlocks = root.querySelectorAll<HTMLElement>('pre code.language-mermaid')
  if (codeBlocks.length === 0) return

  const mermaid = await getMermaid()

  for (const codeEl of codeBlocks) {
    const preEl = codeEl.parentElement
    if (!preEl || preEl.dataset.mermaidRendered === 'true') continue

    const definition = codeEl.textContent || ''
    if (!definition.trim()) continue

    try {
      const id = `mermaid-${++mermaidId}`
      const { svg } = await mermaid.render(id, definition.trim())

      // Replace the <pre> with a container holding the SVG
      const container = document.createElement('div')
      container.className = 'mermaid-diagram'
      container.style.cssText = 'text-align: center; margin: 10px 0; overflow-x: auto;'

      // Mermaid's render() returns sanitized SVG (securityLevel: 'strict')
      // Parse it safely via DOMParser
      const parser = new DOMParser()
      const doc = parser.parseFromString(svg, 'image/svg+xml')
      const svgEl = doc.documentElement
      if (svgEl.tagName === 'svg') {
        container.appendChild(document.importNode(svgEl, true))
      }

      preEl.dataset.mermaidRendered = 'true'
      preEl.replaceWith(container)
    } catch {
      // If rendering fails, leave the code block as-is
      preEl.dataset.mermaidRendered = 'true'
    }
  }
}
