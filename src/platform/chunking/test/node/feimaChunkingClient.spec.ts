/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CallTracker } from '../../../../util/common/telemetryCorrelationId';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { Event } from '../../../../util/vs/base/common/event';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { IFeimaAuthenticationService } from '../../../authentication/common/feimaAuthentication';
import { EmbeddingType } from '../../../embeddings/common/embeddingsComputer';
import { IFeimaConfigData, IFeimaConfigService, IOAuth2Endpoints } from '../../../feima/common/feimaConfigService';
import { FetchOptions, IFetcherService, Response } from '../../../networking/common/fetcherService';
import { createFakeResponse } from '../../../test/node/fetcher';
import { createPlatformServices, ITestingServicesAccessor } from '../../../test/node/services';
import { ChunkableContent, ComputeBatchInfo, EmbeddingsComputeQos } from '../../common/chunkingEndpointClient';
import { FeimaChunkingClient } from '../../common/feimaChunkingClient';

/**
 * Mock Feima Authentication Service for testing
 */
class MockFeimaAuthService implements IFeimaAuthenticationService {
	_serviceBrand: undefined;

	constructor(
		private _isAuthenticated: boolean,
		private _token?: string
	) { }

	async getToken(): Promise<string | undefined> {
		return this._token;
	}

	async isAuthenticated(): Promise<boolean> {
		return this._isAuthenticated;
	}

	async refreshToken(): Promise<string | undefined> {
		return this._token;
	}

	async signOut(): Promise<void> { }

	// Stub implementations for provider methods
	onDidChangeAuthenticationState: Event<boolean> = Event.None;
	getSessions = async () => [];
	createSession = async () => { throw new Error('Not implemented'); };
	removeSession = async () => { };
	getCachedSessions = () => [];
	onDidChangeSessions: Event<any> = Event.None;
	handleUri = () => { };
}

/**
 * Mock Feima Config Service for testing
 */
class MockFeimaConfigService implements IFeimaConfigService {
	_serviceBrand: undefined;

	constructor(private _config: IFeimaConfigData) { }

	getConfig(): IFeimaConfigData {
		return this._config;
	}

	getOAuth2Endpoints(): IOAuth2Endpoints {
		return {
			authorizationEndpoint: `${this._config.authBaseUrl}/oauth/authorize`,
			tokenEndpoint: `${this._config.authBaseUrl}/oauth/token`,
			revocationEndpoint: `${this._config.authBaseUrl}/oauth/revoke`,
		};
	}

	onDidChangeConfig: Event<IFeimaConfigData> = Event.None;

	validateConfig(): string[] {
		return [];
	}
}

/**
 * Mock Fetcher Service that tracks requests
 */
class MockFetcherService implements IFetcherService {
	_serviceBrand: undefined;

	requests: Array<{ url: string; options: FetchOptions }> = [];

	constructor(private _response: any, private _statusCode: number = 200) { }

	async fetch(url: string, options: FetchOptions): Promise<Response> {
		this.requests.push({ url, options });
		return createFakeResponse(this._statusCode, this._response);
	}

	getUserAgentLibrary(): string {
		return 'test-agent';
	}

	async disconnectAll(): Promise<unknown> {
		return Promise.resolve();
	}

	makeAbortController(): any {
		return { abort: () => { }, signal: {} };
	}

	isAbortError(e: any): boolean {
		return false;
	}

	isInternetDisconnectedError(e: any): boolean {
		return false;
	}

	isFetcherError(e: any): boolean {
		return false;
	}

	getUserMessageForFetcherError(err: any): string {
		return 'error';
	}

	async fetchWithPagination<T>(baseUrl: string, options: any): Promise<T[]> {
		return [];
	}
}

const DEFAULT_CONFIG: IFeimaConfigData = {
	authBaseUrl: 'https://auth.feima.test',
	apiBaseUrl: 'https://api.feima.test/v1',
	clientId: 'test-client-id',
	issuer: 'https://auth.feima.test',
	modelRefreshInterval: 300,
	quotaShowInStatusBar: true,
	quotaAlertThreshold: 0.8,
	preferFeimaModels: true,
};

/**
 * Create a mock ChunkableContent for testing
 */
function createMockContent(text: string, uri: URI = URI.parse('file:///test.ts')): ChunkableContent {
	return {
		uri,
		githubLanguageId: 145, // TypeScript
		getText: async () => text,
	};
}

