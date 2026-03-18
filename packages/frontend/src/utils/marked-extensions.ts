/**
 * Custom marked extensions for GitHub-style alerts and other enhancements.
 *
 * Supports:
 *   > [!NOTE]
 *   > [!TIP]
 *   > [!IMPORTANT]
 *   > [!WARNING]
 *   > [!CAUTION]
 */
import type { MarkedExtension } from 'marked'

const ALERT_TYPES: Record<string, { icon: string; className: string; label: string }> = {
  NOTE: { icon: 'ℹ️', className: 'alert-note', label: 'Note' },
  TIP: { icon: '💡', className: 'alert-tip', label: 'Tip' },
  IMPORTANT: { icon: '❗', className: 'alert-important', label: 'Important' },
  WARNING: { icon: '⚠️', className: 'alert-warning', label: 'Warning' },
  CAUTION: { icon: '🔴', className: 'alert-caution', label: 'Caution' },
}

export const githubAlertsExtension: MarkedExtension = {
  renderer: {
    blockquote(token) {
      const text = typeof token === 'string' ? token : (token as any).text ?? ''
      // Match [!TYPE] at the start of blockquote content
      const match = text.match(/^\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>)?\s*([\s\S]*)/i)
      if (!match) return false

      const type = match[1].toUpperCase()
      const alertInfo = ALERT_TYPES[type]
      if (!alertInfo) return false

      const content = match[2].replace(/<\/p>\s*$/, '')
      return `<div class="gh-alert ${alertInfo.className}">
        <div class="gh-alert-title">${alertInfo.icon} ${alertInfo.label}</div>
        <div class="gh-alert-content"><p>${content}</p></div>
      </div>`
    },
  },
}

/**
 * CSS for GitHub-style alerts. Include in component styles.
 */
export const githubAlertStyles = `
  .gh-alert {
    padding: 10px 14px;
    border-radius: 10px;
    margin: 8px 0;
    border-left: 3px solid;
  }
  .gh-alert-title {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 4px;
  }
  .gh-alert-content p {
    margin: 0;
  }
  .gh-alert.alert-note {
    background: color-mix(in srgb, #58a6ff 8%, transparent);
    border-color: #58a6ff;
  }
  .gh-alert.alert-note .gh-alert-title { color: #58a6ff; }
  .gh-alert.alert-tip {
    background: color-mix(in srgb, #3fb950 8%, transparent);
    border-color: #3fb950;
  }
  .gh-alert.alert-tip .gh-alert-title { color: #3fb950; }
  .gh-alert.alert-important {
    background: color-mix(in srgb, #a371f7 8%, transparent);
    border-color: #a371f7;
  }
  .gh-alert.alert-important .gh-alert-title { color: #a371f7; }
  .gh-alert.alert-warning {
    background: color-mix(in srgb, #d29922 8%, transparent);
    border-color: #d29922;
  }
  .gh-alert.alert-warning .gh-alert-title { color: #d29922; }
  .gh-alert.alert-caution {
    background: color-mix(in srgb, #f85149 8%, transparent);
    border-color: #f85149;
  }
  .gh-alert.alert-caution .gh-alert-title { color: #f85149; }
`
