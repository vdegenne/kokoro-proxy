import {randomUUID} from 'node:crypto'
import {
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {config} from './config.js'

type UsageCounts = Record<string, number>

const gib = 1024 ** 3

const maxBytes = Number(process.env.DISK_CACHE_MAX_BYTES ?? 5 * gib)

if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
	throw new Error('DISK_CACHE_MAX_BYTES must be a positive integer')
}

const audioDir = join(config.cacheDir, 'audio')
const statsPath = join(config.cacheDir, 'stats.json')

function getAudioPath(hash: string): string {
	return join(audioDir, hash.slice(0, 2), hash.slice(2, 4), `${hash}.mp3`)
}

async function main(): Promise<void> {
	let stats: UsageCounts

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

		stats = parsed as UsageCounts
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			console.log('No stats.json found. Nothing to clean.')
			return
		}

		throw error
	}

	const entries = Object.entries(stats).filter(
		([hash, count]) =>
			/^[a-f0-9]{64}$/.test(hash) && Number.isSafeInteger(count) && count >= 0,
	)

	const files: {
		hash: string
		path: string
		size: number
		uses: number
		mtimeMs: number
	}[] = []

	let totalBytes = 0

	for (const [hash, uses] of entries) {
		const path = getAudioPath(hash)

		try {
			const info = await stat(path)

			if (!info.isFile()) continue

			files.push({
				hash,
				path,
				size: info.size,
				uses,
				mtimeMs: info.mtimeMs,
			})

			totalBytes += info.size
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error
			}

			// Remove stale statistics for files that no longer exist.
			delete stats[hash]
		}
	}

	const initialBytes = totalBytes

	// Least-used files first; oldest files break ties.
	files.sort((a, b) => a.uses - b.uses || a.mtimeMs - b.mtimeMs)

	let deletedFiles = 0

	for (const file of files) {
		if (totalBytes <= maxBytes) break

		await unlink(file.path)

		totalBytes -= file.size
		delete stats[file.hash]
		deletedFiles++

		console.log(
			`Deleted ${file.hash}.mp3 (${file.size} bytes, ${file.uses} uses)`,
		)
	}

	if (deletedFiles > 0 || files.length !== entries.length) {
		await mkdir(dirname(statsPath), {recursive: true})

		const tempPath = `${statsPath}.${randomUUID()}.tmp`

		try {
			await writeFile(tempPath, JSON.stringify(stats), 'utf8')
			await rename(tempPath, statsPath)
		} finally {
			await unlink(tempPath).catch(() => {})
		}
	}

	console.log(
		`Cache: ${(initialBytes / gib).toFixed(2)} GiB → ` +
			`${(totalBytes / gib).toFixed(2)} GiB`,
	)
	console.log(`Deleted ${deletedFiles} file(s).`)

	if (totalBytes > maxBytes) {
		console.log(
			'Cache remains above the limit. Some audio files may not be tracked in stats.json.',
		)
	}
}

main().catch((error: unknown) => {
	console.error('Cache cleanup failed:', error)
	process.exitCode = 1
})
