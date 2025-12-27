/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InlineCompletionItemProvider } from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { createContext, setup } from '../../completions-core/vscode-node/completionsServiceBridges';
import { CopilotInlineCompletionItemProvider } from '../../completions-core/vscode-node/extension/src/inlineCompletion';
import { ICopilotInlineCompletionItemProviderService } from '../common/copilotInlineCompletionItemProviderService';
import { Qwen3CompletionProvider } from './qwen3CompletionProvider';

export class CopilotInlineCompletionItemProviderService extends Disposable implements ICopilotInlineCompletionItemProviderService {
	readonly _serviceBrand: undefined;

	private _provider: InlineCompletionItemProvider | undefined;
	private _qwen3Provider: Qwen3CompletionProvider | undefined;
	private _completionsInstantiationService: IInstantiationService | undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	getOrCreateInstantiationService(): IInstantiationService {
		if (!this._completionsInstantiationService) {
			this._completionsInstantiationService = this._instantiationService.invokeFunction(createContext, this._store);
		}
		return this._completionsInstantiationService;
	}

	getOrCreateProvider(): InlineCompletionItemProvider {
		// Check if Qwen3 is configured
		const qwen3ApiKey = process.env.QWEN3_API_KEY;
		const qwen3BaseUrl = process.env.QWEN3_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

		if (qwen3ApiKey) {
			// Return Qwen3 provider if configured
			return this.getOrCreateQwen3Provider(qwen3ApiKey, qwen3BaseUrl);
		}

		// Otherwise use Copilot provider
		if (!this._provider) {
			this._completionsInstantiationService = this.getOrCreateInstantiationService();
			this._completionsInstantiationService.invokeFunction(setup, this._store);
			this._provider = this._register(this._completionsInstantiationService.createInstance(CopilotInlineCompletionItemProvider));
		}
		return this._provider;
	}

	getOrCreateQwen3Provider(apiKey: string, baseUrl: string): Qwen3CompletionProvider {
		if (!this._qwen3Provider) {
			this._qwen3Provider = this._register(this._instantiationService.createInstance(Qwen3CompletionProvider, apiKey, baseUrl));
		}
		return this._qwen3Provider;
	}
}
