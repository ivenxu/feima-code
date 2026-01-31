/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IAuthenticationService } from '../../authentication/common/authentication';
import { IFeimaAuthenticationService } from '../../authentication/node/feimaAuthenticationService';
import { IChatMLFetcher, Source } from '../../chat/common/chatMLFetcher';
import { ChatLocation, ChatResponse, ChatFetchResponseType } from '../../chat/common/commonTypes';
import { IConfigurationService } from '../../configuration/common/configurationService';
import { IEnvService } from '../../env/common/envService';
import { ILogService } from '../../log/common/logService';
import { FinishedCallback, OptionalChatRequestParams } from '../../networking/common/fetch';
import { IFetcherService } from '../../networking/common/fetcherService';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { ITelemetryService, TelemetryProperties } from '../../telemetry/common/telemetry';
import { ITokenizerProvider } from '../../tokenizer/node/tokenizer';
import { ICAPIClientService } from '../common/capiClient';
import { IDomainService } from '../common/domainService';
import { IChatModelInformation } from '../common/endpointProvider';
import { ChatEndpoint } from './chatEndpoint';

/**
 * Feima Chat Endpoint
 *
 * Extends ChatEndpoint to add Feima-specific authentication.
 * Routes requests to Feima API and injects fresh Feima tokens at request time.
 *
 * Key differences from CopilotChatEndpoint:
 * - Uses IFeimaAuthenticationService instead of IAuthenticationService
 * - Fetches fresh token on each request (tokens may expire)
 * - Adds Authorization header dynamically in getExtraHeaders()
 */
export class FeimaChatEndpoint extends ChatEndpoint {
	private _cachedToken: string | null = null;

	constructor(
		modelMetadata: IChatModelInformation,
		@IDomainService domainService: IDomainService,
		@ICAPIClientService capiClientService: ICAPIClientService,
		@IFetcherService fetcherService: IFetcherService,
		@IEnvService envService: IEnvService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IAuthenticationService authService: IAuthenticationService,
		@IFeimaAuthenticationService private readonly feimaAuthService: IFeimaAuthenticationService,
		@IChatMLFetcher chatMLFetcher: IChatMLFetcher,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentService: IExperimentationService,
		@ILogService private readonly _logService: ILogService
	) {
		super(
			modelMetadata,
			domainService,
			capiClientService,
			fetcherService,
			telemetryService,
			authService, // Pass GitHub auth service to parent (needed for base functionality)
			chatMLFetcher,
			tokenizerProvider,
			instantiationService,
			configurationService,
			experimentService,
			_logService
		);

		// Pre-fetch token on construction
		this._prefetchToken();
	}

	/**
	 * Pre-fetch and cache token to avoid latency on first request
	 */
	private async _prefetchToken(): Promise<void> {
		try {
			const token = await this.feimaAuthService.getToken();
			this._cachedToken = token || null;
		} catch (error) {
			this._logService.error(error, '[FeimaChatEndpoint] Failed to prefetch Feima token');
		}
	}

	/**
	 * Override getExtraHeaders to inject Feima auth token.
	 * NOTE: This is synchronous but uses cached token. Token is refreshed in makeChatRequest().
	 */
	public override getExtraHeaders(): Record<string, string> {
		const baseHeaders = super.getExtraHeaders();

		if (!this._cachedToken) {
			this._logService.warn('[FeimaChatEndpoint] No cached Feima token available');
			return baseHeaders;
		}

		// Add Feima authorization header
		return {
			...baseHeaders,
			'Authorization': `Bearer ${this._cachedToken}`,
			'Content-Type': 'application/json',
		};
	}

	/**
	 * Override makeChatRequest to refresh token before each request.
	 * This ensures we always use a fresh token even if it expired.
	 */
	public override async makeChatRequest(
		debugName: string,
		messages: Raw.ChatMessage[],
		finishedCb: FinishedCallback | undefined,
		token: CancellationToken,
		location: ChatLocation,
		source?: Source,
		requestOptions?: Omit<OptionalChatRequestParams, 'n'>,
		userInitiatedRequest?: boolean,
		telemetryProperties?: TelemetryProperties
	): Promise<ChatResponse> {
		// Refresh token before making request (tokens may expire)
		try {
			const freshToken = await this.feimaAuthService.getToken();
			if (!freshToken) {
				throw new Error('Failed to get Feima authentication token');
			}
			this._cachedToken = freshToken;
		} catch (error) {
			this._logService.error(error, '[FeimaChatEndpoint] Failed to refresh Feima token');
			throw error;
		}

		// Call parent's makeChatRequest with fresh token in place
		const result = await super.makeChatRequest(
			debugName,
			messages,
			finishedCb,
			token,
			location,
			source,
			requestOptions,
			userInitiatedRequest,
			telemetryProperties
		);

		// Handle token expiration errors by clearing the session
		// This will trigger VS Code to prompt for re-authentication
		if (result.type === ChatFetchResponseType.BadRequest &&
			(result.reason.includes('token expired or invalid') || result.reason.includes('401'))) {
			this._logService.warn('[FeimaChatEndpoint] Token expired, clearing session to trigger re-auth');
			try {
				await this.feimaAuthService.signOut();
			} catch (error) {
				this._logService.error(error, '[FeimaChatEndpoint] Failed to clear session on token error');
			}
		}

		return result;
	}
}
