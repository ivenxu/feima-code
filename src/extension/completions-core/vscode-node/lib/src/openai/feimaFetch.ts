/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGitHubToFeimaModelMappingService } from '../../../../../../extension/endpoint/common/githubToFeimaModelMappingService';
import { IFeimaConfigService } from '../../../../../../extension/feimaConfig/common/feimaConfigService';
import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { IFeimaAuthenticationService } from '../../../../../../platform/authentication/node/feimaAuthenticationService';
import { IFeimaModelMetadataFetcher } from '../../../../../../platform/endpoint/node/feimaModelMetadataFetcher';
import { IEnvService } from '../../../../../../platform/env/common/envService';
import { ILogService } from '../../../../../../platform/log/common/logService';
import { ICompletionsFetchService } from '../../../../../../platform/nesFetch/common/completionsFetchService';
import { IFetcherService } from '../../../../../../platform/networking/common/fetcherService';
import { CancellationToken } from '../../../../../../util/vs/base/common/cancellation';
import { IInstantiationService } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { CancellationToken as ICancellationToken } from '../../../types/src';
import { ICompletionsCopilotTokenManager } from '../auth/copilotTokenManager';
import { asyncIterableMap } from '../helpers/iterableHelpers';
import { ICompletionsLogTargetService } from '../logger';
import type { Response as NetworkingResponse } from '../networking';
import { ICompletionsStatusReporter } from '../progress';
import { TelemetryWithExp } from '../telemetry';
import { ICompletionsRuntimeModeService } from '../util/runtimeMode';
import {
	CompletionError,
	CompletionParams,
	CompletionResults,
	FinishedCallback,
	LiveOpenAIFetcher,
	postProcessChoices,
} from './fetch';
import { FinishedCompletion, SSEProcessor, prepareSolutionForReturn } from './stream';

/**
 * Feima completion request body (OpenAI-compatible format)
 */
interface FeimaCompletionRequest {
	model: string;
	prompt: string;
	suffix?: string;
	max_tokens: number;
	n: number;
	temperature: number;
	top_p: number;
	stop: string[];
	stream: boolean;
	language?: string;
	extra?: Record<string, unknown>;
}

/**
 * Feima OpenAI Fetcher
 *
 * Extends LiveOpenAIFetcher to add smart routing between Feima and GitHub APIs.
 *
 * Architecture:
 * - Model detection: Uses FeimaModelMetadataFetcher.isFeimaModel() to check model source
 * - Authentication: JWT tokens for Feima, OAuth for GitHub
 * - Fallback: Always falls back to GitHub if Feima fails
 * - SSE Streaming: Handles Server-Sent Events from both APIs
 *
 * Key principles:
 * - No modification to base LiveOpenAIFetcher logic
 * - All routing decisions based on model ID cache lookup
 * - Graceful error handling with fallback
 */
export class FeimaOpenAIFetcher extends LiveOpenAIFetcher {

	private readonly _instantiationService: IInstantiationService;

	constructor(
		// Feima-specific services (must come first for DI to inject them)
		@IFeimaAuthenticationService private readonly feimaAuth: IFeimaAuthenticationService,
		@IFeimaConfigService private readonly feimaConfig: IFeimaConfigService,
		@IFeimaModelMetadataFetcher private readonly feimaModelFetcher: IFeimaModelMetadataFetcher,
		@IGitHubToFeimaModelMappingService private readonly modelMappingService: IGitHubToFeimaModelMappingService,
		@ILogService private readonly feimaLogService: ILogService,
		@IFetcherService private readonly feimaFetcherService: IFetcherService,
		// Parent class parameters (LiveOpenAIFetcher)
		@IInstantiationService instantiationService: IInstantiationService,
		@ICompletionsRuntimeModeService runtimeModeService: ICompletionsRuntimeModeService,
		@ICompletionsLogTargetService logTargetService: ICompletionsLogTargetService,
		@ICompletionsCopilotTokenManager copilotTokenManager: ICompletionsCopilotTokenManager,
		@ICompletionsStatusReporter statusReporter: ICompletionsStatusReporter,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@ICompletionsFetchService fetchService: ICompletionsFetchService,
		@IEnvService envService: IEnvService,
	) {
		feimaLogService.trace(`[FeimaOpenAIFetcher] Constructor called`);
		super(instantiationService, runtimeModeService, logTargetService, copilotTokenManager, statusReporter, authenticationService, fetchService, envService);
		this._instantiationService = instantiationService;
	}

