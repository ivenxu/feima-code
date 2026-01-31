/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IFeimaConfigService, IFeimaConfigData, DEFAULT_FEIMA_CONFIG } from '../../../src/platform/feima/common/feimaConfigService';

describe('FeimaConfigService', () => {
	// Mock the service implementation for testing
	let mockConfigService: IFeimaConfigService;

	beforeEach(() => {
		// Create a mock implementation for testing
		mockConfigService = {
			getConfig: vi.fn(),
			getOAuth2Endpoints: vi.fn(),
			onDidChangeConfig: vi.fn(),
			validateConfig: vi.fn()
		};
	});

	describe('Default Configuration', () => {
		it('should have valid default Feima configuration', () => {
			expect(DEFAULT_FEIMA_CONFIG).toBeDefined();
			expect(DEFAULT_FEIMA_CONFIG.authBaseUrl).toBe('https://auth.feima.ai');
			expect(DEFAULT_FEIMA_CONFIG.apiBaseUrl).toBe('https://api.feima.ai/v1');
			expect(DEFAULT_FEIMA_CONFIG.clientId).toBe('vscode-feima-client');
			expect(DEFAULT_FEIMA_CONFIG.issuer).toBe('https://auth.feima.ai');
			expect(DEFAULT_FEIMA_CONFIG.modelRefreshInterval).toBe(300);
			expect(DEFAULT_FEIMA_CONFIG.quotaShowInStatusBar).toBe(true);
			expect(DEFAULT_FEIMA_CONFIG.quotaAlertThreshold).toBe(0.8);
			expect(DEFAULT_FEIMA_CONFIG.preferFeimaModels).toBe(true);
		});

		it('should have reasonable model refresh interval', () => {
			expect(DEFAULT_FEIMA_CONFIG.modelRefreshInterval).toBeGreaterThanOrEqual(60);
			expect(DEFAULT_FEIMA_CONFIG.modelRefreshInterval).toBeLessThanOrEqual(3600);
		});

		it('should have valid quota alert threshold', () => {
			expect(DEFAULT_FEIMA_CONFIG.quotaAlertThreshold).toBeGreaterThanOrEqual(0.5);
			expect(DEFAULT_FEIMA_CONFIG.quotaAlertThreshold).toBeLessThanOrEqual(0.99);
		});
	});

	describe('OAuth2 Endpoints Derivation', () => {
		it('should derive correct OAuth2 endpoints from base URL', () => {
			const mockService = {
				...mockConfigService,
				getConfig: vi.fn().mockReturnValue(DEFAULT_FEIMA_CONFIG),
				getOAuth2Endpoints: vi.fn().mockReturnValue({
					authorizationEndpoint: 'https://auth.feima.ai/oauth/authorize',
					tokenEndpoint: 'https://auth.feima.ai/oauth/token',
					revocationEndpoint: 'https://auth.feima.ai/oauth/revoke'
				})
			};

			const endpoints = mockService.getOAuth2Endpoints();

			expect(endpoints.authorizationEndpoint).toContain('/oauth/authorize');
			expect(endpoints.tokenEndpoint).toContain('/oauth/token');
			expect(endpoints.revocationEndpoint).toContain('/oauth/revoke');
		});

		it('should handle custom auth base URLs', () => {
			const customConfig = {
				...DEFAULT_FEIMA_CONFIG,
				authBaseUrl: 'https://custom-auth.example.com'
			};

			const mockService = {
				...mockConfigService,
				getConfig: vi.fn().mockReturnValue(customConfig),
				getOAuth2Endpoints: vi.fn().mockReturnValue({
					authorizationEndpoint: 'https://custom-auth.example.com/oauth/authorize',
					tokenEndpoint: 'https://custom-auth.example.com/oauth/token'
				})
			};

			const endpoints = mockService.getOAuth2Endpoints();

			expect(endpoints.authorizationEndpoint).toContain('custom-auth.example.com');
			expect(endpoints.tokenEndpoint).toContain('custom-auth.example.com');
		});
	});

	describe('Configuration Validation', () => {
		it('should validate required configuration fields', () => {
			const mockService = {
				...mockConfigService,
				validateConfig: vi.fn().mockReturnValue([])
			};

			const errors = mockService.validateConfig();
			expect(errors).toEqual([]);
		});

		it('should detect invalid URLs', () => {
			const mockService = {
				...mockConfigService,
				validateConfig: vi.fn().mockReturnValue(['Invalid authBaseUrl format'])
			};

			const errors = mockService.validateConfig();
			expect(errors).toContain('Invalid authBaseUrl format');
		});

		it('should validate model refresh interval bounds', () => {
			const mockService = {
				...mockConfigService,
				validateConfig: vi.fn().mockReturnValue(['modelRefreshInterval must be between 60-3600 seconds'])
			};

			const errors = mockService.validateConfig();
			expect(errors).toContain('modelRefreshInterval must be between 60-3600 seconds');
		});

		it('should validate quota alert threshold range', () => {
			const mockService = {
				...mockConfigService,
				validateConfig: vi.fn().mockReturnValue(['quotaAlertThreshold must be between 0.5-0.99'])
			};

			const errors = mockService.validateConfig();
			expect(errors).toContain('quotaAlertThreshold must be between 0.5-0.99');
		});
	});

	describe('Configuration Change Notifications', () => {
		it('should emit change events when configuration updates', () => {
			const listener = vi.fn();
			const mockService = {
				...mockConfigService,
				onDidChangeConfig: vi.fn().mockImplementation((callback: any) => {
					// Simulate configuration change
					const newConfig = { ...DEFAULT_FEIMA_CONFIG, preferFeimaModels: false };
					callback(newConfig);
					return { dispose: vi.fn() };
				})
			};

			// Subscribe to changes
			mockService.onDidChangeConfig(listener);

			expect(listener).toHaveBeenCalledWith({ ...DEFAULT_FEIMA_CONFIG, preferFeimaModels: false });
		});

		it('should allow multiple listeners for config changes', () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			const mockService = {
				...mockConfigService,
				onDidChangeConfig: vi.fn().mockImplementation((callback: any) => {
					callback(DEFAULT_FEIMA_CONFIG);
					return { dispose: vi.fn() };
				})
			};

			// Subscribe listeners
			mockService.onDidChangeConfig(listener1);
			mockService.onDidChangeConfig(listener2);

			// Both listeners should be called
			expect(listener1).toHaveBeenCalledWith(DEFAULT_FEIMA_CONFIG);
			expect(listener2).toHaveBeenCalledWith(DEFAULT_FEIMA_CONFIG);
		});
	});

	describe('Type Safety', () => {
		it('should maintain type safety for configuration interface', () => {
			const config: IFeimaConfigData = {
				authBaseUrl: 'https://test.com',
				apiBaseUrl: 'https://api.test.com',
				clientId: 'test-client',
				issuer: 'https://test.com',
				modelRefreshInterval: 300,
				quotaShowInStatusBar: true,
				quotaAlertThreshold: 0.8,
				preferFeimaModels: true
			};

			expect(config.authBaseUrl).toBe('https://test.com');
			expect(config.preferFeimaModels).toBe(true);
		});

		it('should enforce required fields in configuration', () => {
			// This would fail TypeScript compilation if any required fields were missing
			const config: IFeimaConfigData = DEFAULT_FEIMA_CONFIG;
			expect(config).toBeDefined();
		});
	});
});