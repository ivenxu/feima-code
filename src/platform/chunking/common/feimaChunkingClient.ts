/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CallTracker } from '../../../util/common/telemetryCorrelationId';
import { raceCancellationError } from '../../../util/vs/base/common/async';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Range } from '../../../util/vs/editor/common/core/range';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IAuthenticationService } from '../../authentication/common/authentication';
import { IFeimaAuthenticationService } from '../../authentication/common/feimaAuthentication';
import { Embedding, EmbeddingType, EmbeddingVector } from '../../embeddings/common/embeddingsComputer';
import { IFeimaConfigService } from '../../feima/common/feimaConfigService';
import { ILogService } from '../../log/common/logService';
import { IFetcherService } from '../../networking/common/fetcherService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { FileChunkWithEmbedding, FileChunkWithOptionalEmbedding } from './chunk';
import { ChunkableContent, ComputeBatchInfo, EmbeddingsComputeQos, IChunkingEndpointClient } from './chunkingEndpointClient';
import { ChunkingEndpointClientImpl } from './chunkingEndpointClientImpl';
import { stripChunkTextMetadata } from './chunkingStringUtils';

type FeimaChunksEndpointResponse = {
	readonly chunks: readonly {
		readonly hash: string;
		readonly range: { start: number; end: number };
		readonly line_range: { start: number; end: number };
		readonly text?: string;
		readonly embedding?: { model: string; embedding: EmbeddingVector };
	}[];
	readonly embedding_model: string;
};

/**
 * Feima-aware chunking client that routes to Feima API or GitHub CAPI based on preferFeimaModels config.
 *
 * Routing priority:
 * 1. If preferFeimaModels is true → Use Feima API /v1/chunks, fallback to GitHub CAPI if fails
 * 2. If preferFeimaModels is false → Use GitHub CAPI /chunks, fallback to Feima API if fails
 */
export class FeimaChunkingClient extends Disposable implements IChunkingEndpointClient {
	declare readonly _serviceBrand: undefined;

	/**
	 * The original GitHub CAPI client for fallback
	 */
	private readonly _githubClient: ChunkingEndpointClientImpl;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IFeimaAuthenticationService private readonly _feimaAuthService: IFeimaAuthenticationService,
		@IFeimaConfigService private readonly _feimaConfig: IFeimaConfigService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();

