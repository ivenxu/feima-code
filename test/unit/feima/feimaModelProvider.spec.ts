/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line local/no-runtime-import
import * as vscode from 'vscode';
// eslint-disable-next-line import/no-restricted-paths
import { FeimaModelProvider } from '../../../src/extension/feimaModels/vscode-node/feimaModelProvider';
import { IFeimaAuthenticationService } from '../../../src/platform/authentication/node/feimaAuthenticationService';
import { IEndpointProvider } from '../../../src/platform/endpoint/common/endpointProvider';
import { IFeimaModelMetadataFetcher } from '../../../src/platform/endpoint/node/feimaModelMetadataFetcher';
import { ILogService } from '../../../src/platform/log/common/logService';
import { IInstantiationService } from '../../../src/util/vs/platform/instantiation/common/instantiation';
// eslint-disable-next-line import/no-restricted-paths
import { CopilotLanguageModelWrapper } from '../../../src/extension/conversation/vscode-node/languageModelAccess';

// Mock VS Code API - using the global vscode shim from vitest config
// vi.mock('vscode', () => ({
// 	EventEmitter: vi.fn().mockImplementation(() => ({
// 		event: vi.fn(),
// 		fire: vi.fn()
// 	})),
// 	Position: vi.fn(),
// 	Range: vi.fn(),
// 	Selection: vi.fn(),
// 	CancellationTokenSource: vi.fn(),
// 	Diagnostic: vi.fn(),
// 	TextEdit: vi.fn(),
// 	WorkspaceEdit: vi.fn(),
// 	Uri: vi.fn(),
// 	MarkdownString: vi.fn(),
// 	TextEditorCursorStyle: vi.fn(),
// 	TextEditorLineNumbersStyle: vi.fn(),
// 	TextEditorRevealType: vi.fn(),
// 	EndOfLine: vi.fn(),
// 	DiagnosticSeverity: vi.fn()
// }));

