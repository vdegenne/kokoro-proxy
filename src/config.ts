import {homedir} from 'node:os'
import {join, resolve} from 'node:path'

function getPositiveInteger(name: string, fallback: number): number {
	const value = process.env[name]

	if (value === undefined) return fallback

	const parsed = Number(value)

	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}

	return parsed
}

function getUrl(name: string, fallback: string): string {
	const value = process.env[name] ?? fallback

	try {
		return new URL(value).toString().replace(/\/$/, '')
	} catch {
		throw new Error(`${name} must be a valid URL`)
	}
}

const mib = 1024 * 1024

export const config = {
	host: process.env.HOST ?? '127.0.0.1',
	port: getPositiveInteger('PORT', 3000),

	upstreamUrl: getUrl('KOKORO_URL', 'http://127.0.0.1:8880'),

	cacheDir: resolve(
		process.env.CACHE_DIR ?? join(homedir(), '.cache', 'kokoro-proxxy'),
	),

	memoryCacheMaxBytes: getPositiveInteger('MEMORY_CACHE_MAX_BYTES', 100 * mib),

	statsFlushIntervalMs: getPositiveInteger('STATS_FLUSH_INTERVAL_MS', 30_000),
} as const
