import {serve} from '@hono/node-server'
import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {Readable} from 'node:stream'

import {getSpeech} from './cache.js'
import {config} from './config.js'
import {closeStats} from './stats.js'

const app = new Hono()

app.use(
	'*',
	cors({
		origin: '*',
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type'],
	}),
)

app.get('/health', async (c) => {
	try {
		const response = await fetch(`${config.upstreamUrl}/v1/voices`, {
			signal: AbortSignal.timeout(3000),
		})

		if (!response.ok) {
			return c.json({status: 'unhealthy', upstreamStatus: response.status}, 503)
		}

		return c.json({status: 'ok'})
	} catch {
		return c.json({status: 'unhealthy'}, 503)
	}
})

app.get('/v1/voices', async (c) => {
	try {
		const response = await fetch(`${config.upstreamUrl}/v1/voices`, {
			signal: AbortSignal.timeout(10_000),
		})

		const body = await response.arrayBuffer()

		return new Response(body, {
			status: response.status,
			headers: {
				'content-type':
					response.headers.get('content-type') ?? 'application/json',
			},
		})
	} catch {
		return c.json({error: 'Kokoro server unavailable'}, 502)
	}
})

app.post('/v1/audio/speech', async (c) => {
	let body: unknown

	try {
		body = await c.req.json()
	} catch {
		return c.json({error: 'Invalid JSON body'}, 400)
	}

	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return c.json({error: 'Expected a JSON object'}, 400)
	}

	const input = body as Record<string, unknown>

	if (
		typeof input.input !== 'string' ||
		input.input.trim().length === 0 ||
		typeof input.voice !== 'string' ||
		input.voice.trim().length === 0
	) {
		return c.json({error: 'input and voice must be non-empty strings'}, 400)
	}

	const speed = input.speed ?? 1
	const volumeMultiplier = input.volume_multiplier ?? 1

	if (
		typeof speed !== 'number' ||
		!Number.isFinite(speed) ||
		speed <= 0 ||
		typeof volumeMultiplier !== 'number' ||
		!Number.isFinite(volumeMultiplier) ||
		volumeMultiplier <= 0
	) {
		return c.json(
			{error: 'speed and volume_multiplier must be positive numbers'},
			400,
		)
	}

	try {
		const audio = await getSpeech({
			input: input.input,
			voice: input.voice,
			speed,
			volume_multiplier: volumeMultiplier,
		})

		const stream =
			audio.body instanceof Readable
				? Readable.toWeb(audio.body)
				: Readable.toWeb(Readable.from([audio.body]))

		return new Response(stream as globalThis.ReadableStream<Uint8Array>, {
			headers: {
				'content-type': 'audio/mpeg',
				'content-length': String(audio.size),
				'cache-control': 'no-store',
			},
		})
	} catch (error) {
		console.error('Speech synthesis failed:', error)

		return c.json({error: 'Speech synthesis failed'}, 502)
	}
})

const server = serve({
	fetch: app.fetch,
	hostname: config.host,
	port: config.port,
})

console.log(`Kokoro proxy listening on http://${config.host}:${config.port}`)

let shuttingDown = false

async function shutdown(): Promise<void> {
	if (shuttingDown) return
	shuttingDown = true

	server.close()

	try {
		await closeStats()
	} catch (error) {
		console.error('Failed to flush usage stats:', error)
		process.exitCode = 1
	}
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

export {app}
