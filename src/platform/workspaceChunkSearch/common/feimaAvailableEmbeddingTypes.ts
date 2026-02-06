/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../authentication/common/authentication';
import { IFeimaAuthenticationService } from '../../authentication/common/feimaAuthentication';
import { EmbeddingType } from '../../embeddings/common/embeddingsComputer';
import { IFeimaConfigService } from '../../feima/common/feimaConfigService';
import { ILogService } from '../../log/common/logService';
import { GithubAvailableEmbeddingTypesService, IGithubAvailableEmbeddingTypesService } from './githubAvailableEmbeddingTypes';

/**
 * Combined service that tries Feima embeddings first, then falls back to GitHub.
 *
 * This service enables semantic search for Feima-authenticated users (including GitHub anonymous users)
 * by checking Feima authentication before querying GitHub's embedding models API.
 *
 * Priority logic:
 * 1. If Feima authenticated AND (no GitHub auth OR preferFeimaModels config) → Use Feima
 * 2. If GitHub authenticated → Use GitHub embeddings
 * 3. Otherwise → No embeddings available
 */
export class FeimaEmbeddingTypesService implements IGithubAvailableEmbeddingTypesService {
	readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IFeimaAuthenticationService private readonly _feimaAuthService: IFeimaAuthenticationService,
		@IAuthenticationService private readonly _githubAuthService: IAuthenticationService,
		@IFeimaConfigService private readonly _feimaConfigService: IFeimaConfigService,
		private readonly _githubService: GithubAvailableEmbeddingTypesService,
	) { }

	async getPreferredType(silent: boolean): Promise<EmbeddingType | undefined> {
		this._logService.debug(`[FeimaEmbeddingTypesService] getPreferredType() called, silent=${silent}`);

		const isFeimaAuthenticated = await this._feimaAuthService.isAuthenticated();
		const isGitHubAuthenticated = !!this._githubAuthService.copilotToken && !this._githubAuthService.copilotToken.isNoAuthUser;

		this._logService.debug(`[FeimaEmbeddingTypesService] Authentication status: Feima=${isFeimaAuthenticated}, GitHub=${isGitHubAuthenticated}`);

		// Check user preference from configuration
		const config = this._feimaConfigService.getConfig();
		const preferFeimaModels = config.preferFeimaModels;
		this._logService.debug(`[FeimaEmbeddingTypesService] Configuration: preferFeimaModels=${preferFeimaModels}`);

		// Priority 1: Use Feima if authenticated and either no GitHub or user prefers Feima
		if (isFeimaAuthenticated && (!isGitHubAuthenticated || preferFeimaModels)) {
			/* __GDPR__
				"feimaEmbeddingTypes.getPreferredType.feima" : {
					"owner": "feima",
					"comment": "Tracking when Feima embeddings are selected",
					"hasGitHubAuth": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether user also has GitHub authentication" },
					"preferFeimaModels": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether user prefers Feima models" }
				}
			*/
			// TODO: Add telemetry once ITelemetryService is added to constructor

			// Return Feima embedding model directly (text-embedding-v4 from feima-api database)
			// This replaces GitHub's text-embedding-3-small-512 with Feima's Ali Cloud embedding model
			const feimaEmbeddingModel = 'text-embedding-v4';
			this._logService.info(`[FeimaEmbeddingTypesService] Using Feima embeddings: ${feimaEmbeddingModel}`);
			return new EmbeddingType(feimaEmbeddingModel);
		}

		// Priority 2: Fallback to GitHub if authenticated
		if (isGitHubAuthenticated) {
			this._logService.info('[FeimaEmbeddingTypesService] Delegating to GitHub embeddings service');
			return this._githubService.getPreferredType(silent);
		}

		// No authentication available
		this._logService.info('[FeimaEmbeddingTypesService] No embeddings available: no authentication');

		/* __GDPR__
			"feimaEmbeddingTypes.getPreferredType.noAuth" : {
				"owner": "feima",
				"comment": "Tracking when no embeddings are available due to lack of authentication"
			}
		*/
		// TODO: Add telemetry

		return undefined;
	}
}
