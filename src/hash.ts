import {createHash} from 'node:crypto'

export interface SpeechOptions {
	input: string
	voice: string
	speed: number
	volume_multiplier: number
}

export function getCacheKey(options: SpeechOptions): string {
	const payload = JSON.stringify([
		options.input,
		options.voice,
		options.speed,
		options.volume_multiplier,
	])

	return createHash('sha256').update(payload).digest('hex')
}
