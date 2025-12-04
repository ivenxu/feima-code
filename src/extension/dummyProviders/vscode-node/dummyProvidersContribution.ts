/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IAuthorizationServerMetadata } from '../../../util/vs/base/common/oauth';
import { IExtensionContribution } from '../../common/contributions';
import { IOAuth2Config, OAuth2Service } from '../../dummyAuth/common/oauth2Service';
import { DummyAuthProvider } from '../../dummyAuth/vscode-node/dummyAuthProvider';
import { DummyModelProvider } from '../../dummyModels/vscode-node/dummyModelProvider';

// Context key for tracking dummy auth sign-in state
const DUMMY_AUTH_SIGNED_IN_KEY = 'github.copilot.dummyAuth.signedIn';

/**
 * Contribution that registers the dummy authentication provider and dummy model provider.
 * Uses OAuth2 + PKCE flow for authentication.
 */
export class DummyProvidersContribution extends Disposable implements IExtensionContribution {

	readonly id = 'dummyProviders';
	private readonly authProvider: DummyAuthProvider;
	private readonly modelProvider: DummyModelProvider;

	constructor(
		@IFetcherService private readonly fetcherService: IFetcherService,
		@IVSCodeExtensionContext private readonly context: IVSCodeExtensionContext
	) {
		super();

		console.log('[DummyProviders] Starting registration...');

		// Initialize context key to false immediately (before checking sessions)
		// This ensures the menu item is visible from the start
		vscode.commands.executeCommand('setContext', DUMMY_AUTH_SIGNED_IN_KEY, false);
		console.log(`[DummyProviders] Context key ${DUMMY_AUTH_SIGNED_IN_KEY} initialized to: false`);

		// Configure OAuth2
		// TODO: Move to configuration or environment variables
		const oauth2Config: IOAuth2Config = this.getOAuth2Config();
		const oauth2Service = new OAuth2Service(oauth2Config, this.fetcherService);
		console.log('[DummyProviders] OAuth2Service initialized');

		// Initialize context key for sign-in state
		const updateSignInContext = async () => {
			const sessions = await vscode.authentication.getSession(
				'my-dummy-authentication',
				[],
				{ createIfNone: false, silent: true }
			);
			const isSignedIn = !!sessions;
			await vscode.commands.executeCommand('setContext', DUMMY_AUTH_SIGNED_IN_KEY, isSignedIn);
			console.log(`[DummyProviders] Context key ${DUMMY_AUTH_SIGNED_IN_KEY} updated to:`, isSignedIn);
		};

		// Register authentication provider
		this.authProvider = new DummyAuthProvider(this.context, oauth2Config, oauth2Service);
		console.log('[DummyProviders] Created DummyAuthProvider');

		// Register URI handler for OAuth callbacks
		this._register(vscode.window.registerUriHandler(this.authProvider));
		console.log('[DummyProviders] Registered URI handler for OAuth callbacks');

		this._register(
			vscode.authentication.registerAuthenticationProvider(
				'my-dummy-authentication',
				'My Dummy Auth',
				this.authProvider,
				{ supportsMultipleAccounts: false }
			)
		);
		console.log('[DummyProviders] Registered authentication provider: my-dummy-authentication');

		// Function to request session access (adds menu item to Accounts menu)
		const requestSessionAccess = () => {
			vscode.authentication.getSession(
				'my-dummy-authentication',
				[],
				{ createIfNone: true }
			).then(undefined, () => {
				// Ignore error if user doesn't sign in immediately
				// The menu item will remain available
			});
		};

		// Update context key when sessions change
		this._register(
			vscode.authentication.onDidChangeSessions(async (e: vscode.AuthenticationSessionsChangeEvent) => {
				if (e.provider.id === 'my-dummy-authentication') {
					console.log('[DummyProviders] Session change event:', {
						added: e.added?.length ?? 0,
						removed: e.removed?.length ?? 0,
						changed: e.changed?.length ?? 0
					});

					// Check current session state
					const sessions = await vscode.authentication.getSession(
						'my-dummy-authentication',
						[],
						{ createIfNone: false, silent: true }
					);
					console.log('[DummyProviders] Session after change:', sessions ? 'EXISTS' : 'NONE');
					const isSignedIn = !!sessions;
					await vscode.commands.executeCommand('setContext', DUMMY_AUTH_SIGNED_IN_KEY, isSignedIn);
					console.log(`[DummyProviders] Session changed, context key ${DUMMY_AUTH_SIGNED_IN_KEY} set to:`, isSignedIn);

					// Fire model change event to update model availability
					console.log('[DummyProviders] Firing model change event due to auth state change');
					this.modelProvider.fireChangeEvent();

					// If no session exists (sign-out), request session access again
					// to re-add the sign-in menu item to Accounts menu
					if (!isSignedIn) {
						console.log('[DummyProviders] No session found, re-requesting session access to show sign-in menu item');
						requestSessionAccess();
					}
				}
			})
		);

		// Set initial context key state
		updateSignInContext();

		// Request session access to add sign-in menu item to Accounts menu
		// By passing createIfNone: true, VS Code will automatically add a menu entry
		// in the Accounts menu for signing in (with a numbered badge on the Accounts icon)
		console.log('[DummyProviders] Requesting initial session access to show sign-in menu item...');
		requestSessionAccess();
		console.log('[DummyProviders] Session access requested - menu item should appear in Accounts menu');

		// Register language model provider
		this.modelProvider = new DummyModelProvider();
		console.log('[DummyProviders] Created DummyModelProvider');
		this._register(
			vscode.lm.registerLanguageModelChatProvider('dummy', this.modelProvider)
		);
		console.log('[DummyProviders] Registered language model provider: dummy');

		// Fire the change event after a short delay to notify VS Code
		setTimeout(() => {
			console.log('[DummyProviders] Firing model information change event');
			this.modelProvider.fireChangeEvent();
		}, 1000);

		// Register the Sign In action (similar to ChatSetupFromAccountsAction)
		this._register(this.registerSignInAction());

		// Register other commands
		this._register(this.registerOtherCommands());

		console.log('[DummyProviders] Registered commands');
		console.log('[DummyProviders] Registration complete!');
	}

