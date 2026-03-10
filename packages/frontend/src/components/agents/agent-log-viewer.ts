import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { virtualize } from '@lit-labs/virtualizer/virtualize.js'
import type { AgentLogEntry } from '@dune/shared'

type TerminalTone = 'normal' | 'muted' | 'warn' | 'error' | 'success' | 'info'
type TerminalLine = {
  key: string
  timestamp: number
  level: string
  tone: TerminalTone
  text: string
}

@customElement('agent-log-viewer')
export class AgentLogViewer extends LitElement {
  @property({ type: Array }) entries: AgentLogEntry[] = []
  @property({ type: Boolean }) wrapLines = false
  private static readonly VIRTUALIZE_THRESHOLD = 120

  static styles = css`
    :host {
      display: block;
      padding: 0 0 var(--space-md);
    }

    .empty {
      margin: 0 12px 10px;
      padding: 12px;
      border-radius: var(--radius);
      border: 1px solid color-mix(in srgb, var(--text-muted) 24%, transparent);
      background: #0b1220;
      color: #7f8ba1;
      font-size: 12px;
      font-family: var(--font-mono);
    }

    .terminal-shell {
      margin: 0 12px 10px;
      padding: 8px 10px 10px;
      border-radius: var(--radius);
      border: 1px solid color-mix(in srgb, #1e293b 80%, #334155);
      background: radial-gradient(circle at top right, #1a253a 0%, #0b1220 38%, #070d18 100%);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      overflow: visible;
    }

    .scrollback {
      overflow-x: auto;
      overflow-y: visible;
    }

    .line {
      display: flex;
      align-items: baseline;
      gap: 10px;
      min-height: 18px;
      padding: 1px 0;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.45;
      color: #e2e8f0;
      white-space: pre;
      min-width: max-content;
    }

    .line.wrap {
      white-space: pre-wrap;
      min-width: 0;
    }

    .line:hover {
      background: color-mix(in srgb, #60a5fa 8%, transparent);
    }

    .ts {
      color: #7f8ba1;
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
    }

    .level {
      width: 72px;
      flex: 0 0 72px;
      color: #9aa8c0;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .msg {
      min-width: 0;
      flex: 1 1 auto;
      color: #e2e8f0;
      overflow-x: visible;
    }

    .line.wrap .msg {
      word-break: break-word;
    }

    .line.tone-muted .level,
    .line.tone-muted .msg {
      color: #8f9db5;
    }

    .line.tone-info .level,
    .line.tone-info .msg {
      color: #93c5fd;
    }

    .line.tone-warn .level,
    .line.tone-warn .msg {
      color: #fbbf24;
    }

    .line.tone-error .level,
    .line.tone-error .msg {
      color: #fda4af;
    }

    .line.tone-success .level,
    .line.tone-success .msg {
      color: #86efac;
    }
  `

  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }

  private splitLines(raw: unknown): string[] {
    const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
    const normalized = text.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    return lines.length > 0 ? lines : ['']
  }

  private stringify(value: unknown): string {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value ?? {}, null, 2)
    } catch {
      return String(value ?? '')
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    return {}
  }

  private pushTextLines(
    output: TerminalLine[],
    entry: AgentLogEntry,
    segment: string,
    level: string,
    tone: TerminalTone,
    raw: unknown,
  ) {
    const lines = this.splitLines(raw)
    lines.forEach((line, lineIndex) => {
      output.push({
        key: `${entry.id}:${segment}:${level}:${lineIndex}`,
        timestamp: entry.timestamp,
        level,
        tone,
        text: line.length > 0 ? line : ' ',
      })
    })
  }

  private toneForRuntimeChannel(channel: string): TerminalTone {
    switch (channel) {
      case 'stderr': return 'error'
      case 'stdout': return 'info'
      case 'status': return 'success'
      case 'lifecycle': return 'warn'
      default: return 'muted'
    }
  }

  private summaryForEntry(entry: AgentLogEntry, data: Record<string, unknown>): { level: string; tone: TerminalTone; text: unknown } {
    switch (entry.type) {
      case 'text':
        return { level: 'TEXT', tone: 'normal', text: data.text ?? '' }
      case 'tool_use':
        return {
          level: 'TOOL',
          tone: 'warn',
          text: typeof data.toolName === 'string' && data.toolName.trim().length > 0 ? data.toolName : 'unknown',
        }
      case 'tool_result':
        return {
          level: 'OUTPUT',
          tone: Boolean(data.isError) ? 'error' : 'info',
          text: data.content ?? '',
        }
      case 'result': {
        const stats = [
          typeof data.durationMs === 'number' ? `duration=${(data.durationMs / 1000).toFixed(1)}s` : null,
          typeof data.numTurns === 'number' ? `turns=${data.numTurns}` : null,
          typeof data.totalCostUsd === 'number' ? `cost=$${data.totalCostUsd.toFixed(4)}` : null,
        ].filter(Boolean)
        return { level: 'RESULT', tone: 'success', text: stats.length > 0 ? stats.join(' ') : 'completed' }
      }
      case 'error':
        return { level: 'ERROR', tone: 'error', text: data.message ?? 'Unknown error' }
      case 'system':
        return { level: 'SYSTEM', tone: 'muted', text: data.message ?? '' }
      case 'user_message':
        return { level: 'USER', tone: 'info', text: data.content ?? '' }
      case 'channel_input': {
        const channels = Array.isArray(data.channels) ? data.channels.length : 0
        return { level: 'CHANNEL', tone: 'muted', text: `${channels} channel(s)` }
      }
      case 'thinking':
        return { level: 'THINK', tone: 'muted', text: '...' }
      case 'runtime': {
        const channel = typeof data.channel === 'string' ? data.channel : 'runtime'
        return {
          level: channel.toUpperCase(),
          tone: this.toneForRuntimeChannel(channel),
          text: data.message ?? '',
        }
      }
      default:
        return { level: entry.type.toUpperCase(), tone: 'muted', text: this.stringify(data) }
    }
  }

  private buildTerminalLines(entries: AgentLogEntry[]): TerminalLine[] {
    const output: TerminalLine[] = []
    for (const entry of entries) {
      const d = this.asRecord(entry.data)
      const summary = this.summaryForEntry(entry, d)
      this.pushTextLines(output, entry, 'summary', summary.level, summary.tone, summary.text)
      this.pushTextLines(output, entry, 'payload', 'DATA', 'muted', this.stringify(d))
    }
    return output
  }

  private renderLine(line: TerminalLine) {
    return html`
      <div class="line tone-${line.tone} ${this.wrapLines ? 'wrap' : ''}">
        <span class="ts">[${this.formatTime(line.timestamp)}]</span>
        <span class="level">${line.level}</span>
        <span class="msg">${line.text}</span>
      </div>
    `
  }

  private renderTerminalBody(lines: TerminalLine[]) {
    if (lines.length > AgentLogViewer.VIRTUALIZE_THRESHOLD) {
      return html`${virtualize({
        items: lines,
        renderItem: (line: TerminalLine) => this.renderLine(line),
      })}`
    }
    return html`${lines.map((line) => this.renderLine(line))}`
  }

  render() {
    const lines = this.buildTerminalLines(this.entries)
    if (lines.length === 0) {
      return html`<div class="empty">No logs yet. Waiting for stream...</div>`
    }

    return html`
      <div class="terminal-shell">
        <div class="scrollback">
          ${this.renderTerminalBody(lines)}
        </div>
      </div>
    `
  }
}
