export interface SpeechOptions {
	input: string
	voice: string
	speed: number
	volume_multiplier: number
}

export async function getCacheKey(options: SpeechOptions): Promise<string> {
	const payload = JSON.stringify([
		options.input,
		options.voice,
		options.speed,
		options.volume_multiplier,
	])

	const data = new TextEncoder().encode(payload)
	const hash = await crypto.subtle.digest('SHA-256', data)

	return Array.from(new Uint8Array(hash))
		.map(function (byte) {
			return byte.toString(16).padStart(2, '0')
		})
		.join('')
}

export function getAudioPath(hash: string): string {
	return `audio/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.mp3`
}