		// Create the original GitHub client for fallback
		this._githubClient = this._register(instantiationService.createInstance(ChunkingEndpointClientImpl));
	}

	public async computeChunks(
		authToken: string,
		embeddingType: EmbeddingType,
		content: ChunkableContent,
		batchInfo: ComputeBatchInfo,
		qos: EmbeddingsComputeQos,
		cache: ReadonlyMap<string, FileChunkWithEmbedding> | undefined,
		telemetryInfo: CallTracker,
		token: CancellationToken
	): Promise<readonly FileChunkWithOptionalEmbedding[] | undefined> {
		// Fetch authentication tokens for both backends
		const feimaToken = await this._feimaAuthService.getToken();
		const githubToken = (await this._authService.getCopilotToken()).token;

		// Route based on preferFeimaModels config
		return this.routeRequest(
			() => this.doFeimaChunks(feimaToken!, embeddingType, content, batchInfo, qos, cache, telemetryInfo, false, token),
			() => this._githubClient.computeChunks(githubToken, embeddingType, content, batchInfo, qos, cache, telemetryInfo, token),
			telemetryInfo,
			token
		);
	}

	public async computeChunksAndEmbeddings(
		authToken: string,
		embeddingType: EmbeddingType,
		content: ChunkableContent,
		batchInfo: ComputeBatchInfo,
		qos: EmbeddingsComputeQos,
		cache: ReadonlyMap<string, FileChunkWithEmbedding> | undefined,
		telemetryInfo: CallTracker,
		token: CancellationToken
	): Promise<readonly FileChunkWithEmbedding[] | undefined> {
		// Fetch authentication tokens for both backends
		const feimaToken = await this._feimaAuthService.getToken();
		const githubToken = (await this._authService.getCopilotToken()).token;

		// Route based on preferFeimaModels config
		const result = await this.routeRequest(
			() => this.doFeimaChunks(feimaToken!, embeddingType, content, batchInfo, qos, cache, telemetryInfo, true, token),
			() => this._githubClient.computeChunksAndEmbeddings(githubToken, embeddingType, content, batchInfo, qos, cache, telemetryInfo, token),
			telemetryInfo,
			token
		);
		return result as FileChunkWithEmbedding[] | undefined;
	}

	/**
	 * Route request to Feima or GitHub based on preferFeimaModels config.
	 */
	private async routeRequest<T>(
		feimaOperation: () => Promise<T>,
		githubOperation: () => Promise<T>,
		telemetryInfo: CallTracker,
		token: CancellationToken
	): Promise<T> {
		// Check if Feima models are preferred
		const preferFeima = this._feimaConfig.getConfig().preferFeimaModels;

		if (preferFeima) {
			this._logService.debug('[FeimaChunkingClient] Using Feima API for chunks');

			/* __GDPR__
				"feimaChunkingClient.routeToFeima" : {
					"owner": "feima",
					"comment": "Tracks when chunks are routed to Feima API",
					"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" }
				}
			*/
			this._telemetryService.sendMSFTTelemetryEvent('feimaChunkingClient.routeToFeima', {
				source: telemetryInfo.toString(),
			});

			try {
				return await raceCancellationError(feimaOperation(), token);
			} catch (e) {
				this._logService.error('[FeimaChunkingClient] Feima API failed, falling back to GitHub', e);

				/* __GDPR__
					"feimaChunkingClient.feimaFallbackToGithub" : {
						"owner": "feima",
						"comment": "Tracks when Feima API fails and falls back to GitHub",
						"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" },
						"error": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Error message" }
					}
				*/
				this._telemetryService.sendMSFTTelemetryEvent('feimaChunkingClient.feimaFallbackToGithub', {
					source: telemetryInfo.toString(),
					error: e instanceof Error ? e.message : String(e),
				});

				// Fallback to GitHub if Feima fails
				return await raceCancellationError(githubOperation(), token);
			}
		}

		// Use GitHub CAPI
		this._logService.debug('[FeimaChunkingClient] Using GitHub CAPI for chunks');

		/* __GDPR__
			"feimaChunkingClient.routeToGithub" : {
				"owner": "feima",
				"comment": "Tracks when chunks are routed to GitHub CAPI",
				"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent('feimaChunkingClient.routeToGithub', {
			source: telemetryInfo.toString(),
		});

		try {
			return await raceCancellationError(githubOperation(), token);
		} catch (e) {
			this._logService.error('[FeimaChunkingClient] GitHub CAPI failed, falling back to Feima', e);

			/* __GDPR__
				"feimaChunkingClient.githubFallbackToFeima" : {
					"owner": "feima",
					"comment": "Tracks when GitHub CAPI fails and falls back to Feima",
					"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" },
					"error": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Error message" }
				}
			*/
			this._telemetryService.sendMSFTTelemetryEvent('feimaChunkingClient.githubFallbackToFeima', {
				source: telemetryInfo.toString(),
				error: e instanceof Error ? e.message : String(e),
			});

			// Fallback to Feima if GitHub fails
			return await raceCancellationError(feimaOperation(), token);
		}
	}

	/**
	 * Call Feima API /v1/chunks endpoint.
	 */
	private async doFeimaChunks(
		authToken: string,
		embeddingType: EmbeddingType,
		content: ChunkableContent,
		batchInfo: ComputeBatchInfo,
		qos: EmbeddingsComputeQos,
		cache: ReadonlyMap<string, FileChunkWithEmbedding> | undefined,
		telemetryInfo: CallTracker,
		computeEmbeddings: boolean,
		token: CancellationToken
	): Promise<readonly FileChunkWithOptionalEmbedding[] | undefined> {
		const text = await raceCancellationError(content.getText(), token);
		if (!text || text.trim().length === 0) {
			return [];
		}

		const feimaApiUrl = this._feimaConfig.getConfig().apiBaseUrl;
		if (!feimaApiUrl) {
			throw new Error('Feima API URL not configured');
		}

		// Map QoS enum to backend-expected strings
		const qosString = qos === EmbeddingsComputeQos.Batch ? 'low' : 'high';

		try {
			this._logService.debug(`[FeimaChunkingClient] Calling Feima API: ${feimaApiUrl}/chunks`);

			const response = await raceCancellationError(
				this._fetcherService.fetch(`${feimaApiUrl}/chunks`, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${authToken}`,
						'Content-Type': 'application/json',
					},
					json: {
						embed: computeEmbeddings,
						qos: qosString,
						content: text,
						path: content.uri.path,
						local_hashes: cache ? Array.from(cache.keys()) : [],
						language_id: content.githubLanguageId ?? 0,
						embedding_model: embeddingType.id,
					},
				}),
				token
			);

			if (!response.ok) {
				let errorDetail = '';
				try {
					const errorBody = await response.json();
					errorDetail = JSON.stringify(errorBody);
					this._logService.error(`[FeimaChunkingClient] Error from Feima API. Status: ${response.status}. Status Text: ${response.statusText}. Detail: ${errorDetail}`);
				} catch {
					this._logService.error(`[FeimaChunkingClient] Error from Feima API. Status: ${response.status}. Status Text: ${response.statusText}.`);
				}

				/* __GDPR__
					"feimaChunkingClient.apiError" : {
						"owner": "feima",
						"comment": "Tracks errors from Feima chunks API",
						"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" },
						"responseStatus": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "HTTP status code" }
					}
				*/
				this._telemetryService.sendMSFTTelemetryEvent('feimaChunkingClient.apiError', {
					source: telemetryInfo.toString(),
				}, {
					responseStatus: response.status,
				});

				return undefined;
			}

			batchInfo.recomputedFileCount++;
			batchInfo.sentContentTextLength += text.length;

			const body: FeimaChunksEndpointResponse = await response.json();
			if (!body.chunks || body.chunks.length === 0) {
				return [];
			}

			this._logService.debug(`[FeimaChunkingClient] Received ${body.chunks.length} chunks from Feima API`);

			// Transform Feima response to internal format
			const results: FileChunkWithOptionalEmbedding[] = [];
			for (const chunk of body.chunks) {
				const range = new Range(chunk.line_range.start, 0, chunk.line_range.end, 0);

				// Check cache
				const cached = cache?.get(chunk.hash);
				if (cached) {
					results.push({
						chunk: {
							file: content.uri,
							text: stripChunkTextMetadata(cached.chunk.text),
							rawText: undefined,
							range,
							isFullFile: cached.chunk.isFullFile,
						},
						chunkHash: chunk.hash,
						embedding: cached.embedding,
					});
					continue;
				}

				// Validate chunk has text
				if (typeof chunk.text !== 'string') {
					this._logService.warn(`[FeimaChunkingClient] Invalid chunk without text, skipping`);
					continue;
				}

				// Parse embedding if present
				let embedding: Embedding | undefined;
				if (chunk.embedding?.embedding) {
					const returnedEmbeddingsType = new EmbeddingType(body.embedding_model);
					if (!returnedEmbeddingsType.equals(embeddingType)) {
						throw new Error(`Unexpected embedding model from Feima. Got: ${returnedEmbeddingsType}. Expected: ${embeddingType}`);
					}

					embedding = {
						type: returnedEmbeddingsType,
						value: chunk.embedding.embedding
					};
				}

				// Validate embeddings are present if requested
				if (computeEmbeddings && !embedding) {
					this._logService.warn(`[FeimaChunkingClient] Chunk missing embedding when embed=true, skipping`);
					continue;
				}

				results.push({
					chunk: {
						file: content.uri,
						text: stripChunkTextMetadata(chunk.text),
						rawText: undefined,
						range,
						isFullFile: false,
					},
					chunkHash: chunk.hash,
					embedding: embedding
				});
			}

			return results;

		} catch (e) {
			this._logService.error('[FeimaChunkingClient] Exception calling Feima API', e);
			throw e;
		}
	}
}
