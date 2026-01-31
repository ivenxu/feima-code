/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatRequest, LanguageModelChat } from 'vscode';
import { IGitHubToFeimaModelMappingService } from '../../../extension/endpoint/common/githubToFeimaModelMappingService';
import { IFeimaConfigService } from '../../../extension/feimaConfig/common/feimaConfigService';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IFeimaAuthenticationService } from '../../../platform/authentication/node/feimaAuthenticationService';
import { ChatEndpointFamily, EmbeddingsEndpointFamily, IChatModelInformation, ICompletionModelInformation, IEndpointProvider, IFeimaEndpointProvider, IGitHubEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { FeimaChatEndpoint } from '../../../platform/endpoint/node/feimaChatEndpoint';
import { IFeimaModelMetadataFetcher } from '../../../platform/endpoint/node/feimaModelMetadataFetcher';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint, IEmbeddingsEndpoint } from '../../../platform/networking/common/networking';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';

/**
 * Feima-only Endpoint Provider
 *
 * Returns only Feima models (no GitHub Copilot models).
 * Used by FeimaModelProvider to show only Feima models in the model picker.
 *
 * Architecture:
 * - Does NOT extend ProductionEndpointProvider
 * - Fetches only from IFeimaModelMetadataFetcher
 * - Creates CopilotChatEndpoint instances for Feima models
 * - Returns empty lists when not authenticated
 */
export class FeimaOnlyEndpointProvider implements IEndpointProvider {

	declare readonly _serviceBrand: undefined;

	private _chatEndpoints: Map<string, IChatEndpoint> = new Map();

	constructor(
		@IFeimaAuthenticationService private readonly feimaAuthService: IFeimaAuthenticationService,
		@IFeimaModelMetadataFetcher private readonly feimaModelFetcher: IFeimaModelMetadataFetcher,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		// Listen for model refresh events to clear cache
		this.feimaModelFetcher.onDidModelsRefresh(() => {
			this._chatEndpoints.clear();
		});

		// Listen for authentication changes to clear cache (tokens may have changed)
		this.feimaAuthService.onDidChangeAuthenticationState(() => {
			this.logService.trace('[FeimaOnlyEndpointProvider] Auth changed, clearing endpoint cache');
			this._chatEndpoints.clear();
		});
	}

	private async getOrCreateChatEndpointInstance(modelMetadata: IChatModelInformation): Promise<IChatEndpoint> {
		const modelId = modelMetadata.id;
		let chatEndpoint = this._chatEndpoints.get(modelId);
		if (!chatEndpoint) {
			// Create FeimaChatEndpoint which handles Feima authentication
			chatEndpoint = this.instantiationService.createInstance(FeimaChatEndpoint, modelMetadata);
			this._chatEndpoints.set(modelId, chatEndpoint);
		}
		return chatEndpoint;
	}

	async getAllCompletionModels(forceRefresh?: boolean): Promise<ICompletionModelInformation[]> {
		this.logService.trace('[FeimaOnlyEndpointProvider] Getting all completion models');

		// Check authentication
		const isAuthenticated = await this.feimaAuthService.isAuthenticated();
		if (!isAuthenticated) {
			this.logService.trace('[FeimaOnlyEndpointProvider] Not authenticated, returning empty list');
			return [];
		}

		// Fetch Feima models
		try {
			const models = await this.feimaModelFetcher.getAllCompletionModels(forceRefresh ?? false);
			this.logService.trace(`[FeimaOnlyEndpointProvider] Fetched ${models.length} Feima completion models`);
			return models;
		} catch (error) {
			this.logService.error(
				error instanceof Error ? error : new Error(String(error)),
				'[FeimaOnlyEndpointProvider] Failed to fetch Feima completion models'
			);
			return [];
		}
	}

