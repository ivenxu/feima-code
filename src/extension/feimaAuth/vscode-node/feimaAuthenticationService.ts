/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFeimaAuthenticationService } from '../../../platform/authentication/node/feimaAuthenticationService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter } from '../../../util/vs/base/common/event';
import { IAuthorizationTokenResponse } from '../../../util/vs/base/common/oauth';
import { IOAuth2Service } from '../common/oauth2Service';

/**
 * Stored token data in VS Code secrets
 */
interface IStoredTokenData {
	tokenResponse: IAuthorizationTokenResponse;
	issuedAt: number;
	sessionId: string;
	accountId: string;
	accountLabel: string;
}

/**
 * Pending OAuth2 callback resolver
 */
interface IPendingCallback {
	resolve: (result: { code: string } | { error: string }) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Feima authentication service - heavy implementation with OAuth2, session management, and secrets storage.
 *
 * This service is the "engine" that manages all authentication state. It:
 * - Performs OAuth2 + PKCE flow
 * - Manages session storage in VS Code secrets
 * - Handles token refresh automatically
 * - Provides both consumer methods (getToken, isAuthenticated) and provider methods (getSessions, createSession)
 *
 * Architecture:
 * - FeimaAuthenticationService (this class): Heavy implementation, registered in DI
 * - FeimaAuthProvider: Thin VS Code adapter that delegates to this service
 * - OAuth2Service: Handles OAuth2 protocol details
 */
export class FeimaAuthenticationService implements IFeimaAuthenticationService {
	readonly _serviceBrand: undefined;

	// Events
	private readonly _onDidChangeAuthenticationState = new Emitter<boolean>();
	readonly onDidChangeAuthenticationState = this._onDidChangeAuthenticationState.event;

	private readonly _onDidChangeSessions = new Emitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	// State
	private readonly _secretsKey = 'feimaAuth.tokens';
	/**
	 * Map of nonce → pending callback.
	 * Allows multiple concurrent OAuth flows per provider.
	 */
	private readonly _pendingCallbacks = new Map<string, IPendingCallback>();
	private _cachedSessions: vscode.AuthenticationSession[] = [];
	private _initializing: Promise<void>;

	// OAuth2 redirect URI - dynamically constructed based on VS Code version (vscode:// or vscode-insiders://)
	private readonly _redirectUri: string;

	constructor(
		@IVSCodeExtensionContext private readonly _context: IVSCodeExtensionContext,
		@ILogService private readonly _logService: ILogService,
		@IOAuth2Service private readonly _oauth2Service: IOAuth2Service
	) {
		// Construct redirect URI based on VS Code URI scheme (vscode:// or vscode-insiders://)
		// This ensures the OAuth callback works in both stable and insiders builds
		// Use /oauth/callback path to avoid conflict with GitHub auth provider's /did-authenticate
		this._redirectUri = `${vscode.env.uriScheme}://GitHub.copilot-chat/oauth/callback`;

		// Load initial sessions cache
		// Store the promise so getSessions() can wait for initialization to complete
		this._initializing = this._loadStoredToken().then(stored => {
			if (stored) {
				const session: vscode.AuthenticationSession = {
					id: stored.sessionId,
					accessToken: stored.tokenResponse.access_token,
					account: {
						id: stored.accountId,
						label: stored.accountLabel
					},
					scopes: []
				};
				this._cachedSessions = [session];
			}
		});
	}

	// ============ Consumer-Facing Methods ============

	async getToken(): Promise<string | undefined> {
		const sessions = await this.getSessions(undefined, {});
		if (sessions.length === 0) {
			return undefined;
		}
		return sessions[0].accessToken;
	}

	async isAuthenticated(): Promise<boolean> {
		const token = await this.getToken();
		return token !== undefined;
	}

	async refreshToken(): Promise<string | undefined> {
		// Token refresh happens automatically in getSessions()
		return this.getToken();
	}

	async signOut(): Promise<void> {
		const sessions = this._cachedSessions;
		if (sessions.length > 0) {
			await this.removeSession(sessions[0].id);
		}
	}

	// ============ Provider Methods (VS Code AuthenticationProvider interface) ============

