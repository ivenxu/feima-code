/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { DummyAuthProvider } from '../../dummyAuth/vscode-node/dummyAuthProvider';
import { DummyModelProvider } from '../../dummyModels/vscode-node/dummyModelProvider';

/**
 * Contribution that registers the dummy authentication provider and dummy model provider.
 * This is for PoC purposes to test chat functionality without GitHub authentication.
 */
export class DummyProvidersContribution extends Disposable implements IExtensionContribution {

	readonly id = 'dummyProviders';

	constructor() {
		super();

		console.log('[DummyProviders] Starting registration...');

		// Register authentication provider
		const authProvider = new DummyAuthProvider();
		console.log('[DummyProviders] Created DummyAuthProvider');
		this._register(
			vscode.authentication.registerAuthenticationProvider(
				'my-dummy-authentication',
				'My Dummy Auth',
				authProvider
			)
		);
		console.log('[DummyProviders] Registered authentication provider: my-dummy-authentication');

		// Register language model provider
		const modelProvider = new DummyModelProvider();
		console.log('[DummyProviders] Created DummyModelProvider');
		this._register(
			vscode.lm.registerLanguageModelChatProvider('dummy', modelProvider)
		);
		console.log('[DummyProviders] Registered language model provider: dummy');

		// Register command to trigger dummy authentication
		this._register(
			vscode.commands.registerCommand('github.copilot.dummy.signIn', async () => {
				try {
					// Request a session - this will trigger createSession if no session exists
					const session = await vscode.authentication.getSession(
						'my-dummy-authentication',
						[],
						{ createIfNone: true }
					);

					if (session) {
						vscode.window.showInformationMessage(
							`✅ Dummy authentication successful! Signed in as: ${session.account.label}`
						);
					}
				} catch (error) {
					vscode.window.showErrorMessage(
						`Failed to sign in with Dummy Auth: ${error}`
					);
				}
			})
		);

		// Register command to sign out
		this._register(
			vscode.commands.registerCommand('github.copilot.dummy.signOut', async () => {
				try {
					const sessions = await vscode.authentication.getSession(
						'my-dummy-authentication',
						[],
						{ createIfNone: false, silent: true }
					);

					if (sessions) {
						// VS Code doesn't provide a direct signOut API, so we show the accounts menu
						await vscode.commands.executeCommand('workbench.action.accounts');
						vscode.window.showInformationMessage(
							'Please use the Accounts menu to sign out of Dummy Auth'
						);
					} else {
						vscode.window.showInformationMessage('No active Dummy Auth session');
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to sign out: ${error}`);
				}
			})
		);
		console.log('[DummyProviders] Registered commands');
		console.log('[DummyProviders] Registration complete!');
	}
}
