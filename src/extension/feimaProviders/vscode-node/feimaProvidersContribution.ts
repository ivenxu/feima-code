/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFeimaAuthenticationService } from '../../../platform/authentication/node/feimaAuthenticationService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { FeimaAuthProvider } from '../../feimaAuth/vscode-node/feimaAuthProvider';
import { FeimaModelProvider } from '../../feimaModels/vscode-node/feimaModelProvider';

// Context key for tracking Feima auth sign-in state
const FEIMA_AUTH_SIGNED_IN_KEY = 'github.copilot.feimaAuth.signedIn';

/**
 * Contribution that registers the Feima authentication provider and Feima model provider.
 * Uses OAuth2 + PKCE flow for authentication via FeimaAuthenticationService (DI-injectable).
 */
export class FeimaProvidersContribution extends Disposable implements IExtensionContribution {

	readonly id = 'feimaProviders';
	private readonly authProvider: FeimaAuthProvider;
	private readonly modelProvider: FeimaModelProvider;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFeimaAuthenticationService private readonly authService: IFeimaAuthenticationService
	) {
		super();

		this.logService.info('[FeimaProviders] Starting registration...');

		// Initialize context key to false immediately (before checking sessions)
		// This ensures the menu item is visible from the start
		vscode.commands.executeCommand('setContext', FEIMA_AUTH_SIGNED_IN_KEY, false);

		// Create thin authentication provider adapter (delegates to service)
		this.authProvider = new FeimaAuthProvider(
			this.authService,
			this.logService
		);

		// Initialize context key for sign-in state
		const updateSignInContext = async () => {
			const isSignedIn = await this.authService.isAuthenticated();
			await vscode.commands.executeCommand('setContext', FEIMA_AUTH_SIGNED_IN_KEY, isSignedIn);
		};

		// Register VS Code authentication provider
		this._register(
			vscode.authentication.registerAuthenticationProvider(
				'feima-authentication',
				'Feima',
				this.authProvider,
				{ supportsMultipleAccounts: false }
			)
		);

		// After registering the provider, check if there's an existing session
		// and notify VS Code so the auth dialog shows the correct state
		this.authProvider.getSessions([], {}).then(sessions => {
			if (sessions.length > 0) {
				this.logService.info('[FeimaProviders] Found existing session on startup, notifying VS Code');
			}
		});

		// Register URI handler for OAuth2 callbacks
		// The provider implements UriHandler and delegates to the service
		this._register(
			vscode.window.registerUriHandler(this.authProvider)
		);

		// Function to request session access (adds menu item to Accounts menu)
		const requestSessionAccess = () => {
			vscode.authentication.getSession(
				'feima-authentication',
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
				if (e.provider.id === 'feima-authentication') {
					this.logService.debug(`[FeimaProviders] Auth session changed for provider: ${e.provider.id}`);

					// Use authService for consistent authentication check
					const isSignedIn = await this.authService.isAuthenticated();
					await vscode.commands.executeCommand('setContext', FEIMA_AUTH_SIGNED_IN_KEY, isSignedIn);

					this.modelProvider.fireChangeEvent();

					// If no session exists (sign-out), request session access again
					// to re-add the sign-in menu item to Accounts menu
					if (!isSignedIn) {
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
		requestSessionAccess();

		// Register language model provider using Feima model metadata for dynamic models
		this.modelProvider = this.instantiationService.createInstance(FeimaModelProvider as never);
		this._register(
			vscode.lm.registerLanguageModelChatProvider('feima', this.modelProvider)
		);

		// Fire the change event after a short delay to notify VS Code
		setTimeout(() => {
			this.logService.info('[FeimaProviders] Firing model information change event');
			this.modelProvider.fireChangeEvent();
		}, 200);

		// Register the Sign In action (similar to ChatSetupFromAccountsAction)
		this._register(this.registerSignInAction());

		// Register other commands
		this._register(this.registerOtherCommands());

	}

	/**
	 * Register the Sign In with Feima action that appears in the Accounts menu.
	 */
	private registerSignInAction(): vscode.Disposable {
		return vscode.commands.registerCommand('feima.signIn', async () => {
			try {
				this.logService.info('[FeimaProviders] Sign in action triggered');

				// Directly call createSession to bypass VS Code's TaskSingler
				// This allows starting a new auth flow immediately, even if another is in progress
				const session = await this.authProvider.createSession([], {});

				if (session) {
					await vscode.commands.executeCommand('setContext', FEIMA_AUTH_SIGNED_IN_KEY, true);
					vscode.window.showInformationMessage(
						`✅ Feima authentication successful! Signed in as: ${session.account.label}`
					);
				}
			} catch (error) {
				this.logService.error(error instanceof Error ? error : new Error(String(error)), '[FeimaProviders] Sign in failed');
				vscode.window.showErrorMessage(
					`Failed to sign in with Feima Auth: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		});
	}

	private registerOtherCommands(): vscode.Disposable {
		const disposables: vscode.Disposable[] = [];

		// Register command to sign out
		disposables.push(
			vscode.commands.registerCommand('feima.signOut', async () => {
				try {
					// Use provider's cached sessions (non-blocking)
					const sessions = this.authProvider.getCachedSessions();
					const session = sessions[0];

					if (session) {
						const confirmed = await vscode.window.showInformationMessage(
							`Sign out of Feima Auth (${session.account.label})?`,
							'Sign Out',
							'Cancel'
						);

						if (confirmed === 'Sign Out') {
							// Directly call the provider's removeSession method
							// This will fire onDidChangeSessions which updates the context key
							await this.authProvider.removeSession(session.id);
							this.logService.info(`[FeimaProviders] Session ${session.id} removed`);
							vscode.window.showInformationMessage('✅ Signed out of Feima Auth');
						}
					} else {
						vscode.window.showInformationMessage('No active Feima Auth session');
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to sign out: ${error}`);
				}
			})
		);

		// Register debug command to list available models
		disposables.push(
			vscode.commands.registerCommand('feima.listModels', async () => {
				try {
					const allModels = await vscode.lm.selectChatModels();
					const feimaModels = allModels.filter(m => m.vendor === 'feima');
					const modelInfo = feimaModels.map(m => `${m.id} (${m.vendor}) - ${m.name}`).join('\n');
					this.logService.info(`[FeimaProviders] Available Feima models from VS Code: ${feimaModels.length} models\n${modelInfo}`);
					vscode.window.showInformationMessage(
						`Found ${feimaModels.length} Feima model(s):\n${modelInfo || 'No models found'}`
					);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to list models: ${error}`);
				}
			})
		);

		// Register debug command to check context key state
		disposables.push(
			vscode.commands.registerCommand('feima.checkContextKey', () => {
				// Use provider's cached sessions (non-blocking)
				const sessions = this.authProvider.getCachedSessions();
				const isSignedIn = sessions.length > 0;
				vscode.window.showInformationMessage(
					`Context key ${FEIMA_AUTH_SIGNED_IN_KEY} should be: ${isSignedIn}\nSession exists: ${sessions.length > 0}`
				);
				this.logService.info(`[FeimaProviders] Context key check - isSignedIn: ${isSignedIn}, session exists: ${sessions.length > 0}`);
			})
		);

		return vscode.Disposable.from(...disposables);
	}

}