describe('FeimaChunkingClient', function () {
	let accessor: ITestingServicesAccessor;
	let disposables: DisposableStore;

	beforeEach(() => {
		disposables = new DisposableStore();
	});

	afterEach(() => {
		disposables.dispose();
	});

	describe('Routing Logic', () => {
		it('should route to Feima API when authenticated', async function () {
			const feimaResponse = {
				chunks: [{
					hash: 'test-hash-1',
					range: { start: 0, end: 10 },
					line_range: { start: 1, end: 5 },
					text: 'function test() {\n  return 42;\n}',
				}],
				embedding_model: 'text-embedding-v4',
			};

			const mockFetcher = new MockFetcherService(feimaResponse);
			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('function test() { return 42; }');
			const embeddingType = new EmbeddingType('text-embedding-3-small');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			const result = await client.computeChunks(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Batch,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			// Verify Feima API was called
			expect(mockFetcher.requests).toHaveLength(1);
			expect(mockFetcher.requests[0].url).toBe('https://api.feima.test/v1/chunks');
			expect(mockFetcher.requests[0].options.method).toBe('POST');

			// Verify request body
			const requestBody = mockFetcher.requests[0].options.json as any;
			expect(requestBody).toBeDefined();
			expect(requestBody.embed).toBe(false);
			expect(requestBody.content).toBeDefined();
			expect(requestBody.language_id).toBe(145);
			expect(requestBody.embedding_model).toBe('text-embedding-v4');

			// Verify Authorization header
			expect(mockFetcher.requests[0].options.headers?.['Authorization']).toBe('Bearer auth-token');

			// Verify result
			expect(result).toBeDefined();
			expect(result?.length).toBe(1);
			expect(result![0].chunkHash).toBe('test-hash-1');
		});

		it('should NOT route to Feima API when not authenticated', async function () {
			// Mock GitHub client will be used automatically since we're not authenticated
			const mockAuthService = new MockFeimaAuthService(false);
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);
			const mockFetcher = new MockFetcherService({});

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('function test() { return 42; }');
			const embeddingType = new EmbeddingType('text-embedding-v4');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			// This should route to GitHub (the wrapped client), not Feima
			// Since we don't have GitHub token setup in tests, we expect it to fail
			// but the important part is that Feima API was NOT called
			try {
				await client.computeChunks(
					'github-token',
					embeddingType,
					content,
					batchInfo,
					EmbeddingsComputeQos.Batch,
					undefined,
					telemetryInfo,
					CancellationToken.None
				);
			} catch (e) {
				// Expected to fail since GitHub client is not configured in tests
			}

			// Verify Feima API was NOT called (no requests to feima.test domain)
			const feimaRequests = mockFetcher.requests.filter(r => r.url.includes('feima.test'));
			expect(feimaRequests).toHaveLength(0);
		});

		it('should fallback to GitHub when Feima API fails', async function () {
			// Make Feima API return an error
			const mockFetcher = new MockFetcherService({ error: 'Internal Server Error' });
			// Override fetch to throw error for Feima, but succeed for GitHub
			mockFetcher.fetch = async (url: string, options: FetchOptions) => {
				mockFetcher.requests.push({ url, options });
				if (url.includes('feima.test')) {
					throw new Error('Feima API Error');
				}
				// For GitHub, return empty chunks (we're just testing the fallback logic)
				return createFakeResponse(200, { chunks: [], embedding_model: 'text-embedding-v4' });
			};

			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('function test() { return 42; }');
			const embeddingType = new EmbeddingType('text-embedding-v4');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			// Should not throw, should fallback to GitHub
			await client.computeChunks(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Batch,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			// Verify Feima API was attempted first
			const feimaRequests = mockFetcher.requests.filter(r => r.url.includes('feima.test'));
			expect(feimaRequests.length).toBeGreaterThan(0);
		});
	});

	describe('Response Parsing', () => {
		it('should correctly parse chunks without embeddings', async function () {
			const feimaResponse = {
				chunks: [
					{
						hash: 'hash-1',
						range: { start: 0, end: 33 },
						line_range: { start: 1, end: 3 },
						text: 'function test() {\n  return 42;\n}',
					},
					{
						hash: 'hash-2',
						range: { start: 34, end: 60 },
						line_range: { start: 4, end: 6 },
						text: 'function test2() {\n  return 24;\n}',
					}
				],
				embedding_model: 'text-embedding-v4',
			};

			const mockFetcher = new MockFetcherService(feimaResponse);
			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('function test() { return 42; }\nfunction test2() { return 24; }');
			const embeddingType = new EmbeddingType('text-embedding-3-small');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			const result = await client.computeChunks(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Batch,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			expect(result).toBeDefined();
			expect(result?.length).toBe(2);

			// Check first chunk
			expect(result![0].chunkHash).toBe('hash-1');
			expect(result![0].chunk.range.startLineNumber).toBe(1);
			expect(result![0].chunk.range.endLineNumber).toBe(3);
			expect(result![0].embedding).toBeUndefined();

			// Check second chunk
			expect(result![1].chunkHash).toBe('hash-2');
			expect(result![1].chunk.range.startLineNumber).toBe(4);
			expect(result![1].chunk.range.endLineNumber).toBe(6);
			expect(result![1].embedding).toBeUndefined();
		});

		it('should correctly parse chunks with embeddings', async function () {
			const feimaResponse = {
				chunks: [
					{
						hash: 'hash-1',
						range: { start: 0, end: 33 },
						line_range: { start: 1, end: 3 },
						text: 'function test() {\n  return 42;\n}',
						embedding: {
							model: 'text-embedding-v4',
							embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
						}
					}
				],
				embedding_model: 'text-embedding-v4',
			};

			const mockFetcher = new MockFetcherService(feimaResponse);
			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('function test() { return 42; }');
			const embeddingType = new EmbeddingType('text-embedding-v4');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			const result = await client.computeChunksAndEmbeddings(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Batch,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			expect(result).toBeDefined();
			expect(result?.length).toBe(1);
			expect(result![0].embedding).toBeDefined();
			expect(result![0].embedding?.value).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
			expect(result![0].embedding?.type.id).toBe('text-embedding-v4');
		});

		it('should handle empty text content', async function () {
			const mockFetcher = new MockFetcherService({ chunks: [], embedding_model: 'test' });
			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('');
			const embeddingType = new EmbeddingType('text-embedding-v4');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			const result = await client.computeChunks(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Batch,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			// Should return empty array without calling API
			expect(result).toEqual([]);
			expect(mockFetcher.requests).toHaveLength(0);
		});

		it('should handle API error responses', async function () {
			const mockFetcher = new MockFetcherService({ error: 'Bad Request' }, 400);

			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('function test() { return 42; }');
			const embeddingType = new EmbeddingType('text-embedding-v4');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			// Should fallback to GitHub client when Feima returns error
			// We expect this to eventually return undefined or throw
			await client.computeChunks(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Batch,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			// Verify Feima API was called
			expect(mockFetcher.requests.length).toBeGreaterThan(0);
		});
	});

	describe('Request Format', () => {
		it('should send correct request format for computeChunks', async function () {
			const feimaResponse = {
				chunks: [],
				embedding_model: 'text-embedding-v4',
			};

			const mockFetcher = new MockFetcherService(feimaResponse);
			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('test content', URI.parse('file:///path/to/file.ts'));
			const embeddingType = new EmbeddingType('text-embedding-v4');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			await client.computeChunks(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Online,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			expect(mockFetcher.requests).toHaveLength(1);
			const request = mockFetcher.requests[0];

			expect(request.options.json).toMatchObject({
				embed: false, // computeChunks should NOT request embeddings
				qos: EmbeddingsComputeQos.Online,
				content: 'test content',
				path: '/path/to/file.ts',
				language_id: 145,
				embedding_model: 'text-embedding-v4',
				local_hashes: [],
			});
		});

		it('should send correct request format for computeChunksAndEmbeddings', async function () {
			const feimaResponse = {
				chunks: [],
				embedding_model: 'text-embedding-v4',
			};

			const mockFetcher = new MockFetcherService(feimaResponse);
			const mockAuthService = new MockFeimaAuthService(true, 'feima-token-123');
			const mockConfigService = new MockFeimaConfigService(DEFAULT_CONFIG);

			const testingServiceCollection = createPlatformServices();
			testingServiceCollection.define(IFeimaAuthenticationService, mockAuthService);
			testingServiceCollection.define(IFeimaConfigService, mockConfigService);
			testingServiceCollection.define(IFetcherService, mockFetcher);
			accessor = disposables.add(testingServiceCollection.createTestingAccessor());

			const client: FeimaChunkingClient = disposables.add(
				accessor.get(IInstantiationService).createInstance(FeimaChunkingClient as any)
			);

			const content = createMockContent('test content');
			const embeddingType = new EmbeddingType('text-embedding-v4');
			const batchInfo: ComputeBatchInfo = { recomputedFileCount: 0, sentContentTextLength: 0 };
			const telemetryInfo = new CallTracker();

			await client.computeChunksAndEmbeddings(
				'auth-token',
				embeddingType,
				content,
				batchInfo,
				EmbeddingsComputeQos.Batch,
				undefined,
				telemetryInfo,
				CancellationToken.None
			);

			expect(mockFetcher.requests).toHaveLength(1);
			const request = mockFetcher.requests[0];

			expect((request.options.json as any).embed).toBe(true); // computeChunksAndEmbeddings SHOULD request embeddings
		});
	});
});
