import type { Agent } from '@dune/shared'

/** Parse @mentions from message content, returning matched agent IDs. */
export function parseMentions(content: string, agents: Agent[]): string[] {
  return agents
    .filter(a => {
      const pattern = new RegExp(`@${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s,.!?;:)\\]}>]|$)`)
      return pattern.test(content)
    })
    .map(a => a.id)
}
