import {randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {config} from './config.js'

type UsageCounts = Record<string, number>

const statsPath = join(config.cacheDir, 'stats.json')
const pending: UsageCounts = {}

let flushPromise: Promise<void> | undefined

async function readStats(): Promise<UsageCounts> {
	try {
		const content = await readFile(statsPath, 'utf8')
		const parsed: unknown = JSON.parse(content)

		if (
			parsed === null ||
			typeof parsed !== 'object' ||
			Array.isArray(parsed)
		) {
			throw new Error('Invalid stats.json format')
		}

		return parsed as UsageCounts
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return {}
		}

		throw error
	}
}

export function recordUsage(hash: string): void {
	pending[hash] = (pending[hash] ?? 0) + 1
}

async function flushStats(): Promise<void> {
	const snapshot = {...pending}

	for (const hash of Object.keys(snapshot)) {
		delete pending[hash]
	}

	if (Object.keys(snapshot).length === 0) return

	try {
		await mkdir(dirname(statsPath), {recursive: true})

		const stats = await readStats()

		for (const [hash, count] of Object.entries(snapshot)) {
			stats[hash] = (stats[hash] ?? 0) + count
		}

		const tempPath = `${statsPath}.${randomUUID()}.tmp`

		try {
			await writeFile(tempPath, JSON.stringify(stats), 'utf8')
			await rename(tempPath, statsPath)
		} catch (error) {
			const {unlink} = await import('node:fs/promises')
			await unlink(tempPath).catch(() => {})
			throw error
		}
	} catch (error) {
		for (const [hash, count] of Object.entries(snapshot)) {
			pending[hash] = (pending[hash] ?? 0) + count
		}

		throw error
	}
}

function scheduleFlush(): void {
	if (flushPromise) return

	flushPromise = flushStats()
		.catch((error: unknown) => {
			console.error('Failed to persist usage stats:', error)
		})
		.finally(() => {
			flushPromise = undefined
		})
}

const timer = setInterval(scheduleFlush, config.statsFlushIntervalMs)
timer.unref()

export async function closeStats(): Promise<void> {
	clearInterval(timer)

	if (flushPromise) {
		await flushPromise
	}

	await flushStats()
}
