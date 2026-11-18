import {FetchOptions, KokoroClient} from '@vdegenne/kokoro'

import {SpeechOptions} from './core.js'

/**
 * Specialized Kokoro client for proxy servers.
 * Uses GET requests for audio synthesis to enable HTTP browser caching,
 * while keeping the standard KokoroClient API.
 */
export class KokoroProxyClient extends KokoroClient {
	protected override async fetchAudio(
		options: SpeechOptions,
		fetchOptions: FetchOptions,
	): Promise<Blob> {
		const params = new URLSearchParams({
			input: options.input,
			voice: options.voice ?? 'af_heart',
			speed: String(options.speed ?? 1),
			volume_multiplier: String(options.volume_multiplier ?? 1),
		})

		const response = await this.fetch(
			`${this.endpoint}/v1/audio/speech?${params}`,
			{
				headers: new Headers(fetchOptions.headers),
			},
		)

		if (!response.ok) {
			throw await this.createResponseError(
				response,
				'Kokoro TTS synthesis failed',
			)
		}

		return response.blob()
	}
}
