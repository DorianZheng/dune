import { nanoid } from 'nanoid'

/** 12-char ID for primary entities (agents, channels, sandboxes). */
export const newId = () => nanoid(12)

/** 16-char ID for high-volume items (messages, log entries). */
export const newEventId = () => nanoid(16)
