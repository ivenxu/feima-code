/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import {
	DEFAULT_FEIMA_CONFIG,
	IFeimaConfigData,
	IFeimaConfigService,
	IOAuth2Endpoints
} from '../common/feimaConfigService';

/**
 * Implementation of Feima configuration service.
 *
 * Loads configuration from VS Code settings and provides:
 * - Type-safe access to all Feima settings
 * - Automatic validation with fallback to defaults
 * - Change notifications when settings update
 * - Derived OAuth2 endpoints from base URLs
 */
export class FeimaConfigService extends Disposable implements IFeimaConfigService {
	private _config: IFeimaConfigData;
	private readonly _onDidChangeConfig = new Emitter<IFeimaConfigData>();
	readonly onDidChangeConfig = this._onDidChangeConfig.event;

	constructor(@ILogService private readonly logService: ILogService) {
		super();

		// Load initial configuration
		this._config = this._loadConfig();
		this.logService.debug(`[FeimaConfig] Service initialized with auth: ${this._config.authBaseUrl}, api: ${this._config.apiBaseUrl}`);

		// Listen for configuration changes
		this._register(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (this._isFeimaSetting(e)) {
					this.logService.debug('[FeimaConfig] Feima settings changed, reloading configuration');
					const newConfig = this._loadConfig();
					this._config = newConfig;
					this._onDidChangeConfig.fire(newConfig);
				}
			})
		);
	}

	getConfig(): IFeimaConfigData {
		return { ...this._config };
	}

	getOAuth2Endpoints(): IOAuth2Endpoints {
		const { authBaseUrl } = this._config;

		// Normalize URL (remove trailing slash)
		const baseUrl = authBaseUrl.endsWith('/') ? authBaseUrl.slice(0, -1) : authBaseUrl;

		return {
			authorizationEndpoint: `${baseUrl}/oauth/authorize`,
			tokenEndpoint: `${baseUrl}/oauth/token`,
			revocationEndpoint: `${baseUrl}/oauth/revoke`
		};
	}

	validateConfig(): string[] {
		const errors: string[] = [];

		// Validate URLs are well-formed
		try {
			new URL(this._config.authBaseUrl);
		} catch {
			errors.push(`feima.auth.baseUrl is not a valid URL: ${this._config.authBaseUrl}`);
		}

		try {
			new URL(this._config.apiBaseUrl);
		} catch {
			errors.push(`feima.api.baseUrl is not a valid URL: ${this._config.apiBaseUrl}`);
		}

		try {
			new URL(this._config.issuer);
		} catch {
			errors.push(`feima.auth.issuer is not a valid URL: ${this._config.issuer}`);
		}

		// Validate clientId is not empty
		if (!this._config.clientId || this._config.clientId.trim().length === 0) {
			errors.push('feima.auth.clientId must not be empty');
		}

		// Validate refresh interval
		if (this._config.modelRefreshInterval < 60) {
			errors.push('feima.model.refreshInterval must be at least 60 seconds');
		}

		// Validate quota alert threshold
		if (this._config.quotaAlertThreshold < 0.5 || this._config.quotaAlertThreshold > 0.99) {
			errors.push('feima.quota.alertThreshold must be between 0.5 and 0.99');
		}

		return errors;
	}

	private _loadConfig(): IFeimaConfigData {
		const config = vscode.workspace.getConfiguration('feima');

		return {
			authBaseUrl: config.get<string>('auth.baseUrl') ?? DEFAULT_FEIMA_CONFIG.authBaseUrl,
			apiBaseUrl: config.get<string>('api.baseUrl') ?? DEFAULT_FEIMA_CONFIG.apiBaseUrl,
			clientId: config.get<string>('auth.clientId') ?? DEFAULT_FEIMA_CONFIG.clientId,
			issuer: config.get<string>('auth.issuer') ?? DEFAULT_FEIMA_CONFIG.issuer,
			modelRefreshInterval: config.get<number>('model.refreshInterval') ?? DEFAULT_FEIMA_CONFIG.modelRefreshInterval,
			quotaShowInStatusBar: config.get<boolean>('quota.showInStatusBar') ?? DEFAULT_FEIMA_CONFIG.quotaShowInStatusBar,
			quotaAlertThreshold: config.get<number>('quota.alertThreshold') ?? DEFAULT_FEIMA_CONFIG.quotaAlertThreshold,
			preferFeimaModels: config.get<boolean>('preferFeimaModels') ?? DEFAULT_FEIMA_CONFIG.preferFeimaModels
		};
	}

	private _isFeimaSetting(e: vscode.ConfigurationChangeEvent): boolean {
		return e.affectsConfiguration('feima');  // Fixed line
	}
}