	async getAllChatEndpoints(): Promise<IChatEndpoint[]> {
		this.logService.trace('[FeimaOnlyEndpointProvider] Getting all chat endpoints');

		// Check authentication
		const isAuthenticated = await this.feimaAuthService.isAuthenticated();
		if (!isAuthenticated) {
			this.logService.trace('[FeimaOnlyEndpointProvider] Not authenticated, returning empty list');
			return [];
		}

		// Fetch Feima models
		try {
			const models = await this.feimaModelFetcher.getAllChatModels();
			this.logService.trace(`[FeimaOnlyEndpointProvider] Fetched ${models.length} Feima chat models`);

			// Create endpoints from models (now async)
			const endpointPromises = models.map(model => this.getOrCreateChatEndpointInstance(model));
			return await Promise.all(endpointPromises);
		} catch (error) {
			this.logService.error(
				error instanceof Error ? error : new Error(String(error)),
				'[FeimaOnlyEndpointProvider] Failed to fetch Feima chat models'
			);
			return [];
		}
	}

	async getChatEndpoint(requestOrFamily: LanguageModelChat | ChatRequest | ChatEndpointFamily): Promise<IChatEndpoint> {
		this.logService.trace('[FeimaOnlyEndpointProvider] Getting chat endpoint');

		// Check authentication
		const isAuthenticated = await this.feimaAuthService.isAuthenticated();
		if (!isAuthenticated) {
			throw new Error('Feima not authenticated');
		}

		// Handle family string
		if (typeof requestOrFamily === 'string') {
			const model = await this.feimaModelFetcher.getChatModelFromFamily(requestOrFamily);
			if (!model) {
				throw new Error(`No Feima model found for family: ${requestOrFamily}`);
			}
			return await this.getOrCreateChatEndpointInstance(model);
		}

		// Handle LanguageModelChat or ChatRequest
		const languageModel = 'model' in requestOrFamily ? requestOrFamily.model : requestOrFamily;
		if (!languageModel) {
			throw new Error('No model specified in request');
		}

		const model = await this.feimaModelFetcher.getChatModelFromApiModel(languageModel);
		if (!model) {
			throw new Error(`No Feima model found for: ${languageModel.id}`);
		}

		return await this.getOrCreateChatEndpointInstance(model);
	}

	async getEmbeddingsEndpoint(family?: EmbeddingsEndpointFamily): Promise<IEmbeddingsEndpoint> {
		// Feima embeddings not yet supported
		throw new Error('Feima embeddings not yet supported');
	}
}

/**
 * Combined Endpoint Provider
 *
 * Composes both GitHub and Feima endpoint providers to return merged model lists.
 * Used by general consumers like PromptFileContextService that need to know about all available models.
 *
 * Architecture:
 * - Composes IGitHubEndpointProvider and IFeimaEndpointProvider
 * - Merges models based on preferFeimaModels configuration
 * - Gracefully handles authentication failures
 */
