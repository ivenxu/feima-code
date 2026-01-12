/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFeimaAuthenticationService } from '../../../platform/authentication/node/feimaAuthenticationService';
import { ILogService } from '../../../platform/log/common/logService';

/**
 * Thin authentication provider adapter that delegates to IFeimaAuthenticationService.
 * This class implements VS Code's AuthenticationProvider interface and UriHandler
 * but contains no business logic - all operations are delegated to the service.
 */
export class FeimaAuthProvider implements vscode.AuthenticationProvider, vscode.UriHandler {
	readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;

	constructor(
		private readonly _authService: IFeimaAuthenticationService,
		private readonly _logService: ILogService
	) {
		// Forward the event from the service
		this.onDidChangeSessions = _authService.onDidChangeSessions;
	}

	/**
	 * Handle OAuth callback URI - delegates to service
	 */
	async handleUri(uri: vscode.Uri): Promise<void> {
		this._logService.debug('[FeimaAuthProvider] Handling OAuth callback URI');
		return this._authService.handleUri(uri);
	}

	/**
	 * Get existing sessions - delegates to service
	 */
	async getSessions(
		scopes: readonly string[] | undefined,
		options: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession[]> {
		this._logService.debug('[FeimaAuthProvider] Getting sessions');
		return this._authService.getSessions(scopes, options);
	}

	/**
	 * Create a new session with OAuth2 flow - delegates to service
	 */
	async createSession(
		scopes: readonly string[],
		options: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession> {
		this._logService.debug('[FeimaAuthProvider] Creating new session');
		return this._authService.createSession(scopes, options);
	}

	/**
	 * Remove a session - delegates to service
	 */
	async removeSession(sessionId: string): Promise<void> {
		this._logService.debug(`[FeimaAuthProvider] Removing session: ${sessionId}`);
		return this._authService.removeSession(sessionId);
	}

	/**
	 * Get cached sessions without refresh - delegates to service
	 */
	getCachedSessions(): vscode.AuthenticationSession[] {
		this._logService.debug('[FeimaAuthProvider] Getting cached sessions');
		return this._authService.getCachedSessions();
	}
}