	/**
	 * Override to route requests between Feima and GitHub APIs
	 *
	 * Routing logic:
	 * 1. Check if model is in Feima model cache (via isFeimaModel)
	 * 2. If yes and authenticated, route to Feima API
	 * 3. Otherwise, use parent implementation (GitHub API)
	 * 4. On Feima errors, log and fall back to GitHub
	 */
	override async fetchAndStreamCompletions(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancel?: ICancellationToken
	): Promise<CompletionResults | CompletionError> {

		const mappedModelId = this._mapModelForFeimaPreference(params.engineModelId);
		this.feimaLogService.trace(`[FeimaOpenAIFetcher] fetchAndStreamCompletions called for model ${mappedModelId} (original: ${params.engineModelId})`);

		// Check if model is from Feima (via cached model list)
		const isFeima = this.feimaModelFetcher.isFeimaModel(mappedModelId);

		if (isFeima) {
			this.feimaLogService.trace(`[FeimaOpenAIFetcher] Model ${mappedModelId} identified as Feima model`);

			// Check Feima authentication
			const isAuthenticated = await this.feimaAuth.isAuthenticated();
			if (!isAuthenticated) {
				this.feimaLogService.warn(`[FeimaOpenAIFetcher] Feima model requested but not authenticated, falling back to GitHub`);
				// Fall through to GitHub
			} else {
				// Try Feima API
				try {
					return await this.fetchFromFeima(params, baseTelemetryData, finishedCb, cancel, mappedModelId);
				} catch (error) {
					this.feimaLogService.error(`[FeimaOpenAIFetcher] Feima API call failed: ${error instanceof Error ? error.message : String(error)}`);
					// Fall through to GitHub fallback
				}
			}
		}

		// Use GitHub API (parent logic)
		this.feimaLogService.trace(`[FeimaOpenAIFetcher] Using GitHub API for model ${mappedModelId}`);
		return super.fetchAndStreamCompletions(params, baseTelemetryData, finishedCb, cancel);
	}

	/**
	 * Override to route requests between Feima and GitHub APIs for fetchAndStreamCompletions2
	 */
	override async fetchAndStreamCompletions2(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancel: CancellationToken
	): Promise<CompletionResults | CompletionError> {

		const mappedModelId = this._mapModelForFeimaPreference(params.engineModelId);
		this.feimaLogService.trace(`[FeimaOpenAIFetcher] fetchAndStreamCompletions2 called for model ${mappedModelId} (original: ${params.engineModelId})`);

		// Check if model is from Feima (via cached model list)
		const isFeima = this.feimaModelFetcher.isFeimaModel(mappedModelId);

		if (isFeima) {
			this.feimaLogService.trace(`[FeimaOpenAIFetcher] Model ${mappedModelId} identified as Feima model`);

			// Check Feima authentication
			const isAuthenticated = await this.feimaAuth.isAuthenticated();
			if (!isAuthenticated) {
				this.feimaLogService.warn(`[FeimaOpenAIFetcher] Feima model requested but not authenticated, falling back to GitHub`);
				// Fall through to GitHub
			} else {
				// Try Feima API
				try {
					return await this.fetchFromFeima(params, baseTelemetryData, finishedCb, cancel, mappedModelId);
				} catch (error) {
					this.feimaLogService.error(`[FeimaOpenAIFetcher] Feima API call failed: ${error instanceof Error ? error.message : String(error)}`);
					// Fall through to GitHub fallback
				}
			}
		}

		// Use GitHub API (parent logic)
		this.feimaLogService.trace(`[FeimaOpenAIFetcher] Using GitHub API for model ${mappedModelId}`);
		return super.fetchAndStreamCompletions2(params, baseTelemetryData, finishedCb, cancel);
	}

