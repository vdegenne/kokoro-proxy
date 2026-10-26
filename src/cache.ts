import {randomUUID} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
import {mkdir, readFile, rename, stat, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import {config} from './config.js'
import {getCacheKey, type SpeechOptions} from './hash.js'
import {recordUsage} from './stats.js'

export interface CachedAudio {
	body: Buffer | Readable
	size: number
}

interface MemoryEntry {
	data: Buffer
}

const memoryCache = new Map<string, MemoryEntry>()
const inFlight = new Map<string, Promise<void>>()

let memoryCacheSize = 0

function getDiskPath(hash: string): string {
	return join(
		config.cacheDir,
		'audio',
		hash.slice(0, 2),
		hash.slice(2, 4),
		`${hash}.mp3`,
	)
}

function getMemory(hash: string): Buffer | undefined {
	const entry = memoryCache.get(hash)

	if (!entry) return undefined

	// Refresh insertion order to implement LRU.
	memoryCache.delete(hash)
	memoryCache.set(hash, entry)

	return entry.data
}

function setMemory(hash: string, data: Buffer): void {
	if (data.length > config.memoryCacheMaxBytes) return

	const previous = memoryCache.get(hash)

	if (previous) {
		memoryCacheSize -= previous.data.length
		memoryCache.delete(hash)
	}

	while (memoryCacheSize + data.length > config.memoryCacheMaxBytes) {
		const oldest = memoryCache.keys().next().value as string | undefined

		if (oldest === undefined) break

		const entry = memoryCache.get(oldest)!

		memoryCacheSize -= entry.data.length
		memoryCache.delete(oldest)
	}

	memoryCache.set(hash, {data})
	memoryCacheSize += data.length
}

async function getDiskAudio(hash: string): Promise<CachedAudio | undefined> {
	const path = getDiskPath(hash)

	let fileSize: number

	try {
		fileSize = (await stat(path)).size
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined
		}

		throw error
	}

	if (fileSize <= config.memoryCacheMaxBytes) {
		const data = await readFile(path)
		setMemory(hash, data)

		return {body: data, size: data.length}
	}

	return {
		body: createReadStream(path),
		size: fileSize,
	}
}

async function synthesize(options: SpeechOptions, hash: string): Promise<void> {
	const path = getDiskPath(hash)
	const directory = join(path, '..')
	const tempPath = `${path}.${randomUUID()}.tmp`

	await mkdir(directory, {recursive: true})

	try {
		const response = await fetch(`${config.upstreamUrl}/v1/audio/speech`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				model: 'tts-1',
				input: options.input,
				voice: options.voice,
				speed: options.speed,
				volume_multiplier: options.volume_multiplier,
				response_format: 'mp3',
			}),
		})

		if (!response.ok) {
			const details = await response.text().catch(() => '')

			throw new Error(
				`Kokoro returned HTTP ${response.status}` +
					(details ? `: ${details}` : ''),
			)
		}

		if (!response.body) {
			throw new Error('Kokoro returned an empty response body')
		}

		await pipeline(
			response.body as unknown as import('node:stream/web').ReadableStream,
			createWriteStream(tempPath, {flags: 'wx'}),
		)

		await rename(tempPath, path)

		const fileSize = (await stat(path)).size

		if (fileSize <= config.memoryCacheMaxBytes) {
			try {
				setMemory(hash, await readFile(path))
			} catch {
				// The disk cache remains usable if memory caching fails.
			}
		}
	} finally {
		await unlink(tempPath).catch(() => {})
	}
}

export async function getSpeech(options: SpeechOptions): Promise<CachedAudio> {
	const hash = getCacheKey(options)

	let audio = getMemory(hash)

	if (audio) {
		recordUsage(hash)
		return {body: audio, size: audio.length}
	}

	const cached = await getDiskAudio(hash)

	if (cached) {
		recordUsage(hash)
		return cached
	}

	let pending = inFlight.get(hash)

	if (!pending) {
		pending = synthesize(options, hash)
		inFlight.set(hash, pending)

		void pending.then(
			() => {
				if (inFlight.get(hash) === pending) {
					inFlight.delete(hash)
				}
			},
			() => {
				if (inFlight.get(hash) === pending) {
					inFlight.delete(hash)
				}
			},
		)
	}

	await pending

	audio = getMemory(hash)

	if (audio) {
		recordUsage(hash)
		return {body: audio, size: audio.length}
	}

	const result = await getDiskAudio(hash)

	if (!result) {
		throw new Error('Audio was generated but is missing from the disk cache')
	}

	recordUsage(hash)
	return result
}
