#!/usr/bin/env node
import {readFileSync} from 'node:fs'
import {Readable} from 'node:stream'

import {serve} from '@hono/node-server'
import {Hono} from 'hono'
import {cors} from 'hono/cors'

import {getSpeech} from './cache.js'
import {config} from './config.js'
import {closeStats} from './stats.js'

const app = new Hono()

const UPSTREAM_CHECK_INTERVAL = 3000
const UPSTREAM_CHECK_TIMEOUT = 2000

let upstreamAvailable = false

async function checkUpstream(): Promise<boolean> {
	try {
		const response = await fetch(`${config.upstreamUrl}/health`, {
			signal: AbortSignal.timeout(UPSTREAM_CHECK_TIMEOUT),
		})

		return response.ok
	} catch {
		return false
	}
}

upstreamAvailable = await checkUpstream()

app.use(
	'*',
	cors({
		origin: function (origin) {
			if (/^https?:\/\/localhost(?::\d+)?$/.test(origin)) {
				return origin
			}

			return config.corsOrigins.includes(origin) ? origin : null
		},
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	}),
)

app.get('/health', async (c) => {
	try {
		const response = await fetch(`${config.upstreamUrl}/health`, {
			signal: AbortSignal.timeout(3000),
		})

		return new Response(response.body, {
			status: response.status,
			headers: {
				'content-type':
					response.headers.get('content-type') ?? 'application/json',
			},
		})
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

app.get('/v1/audio/speech', async (c) => {
	const input = c.req.query('input')
	const voice = c.req.query('voice')
	const speed = Number(c.req.query('speed') ?? 1)
	const volumeMultiplier = Number(c.req.query('volume_multiplier') ?? 1)

	if (!input?.trim() || !voice?.trim()) {
		return c.json({error: 'input and voice must be non-empty strings'}, 400)
	}

	if (
		!Number.isFinite(speed) ||
		speed <= 0 ||
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
			input,
			voice,
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
				// 'cache-control': 'private, max-age=86400',
				'cache-control': 'private, max-age=31536000, immutable',
			},
		})
	} catch (error) {
		console.error('Speech synthesis failed:', error)
		return c.json({error: 'Speech synthesis failed'}, 502)
	}
})

app.post('/v1/audio/speech', async (c) => {
	return c.json({error: 'POST endpoint temporarily disabled'}, 410)
	// let body: unknown
	//
	// try {
	// 	body = await c.req.json()
	// } catch {
	// 	return c.json({error: 'Invalid JSON body'}, 400)
	// }
	//
	// if (body === null || typeof body !== 'object' || Array.isArray(body)) {
	// 	return c.json({error: 'Expected a JSON object'}, 400)
	// }
	//
	// const input = body as Record<string, unknown>
	//
	// if (
	// 	typeof input.input !== 'string' ||
	// 	input.input.trim().length === 0 ||
	// 	typeof input.voice !== 'string' ||
	// 	input.voice.trim().length === 0
	// ) {
	// 	return c.json({error: 'input and voice must be non-empty strings'}, 400)
	// }
	//
	// const speed = input.speed ?? 1
	// const volumeMultiplier = input.volume_multiplier ?? 1
	//
	// if (
	// 	typeof speed !== 'number' ||
	// 	!Number.isFinite(speed) ||
	// 	speed <= 0 ||
	// 	typeof volumeMultiplier !== 'number' ||
	// 	!Number.isFinite(volumeMultiplier) ||
	// 	volumeMultiplier <= 0
	// ) {
	// 	return c.json(
	// 		{error: 'speed and volume_multiplier must be positive numbers'},
	// 		400,
	// 	)
	// }
	//
	// try {
	// 	const audio = await getSpeech({
	// 		input: input.input,
	// 		voice: input.voice,
	// 		speed,
	// 		volume_multiplier: volumeMultiplier,
	// 	})
	//
	// 	const stream =
	// 		audio.body instanceof Readable
	// 			? Readable.toWeb(audio.body)
	// 			: Readable.toWeb(Readable.from([audio.body]))
	//
	// 	return new Response(stream as globalThis.ReadableStream<Uint8Array>, {
	// 		headers: {
	// 			'content-type': 'audio/mpeg',
	// 			'content-length': String(audio.size),
	// 			'cache-control': 'no-store',
	// 		},
	// 	})
	// } catch (error) {
	// 	console.error('Speech synthesis failed:', error)
	//
	// 	return c.json({error: 'Speech synthesis failed'}, 502)
	// }
})

const server = serve({
	fetch: app.fetch,
	hostname: config.host,
	port: config.port,
})

await new Promise<void>(function (resolve, reject) {
	server.once('listening', resolve)
	server.once('error', reject)
})

const {version} = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {version: string}

const c = {
	reset: '\x1B[0m',
	bold: '\x1B[1m',
	dim: '\x1B[2m',
	green: '\x1B[32m',
	red: '\x1B[31m',
	cyan: '\x1B[36m',
	yellow: '\x1B[33m',
	magenta: '\x1B[35m',
}

const corsOrigins = config.corsOrigins

console.log(`
${c.magenta}${c.bold}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                 KOKORO PROXY                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${c.reset}

  ${c.dim}SERVER${c.reset}
  ${c.bold}Version${c.reset}          ${version}
  ${c.bold}Address${c.reset}          http://${config.host}:${config.port}

  ${c.dim}UPSTREAM${c.reset}
  ${c.bold}Endpoint${c.reset}         ${config.upstreamUrl}
  ${c.bold}Status${c.reset}           ${
		upstreamAvailable
			? `${c.green}● Connected${c.reset}`
			: `${c.red}● UNREACHABLE${c.reset}`
	}

  ${c.dim}STORAGE${c.reset}
  ${c.bold}Cache directory${c.reset}  ${config.cacheDir}

  ${c.dim}CORS ORIGINS (${corsOrigins.length + 1})${c.reset}
  ${c.green}●${c.reset} http://localhost:*
${
	corsOrigins.length
		? corsOrigins
				.map((origin) => `  ${c.green}●${c.reset} ${origin}`)
				.join('\n')
		: `  ${c.red}● No additional origins configured${c.reset}`
}

${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`)

let checkingUpstream = false

const upstreamMonitor = setInterval(async function () {
	if (checkingUpstream || shuttingDown) return

	checkingUpstream = true

	try {
		const available = await checkUpstream()

		if (available !== upstreamAvailable) {
			upstreamAvailable = available

			if (available) {
				console.log(`${c.green}[UPSTREAM] Connection restored.${c.reset}`)
			} else {
				console.log(`${c.red}[UPSTREAM] Connection lost!${c.reset}`)
			}
		}
	} finally {
		checkingUpstream = false
	}
}, UPSTREAM_CHECK_INTERVAL)

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) return
	shuttingDown = true

	console.log(`\nReceived ${signal}. Shutting down Kokoro Proxy...`)

	clearInterval(upstreamMonitor)

	server.close()

	try {
		await closeStats()
		console.log('Usage stats flushed successfully.')
	} catch (error) {
		console.error('Failed to flush usage stats:', error)
		process.exitCode = 1
	}

	console.log('Kokoro Proxy stopped.')
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

export {app}