	/**
	 * Register the Sign In with Dummy action that appears in the Accounts menu.
	 * This is similar to ChatSetupFromAccountsAction but for the dummy auth provider.
	 */
	private registerSignInAction(): vscode.Disposable {
		return vscode.commands.registerCommand('github.copilot.dummy.signIn', async () => {
			try {
				console.log('[DummyProviders] Sign in action triggered');

				// Request a session - this will trigger createSession if no session exists
				const session = await vscode.authentication.getSession(
					'my-dummy-authentication',
					[],
					{ createIfNone: true }
				);

				if (session) {
					await vscode.commands.executeCommand('setContext', DUMMY_AUTH_SIGNED_IN_KEY, true);
					console.log(`[DummyProviders] Context key ${DUMMY_AUTH_SIGNED_IN_KEY} set to: true after sign-in`);
					vscode.window.showInformationMessage(
						`✅ Dummy authentication successful! Signed in as: ${session.account.label}`
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to sign in with Dummy Auth: ${error}`
				);
			}
		});
	}

	private registerOtherCommands(): vscode.Disposable {
		const disposables: vscode.Disposable[] = [];

		// Register command to sign out
		disposables.push(
			vscode.commands.registerCommand('github.copilot.dummy.signOut', async () => {
				try {
					const session = await vscode.authentication.getSession(
						'my-dummy-authentication',
						[],
						{ createIfNone: false, silent: true }
					);

					if (session) {
						const confirmed = await vscode.window.showInformationMessage(
							`Sign out of Dummy Auth (${session.account.label})?`,
							'Sign Out',
							'Cancel'
						);

						if (confirmed === 'Sign Out') {
							// Directly call the provider's removeSession method
							// This will fire onDidChangeSessions which updates the context key
							await this.authProvider.removeSession(session.id);
							console.log(`[DummyProviders] Session ${session.id} removed`);
							vscode.window.showInformationMessage('✅ Signed out of Dummy Auth');
						}
					} else {
						vscode.window.showInformationMessage('No active Dummy Auth session');
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to sign out: ${error}`);
				}
			})
		);

		// Register debug command to list available models
		disposables.push(
			vscode.commands.registerCommand('github.copilot.dummy.listModels', async () => {
				try {
					const models = await vscode.lm.selectChatModels();
					console.log('[DummyProviders] Available models from VS Code:', models);
					const modelInfo = models.map(m => `${m.id} (${m.vendor}) - ${m.name}`).join('\n');
					vscode.window.showInformationMessage(
						`Found ${models.length} model(s):\n${modelInfo || 'No models found'}`
					);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to list models: ${error}`);
				}
			})
		);

		// Register debug command to check context key state
		disposables.push(
			vscode.commands.registerCommand('github.copilot.dummy.checkContextKey', async () => {
				const sessions = await vscode.authentication.getSession(
					'my-dummy-authentication',
					[],
					{ createIfNone: false, silent: true }
				);
				const isSignedIn = !!sessions;
				vscode.window.showInformationMessage(
					`Context key ${DUMMY_AUTH_SIGNED_IN_KEY} should be: ${isSignedIn}\nSession exists: ${!!sessions}`
				);
				console.log(`[DummyProviders] Context key check - isSignedIn: ${isSignedIn}, session:`, sessions);
			})
		);

		return vscode.Disposable.from(...disposables);
	}

	/**
	 * Get OAuth2 configuration.
	 * TODO: Move to VS Code settings or environment variables for production use.
	 */
	private getOAuth2Config(): IOAuth2Config {
		// Example configuration for a generic OAuth2 provider
		// This can be configured for AWS Cognito, Auth0, Okta, Azure AD, etc.
		const serverMetadata: IAuthorizationServerMetadata = {
			issuer: process.env.OAUTH_ISSUER || 'https://example.com',
			authorization_endpoint: process.env.OAUTH_AUTH_ENDPOINT || 'https://example.com/oauth2/authorize',
			token_endpoint: process.env.OAUTH_TOKEN_ENDPOINT || 'https://example.com/oauth2/token',
			revocation_endpoint: process.env.OAUTH_REVOCATION_ENDPOINT,
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code', 'refresh_token'],
			code_challenge_methods_supported: ['S256'],
			scopes_supported: ['openid', 'email', 'profile']
		};

		// For remote/WSL scenarios, the callback URI is transformed by vscode.env.asExternalUri()
		// Local: vscode://github.copilot-chat/oauth/callback
		// Remote/WSL: https://vscode.dev/redirect?url=vscode://github.copilot-chat/oauth/callback
		return {
			clientId: process.env.OAUTH_CLIENT_ID || 'your-client-id',
			clientSecret: process.env.OAUTH_CLIENT_SECRET, // Optional for public clients with PKCE
			serverMetadata,
			redirectUri: `${vscode.env.uriScheme}://github.copilot-chat/oauth/callback`,  // Base URI - transformed for remote
			scopes: ['openid', 'email', 'profile'],
			additionalAuthParams: {
				// Optional: add provider-specific parameters
				// For example, Azure AD might need 'prompt': 'select_account'
			}
		};
	}
}
