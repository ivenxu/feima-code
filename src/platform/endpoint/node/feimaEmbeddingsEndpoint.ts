/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITokenizer } from '../../../util/common/tokenizer';
import { IFeimaAuthenticationService } from '../../authentication/node/feimaAuthenticationService';
import { ILogService } from '../../log/common/logService';
import { IEmbeddingsEndpoint, IEndpointBody } from '../../networking/common/networking';
import { ITokenizerProvider } from '../../tokenizer/node/tokenizer';
import { IEmbeddingModelInformation } from '../common/endpointProvider';

/**
 * Feima embeddings endpoint using Ali Cloud text-embedding-v4.
 *
 * This endpoint provides embeddings for Feima-authenticated users via the Feima API,
 * which proxies to Ali Cloud DashScope embeddings service.
 */
export class FeimaEmbeddingsEndpoint implements IEmbeddingsEndpoint {
	public readonly maxBatchSize: number;
	public readonly modelMaxPromptTokens: number;

	public readonly name = this._modelInfo.name;
	public readonly version = this._modelInfo.version;
	public readonly family = this._modelInfo.capabilities.family;
	public readonly tokenizer = this._modelInfo.capabilities.tokenizer;

	constructor(
		private _modelInfo: IEmbeddingModelInformation,
		private readonly _feimaApiEndpoint: string,
		@ITokenizerProvider private readonly _tokenizerProvider: ITokenizerProvider,
		@IFeimaAuthenticationService private readonly _feimaAuthService: IFeimaAuthenticationService,
		@ILogService private readonly _logService: ILogService
	) {
		// Ali Cloud limits: batch size 10, max tokens 8192
		this.maxBatchSize = this._modelInfo.capabilities.limits?.max_inputs ?? 10;
		this.modelMaxPromptTokens = 8192;

		this._logService.debug(`[FeimaEmbeddingsEndpoint] Initialized: modelId=${this._modelInfo.id}, modelName=${this._modelInfo.name}, apiEndpoint=${this._feimaApiEndpoint}, maxBatchSize=${this.maxBatchSize}, modelMaxPromptTokens=${this.modelMaxPromptTokens}`);
	}

	public acquireTokenizer(): ITokenizer {
		return this._tokenizerProvider.acquireTokenizer(this);
	}

	public get urlOrRequestMetadata(): string {
		// Return Feima API endpoint URL for embeddings
		return `${this._feimaApiEndpoint}/v1/embeddings`;
	}

	/**
	 * Get authentication token for Feima API requests.
	 *
	 * This method is called by RemoteEmbeddingsComputer before making requests.
	 */
	public async getAuthToken(): Promise<string> {
		this._logService.debug('[FeimaEmbeddingsEndpoint] getAuthToken() called');

		const token = await this._feimaAuthService.getToken();
		if (!token) {
			this._logService.error('[FeimaEmbeddingsEndpoint] No authentication token available');
			throw new Error('Feima authentication required for embeddings');
		}

		this._logService.debug('[FeimaEmbeddingsEndpoint] Authentication token retrieved successfully');
		return token;
	}

	/**
	 * Intercept and transform request body before sending to Feima API.
	 *
	 * Note: Model mapping happens in CombinedEndpointProvider before the endpoint is selected.
	 * This method ensures the request uses the correct model and dimensions from _modelInfo.
	 */
	public interceptBody(body: IEndpointBody | undefined): void {
		this._logService.debug(`[FeimaEmbeddingsEndpoint] interceptBody() called: originalBody=${body ? JSON.stringify({ model: body.model, dimensions: body.dimensions }) : 'null'}`);

		if (!body) {
			this._logService.debug('[FeimaEmbeddingsEndpoint] No body to intercept');
			return;
		}

		const originalModel = body.model;
		const originalDimensions = body.dimensions;

		// Override with the actual Feima model from modelInfo
		body.model = this._modelInfo.id;
		// Use dimensions from request, or default to 512 for Ali Cloud text-embedding-v4
		if (!body.dimensions) {
			body.dimensions = 512;
		}

		this._logService.debug(`[FeimaEmbeddingsEndpoint] Body intercepted: originalModel=${originalModel}, newModel=${body.model}, originalDimensions=${originalDimensions}, newDimensions=${body.dimensions}`);
	}
}
