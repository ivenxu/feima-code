/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line local/no-runtime-import
import * as vscode from 'vscode';
// eslint-disable-next-line import/no-restricted-paths
import { FeimaAuthProvider } from '../../../src/extension/feimaAuth/vscode-node/feimaAuthProvider';
import { IFeimaAuthenticationService } from '../../../src/platform/authentication/node/feimaAuthenticationService';
import { ILogService } from '../../../src/platform/log/common/logService';

// Mock VS Code API
vi.mock('vscode', () => ({
	EventEmitter: vi.fn().mockImplementation(() => ({
		event: vi.fn()
	}))
}));

describe('FeimaAuthProvider', () => {
	let mockAuthService: IFeimaAuthenticationService;
	let mockLogService: ILogService;
	let provider: FeimaAuthProvider;

	beforeEach(() => {
		mockAuthService = {
			_serviceBrand: undefined,
			isAuthenticated: vi.fn(),
			onDidChangeSessions: { event: vi.fn() } as any,
			getSessions: vi.fn(),
			createSession: vi.fn(),
			removeSession: vi.fn(),
			getCachedSessions: vi.fn(),
			handleUri: vi.fn(),
			getToken: vi.fn(),
			refreshToken: vi.fn(),
			signOut: vi.fn(),
			onDidChangeAuthenticationState: { event: vi.fn() } as any
		};

		mockLogService = {
			_serviceBrand: undefined,
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			show: vi.fn(),
			createSubLogger: vi.fn(),
			withExtraTarget: vi.fn()
		};

		provider = new FeimaAuthProvider(mockAuthService, mockLogService);
	});

	describe('Initialization', () => {
		it('should initialize with required services', () => {
			expect(provider).toBeDefined();
			expect(provider.onDidChangeSessions).toBe(mockAuthService.onDidChangeSessions);
		});
	});

	describe('handleUri', () => {
		it('should delegate URI handling to auth service', async () => {
			const mockUri = {} as vscode.Uri;
			mockAuthService.handleUri = vi.fn().mockResolvedValue(undefined);

			await provider.handleUri(mockUri);

			expect(mockAuthService.handleUri).toHaveBeenCalledWith(mockUri);
			expect(mockLogService.debug).toHaveBeenCalledWith('[FeimaAuthProvider] Handling OAuth callback URI');
		});

		it('should handle URI handling errors', async () => {
			const mockUri = {} as vscode.Uri;
			const error = new Error('URI handling failed');
			mockAuthService.handleUri = vi.fn().mockRejectedValue(error);

			await expect(provider.handleUri(mockUri)).rejects.toThrow('URI handling failed');
		});
	});

	describe('getSessions', () => {
		it('should delegate session retrieval to auth service', async () => {
			const scopes = ['openid', 'profile'];
			const options = {};
			const mockSessions: vscode.AuthenticationSession[] = [
				{
					id: 'session1',
					accessToken: 'token1',
					account: { id: 'user1', label: 'User 1' },
					scopes: ['openid']
				}
			];

			mockAuthService.getSessions = vi.fn().mockResolvedValue(mockSessions);

			const result = await provider.getSessions(scopes, options);

			expect(mockAuthService.getSessions).toHaveBeenCalledWith(scopes, options);
			expect(result).toEqual(mockSessions);
			expect(mockLogService.debug).toHaveBeenCalledWith('[FeimaAuthProvider] Getting sessions');
		});

		it('should handle empty scopes', async () => {
			const mockSessions: vscode.AuthenticationSession[] = [];
			mockAuthService.getSessions = vi.fn().mockResolvedValue(mockSessions);

			const result = await provider.getSessions(undefined, {});

			expect(mockAuthService.getSessions).toHaveBeenCalledWith(undefined, {});
			expect(result).toEqual([]);
		});

		it('should handle session retrieval errors', async () => {
			const error = new Error('Session retrieval failed');
			mockAuthService.getSessions = vi.fn().mockRejectedValue(error);

			await expect(provider.getSessions(['openid'], {})).rejects.toThrow('Session retrieval failed');
		});
	});

	describe('createSession', () => {
		it('should delegate session creation to auth service', async () => {
			const scopes = ['openid', 'profile'];
			const options = {};
			const mockSession: vscode.AuthenticationSession = {
				id: 'session1',
				accessToken: 'token1',
				account: { id: 'user1', label: 'User 1' },
				scopes: ['openid', 'profile']
			};

			mockAuthService.createSession = vi.fn().mockResolvedValue(mockSession);

			const result = await provider.createSession(scopes, options);

			expect(mockAuthService.createSession).toHaveBeenCalledWith(scopes, options);
			expect(result).toEqual(mockSession);
			expect(mockLogService.debug).toHaveBeenCalledWith('[FeimaAuthProvider] Creating new session');
		});

		it('should handle OAuth2 flow completion', async () => {
			const scopes = ['openid', 'email'];
			const mockSession: vscode.AuthenticationSession = {
				id: 'oauth-session',
				accessToken: 'oauth-token',
				account: { id: 'user@example.com', label: 'User' },
				scopes: ['openid', 'email']
			};

			mockAuthService.createSession = vi.fn().mockResolvedValue(mockSession);

			const result = await provider.createSession(scopes, {});

			expect(result.id).toBe('oauth-session');
			expect(result.scopes).toEqual(['openid', 'email']);
		});

		it('should handle session creation errors', async () => {
			const error = new Error('OAuth2 flow failed');
			mockAuthService.createSession = vi.fn().mockRejectedValue(error);

			await expect(provider.createSession(['openid'], {})).rejects.toThrow('OAuth2 flow failed');
		});
	});

	describe('removeSession', () => {
		it('should delegate session removal to auth service', async () => {
			const sessionId = 'session-to-remove';
			mockAuthService.removeSession = vi.fn().mockResolvedValue(undefined);

			await provider.removeSession(sessionId);

			expect(mockAuthService.removeSession).toHaveBeenCalledWith(sessionId);
			expect(mockLogService.debug).toHaveBeenCalledWith('[FeimaAuthProvider] Removing session: session-to-remove');
		});

		it('should handle session removal errors', async () => {
			const sessionId = 'invalid-session';
			const error = new Error('Session not found');
			mockAuthService.removeSession = vi.fn().mockRejectedValue(error);

			await expect(provider.removeSession(sessionId)).rejects.toThrow('Session not found');
		});
	});

	describe('getCachedSessions', () => {
		it('should delegate cached session retrieval to auth service', () => {
			const mockSessions: vscode.AuthenticationSession[] = [
				{
					id: 'cached-session',
					accessToken: 'cached-token',
					account: { id: 'cached-user', label: 'Cached User' },
					scopes: ['openid']
				}
			];

			mockAuthService.getCachedSessions = vi.fn().mockReturnValue(mockSessions);

			const result = provider.getCachedSessions();

			expect(mockAuthService.getCachedSessions).toHaveBeenCalled();
			expect(result).toEqual(mockSessions);
			expect(mockLogService.debug).toHaveBeenCalledWith('[FeimaAuthProvider] Getting cached sessions');
		});

		it('should handle empty cached sessions', () => {
			mockAuthService.getCachedSessions = vi.fn().mockReturnValue([]);

			const result = provider.getCachedSessions();

			expect(result).toEqual([]);
		});

		it('should return sessions with proper structure', () => {
			const mockSessions: vscode.AuthenticationSession[] = [
				{
					id: 'session1',
					accessToken: 'token1',
					account: { id: 'user1', label: 'User 1' },
					scopes: ['openid', 'profile']
				},
				{
					id: 'session2',
					accessToken: 'token2',
					account: { id: 'user2', label: 'User 2' },
					scopes: ['openid', 'email']
				}
			];

			mockAuthService.getCachedSessions = vi.fn().mockReturnValue(mockSessions);

			const result = provider.getCachedSessions();

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('session1');
			expect(result[1].scopes).toEqual(['openid', 'email']);
		});
	});

	describe('Event Forwarding', () => {
		it('should forward session change events from auth service', () => {
			const mockEvent = { event: vi.fn() };
			mockAuthService.onDidChangeSessions = mockEvent as any;

			// Create new provider to test event forwarding
			const newProvider = new FeimaAuthProvider(mockAuthService, mockLogService);

			expect(newProvider.onDidChangeSessions).toBe(mockEvent);
		});
	});

	describe('Error Handling', () => {
		it('should not expose internal service errors directly', async () => {
			mockAuthService.getSessions = vi.fn().mockRejectedValue(new Error('Internal auth error'));

			await expect(provider.getSessions(['openid'], {})).rejects.toThrow('Internal auth error');
		});

		it('should log all operations for debugging', async () => {
			mockAuthService.getSessions = vi.fn().mockResolvedValue([]);

			await provider.getSessions(['openid'], {});

			expect(mockLogService.debug).toHaveBeenCalledWith('[FeimaAuthProvider] Getting sessions');
		});
	});

	describe('Interface Compliance', () => {
		it('should implement vscode.AuthenticationProvider interface', () => {
			expect(typeof provider.handleUri).toBe('function');
			expect(typeof provider.getSessions).toBe('function');
			expect(typeof provider.createSession).toBe('function');
			expect(typeof provider.removeSession).toBe('function');
			expect(typeof provider.getCachedSessions).toBe('function');
			expect(provider.onDidChangeSessions).toBeDefined();
		});

		it('should implement vscode.UriHandler interface', () => {
			expect(typeof provider.handleUri).toBe('function');
		});
	});
});