/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, languages } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { autorun, observableFromEvent } from '../../../util/vs/base/common/observableInternal';
import { registerUnificationCommands } from '../../completions-core/vscode-node/completionsServiceBridges';
import { ICopilotInlineCompletionItemProviderService } from '../common/copilotInlineCompletionItemProviderService';
import { unificationStateObservable } from './completionsUnificationContribution';
import { Qwen3CompletionProvider } from './qwen3CompletionProvider';

export class CompletionsCoreContribution extends Disposable {

	private _provider: CopilotInlineCompletionItemProvider | undefined;
	private _qwen3Provider: Qwen3CompletionProvider | undefined;

	private readonly _copilotToken = observableFromEvent(this, this.authenticationService.onDidAuthenticationChange, () => this.authenticationService.copilotToken);

	constructor(
		@ICopilotInlineCompletionItemProviderService _copilotInlineCompletionItemProviderService: ICopilotInlineCompletionItemProviderService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentationService: IExperimentationService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService
	) {
		super();

		const unificationState = unificationStateObservable(this);

		this._register(autorun(reader => {
			const unificationStateValue = unificationState.read(reader);
			const configEnabled = configurationService.getExperimentBasedConfigObservable<boolean>(ConfigKey.TeamInternal.InlineEditsEnableGhCompletionsProvider, experimentationService).read(reader);
			const extensionUnification = unificationStateValue?.extensionUnification ?? false;
      let hasInstantiatedProvider = false;
			// Check if Qwen3 is configured
			const qwen3ApiKey = process.env.QWEN3_API_KEY;
			const qwen3BaseUrl = process.env.QWEN3_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

			if (qwen3ApiKey) {
				// Use Qwen3 provider if configured
				const qwen3Provider = this._getOrCreateQwen3Provider(qwen3ApiKey, qwen3BaseUrl);
				reader.store.add(
					languages.registerInlineCompletionItemProvider(
						{ pattern: '**' },
						qwen3Provider,
						{
							debounceDelayMs: 0,
							excludes: ['qwen3-completions'],
							groupId: 'completions'
						}
					)
				);
			} else if (unificationStateValue?.codeUnification || extensionUnification || configEnabled || this._copilotToken.read(reader)?.isNoAuthUser) {
				const provider = _copilotInlineCompletionItemProviderService.getOrCreateProvider();
				reader.store.add(
					languages.registerInlineCompletionItemProvider(
						{ pattern: '**' },
						provider,
						{
							debounceDelayMs: 0,
							excludes: ['github.copilot'],
							groupId: 'completions'
						}
					)
				);
				hasInstantiatedProvider = true;
			}

			void commands.executeCommand('setContext', 'github.copilot.extensionUnification.activated', extensionUnification);

			if (extensionUnification && hasInstantiatedProvider) {
				const completionsInstaService = _copilotInlineCompletionItemProviderService.getOrCreateInstantiationService();
				reader.store.add(completionsInstaService.invokeFunction(registerUnificationCommands));
			}
		}));

		this._register(autorun(reader => {
			const token = this._copilotToken.read(reader);
			void commands.executeCommand('setContext', 'github.copilot.activated', token !== undefined);
		}));
	}

	private _getOrCreateQwen3Provider(apiKey: string, baseUrl: string) {
		if (!this._qwen3Provider) {
			this._qwen3Provider = this._register(this._instantiationService.createInstance(Qwen3CompletionProvider, apiKey, baseUrl));
		}
		return this._qwen3Provider;
	}
}