export class CombinedEndpointProvider implements IEndpointProvider {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IGitHubEndpointProvider private readonly githubProvider: IEndpointProvider,
		@IFeimaEndpointProvider private readonly feimaProvider: IEndpointProvider,
		@IAuthenticationService private readonly githubAuthService: IAuthenticationService,
		@IFeimaAuthenticationService private readonly feimaAuthService: IFeimaAuthenticationService,
		@IFeimaConfigService private readonly feimaConfigService: IFeimaConfigService,
		@IGitHubToFeimaModelMappingService private readonly modelMappingService: IGitHubToFeimaModelMappingService,
		@ILogService private readonly logService: ILogService
	) { }

	/**
	 * Merge models from both providers with fallback logic.
	 * - If both have models: merge based on preference
	 * - If only one has models: return that one
	 * - If neither has models: return empty array
	 */
	private mergeModels<T extends ICompletionModelInformation | IChatModelInformation>(
		githubModels: T[],
		feimaModels: T[],
		preferFeimaModels: boolean
	): T[] {
		// If both have models, merge based on preference
		if (githubModels.length > 0 && feimaModels.length > 0) {
			return preferFeimaModels
				? [...feimaModels, ...githubModels]
				: [...githubModels, ...feimaModels];
		}

		// Fallback to whichever has models
		if (feimaModels.length > 0) {
			this.logService.trace('[CombinedEndpointProvider] Using Feima models only');
			return feimaModels;
		}

		if (githubModels.length > 0) {
			this.logService.trace('[CombinedEndpointProvider] Using GitHub models only');
			return githubModels;
		}

		// Neither has models
		this.logService.warn('[CombinedEndpointProvider] No models available from either provider');
		return [];
	}

	async getAllCompletionModels(forceRefresh?: boolean): Promise<ICompletionModelInformation[]> {
		this.logService.trace('[CombinedEndpointProvider] Getting all completion models');

		const config = this.feimaConfigService.getConfig();
		const isGitHubAuthenticated = !!this.githubAuthService.copilotToken && !this.githubAuthService.copilotToken.isNoAuthUser;

		// Fetch from both providers in parallel (each handles its own authentication)
		// Skip GitHub provider for anonymous users
		const [githubModels, feimaModels] = await Promise.all([
			isGitHubAuthenticated
				? this.githubProvider.getAllCompletionModels(forceRefresh).catch(error => {
					this.logService.error(
						error instanceof Error ? error : new Error(String(error)),
						'[CombinedEndpointProvider] Failed to fetch GitHub models'
					);
					return [];
				})
				: Promise.resolve([]),
			this.feimaProvider.getAllCompletionModels(forceRefresh).catch(error => {
				this.logService.error(
					error instanceof Error ? error : new Error(String(error)),
					'[CombinedEndpointProvider] Failed to fetch Feima models'
				);
				return [];
			})
		]);

		this.logService.trace(`[CombinedEndpointProvider] Fetched ${githubModels.length} GitHub + ${feimaModels.length} Feima models`);

		// Merge models with fallback logic
		return this.mergeModels(githubModels, feimaModels, config.preferFeimaModels);
	}

	async getAllChatEndpoints(): Promise<IChatEndpoint[]> {
		this.logService.trace('[CombinedEndpointProvider] Getting all chat endpoints');

		const config = this.feimaConfigService.getConfig();
		const isGitHubAuthenticated = !!this.githubAuthService.copilotToken && !this.githubAuthService.copilotToken.isNoAuthUser;

		// Fetch from both providers in parallel (each handles its own authentication)
		// Skip GitHub provider for anonymous users
		const [githubEndpoints, feimaEndpoints] = await Promise.all([
			isGitHubAuthenticated
				? this.githubProvider.getAllChatEndpoints().catch(error => {
					this.logService.error(
						error instanceof Error ? error : new Error(String(error)),
						'[CombinedEndpointProvider] Failed to fetch GitHub endpoints'
					);
					return [];
				})
				: Promise.resolve([]),
			this.feimaProvider.getAllChatEndpoints().catch(error => {
				this.logService.error(
					error instanceof Error ? error : new Error(String(error)),
					'[CombinedEndpointProvider] Failed to fetch Feima endpoints'
				);
				return [];
			})
		]);

		this.logService.trace(`[CombinedEndpointProvider] Fetched ${githubEndpoints.length} GitHub + ${feimaEndpoints.length} Feima endpoints`);

		// Merge endpoints with fallback logic
		return this.mergeArraysWithFallback(githubEndpoints, feimaEndpoints, config.preferFeimaModels);
	}

	/**
	 * Generic helper to merge arrays from both providers with fallback logic.
	 * Same logic as mergeModels() but works with any array type.
	 */
	private mergeArraysWithFallback<T>(
		githubItems: T[],
		feimaItems: T[],
		preferFeimaItems: boolean
	): T[] {
		// If both have items, merge based on preference
		if (githubItems.length > 0 && feimaItems.length > 0) {
			return preferFeimaItems
				? [...feimaItems, ...githubItems]
				: [...githubItems, ...feimaItems];
		}

		// Fallback to whichever has items
		if (feimaItems.length > 0) {
			this.logService.trace('[CombinedEndpointProvider] Using Feima items only');
			return feimaItems;
		}

		if (githubItems.length > 0) {
			this.logService.trace('[CombinedEndpointProvider] Using GitHub items only');
			return githubItems;
		}

		// Neither has items
		this.logService.warn('[CombinedEndpointProvider] No items available from either provider');
		return [];
	}

	async getChatEndpoint(requestOrFamily: LanguageModelChat | ChatRequest | ChatEndpointFamily): Promise<IChatEndpoint> {
		this.logService.trace('[CombinedEndpointProvider] Getting chat endpoint');

		const isFeimaAuthenticated = await this.feimaAuthService.isAuthenticated();
		const config = this.feimaConfigService.getConfig();

		// Map GitHub model families to Feima equivalents when appropriate
		let resolvedRequestOrFamily = requestOrFamily;
		if (typeof requestOrFamily === 'string' && config.preferFeimaModels && isFeimaAuthenticated) {
			const feimaModelId = this.modelMappingService.getFeimaModel(requestOrFamily);
			if (feimaModelId) {
				this.logService.trace(`[CombinedEndpointProvider] Pre-mapping GitHub family ${requestOrFamily} to Feima model ${feimaModelId} for primary provider`);
				resolvedRequestOrFamily = feimaModelId as ChatEndpointFamily;
			}
		}

		// Determine primary and fallback providers based on preference
		const primaryProvider = config.preferFeimaModels ? this.feimaProvider : this.githubProvider;
		const fallbackProvider = config.preferFeimaModels ? this.githubProvider : this.feimaProvider;
		const primaryName = config.preferFeimaModels ? 'Feima' : 'GitHub';
		const fallbackName = config.preferFeimaModels ? 'GitHub' : 'Feima';

		// If both are authenticated, try primary then fallback
		if (isFeimaAuthenticated) {
			try {
				const endpoint = await primaryProvider.getChatEndpoint(resolvedRequestOrFamily);
				this.logService.trace(`[CombinedEndpointProvider] Resolved to ${primaryName} endpoint`);
				return endpoint;
			} catch (primaryError) {
				this.logService.trace(`[CombinedEndpointProvider] ${primaryName} resolution failed, trying ${fallbackName}: ${primaryError}`);
				try {
					const endpoint = await fallbackProvider.getChatEndpoint(requestOrFamily);
					this.logService.trace(`[CombinedEndpointProvider] Resolved to ${fallbackName} endpoint as fallback`);
					return endpoint;
				} catch (fallbackError) {
					this.logService.error(
						fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
						`[CombinedEndpointProvider] Both ${primaryName} and ${fallbackName} resolution failed`
					);
					throw primaryError; // Throw the primary error
				}
			}
		}


		// Final fallback to GitHub
		this.logService.trace('[CombinedEndpointProvider] Using GitHub as final fallback');
		return this.githubProvider.getChatEndpoint(requestOrFamily);
	}

	async getEmbeddingsEndpoint(family?: EmbeddingsEndpointFamily): Promise<IEmbeddingsEndpoint> {
		this.logService.trace('[CombinedEndpointProvider] Getting embeddings endpoint');

		const isFeimaAuthenticated = await this.feimaAuthService.isAuthenticated();
		const config = this.feimaConfigService.getConfig();

		// Determine primary and fallback providers based on preference
		const primaryProvider = config.preferFeimaModels ? this.feimaProvider : this.githubProvider;
		const fallbackProvider = config.preferFeimaModels ? this.githubProvider : this.feimaProvider;
		const primaryName = config.preferFeimaModels ? 'Feima' : 'GitHub';
		const fallbackName = config.preferFeimaModels ? 'GitHub' : 'Feima';

		// If both are authenticated, try primary then fallback
		if (isFeimaAuthenticated) {
			try {
				const endpoint = await primaryProvider.getEmbeddingsEndpoint(family);
				this.logService.trace(`[CombinedEndpointProvider] Resolved to ${primaryName} embeddings endpoint`);
				return endpoint;
			} catch (primaryError) {
				this.logService.trace(`[CombinedEndpointProvider] ${primaryName} embeddings not available, trying ${fallbackName}`);
				try {
					const endpoint = await fallbackProvider.getEmbeddingsEndpoint(family);
					this.logService.trace(`[CombinedEndpointProvider] Resolved to ${fallbackName} embeddings endpoint as fallback`);
					return endpoint;
				} catch (fallbackError) {
					this.logService.error(
						fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
						`[CombinedEndpointProvider] Both ${primaryName} and ${fallbackName} embeddings failed`
					);
					throw primaryError;
				}
			}
		}

		// If only GitHub is authenticated or Feima is not preferred, use GitHub
		this.logService.trace('[CombinedEndpointProvider] Using GitHub embeddings endpoint');
		return this.githubProvider.getEmbeddingsEndpoint(family);
	}
}
