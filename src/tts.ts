import {KokoroClient, type Voice} from '@vdegenne/kokoro'

/**
 * Specialized Kokoro client for proxy servers.
 * Uses GET requests for audio synthesis to enable HTTP browser caching,
 * while keeping the standard KokoroClient API.
 */
export class KokoroProxyClient extends KokoroClient {
	protected override async fetchAudio(
		sentence: string,
		voiceId: Voice,
		speed: number,
		volume_multiplier: number,
		headers: HeadersInit = {},
	): Promise<Blob> {
		const params = new URLSearchParams({
			input: sentence,
			voice: voiceId,
			speed: String(speed),
			volume_multiplier: String(volume_multiplier),
		})

		const response = await fetch(`${this.endpoint}/v1/audio/speech?${params}`, {
			method: 'GET',
			headers,
		})

		if (!response.ok) {
			throw new Error(
				`Kokoro proxy error: ${response.status} ${response.statusText}`,
			)
		}

		return response.blob()
	}
}
