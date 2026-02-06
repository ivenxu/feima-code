/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { TelemetryCorrelationId } from '../../../util/common/telemetryCorrelationId';
import { raceCancellationError } from '../../../util/vs/base/common/async';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IFeimaAuthenticationService } from '../../authentication/common/feimaAuthentication';
import { IFeimaConfigService } from '../../feima/common/feimaConfigService';
import { ILogService } from '../../log/common/logService';
import { IFetcherService } from '../../networking/common/fetcherService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { ComputeEmbeddingsOptions, Embedding, Embeddings, EmbeddingType, IEmbeddingsComputer } from './embeddingsComputer';
import { RemoteEmbeddingsComputer } from './remoteEmbeddingsComputer';

type FeimaEmbeddingsResponse = {
	readonly object: string;
	readonly data: readonly {
		readonly object: string;
		readonly index: number;
		readonly embedding: number[];
	}[];
	readonly model: string;
	readonly usage: {
		readonly prompt_tokens: number;
		readonly total_tokens: number;
	};
};

/**
 * Feima-aware embeddings computer that routes to Feima API or GitHub CAPI based on preferFeimaModels config.
 *
 * Routing priority:
 * 1. If preferFeimaModels is true → Use Feima API /v1/embeddings, fallback to GitHub if fails
 * 2. If preferFeimaModels is false → Use GitHub (RemoteEmbeddingsComputer), fallback to Feima if fails
 */
export class FeimaEmbeddingsComputer extends Disposable implements IEmbeddingsComputer {
	declare readonly _serviceBrand: undefined;

	/**
	 * The original GitHub embeddings computer for fallback
	 */
	private readonly _githubComputer: RemoteEmbeddingsComputer;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IFeimaAuthenticationService private readonly _feimaAuthService: IFeimaAuthenticationService,
		@IFeimaConfigService private readonly _feimaConfig: IFeimaConfigService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();

