/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Dummy authentication provider that auto-authenticates users without OAuth flow.
 * This is for PoC purposes to test model providers without GitHub authentication.
 */
export class DummyAuthProvider implements vscode.AuthenticationProvider {
	private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _session: vscode.AuthenticationSession | undefined;

	/**
	 * Get existing sessions
	 */
	async getSessions(
		_scopes: readonly string[] | undefined,
		_options: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession[]> {
		return this._session ? [this._session] : [];
	}

	/**
	 * Create a new session (auto-authenticate without OAuth)
	 */
	async createSession(
		_scopes: readonly string[],
		_options: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession> {
		// Create a mock session immediately without any OAuth flow
		this._session = {
			id: `dummy-session-${Date.now()}`,
			accessToken: `dummy-token-${Math.random().toString(36).substring(7)}`,
			account: {
				id: 'dummy-user-id',
				label: 'Dummy User'
			},
			scopes: []
		};

		// Fire the change event to notify VS Code
		this._onDidChangeSessions.fire({
			added: [this._session],
			removed: [],
			changed: []
		});

		return this._session;
	}

	/**
	 * Remove a session
	 */
	async removeSession(sessionId: string): Promise<void> {
		if (this._session?.id === sessionId) {
			const removed = this._session;
			this._session = undefined;

			this._onDidChangeSessions.fire({
				added: [],
				removed: [removed],
				changed: []
			});
		}
	}
}
