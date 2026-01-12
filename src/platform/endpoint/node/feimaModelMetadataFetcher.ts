/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelChat } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IFeimaAuthenticationService } from '../../authentication/node/feimaAuthenticationService';
import { IFeimaConfigService } from '../../feima/common/feimaConfigService';
import { ILogService } from '../../log/common/logService';
import { IFetcherService, jsonVerboseError } from '../../networking/common/fetcherService';
import { ChatEndpointFamily, IChatModelInformation, ICompletionModelInformation, IEmbeddingModelInformation, IModelAPIResponse, isChatModelInformation, isCompletionModelInformation, isEmbeddingModelInformation } from '../common/endpointProvider';
import { IModelMetadataFetcher } from './modelMetadataFetcher';

export interface IFeimaModelMetadataFetcher extends IModelMetadataFetcher {
	isFeimaModel(modelId: string): boolean;
}

export const IFeimaModelMetadataFetcher = createServiceIdentifier<IFeimaModelMetadataFetcher>('feimaModelMetadataFetcher');

/**
 * Feima Model Metadata Fetcher
 *
 * Implements IModelMetadataFetcher to fetch models from Feima API.
 * Provides a cache for fast model ID lookups to support routing decisions.
 */
export class FeimaModelMetadataFetcher extends Disposable implements IModelMetadataFetcher {

	private _completionModels: ICompletionModelInformation[] = [];
	private _chatModels: IChatModelInformation[] = [];
	private _embeddingModels: IEmbeddingModelInformation[] = [];
	private _modelIdCache = new Set<string>();
	private _lastFetchTime = 0;
	private readonly _onDidModelsRefresh = new Emitter<void>();
	public readonly onDidModelsRefresh: Event<void> = this._onDidModelsRefresh.event;

	constructor(
		@IFeimaAuthenticationService private readonly feimaAuth: IFeimaAuthenticationService,
		@IFeimaConfigService private readonly feimaConfig: IFeimaConfigService,
		@IFetcherService private readonly fetcher: IFetcherService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Clear cache when authentication state changes (sign-in, sign-out, token refresh)
		this._register(this.feimaAuth.onDidChangeAuthenticationState(() => {
			this.logService.debug('[FeimaModelMetadataFetcher] Auth state changed, clearing model cache');
			this._clearCache();
			this._lastFetchTime = 0;
		}));
	}

	/**
	 * Check if a model ID belongs to Feima (fast cache lookup)
	 */
	isFeimaModel(modelId: string): boolean {
		return this._modelIdCache.has(modelId);
	}

	/**
	 * Get all completion models from Feima API
	 */
	async getAllCompletionModels(forceRefresh: boolean): Promise<ICompletionModelInformation[]> {
		await this._fetchModelsIfNeeded(forceRefresh);
		return [...this._completionModels];
	}

	/**
	 * Get all chat models from Feima API
	 */
	async getAllChatModels(): Promise<IChatModelInformation[]> {
		await this._fetchModelsIfNeeded(false);
		return [...this._chatModels];
	}

	/**
	 * Get chat model by family name
	 */
	async getChatModelFromFamily(family: ChatEndpointFamily): Promise<IChatModelInformation> {
		await this._fetchModelsIfNeeded(false);

		const model = this._chatModels.find(m => m.capabilities.family === family);
		if (!model) {
			throw new Error(`No Feima chat model found for family: ${family}`);
		}
		return model;
	}

	/**
	 * Get chat model by API model ID
	 */
	async getChatModelFromApiModel(model: LanguageModelChat): Promise<IChatModelInformation | undefined> {
		await this._fetchModelsIfNeeded(false);

		return this._chatModels.find(m =>
			m.id === model.id &&
			m.version === model.version &&
			m.capabilities.family === model.family
		);
	}

	/**
	 * Get embeddings model by family name
	 */
	async getEmbeddingsModel(family: 'text-embedding-3-small'): Promise<IEmbeddingModelInformation> {
		await this._fetchModelsIfNeeded(false);

		const model = this._embeddingModels.find(m => m.capabilities.family === family);
		if (!model) {
			throw new Error(`No Feima embeddings model found for family: ${family}`);
		}
		return model;
	}

	/**
	 * Fetch models from Feima API if needed
	 */
	private async _fetchModelsIfNeeded(forceRefresh: boolean): Promise<void> {
		if (!await this.feimaAuth.isAuthenticated()) {
			this.logService.debug('[FeimaModelMetadataFetcher] Not authenticated, skipping fetch');
			return;
		}

		const shouldRefresh = forceRefresh || this._shouldRefreshModels();
		if (!shouldRefresh) {
			return;
		}

		try {
			this.logService.trace('[FeimaModelMetadataFetcher] Fetching models from Feima API');

			const token = await this.feimaAuth.getToken();
			if (!token) {
				throw new Error('Failed to get authentication token');
			}

			const apiBaseUrl = this.feimaConfig.getConfig().apiBaseUrl;
			const modelsUrl = `${apiBaseUrl}/models`;

			this.logService.debug(`[FeimaModelMetadataFetcher] Fetching from: ${modelsUrl}`);

			const response = await this.fetcher.fetch(modelsUrl, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				expectJSON: true,
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
			}

			const data = await jsonVerboseError(response);

			// Parse OpenAI-compatible models response
			if (!data.data || !Array.isArray(data.data)) {
				throw new Error('Invalid models response format: missing data array');
			}

			this._clearCache();
			this._parseModelsResponse(data.data);
			this._lastFetchTime = Date.now();
			this._onDidModelsRefresh.fire();

			this.logService.trace(`[FeimaModelMetadataFetcher] Fetched ${this._chatModels.length} chat models, ${this._completionModels.length} completion models, ${this._embeddingModels.length} embedding models`);
		} catch (error) {
			this.logService.error('[FeimaModelMetadataFetcher] Failed to fetch models', error);
			throw error;
		}
	}

	/**
	 * Parse models from OpenAI-compatible API response
	 */
	private _parseModelsResponse(models: IModelAPIResponse[]): void {
		// Get Feima API base URL for constructing endpoint URLs
		const apiBaseUrl = this.feimaConfig.getConfig().apiBaseUrl;
		const chatCompletionsUrl = `${apiBaseUrl}/chat/completions`;

		for (const model of models) {
			this._modelIdCache.add(model.id);

			if (isChatModelInformation(model)) {
				this._chatModels.push({
					...model,
					urlOrRequestMetadata: chatCompletionsUrl, // Feima chat completions endpoint
				});
			} else if (isCompletionModelInformation(model)) {
				this._completionModels.push(model);
			} else if (isEmbeddingModelInformation(model)) {
				this._embeddingModels.push(model);
			}
		}
	}

	/**
	 * Clear all caches
	 */
	private _clearCache(): void {
		this._completionModels = [];
		this._chatModels = [];
		this._embeddingModels = [];
		this._modelIdCache.clear();
	}

	/**
	 * Determine if models should be refreshed
	 */
	private _shouldRefreshModels(): boolean {
		if (this._chatModels.length === 0 && this._completionModels.length === 0) {
			return true;
		}

		const TEN_MINUTES = 10 * 60 * 1000;
		const timeSinceLastFetch = Date.now() - this._lastFetchTime;
		return timeSinceLastFetch > TEN_MINUTES;
	}
}