	async getSessions(
		_scopes: readonly string[] | undefined,
		_options: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession[]> {
		// Wait for initial token loading to complete
		await this._initializing;

		// If we have cached sessions, validate and return them
		if (this._cachedSessions.length > 0) {
			// Validate the cached session is still valid by checking storage
			const stored = await this._loadStoredToken();
			if (!stored || !stored.tokenResponse || !stored.tokenResponse.access_token) {
				this._logService.warn('[FeimaAuthenticationService] Cached session invalid, clearing');
				this._cachedSessions = [];
				return [];
			}

			// Check if token needs refresh
			// We need to determine actual token expiry using stored.issuedAt + expires_in
			if (!stored.tokenResponse.expires_in) {
				this._logService.debug('[FeimaAuthenticationService] Token has no expires_in field');
			} else {
				const issuedAt = stored.issuedAt;  // When we stored the token
				const expiresAt = issuedAt + (stored.tokenResponse.expires_in * 1000);
				const now = Date.now();
				const timeUntilExpiry = Math.max(0, expiresAt - now);
				const fiveMinutes = 5 * 60 * 1000;
				const needsRefresh = timeUntilExpiry < fiveMinutes;

				this._logService.debug(`[FeimaAuthenticationService] Token refresh evaluation: needsRefresh=${needsRefresh}, hasRefreshToken=${!!stored.tokenResponse.refresh_token}`);
				this._logService.debug(`[FeimaAuthenticationService] Token expiry details: issuedAt=${new Date(issuedAt).toISOString()}, expiresAt=${new Date(expiresAt).toISOString()}, now=${new Date(now).toISOString()}, timeUntilExpiry=${Math.round(timeUntilExpiry / 1000)}s`);

				if (needsRefresh && stored.tokenResponse.refresh_token) {
					try {
						this._logService.info('[FeimaAuthenticationService] Refreshing expired token');
						const refreshed = await this._oauth2Service.refreshAccessToken(stored.tokenResponse.refresh_token);

						// If the OAuth2 server didn't return a new refresh_token, preserve the existing one
						// (RFC 6749 allows servers to reuse the old refresh_token)
						if (!refreshed.refresh_token) {
							this._logService.debug('[FeimaAuthenticationService] Server did not return new refresh_token, preserving existing one');
							refreshed.refresh_token = stored.tokenResponse.refresh_token;
						}

						await this._saveToken(refreshed, stored.accountId, stored.accountLabel, stored.sessionId);

						// Update cached session with new token
						this._cachedSessions = [{
							id: stored.sessionId,
							accessToken: refreshed.access_token,
							account: {
								id: stored.accountId,
								label: stored.accountLabel
							},
							scopes: []
						}];
					} catch (error) {
						this._logService.error('[FeimaAuthenticationService] Token refresh failed:', error);
						await this._clearStoredToken();
						this._cachedSessions = [];
						return [];
					}
				} else if (!needsRefresh) {
					this._logService.debug('[FeimaAuthenticationService] Token does not need refresh yet');
				} else if (!stored.tokenResponse.refresh_token) {
					this._logService.warn('[FeimaAuthenticationService] Token needs refresh but no refresh_token available');
				}
			}

			return this._cachedSessions;
		}

		// No cached sessions means no stored token
		return [];
	}

	async createSession(
		_scopes: readonly string[],
		_options: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession> {
		this._logService.info('[FeimaAuthenticationService] Starting OAuth2 flow');

		// Build authorization URL (generates unique nonce/state internally)
		const authUrl = await this._oauth2Service.buildAuthorizationUrl(this._redirectUri);

		// Extract nonce from the authorization URL to register pending callback
		const urlObj = new URL(authUrl);
		const nonce = urlObj.searchParams.get('state');
		if (!nonce) {
			throw new Error('Failed to generate OAuth2 state/nonce');
		}

		// Open in browser
		const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
		if (!opened) {
			throw new Error('Failed to open authentication URL');
		}

		// Wait for callback with 5-minute timeout
		const result = await new Promise<{ code: string } | { error: string }>((resolve) => {
			const timeoutId = setTimeout(() => {
				if (this._pendingCallbacks.has(nonce)) {
					this._pendingCallbacks.delete(nonce);
					this._logService.warn(`[FeimaAuthenticationService] OAuth2 timeout: nonce=${nonce}, remainingPending=${this._pendingCallbacks.size}`);
					resolve({ error: 'Authentication timed out after 5 minutes' });
				}
			}, 5 * 60 * 1000);

			this._pendingCallbacks.set(nonce, { resolve, timeoutId });
			this._logService.debug(`[FeimaAuthenticationService] Registered pending callback: nonce=${nonce}, pendingCount=${this._pendingCallbacks.size}`);
		});

		if ('error' in result) {
			throw new Error(`Authentication failed: ${result.error}`);
		}

		// Exchange code for token
		const tokenResponse = await this._oauth2Service.exchangeCodeForToken(result.code);

		// Extract user info
		const userInfo = this._oauth2Service.getUserInfo(tokenResponse);
		const accountId = userInfo?.sub || `user-${Date.now()}`;
		const accountLabel = userInfo?.email || userInfo?.preferred_username || userInfo?.name || 'Feima User';

		// Generate session ID once (used for both storage and session object)
		const sessionId = `feima-session-${Date.now()}`;

		// Save token with session ID
		await this._saveToken(tokenResponse, accountId, accountLabel, sessionId);

		const session: vscode.AuthenticationSession = {
			id: sessionId,
			accessToken: tokenResponse.access_token,
			account: {
				id: accountId,
				label: accountLabel
			},
			scopes: []
		};

		this._cachedSessions = [session];

		// Fire events
		this._onDidChangeSessions.fire({
			added: [session],
			removed: [],
			changed: []
		});
		this._onDidChangeAuthenticationState.fire(true);

		this._logService.info('[FeimaAuthenticationService] Session created successfully');
		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		this._logService.info(`[FeimaAuthenticationService] Removing session: ${sessionId}`);

		const stored = await this._loadStoredToken();
		if (!stored || stored.sessionId !== sessionId) {
			this._logService.warn('[FeimaAuthenticationService] No matching session found');
			return;
		}

		const session: vscode.AuthenticationSession = {
			id: stored.sessionId,
			accessToken: stored.tokenResponse.access_token,
			account: {
				id: stored.accountId,
				label: stored.accountLabel
			},
			scopes: []
		};

		// Clear token
		await this._clearStoredToken();
		this._cachedSessions = [];

		// Fire events
		this._onDidChangeSessions.fire({
			added: [],
			removed: [session],
			changed: []
		});
		this._onDidChangeAuthenticationState.fire(false);

		this._logService.info('[FeimaAuthenticationService] Session removed successfully');
	}

	getCachedSessions(): vscode.AuthenticationSession[] {
		return this._cachedSessions;
	}

	/**
	 * Handle OAuth callback URI (called by FeimaAuthProvider).
	 * Supports multiple concurrent OAuth flows via nonce-based routing.
	 */
	handleUri(uri: vscode.Uri): void {
		this._logService.debug(`[FeimaAuthenticationService] Received callback URI: ${uri.toString()}`);

		try {
			// Parse query parameters
			const query = new URLSearchParams(uri.query);
			const code = query.get('code');
			const state = query.get('state');
			const error = query.get('error');
			const errorDescription = query.get('error_description');

			// Handle error responses from OAuth server
			if (error) {
				const errorMsg = errorDescription || error;
				this._logService.error(`[FeimaAuthenticationService] OAuth2 error: ${errorMsg}`);

				// If we have state, route to specific callback
				if (state) {
					const pending = this._pendingCallbacks.get(state);
					if (pending) {
						clearTimeout(pending.timeoutId);
						this._pendingCallbacks.delete(state);
						pending.resolve({ error: errorMsg });
					}
				}
				vscode.window.showErrorMessage(`Feima authentication failed: ${errorMsg}`);
				return;
			}

			// Validate required parameters
			if (!code || !state) {
				this._logService.error(`[FeimaAuthenticationService] Invalid callback: missing code=${!!code}, state=${!!state}`);
				vscode.window.showErrorMessage('Invalid OAuth callback: missing required parameters');
				return;
			}

			// Extract nonce from state (for Feima, state IS the nonce)
			const nonce = state;

			// Find pending callback for this nonce
			const pending = this._pendingCallbacks.get(nonce);
			if (!pending) {
				this._logService.warn(`[FeimaAuthenticationService] No pending callback found: nonce=${nonce}, pendingCount=${this._pendingCallbacks.size}`);
				vscode.window.showErrorMessage('OAuth callback received but no authentication was in progress. Please try signing in again.');
				return;
			}

			// Clear timeout and remove from pending map
			clearTimeout(pending.timeoutId);
			this._pendingCallbacks.delete(nonce);

			this._logService.info(`[FeimaAuthenticationService] Routing callback to pending request: nonce=${nonce}, remainingPending=${this._pendingCallbacks.size}`);

			// Resolve the promise with code
			pending.resolve({ code });

		} catch (error) {
			this._logService.error('[FeimaAuthenticationService] Failed to handle callback URI:', error);
			vscode.window.showErrorMessage('Failed to process OAuth callback');
		}
	}

	// ============ Private Helper Methods ============

	private async _loadStoredToken(): Promise<IStoredTokenData | undefined> {
		try {
			const stored = await this._context.secrets.get(this._secretsKey);
			if (!stored) {
				return undefined;
			}
			return JSON.parse(stored);
		} catch (error) {
			this._logService.error('[FeimaAuthenticationService] Failed to load stored token:', error);
			return undefined;
		}
	}

	private async _saveToken(tokenResponse: IAuthorizationTokenResponse, accountId: string, accountLabel: string, sessionId: string): Promise<void> {
		const data: IStoredTokenData = {
			tokenResponse,
			issuedAt: Date.now(),  // Record when we stored this token
			sessionId,
			accountId,
			accountLabel
		};
		this._logService.debug(`[FeimaAuthenticationService] Saving token with issuedAt=${new Date(data.issuedAt).toISOString()}`);
		await this._context.secrets.store(this._secretsKey, JSON.stringify(data));
	}

	private async _clearStoredToken(): Promise<void> {
		await this._context.secrets.delete(this._secretsKey);
	}

	dispose(): void {
		// Reject all pending OAuth callbacks
		for (const [nonce, pending] of this._pendingCallbacks.entries()) {
			clearTimeout(pending.timeoutId);
			pending.resolve({ error: 'Authentication service disposed' });
			this._logService.debug(`[FeimaAuthenticationService] Rejected pending callback on dispose: nonce=${nonce}`);
		}
		this._pendingCallbacks.clear();

		this._onDidChangeAuthenticationState.dispose();
		this._onDidChangeSessions.dispose();
	}
}
