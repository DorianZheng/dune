import { getJsBoxlite } from '@boxlite-ai/boxlite'
import { config } from '../config.js'

function withBoxliteInitContext<T>(work: () => T, boxliteHome: string): T {
  const previousHome = process.env.BOXLITE_HOME

  try {
    process.env.BOXLITE_HOME = boxliteHome
    return work()
  } finally {
    if (previousHome === undefined) {
      delete process.env.BOXLITE_HOME
    } else {
      process.env.BOXLITE_HOME = previousHome
    }
  }
}

export function createBoxliteRuntime(): any {
  return withBoxliteInitContext(() => {
    const JsBoxlite = getJsBoxlite()
    return JsBoxlite.withDefaultConfig()
  }, config.boxliteHome)
}

export function __resolveBoxliteHomeForInitForTests(boxliteHome: string): string {
  return boxliteHome
}

export function __withBoxliteInitContextForTests<T>(work: () => T, boxliteHome: string): T {
  return withBoxliteInitContext(work, boxliteHome)
}