	/**
	 * Fetch completions from Feima API
	 *
	 * Calls Feima's OpenAI-compatible completion endpoint with SSE streaming.
	 * The Feima API returns responses in OpenAI format, allowing direct integration
	 * with the existing SSE processing infrastructure.
	 *
	 * Uses the platform's IFetcherService to ensure proper Response type with
	 * DestroyableStream that supports both pipeThrough() and destroy() methods.
	 */
	private async fetchFromFeima(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancel?: CancellationToken,
		mappedModelId?: string
	): Promise<CompletionResults | CompletionError> {

		// 1. Validate JWT token
		const token = await this.feimaAuth.getToken();
		if (!token) {
			this.feimaLogService.warn('[FeimaOpenAIFetcher] No Feima token available');
			return {
				type: 'failed',
				reason: 'Not authenticated with Feima'
			};
		}

		// 2. Build request and call Feima API
		const config = this.feimaConfig.getConfig();
		const feimaRequest = this.buildFeimaCompletionRequest(params, mappedModelId);
		const url = `${config.apiBaseUrl}/completions`;

		this.feimaLogService.info(`[FeimaOpenAIFetcher] Calling Feima API: ${url} for model ${mappedModelId || params.engineModelId}`);

		try {
			// Use IFetcherService to get proper Response with DestroyableStream
			const response = await this.feimaFetcherService.fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
					'X-Request-Id': params.ourRequestId,
				},
				body: JSON.stringify(feimaRequest),
			});

			if (!response.ok) {
				const errorText = await response.text();
				this.feimaLogService.error(`[FeimaOpenAIFetcher] Feima API error ${response.status}: ${errorText}`);
				return {
					type: 'failed',
					reason: `Feima API error: ${response.status} ${errorText}`
				};
			}

			// Check for cancellation
			if (cancel?.isCancellationRequested) {
				this.feimaLogService.trace('[FeimaOpenAIFetcher] Request cancelled before processing');
				// Clean up stream
				try {
					await response.body.destroy();
				} catch (e) {
					this.feimaLogService.warn(`[FeimaOpenAIFetcher] Error destroying stream on cancellation: ${e}`);
				}
				return { type: 'canceled', reason: 'before stream processing' };
			}

			// Response.body is now a DestroyableStream with pipeThrough() and destroy()
			this.feimaLogService.trace('[FeimaOpenAIFetcher] Creating SSE processor with response');
			const processor = await this._instantiationService.invokeFunction(
				SSEProcessor.create,
				params.count,
				response as unknown as NetworkingResponse,
				baseTelemetryData,
				[],
				cancel
			);

			const finishedCompletions = processor.processSSE(finishedCb);
			const choices = asyncIterableMap(finishedCompletions, (solution: FinishedCompletion) =>
				this._instantiationService.invokeFunction(prepareSolutionForReturn, solution, baseTelemetryData)
			);

			return {
				type: 'success',
				choices: postProcessChoices(choices),
				getProcessingTime: () => 0,
			};

		} catch (error) {
			this.feimaLogService.error(`[FeimaOpenAIFetcher] Feima API call failed: ${error instanceof Error ? error.message : String(error)}`);
			return {
				type: 'failed',
				reason: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Adapt fetch Response to networking Response format
	 *
	 * NOTE: This method is currently unused. Modern Node.js (18+) with undici provides
	 * a fetch() implementation where response.body is already a Web ReadableStream
	 * compatible with pipeThrough() and other Web Streams API methods.
	 *
	 * Keeping this for reference in case we need special handling for older Node versions
	 * or different environments.
	 */
	/*
	private adaptFetchResponse(response: Response): NetworkingResponse {
		this.feimaLogService.trace('[FeimaOpenAIFetcher] Adapting fetch response to networking format');

		// Import Readable from Node.js stream module
		const { Readable } = require('stream');

		// Convert response body to Node.js Readable stream
		const body = response.body;
		if (!body) {
			throw new Error('Response body is null');
		}

		// In Node.js, undici's fetch may return different stream types
		// Readable.fromWeb() safely converts Web ReadableStreams to Node.js Readable
		let nodeStream: typeof Readable;
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			nodeStream = Readable.fromWeb(body as any);
			this.feimaLogService.trace('[FeimaOpenAIFetcher] Successfully converted response body to Node.js Readable');
		} catch (error) {
			this.feimaLogService.error(`[FeimaOpenAIFetcher] Failed to convert response body: ${error instanceof Error ? error.message : String(error)}`);
			throw new Error(`Failed to convert response body to Node.js stream: ${error}`);
		}

		return {
			status: response.status,
			statusText: response.statusText,
			headers: {
				get: (name: string) => response.headers.get(name),
			},
			body: () => nodeStream,
		} as unknown as NetworkingResponse;
	}
	*/

	/**
	 * Build Feima completion request in OpenAI-compatible format
	 */
	private buildFeimaCompletionRequest(params: CompletionParams, mappedModelId?: string): FeimaCompletionRequest {
		return {
			model: mappedModelId || params.engineModelId,
			prompt: params.prompt.prefix,
			suffix: params.prompt.suffix,
			max_tokens: params.postOptions?.max_tokens ?? 500,
			n: params.count,
			temperature: params.postOptions?.temperature ?? 0,
			top_p: params.postOptions?.top_p ?? 1,
			stop: params.postOptions?.stop ?? [],
			stream: true, // Always stream for real-time display
			// Additional context
			language: params.languageId,
			extra: params.extra,
		};
	}

	/**
	 * Map model ID based on Feima preference configuration
	 * Uses the centralized GitHubToFeimaModelMappingService.
	 */
	private _mapModelForFeimaPreference(modelId: string): string {
		if (!this.feimaConfig.getConfig().preferFeimaModels) {
			return modelId;
		}

		return this.modelMappingService.getFeimaModel(modelId) ?? modelId;
	}
}
