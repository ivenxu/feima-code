/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Dummy language model provider that returns mock responses.
 * This is for PoC purposes to test chat functionality without real AI models.
 */
export class DummyModelProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	/**
	 * Provide available dummy models
	 */
	async provideLanguageModelChatInformation(
		_options: { silent: boolean },
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		return [
			{
				id: 'dummy-fast',
				name: 'Dummy Fast Model',
				family: 'dummy-fast',
				tooltip: 'A fast dummy model for testing (no authentication required)',
				detail: '1x',
				maxInputTokens: 100000,
				maxOutputTokens: 4096,
				version: '1.0.0',
				capabilities: {
					toolCalling: true
				}
				// Note: No authProviderId - makes this model universally accessible
			},
			{
				id: 'dummy-smart',
				name: 'Dummy Smart Model',
				family: 'dummy-smart',
				tooltip: 'A smarter dummy model for testing (no authentication required)',
				detail: '2x',
				maxInputTokens: 200000,
				maxOutputTokens: 8192,
				version: '1.0.0',
				capabilities: {
					toolCalling: true
				}
				// Note: No authProviderId - makes this model universally accessible
			},
			{
				id: 'dummy-pro',
				name: 'Dummy Pro Model',
				family: 'dummy-pro',
				tooltip: 'A pro dummy model for testing (no authentication required)',
				detail: '3x',
				maxInputTokens: 300000,
				maxOutputTokens: 16384,
				version: '1.0.0',
				capabilities: {
					toolCalling: true
				}
				// Note: No authProviderId - makes this model universally accessible
				// Since authProviderId is not part of the public API, all our models are universally accessible
			}
		];
	}

	/**
	 * Provide chat responses - returns dummy text with simulated delay
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage[],
		_options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		// Check for cancellation
		if (token.isCancellationRequested) {
			return;
		}

		// Simulate processing delay
		await new Promise(resolve => setTimeout(resolve, 500));

		if (token.isCancellationRequested) {
			return;
		}

		// Get the last user message
		const lastMessage = messages[messages.length - 1];
		const userMessageText = typeof lastMessage.content === 'string'
			? lastMessage.content
			: lastMessage.content.map(part =>
				part instanceof vscode.LanguageModelTextPart ? part.value : '[non-text]'
			).join('');

		// Generate dummy response
		const responseText = this.generateDummyResponse(model, userMessageText, messages.length);

		// Stream the response word by word for realistic effect
		const words = responseText.split(' ');
		for (let i = 0; i < words.length; i++) {
			if (token.isCancellationRequested) {
				return;
			}

			const word = i === 0 ? words[i] : ' ' + words[i];
			progress.report(new vscode.LanguageModelTextPart(word));

			// Small delay between words for streaming effect
			await new Promise(resolve => setTimeout(resolve, 30));
		}
	}

	/**
	 * Provide token count estimation
	 */
	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		// Simple estimation: ~4 characters per token
		if (typeof text === 'string') {
			return Math.ceil(text.length / 4);
		}

		// For messages, count all text content
		const content = text.content;

		// Sum up all text parts
		let totalLength = 0;
		for (const part of content) {
			// Check if it's a LanguageModelTextPart by checking for value property
			if ('value' in part && typeof part.value === 'string') {
				totalLength += part.value.length;
			}
		}
		return Math.ceil(totalLength / 4);
	}

	/**
	 * Generate a dummy response based on the model and input
	 */
	private generateDummyResponse(
		model: vscode.LanguageModelChatInformation,
		userMessage: string,
		messageCount: number
	): string {
		const responses = [
			`Hello! I'm the ${model.name}, a dummy AI model for testing. You said: "${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}"`,
			`This is a simulated response from ${model.name}. I received ${messageCount} message(s) in this conversation.`,
			`I'm ${model.name}, processing your request about "${userMessage.substring(0, 40)}${userMessage.length > 40 ? '...' : ''}". This is a mock response for PoC purposes.`,
			`${model.name} here! I understand you're asking about "${userMessage.substring(0, 30)}${userMessage.length > 30 ? '...' : ''}". Let me provide a dummy response for testing.`
		];

		// Pick a response based on message length
		const index = userMessage.length % responses.length;
		return responses[index];
	}
}
