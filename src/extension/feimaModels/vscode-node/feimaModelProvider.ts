/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFeimaAuthenticationService } from '../../../platform/authentication/node/feimaAuthenticationService';
import { IEndpointProvider, IFeimaEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IFeimaModelMetadataFetcher } from '../../../platform/endpoint/node/feimaModelMetadataFetcher';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { CopilotLanguageModelWrapper } from '../../conversation/vscode-node/languageModelAccess';

/**
 * Feima language model provider that dynamically provides models from feima-api.
 * Integrates with Feima authentication and uses CopilotLanguageModelWrapper for responses.
 */
export class FeimaModelProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;
	private readonly lmWrapper: CopilotLanguageModelWrapper;
	private _chatEndpoints: IChatEndpoint[] = [];

	constructor(
		@IFeimaAuthenticationService private readonly authService: IFeimaAuthenticationService,
		@IFeimaModelMetadataFetcher private readonly feimaModelFetcher: IFeimaModelMetadataFetcher,
		@IFeimaEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		// Instantiate lmWrapper via DI
		this.lmWrapper = this.instantiationService.createInstance(CopilotLanguageModelWrapper);

		// Listen for model changes
		this.feimaModelFetcher.onDidModelsRefresh(() => {
			this.logService.info('[FeimaModelProvider] Models refreshed, firing change event');
			this._onDidChange.fire();
		});
	}

	/**
	 * Fire a change event to notify VS Code that model information has changed
	 */
	public fireChangeEvent(): void {
		this._onDidChange.fire();
	}

	/**
	 * Provide available Feima models when authenticated
	 * Follows GitHub's pattern: fetches endpoints from endpointProvider and filters to Feima models only
	 */
	async provideLanguageModelChatInformation(
		_options: { silent: boolean },
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		this.logService.debug('[FeimaModelProvider] provideLanguageModelChatInformation called');

		try {
			// Check if user is authenticated with Feima
			const isAuthenticated = await this.authService.isAuthenticated();
			if (!isAuthenticated) {
				this.logService.debug('[FeimaModelProvider] Feima not authenticated - returning empty models');
				this._chatEndpoints = [];
				return [];
			}

			this.logService.debug('[FeimaModelProvider] Feima authenticated - fetching endpoints');

			// Get Feima-only endpoints from endpoint provider (no filtering needed)
			const feimaEndpoints = await this.endpointProvider.getAllChatEndpoints();

			this.logService.debug(`[FeimaModelProvider] Found ${feimaEndpoints.length} Feima endpoints`);

			// Cache endpoints for later lookup in response/tokenCount methods
			this._chatEndpoints = feimaEndpoints;

			// Build language model information from endpoints (following GitHub's pattern)
			const languageModels: vscode.LanguageModelChatInformation[] = [];

			for (const endpoint of feimaEndpoints) {
				// Prepare model detail (multiplier if present, "Free" for multiplier 0)
				const modelDetail = endpoint.multiplier === 0 ? 'Free' : (endpoint.multiplier !== undefined ? `${endpoint.multiplier}x` : undefined);

				// Prepare tooltip (degradation reason if present, otherwise undefined)
				const modelTooltip = endpoint.degradationReason;

				// Prepare category for Feima models
				const modelCategory = { label: 'Feima Models', order: 0 };

				// Use authService to check authentication (non-blocking cached check)
				const isAuthenticated = await this.authService.isAuthenticated();
				const requiresAuthorization = isAuthenticated ? { label: 'Feima User' } : undefined;

				// Prepare status icon (only if degradation reason exists and ThemeIcon is available)
				let statusIcon: vscode.ThemeIcon | undefined;
				try {
					statusIcon = endpoint.degradationReason ? new vscode.ThemeIcon('warning') : undefined;
				} catch {
					// ThemeIcon may not be available in test environment
					statusIcon = undefined;
				}

				const model: vscode.LanguageModelChatInformation = {
					id: endpoint.model,
					name: endpoint.name,
					family: endpoint.family,
					version: endpoint.version,
					tooltip: modelTooltip,
					detail: modelDetail,
					category: modelCategory,
					statusIcon,
					maxInputTokens: endpoint.modelMaxPromptTokens,
					maxOutputTokens: endpoint.maxOutputTokens,
					requiresAuthorization,
					isUserSelectable: endpoint.showInModelPicker,
					isDefault: endpoint.isDefault,
					capabilities: {
						toolCalling: endpoint.supportsToolCalls,
						imageInput: endpoint.supportsVision
					}
				};

				languageModels.push(model);
			}

			this.logService.info(`[FeimaModelProvider] Providing ${languageModels.length} Feima language models`);
			return languageModels;
		} catch (error) {
			this.logService.error(
				error instanceof Error ? error : new Error(String(error)),
				'[FeimaModelProvider] Failed to provide language model information'
			);
			this._chatEndpoints = [];
			return [];
		}
	}

	/**
	 * Provide chat responses using real Feima models via CopilotLanguageModelWrapper
	 * Follows GitHub's pattern: looks up cached endpoint by model ID
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		this.logService.debug(`[FeimaModelProvider] Providing chat response for model: ${model.id}`);

		// Look up cached endpoint by model ID (following GitHub's pattern)
		const endpoint = this._chatEndpoints.find(e => e.model === model.id);

		if (!endpoint) {
			const errorMsg = `Endpoint not found for model: ${model.id}`;
			this.logService.error(errorMsg);
			throw new Error(errorMsg);
		}

		// Use CopilotLanguageModelWrapper to provide the response
		// This handles token counting, safety rules, tools, telemetry, error handling, etc.
		return this.lmWrapper.provideLanguageModelResponse(
			endpoint,
			messages,
			options,
			'GitHub.copilot-chat', // extensionId - must match the actual extension ID from package.json
			progress,
			token
		);
	}

	/**
	 * Provide token count using real tokenizer from endpoint
	 * Follows GitHub's pattern: looks up cached endpoint by model ID
	 */
	async provideTokenCount(
		model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		this.logService.debug(`[FeimaModelProvider] Providing token count for model: ${model.id}`);

		// Look up cached endpoint by model ID (following GitHub's pattern)
		const endpoint = this._chatEndpoints.find(e => e.model === model.id);

		if (!endpoint) {
			this.logService.warn(`[FeimaModelProvider] Endpoint not found for model: ${model.id}, using estimation`);
			// Fallback to estimation if endpoint not found
			const textStr = typeof text === 'string' ? text : JSON.stringify(text);
			return Math.ceil(textStr.length / 4);
		}

		// Use the real tokenizer from CopilotLanguageModelWrapper
		return this.lmWrapper.provideTokenCount(endpoint, text);
	}
}
