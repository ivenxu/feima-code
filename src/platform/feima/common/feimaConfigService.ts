/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';

/**
 * Configuration schema for Feima authentication and API endpoints.
 * All settings are configurable via VS Code settings.
 */
export interface IFeimaConfigData {
	/**
	 * Authentication server base URL (e.g., "https://auth.feima.ai")
	 * Used to construct OAuth2 endpoints
	 */
	authBaseUrl: string;

	/**
	 * API server base URL (e.g., "https://api.feima.ai/v1")
	 * Used for model discovery and other API calls
	 */
	apiBaseUrl: string;

	/**
	 * OAuth2 client ID for public clients (no secret needed with PKCE)
	 */
	clientId: string;

	/**
	 * OAuth2 issuer URL (typically same as authBaseUrl)
	 */
	issuer: string;

	/**
	 * Model refresh interval in seconds (60-3600)
	 */
	modelRefreshInterval: number;

	/**
	 * Whether to show quota usage in status bar
	 */
	quotaShowInStatusBar: boolean;

	/**
	 * Quota alert threshold (0.5-0.99)
	 */
	quotaAlertThreshold: number;

	/**
	 * Whether to prefer Feima models over GitHub Copilot models when both are available
	 * Default: true (Feima models first)
	 */
	preferFeimaModels: boolean;
}

/**
 * Derived OAuth2 endpoints computed from base configuration.
 */
export interface IOAuth2Endpoints {
	authorizationEndpoint: string;
	tokenEndpoint: string;
	revocationEndpoint?: string;
}

/**
 * Service for managing Feima configuration.
 *
 * Provides centralized access to all Feima settings with:
 * - Type-safe configuration access
 * - Automatic endpoint derivation
 * - Configuration change notifications
 * - Validation and defaults
 */
export interface IFeimaConfigService {
	/**
	 * Get current configuration data
	 */
	getConfig(): IFeimaConfigData;

	/**
	 * Get OAuth2 endpoints derived from auth base URL
	 */
	getOAuth2Endpoints(): IOAuth2Endpoints;

	/**
	 * Event fired when configuration changes
	 */
	onDidChangeConfig: Event<IFeimaConfigData>;

	/**
	 * Validate configuration and return errors if invalid
	 */
	validateConfig(): string[];
}

export const IFeimaConfigService = createServiceIdentifier<IFeimaConfigService>('IFeimaConfigService');

/**
 * Default production configuration values.
 * These serve as fallbacks if settings are not configured.
 */
export const DEFAULT_FEIMA_CONFIG: IFeimaConfigData = {
	authBaseUrl: 'https://auth.feima.ai',
	apiBaseUrl: 'https://api.feima.ai/v1',
	clientId: 'vscode-feima-client',
	issuer: 'https://auth.feima.ai',
	modelRefreshInterval: 300,
	quotaShowInStatusBar: true,
	quotaAlertThreshold: 0.8,
	preferFeimaModels: true  // Feima models preferred by default
};