		// Create the original GitHub computer (not registered as disposable - it has its own lifecycle)
		this._githubComputer = instantiationService.createInstance(RemoteEmbeddingsComputer);
	}

	public async computeEmbeddings(
		embeddingType: EmbeddingType,
		inputs: readonly string[],
		options?: ComputeEmbeddingsOptions,
		telemetryInfo?: TelemetryCorrelationId,
		cancellationToken?: CancellationToken,
	): Promise<Embeddings> {
		// Fetch authentication token for Feima
		const feimaToken = await this._feimaAuthService.getToken();

		// Route based on preferFeimaModels config
		return this.routeRequest(
			embeddingType,
			inputs,
			options,
			() => this.doFeimaEmbeddings(feimaToken!, embeddingType, inputs, options, false, cancellationToken),
			() => this._githubComputer.computeEmbeddings(embeddingType, inputs, options, telemetryInfo, cancellationToken),
			telemetryInfo,
			cancellationToken
		);
	}

	/**
	 * Route request to Feima or GitHub based on preferFeimaModels config.
	 */
	private async routeRequest(
		embeddingType: EmbeddingType,
		inputs: readonly string[],
		options: ComputeEmbeddingsOptions | undefined,
		feimaOperation: () => Promise<Embeddings>,
		githubOperation: () => Promise<Embeddings>,
		telemetryInfo: TelemetryCorrelationId | undefined,
		token: CancellationToken | undefined
	): Promise<Embeddings> {
		// Check if Feima models are preferred
		const preferFeima = this._feimaConfig.getConfig().preferFeimaModels;

		if (preferFeima) {
			this._logService.debug('[FeimaEmbeddingsComputer] Using Feima API for embeddings');

			/* __GDPR__
				"feimaEmbeddingsComputer.routeToFeima" : {
					"owner": "feima",
					"comment": "Tracks when embeddings are routed to Feima API",
					"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" },
					"correlationId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Correlation id" }
				}
			*/
			this._telemetryService.sendMSFTTelemetryEvent('feimaEmbeddingsComputer.routeToFeima', {
				source: telemetryInfo?.callTracker.toString() ?? 'unknown',
				correlationId: telemetryInfo?.correlationId ?? 'unknown',
			});

			try {
				return await (token ? raceCancellationError(feimaOperation(), token) : feimaOperation());
			} catch (e) {
				this._logService.error('[FeimaEmbeddingsComputer] Feima API failed, falling back to GitHub', e);

				/* __GDPR__
					"feimaEmbeddingsComputer.feimaFallbackToGithub" : {
						"owner": "feima",
						"comment": "Tracks when Feima API fails and falls back to GitHub",
						"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" },
						"correlationId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Correlation id" },
						"error": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Error message" }
					}
				*/
				this._telemetryService.sendMSFTTelemetryEvent('feimaEmbeddingsComputer.feimaFallbackToGithub', {
					source: telemetryInfo?.callTracker.toString() ?? 'unknown',
					correlationId: telemetryInfo?.correlationId ?? 'unknown',
					error: e instanceof Error ? e.message : String(e),
				});

				// Fallback to GitHub if Feima fails
				return await (token ? raceCancellationError(githubOperation(), token) : githubOperation());
			}
		}

		// Use GitHub CAPI
		this._logService.debug('[FeimaEmbeddingsComputer] Using GitHub for embeddings');

		/* __GDPR__
			"feimaEmbeddingsComputer.routeToGithub" : {
				"owner": "feima",
				"comment": "Tracks when embeddings are routed to GitHub",
				"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" },
				"correlationId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Correlation id" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent('feimaEmbeddingsComputer.routeToGithub', {
			source: telemetryInfo?.callTracker.toString() ?? 'unknown',
			correlationId: telemetryInfo?.correlationId ?? 'unknown',
		});

		try {
			return await (token ? raceCancellationError(githubOperation(), token) : githubOperation());
		} catch (e) {
			this._logService.error('[FeimaEmbeddingsComputer] GitHub failed, falling back to Feima', e);

			/* __GDPR__
				"feimaEmbeddingsComputer.githubFallbackToFeima" : {
					"owner": "feima",
					"comment": "Tracks when GitHub fails and falls back to Feima",
					"source": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Caller of the request" },
					"correlationId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Correlation id" },
					"error": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Error message" }
				}
			*/
			this._telemetryService.sendMSFTTelemetryEvent('feimaEmbeddingsComputer.githubFallbackToFeima', {
				source: telemetryInfo?.callTracker.toString() ?? 'unknown',
				correlationId: telemetryInfo?.correlationId ?? 'unknown',
				error: e instanceof Error ? e.message : String(e),
			});

			// Fallback to Feima if GitHub fails
			const feimaToken = await this._feimaAuthService.getToken();
			return await (token
				? raceCancellationError(this.doFeimaEmbeddings(feimaToken!, embeddingType, inputs, options, true, token), token)
				: this.doFeimaEmbeddings(feimaToken!, embeddingType, inputs, options, true, token));
		}
	}

	/**
	 * Compute embeddings using Feima API.
	 * Batches requests into chunks of 10 inputs (Feima API limit).
	 */
	private async doFeimaEmbeddings(
		token: string,
		embeddingType: EmbeddingType,
		inputs: readonly string[],
		options: ComputeEmbeddingsOptions | undefined,
		isFallback: boolean,
		cancellationToken?: CancellationToken
	): Promise<Embeddings> {
		const apiBaseUrl = this._feimaConfig.getConfig().apiBaseUrl;
		const endpoint = `${apiBaseUrl}/embeddings`;

		this._logService.info(`[FeimaEmbeddingsComputer] Computing embeddings via Feima API${isFallback ? ' (fallback)' : ''}. Inputs: ${inputs.length}, Model: ${embeddingType.id}, InputType: ${options?.inputType ?? 'document'}`);

		// Feima API has a maximum of 10 inputs per request
		const BATCH_SIZE = 10;
		const batches: string[][] = [];
		for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
			batches.push(inputs.slice(i, i + BATCH_SIZE) as string[]);
		}

		this._logService.info(`[FeimaEmbeddingsComputer] Split ${inputs.length} inputs into ${batches.length} batches`);

		// Process batches sequentially to avoid overwhelming the API
		const allEmbeddings: Embedding[] = [];
		let responseModel: string | undefined;

		for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
			const batch = batches[batchIndex];

			// Check cancellation before each batch
			if (cancellationToken?.isCancellationRequested) {
				throw new Error('Operation cancelled');
			}

			this._logService.info(`[FeimaEmbeddingsComputer] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} inputs)`);

			// Build request body
			const requestBody = {
				input: batch,
				model: embeddingType.id,
				dimensions: 512, // TODO: Make configurable or extract from embeddingType
			};

			// Make request to Feima API
			const response = await this._fetcherService.fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${token}`,
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				let errorDetail = '';
				try {
					const errorBody = await response.json();
					errorDetail = JSON.stringify(errorBody);
				} catch {
					// Ignore JSON parse errors
				}
				this._logService.error(`[FeimaEmbeddingsComputer] Error from Feima API on batch ${batchIndex + 1}. Status: ${response.status}. Detail: ${errorDetail}`);

				/* __GDPR__
					"feimaEmbeddingsComputer.feimaApiError" : {
						"owner": "feima",
						"comment": "Tracks errors from Feima embeddings API",
						"statusCode": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "HTTP status code" },
						"embeddingType": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Embedding type" },
						"inputCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "Number of inputs" },
						"batchIndex": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "Batch index" },
						"isFallback": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether this is a fallback request" }
					}
				*/
				this._telemetryService.sendMSFTTelemetryEvent('feimaEmbeddingsComputer.feimaApiError', {
					embeddingType: embeddingType.id,
					isFallback: String(isFallback),
				}, {
					statusCode: response.status,
					inputCount: inputs.length,
					batchIndex: batchIndex,
				});

				throw new Error(`Feima API returned status ${response.status} on batch ${batchIndex + 1}: ${errorDetail || response.statusText}`);
			}

			const jsonResponse: FeimaEmbeddingsResponse = await response.json();

			// Validate response
			if (!jsonResponse.data || jsonResponse.data.length !== batch.length) {
				throw new Error(`Mismatched embedding count in batch ${batchIndex + 1}. Expected: ${batch.length}, Got: ${jsonResponse.data?.length ?? 0}`);
			}

			// Store model from first response
			if (!responseModel) {
				responseModel = jsonResponse.model;
			}

			// Convert to internal format and accumulate
			const batchEmbeddings: Embedding[] = jsonResponse.data.map(item => ({
				type: new EmbeddingType(jsonResponse.model),
				value: item.embedding,
			}));

			allEmbeddings.push(...batchEmbeddings);
		}

		this._logService.info(`[FeimaEmbeddingsComputer] Successfully computed ${allEmbeddings.length} embeddings from Feima API`);

		/* __GDPR__
			"feimaEmbeddingsComputer.feimaApiSuccess" : {
				"owner": "feima",
				"comment": "Tracks successful embeddings requests to Feima API",
				"embeddingType": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Embedding type" },
				"inputCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "Number of inputs" },
				"batchCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "Number of batches" },
				"isFallback": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether this is a fallback request" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent('feimaEmbeddingsComputer.feimaApiSuccess', {
			embeddingType: embeddingType.id,
			isFallback: String(isFallback),
		}, {
			inputCount: inputs.length,
			batchCount: batches.length,
		});

		return {
			type: new EmbeddingType(responseModel!),
			values: allEmbeddings,
		};
	}
}
