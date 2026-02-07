/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import type { Event } from '../../../util/vs/base/common/event';

/**
 * Service interface for Feima authentication.
 *
 * Provides both consumer-facing methods (getToken, isAuthenticated) AND
 * VS Code AuthenticationProvider methods (getSessions, createSession, removeSession).
 *
 * Architecture:
 * - FeimaAuthenticationService: Heavy implementation (OAuth2, session management, secrets)
 * - FeimaAuthProvider: Thin VS Code adapter that delegates to the service
 * - Other services: Inject IFeimaAuthenticationService via DI for getToken/isAuthenticated
 */
export interface IFeimaAuthenticationService {
	readonly _serviceBrand: undefined;

	// ============ Consumer-Facing Methods (for DI injection) ============

	/**
	 * Get current JWT token for Feima API.
	 * @returns JWT token string or undefined if not authenticated or expired
	 */
	getToken(): Promise<string | undefined>;

	/**
	 * Check if user is authenticated with Feima.
	 * @returns true if authenticated, false otherwise
	 */
	isAuthenticated(): Promise<boolean>;

	/**
	 * Refresh JWT token from authentication server.
	 * @returns Fresh JWT token or undefined if refresh fails
	 */
	refreshToken(): Promise<string | undefined>;

	/**
	 * Sign out and clear all stored tokens.
	 */
	signOut(): Promise<void>;

	/**
	 * Event fired when authentication state changes (sign-in or sign-out).
	 */
	onDidChangeAuthenticationState: Event<boolean>;

	// ============ Provider Methods (for FeimaAuthProvider delegation) ============

	/**
	 * Get all authentication sessions.
	 * Used by VS Code AuthenticationProvider interface.
	 */
	getSessions(scopes: readonly string[] | undefined, options: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession[]>;

	/**
	 * Create a new authentication session via OAuth2 + PKCE flow.
	 * Used by VS Code AuthenticationProvider interface.
	 */
	createSession(scopes: readonly string[], options: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession>;

	/**
	 * Remove an authentication session.
	 * Used by VS Code AuthenticationProvider interface.
	 */
	removeSession(sessionId: string): Promise<void>;

	/**
	 * Get cached sessions synchronously (non-blocking).
	 * Used by FeimaAuthProvider for fast checks.
	 */
	getCachedSessions(): vscode.AuthenticationSession[];

	/**
	 * Event fired when sessions change.
	 * Used by VS Code AuthenticationProvider interface.
	 */
	onDidChangeSessions: Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;

	/**
	 * Handle OAuth callback URI (called by VS Code UriHandler).
	 * Used by FeimaAuthProvider for OAuth2 flow.
	 */
	handleUri(uri: vscode.Uri): void;
}

export const IFeimaAuthenticationService = createServiceIdentifier<IFeimaAuthenticationService>('feimaAuthenticationService');
