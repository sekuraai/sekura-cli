import { DEFAULT_ORIGIN, ENDPOINT_VAR, parseOrigin } from './origin.js'

export { DEFAULT_ORIGIN }

export function configuredOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const value = env[ENDPOINT_VAR]?.trim()
  return value ? parseOrigin(value) : DEFAULT_ORIGIN
}

export const ORIGIN = configuredOrigin()
export const isDefaultOrigin = (): boolean => ORIGIN === DEFAULT_ORIGIN
export const SITE = new URL(ORIGIN).host
export const siteUrl = (path: string): string => `${ORIGIN}${path}`
