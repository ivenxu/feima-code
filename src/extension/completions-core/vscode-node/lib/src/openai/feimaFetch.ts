/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFeimaConfigService } from '../../../../../../extension/feimaConfig/common/feimaConfigService';
import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { IFeimaAuthenticationService } from '../../../../../../platform/authentication/node/feimaAuthenticationService';
import { IFeimaModelMetadataFetcher } from '../../../../../../platform/endpoint/node/feimaModelMetadataFetcher';
import { ILogService } from '../../../../../../platform/log/common/logService';
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
		@ILogService private readonly feimaLogService: ILogService,
		// Parent class parameters (LiveOpenAIFetcher)
		@IInstantiationService instantiationService: IInstantiationService,
		@ICompletionsRuntimeModeService runtimeModeService: ICompletionsRuntimeModeService,
		@ICompletionsLogTargetService logTargetService: ICompletionsLogTargetService,
		@ICompletionsCopilotTokenManager copilotTokenManager: ICompletionsCopilotTokenManager,
		@ICompletionsStatusReporter statusReporter: ICompletionsStatusReporter,
		@IAuthenticationService authenticationService: IAuthenticationService,
	) {
		super(instantiationService, runtimeModeService, logTargetService, copilotTokenManager, statusReporter, authenticationService);
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

		// Check if model is from Feima (via cached model list)
		const isFeima = this.feimaModelFetcher.isFeimaModel(params.engineModelId);

		if (isFeima) {
			this.feimaLogService.trace(`[FeimaOpenAIFetcher] Model ${params.engineModelId} identified as Feima model`);

			// Check Feima authentication
			const isAuthenticated = await this.feimaAuth.isAuthenticated();
			if (!isAuthenticated) {
				this.feimaLogService.warn(`[FeimaOpenAIFetcher] Feima model requested but not authenticated, falling back to GitHub`);
				// Fall through to GitHub
			} else {
				// Try Feima API
				try {
					return await this.fetchFromFeima(params, baseTelemetryData, finishedCb, cancel);
				} catch (error) {
					this.feimaLogService.error(`[FeimaOpenAIFetcher] Feima API call failed: ${error instanceof Error ? error.message : String(error)}`);
					// Fall through to GitHub fallback
				}
			}
		}

		// Use GitHub API (parent logic)
		this.feimaLogService.trace(`[FeimaOpenAIFetcher] Using GitHub API for model ${params.engineModelId}`);
		return super.fetchAndStreamCompletions(params, baseTelemetryData, finishedCb, cancel);
	}

	/**
	 * Fetch completions from Feima API
	 *
	 * Calls Feima's OpenAI-compatible completion endpoint with SSE streaming.
	 * The Feima API returns responses in OpenAI format, allowing direct integration
	 * with the existing SSE processing infrastructure.
	 */
	private async fetchFromFeima(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancel?: ICancellationToken
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
		const feimaRequest = this.buildFeimaCompletionRequest(params);
		const url = `${config.apiBaseUrl}/completions`;

		this.feimaLogService.info(`[FeimaOpenAIFetcher] Calling Feima API: ${url} for model ${params.engineModelId}`);

		try {
			const response = await fetch(url, {
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
				if (response.body) {
					void response.body.cancel();
				}
				return { type: 'canceled', reason: 'after fetch request' };
			}

			// Convert fetch Response to networking Response format and use existing SSEProcessor
			const adaptedResponse = this.adaptFetchResponse(response);
			const processor = await this._instantiationService.invokeFunction(
				SSEProcessor.create,
				params.count,
				adaptedResponse,
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
	 * SSEProcessor expects a Response object with specific methods.
	 * This adapter wraps the fetch Response to match the expected interface.
	 *
	 * CRITICAL: SSEProcessor expects a Node.js ReadableStream with setEncoding(),
	 * but fetch() returns a Web ReadableStream. We need to convert it.
	 */
	private adaptFetchResponse(response: Response): NetworkingResponse {
		// Import Readable from Node.js stream module
		const { Readable } = require('stream');

		// Convert Web ReadableStream to Node.js Readable
		const webStream = response.body;
		if (!webStream) {
			throw new Error('Response body is null');
		}

		// Create a Node.js Readable that reads from the Web ReadableStream
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const nodeStream = Readable.fromWeb(webStream as any);

		return {
			status: response.status,
			statusText: response.statusText,
			headers: {
				get: (name: string) => response.headers.get(name),
			},
			body: () => nodeStream,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any as NetworkingResponse;
	}

	/**
	 * Build Feima completion request in OpenAI-compatible format
	 */
	private buildFeimaCompletionRequest(params: CompletionParams): FeimaCompletionRequest {
		return {
			model: params.engineModelId,
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
}