describe('FeimaModelProvider', () => {
	let mockAuthService: IFeimaAuthenticationService;
	let mockModelFetcher: IFeimaModelMetadataFetcher;
	let mockEndpointProvider: IEndpointProvider;
	let mockLogService: ILogService;
	let mockInstantiationService: IInstantiationService;
	let mockLmWrapper: CopilotLanguageModelWrapper;
	let token: vscode.CancellationToken;

	beforeEach(() => {
		// Create mocks
		token = {} as vscode.CancellationToken;
		mockAuthService = {
			_serviceBrand: undefined,
			isAuthenticated: vi.fn(),
			onDidChangeSessions: vi.fn() as any,
			getSessions: vi.fn(),
			createSession: vi.fn(),
			removeSession: vi.fn(),
			getCachedSessions: vi.fn(),
			handleUri: vi.fn(),
			getToken: vi.fn(),
			refreshToken: vi.fn(),
			signOut: vi.fn(),
			onDidChangeAuthenticationState: { event: vi.fn() } as any
		};

		mockModelFetcher = {
			onDidModelsRefresh: vi.fn() as any,
			isFeimaModel: vi.fn(),
			getAllCompletionModels: vi.fn(),
			getAllChatModels: vi.fn(),
			getChatModelFromFamily: vi.fn(),
			getChatModelFromApiModel: vi.fn(),
			getEmbeddingsModel: vi.fn()
		};

		mockEndpointProvider = {
			_serviceBrand: undefined,
			getAllCompletionModels: vi.fn(),
			getAllChatEndpoints: vi.fn(),
			getChatEndpoint: vi.fn(),
			getEmbeddingsEndpoint: vi.fn()
		};

		mockLogService = {
			_serviceBrand: undefined,
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			show: vi.fn(),
			createSubLogger: vi.fn(),
			withExtraTarget: vi.fn()
		};

		mockLmWrapper = {
			provideLanguageModelResponse: vi.fn(),
			provideTokenCount: vi.fn()
		} as any;

		mockInstantiationService = {
			createInstance: vi.fn().mockReturnValue(mockLmWrapper)
		} as any;
	});

	describe('Initialization', () => {
		it('should initialize with required services', () => {
			const provider = new FeimaModelProvider(
				mockAuthService,
				mockModelFetcher,
				mockEndpointProvider,
				mockLogService,
				mockInstantiationService
			);

			expect(provider).toBeDefined();
			expect(mockInstantiationService.createInstance).toHaveBeenCalledWith(CopilotLanguageModelWrapper);
		});

		it('should listen for model refresh events', () => {
			const mockEventEmitter = { event: vi.fn() };
			mockModelFetcher.onDidModelsRefresh = mockEventEmitter.event;

			new FeimaModelProvider(
				mockAuthService,
				mockModelFetcher,
				mockEndpointProvider,
				mockLogService,
				mockInstantiationService
			);

			expect(mockEventEmitter.event).toHaveBeenCalled();
		});
	});

	describe('provideLanguageModelChatInformation', () => {
		let provider: FeimaModelProvider;

		beforeEach(() => {
			provider = new FeimaModelProvider(
				mockAuthService,
				mockModelFetcher,
				mockEndpointProvider,
				mockLogService,
				mockInstantiationService
			);
		});

		it('should return empty models when not authenticated', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(false);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toEqual([]);
			// Note: Provider uses console.log for debugging, not log service
		});

		it('should return models when authenticated', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-gpt-4',
					name: 'Feima GPT-4',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 2,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: true
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: 'feima-gpt-4',
				name: 'Feima GPT-4',
				family: 'GPT-4',
				version: '4.0',
				detail: '2x',
				category: { label: 'Feima Models', order: 0 },
				maxInputTokens: 8000,
				maxOutputTokens: 4000,
				isUserSelectable: true,
				isDefault: true,
				capabilities: {
					toolCalling: true,
					imageInput: false
				}
			});
		});

		it('should handle endpoints with degradation reason', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-gpt-3.5',
					name: 'Feima GPT-3.5',
					family: 'GPT-3.5',
					version: '3.5',
					degradationReason: 'High load',
					modelMaxPromptTokens: 4000,
					maxOutputTokens: 2000,
					supportsToolCalls: false,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			console.log('Mock auth service:', mockAuthService.isAuthenticated);
			console.log('Mock endpoint provider:', mockEndpointProvider.getAllChatEndpoints);

			// Test the mocks directly
			const authResult = await mockAuthService.isAuthenticated();
			console.log('Direct auth call result:', authResult);

			const endpointResult = await mockEndpointProvider.getAllChatEndpoints();
			console.log('Direct endpoint call result:', endpointResult);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			console.log('Result:', result);

			expect(result).toHaveLength(1);
			// Note: statusIcon check removed due to ThemeIcon not being available in test environment
			expect(result[0].tooltip).toBe('High load');
		});

		// ===== COMPREHENSIVE MODEL METADATA ATTRIBUTE TESTING =====

		it('should handle models with different billing multipliers', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-gpt-4-free',
					name: 'Feima GPT-4 Free',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 0,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-gpt-4-premium',
					name: 'Feima GPT-4 Premium',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 5,
					degradationReason: undefined,
					modelMaxPromptTokens: 32000,
					maxOutputTokens: 8000,
					supportsToolCalls: true,
					supportsVision: true,
					showInModelPicker: true,
					isDefault: true
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(2);

			// Free model should show "Free" or no multiplier
			expect(result[0].detail).toBe('Free');

			// Premium model should show multiplier
			expect(result[1].detail).toBe('5x');
		});

		it('should handle models with different capability combinations', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-basic',
					name: 'Feima Basic',
					family: 'GPT-3.5',
					version: '3.5',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 4000,
					maxOutputTokens: 2000,
					supportsToolCalls: false,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-tools',
					name: 'Feima Tools',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 2,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-vision',
					name: 'Feima Vision',
					family: 'GPT-4V',
					version: '4.0',
					multiplier: 3,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: true,
					showInModelPicker: true,
					isDefault: false
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(3);

			// Basic model - no tool calling or vision
			expect(result[0].capabilities.toolCalling).toBe(false);
			expect(result[0].capabilities.imageInput).toBe(false);

			// Tools model - tool calling but no vision
			expect(result[1].capabilities.toolCalling).toBe(true);
			expect(result[1].capabilities.imageInput).toBe(false);

			// Vision model - both tool calling and vision
			expect(result[2].capabilities.toolCalling).toBe(true);
			expect(result[2].capabilities.imageInput).toBe(true);
		});

		it('should handle models with different token limits', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-small',
					name: 'Feima Small',
					family: 'GPT-3.5',
					version: '3.5',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 4000,
					maxOutputTokens: 2000,
					supportsToolCalls: false,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-large',
					name: 'Feima Large',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 2,
					degradationReason: undefined,
					modelMaxPromptTokens: 32000,
					maxOutputTokens: 8000,
					supportsToolCalls: true,
					supportsVision: true,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-xl',
					name: 'Feima XL',
					family: 'GPT-4-Turbo',
					version: '4.0',
					multiplier: 3,
					degradationReason: undefined,
					modelMaxPromptTokens: 128000,
					maxOutputTokens: 16000,
					supportsToolCalls: true,
					supportsVision: true,
					showInModelPicker: true,
					isDefault: false
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(3);

			// Small model
			expect(result[0].maxInputTokens).toBe(4000);
			expect(result[0].maxOutputTokens).toBe(2000);

			// Large model
			expect(result[1].maxInputTokens).toBe(32000);
			expect(result[1].maxOutputTokens).toBe(8000);

			// XL model
			expect(result[2].maxInputTokens).toBe(128000);
			expect(result[2].maxOutputTokens).toBe(16000);
		});

		it('should handle models with different visibility settings', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-public',
					name: 'Feima Public',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-hidden',
					name: 'Feima Hidden',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: false,
					isDefault: false
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(2);

			// Public model should be user selectable
			expect(result[0].isUserSelectable).toBe(true);

			// Hidden model should not be user selectable
			expect(result[1].isUserSelectable).toBe(false);
		});

		it('should handle models with different default settings', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-regular',
					name: 'Feima Regular',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-default',
					name: 'Feima Default',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: true
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(2);

			// Regular model should not be default
			expect(result[0].isDefault).toBe(false);

			// Default model should be marked as default
			expect(result[1].isDefault).toBe(true);
		});

		it('should handle models with various degradation scenarios', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-normal',
					name: 'Feima Normal',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-high-load',
					name: 'Feima High Load',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: 'High server load - responses may be slower',
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-maintenance',
					name: 'Feima Maintenance',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: 'Scheduled maintenance in progress',
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(3);

			// Normal model should have no tooltip
			expect(result[0].tooltip).toBeUndefined();

			// High load model should show degradation reason
			expect(result[1].tooltip).toBe('High server load - responses may be slower');

			// Maintenance model should show degradation reason
			expect(result[2].tooltip).toBe('Scheduled maintenance in progress');
		});

		it('should handle premium vs free model billing display', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-free',
					name: 'Feima Free',
					family: 'GPT-3.5',
					version: '3.5',
					multiplier: 0,
					degradationReason: undefined,
					modelMaxPromptTokens: 4000,
					maxOutputTokens: 2000,
					supportsToolCalls: false,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-premium-1x',
					name: 'Feima Premium 1x',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 8000,
					maxOutputTokens: 4000,
					supportsToolCalls: true,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-premium-10x',
					name: 'Feima Premium 10x',
					family: 'GPT-4-Turbo',
					version: '4.0',
					multiplier: 10,
					degradationReason: undefined,
					modelMaxPromptTokens: 32000,
					maxOutputTokens: 8000,
					supportsToolCalls: true,
					supportsVision: true,
					showInModelPicker: true,
					isDefault: true
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(3);

			// Free model (multiplier = 0) should show "Free"
			expect(result[0].detail).toBe('Free');

			// Premium model with 1x multiplier should show "1x"
			expect(result[1].detail).toBe('1x');

			// Premium model with 10x multiplier should show "10x"
			expect(result[2].detail).toBe('10x');
		});

		it('should handle models with extreme token limits', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-mini',
					name: 'Feima Mini',
					family: 'GPT-3.5',
					version: '3.5',
					multiplier: 1,
					degradationReason: undefined,
					modelMaxPromptTokens: 1000, // Very small context
					maxOutputTokens: 500,
					supportsToolCalls: false,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-max',
					name: 'Feima Max',
					family: 'GPT-4-Long',
					version: '4.0',
					multiplier: 5,
					degradationReason: undefined,
					modelMaxPromptTokens: 2000000, // Very large context (2M tokens)
					maxOutputTokens: 100000,
					supportsToolCalls: true,
					supportsVision: true,
					showInModelPicker: true,
					isDefault: false
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(2);

			// Mini model with small limits
			expect(result[0].maxInputTokens).toBe(1000);
			expect(result[0].maxOutputTokens).toBe(500);

			// Max model with extreme limits
			expect(result[1].maxInputTokens).toBe(2000000);
			expect(result[1].maxOutputTokens).toBe(100000);
		});

		it('should handle models with mixed degradation and premium features', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);

			const mockEndpoints = [
				{
					model: 'feima-premium-degraded',
					name: 'Feima Premium Degraded',
					family: 'GPT-4',
					version: '4.0',
					multiplier: 5,
					degradationReason: 'Premium tier experiencing high demand',
					modelMaxPromptTokens: 32000,
					maxOutputTokens: 8000,
					supportsToolCalls: true,
					supportsVision: true,
					showInModelPicker: true,
					isDefault: false
				},
				{
					model: 'feima-free-limited',
					name: 'Feima Free Limited',
					family: 'GPT-3.5',
					version: '3.5',
					multiplier: 0,
					degradationReason: 'Rate limited - upgrade for better performance',
					modelMaxPromptTokens: 2000,
					maxOutputTokens: 1000,
					supportsToolCalls: false,
					supportsVision: false,
					showInModelPicker: true,
					isDefault: false
				}
			];

			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toHaveLength(2);

			// Premium degraded model
			expect(result[0].detail).toBe('5x');
			expect(result[0].tooltip).toBe('Premium tier experiencing high demand');
			expect(result[0].capabilities.toolCalling).toBe(true);
			expect(result[0].capabilities.imageInput).toBe(true);

			// Free limited model
			expect(result[1].detail).toBe('Free');
			expect(result[1].tooltip).toBe('Rate limited - upgrade for better performance');
			expect(result[1].capabilities.toolCalling).toBe(false);
			expect(result[1].capabilities.imageInput).toBe(false);
		});

		it('should handle authentication errors gracefully', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockRejectedValue(new Error('Auth failed'));

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toEqual([]);
			expect(mockLogService.error).toHaveBeenCalled();
		});

		it('should handle endpoint fetch errors gracefully', async () => {
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);
			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockRejectedValue(new Error('API error'));

			const result = await provider.provideLanguageModelChatInformation({ silent: false }, token);

			expect(result).toEqual([]);
			expect(mockLogService.error).toHaveBeenCalled();
		});
	});

	describe('provideLanguageModelChatResponse', () => {
		let provider: FeimaModelProvider;
		let mockModel: vscode.LanguageModelChatInformation;
		let token: vscode.CancellationToken;

		beforeEach(() => {
			provider = new FeimaModelProvider(
				mockAuthService,
				mockModelFetcher,
				mockEndpointProvider,
				mockLogService,
				mockInstantiationService
			);

			token = {} as vscode.CancellationToken;
			mockModel = {
				id: 'feima-gpt-4',
				name: 'Feima GPT-4',
				family: 'GPT-4',
				version: '4.0'
			} as vscode.LanguageModelChatInformation;

			// Set up cached endpoints
			const mockEndpoints = [{
				model: 'feima-gpt-4',
				name: 'Feima GPT-4',
				family: 'GPT-4',
				version: '4.0'
			}];
			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);
		});

		it('should provide chat response using CopilotLanguageModelWrapper', async () => {
			// First populate the cache
			await provider.provideLanguageModelChatInformation({ silent: false }, token);

			const messages: vscode.LanguageModelChatMessage[] = [
				vscode.LanguageModelChatMessage.User('Hello')
			];
			const options: vscode.ProvideLanguageModelChatResponseOptions = {
				toolMode: vscode.LanguageModelChatToolMode.Auto,
				requestInitiator: 'test-extension'
			};
			const progress = { report: vi.fn() };

			await provider.provideLanguageModelChatResponse(mockModel, messages, options, progress, token);

			expect(mockLmWrapper.provideLanguageModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({ model: 'feima-gpt-4' }),
				messages,
				options,
				'GitHub.copilot-chat',
				progress,
				token
			);
		});

		it('should throw error when endpoint not found', async () => {
			const invalidModel = {
				...mockModel,
				id: 'non-existent-model'
			} as vscode.LanguageModelChatInformation;

			await expect(provider.provideLanguageModelChatResponse(
				invalidModel,
				[],
				{
					toolMode: vscode.LanguageModelChatToolMode.Auto,
					requestInitiator: 'test-extension'
				},
				{ report: vi.fn() },
				{} as vscode.CancellationToken
			)).rejects.toThrow('Endpoint not found for model: non-existent-model');
		});
	});

	describe('provideTokenCount', () => {
		let provider: FeimaModelProvider;
		let mockModel: vscode.LanguageModelChatInformation;

		beforeEach(() => {
			provider = new FeimaModelProvider(
				mockAuthService,
				mockModelFetcher,
				mockEndpointProvider,
				mockLogService,
				mockInstantiationService
			);

			mockModel = {
				id: 'feima-gpt-4',
				name: 'Feima GPT-4',
				family: 'GPT-4',
				version: '4.0'
			} as vscode.LanguageModelChatInformation;
		});

		it('should provide token count using CopilotLanguageModelWrapper', async () => {
			// Set up cached endpoints
			const mockEndpoints = [{
				model: 'feima-gpt-4',
				name: 'Feima GPT-4',
				family: 'GPT-4',
				version: '4.0'
			}];
			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);
			mockLmWrapper.provideTokenCount = vi.fn().mockResolvedValue(42);

			// Populate cache
			await provider.provideLanguageModelChatInformation({ silent: false }, token);

			const result = await provider.provideTokenCount(mockModel, 'Hello world', {} as vscode.CancellationToken);

			expect(mockLmWrapper.provideTokenCount).toHaveBeenCalledWith(
				expect.objectContaining({ model: 'feima-gpt-4' }),
				'Hello world'
			);
			expect(result).toBe(42);
		});

		it('should fallback to estimation when endpoint not found', async () => {
			const invalidModel = {
				...mockModel,
				id: 'non-existent-model'
			} as vscode.LanguageModelChatInformation;

			const result = await provider.provideTokenCount(invalidModel, 'Hello world', {} as vscode.CancellationToken);

			// Should return estimation based on length/4
			expect(result).toBe(Math.ceil('Hello world'.length / 4));
			expect(mockLogService.warn).toHaveBeenCalledWith(
				'[FeimaModelProvider] Endpoint not found for model: non-existent-model, using estimation'
			);
		});

		it('should handle different message types', async () => {
			// Set up cached endpoints
			const mockEndpoints = [{
				model: 'feima-gpt-4',
				name: 'Feima GPT-4',
				family: 'GPT-4',
				version: '4.0'
			}];
			mockEndpointProvider.getAllChatEndpoints = vi.fn().mockResolvedValue(mockEndpoints);
			mockAuthService.isAuthenticated = vi.fn().mockResolvedValue(true);
			mockLmWrapper.provideTokenCount = vi.fn().mockResolvedValue(25);

			// Populate cache
			await provider.provideLanguageModelChatInformation({ silent: false }, token);

			const message = vscode.LanguageModelChatMessage.User('Test message');
			const result = await provider.provideTokenCount(mockModel, message, {} as vscode.CancellationToken);

			expect(mockLmWrapper.provideTokenCount).toHaveBeenCalledWith(
				expect.objectContaining({ model: 'feima-gpt-4' }),
				message
			);
			expect(result).toBe(25);
		});
	});

	describe('fireChangeEvent', () => {
		it('should fire change event to notify VS Code', () => {
			const provider = new FeimaModelProvider(
				mockAuthService,
				mockModelFetcher,
				mockEndpointProvider,
				mockLogService,
				mockInstantiationService
			);

			// Mock the EventEmitter
			const mockFire = vi.fn();
			(provider as any)._onDidChange = { fire: mockFire };

			provider.fireChangeEvent();

			expect(mockFire).toHaveBeenCalled();
		});
	});
});