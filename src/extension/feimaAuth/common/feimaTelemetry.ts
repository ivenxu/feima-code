/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { getCachedSha256Hash } from '../../../util/common/crypto.js';

/**
 * Telemetry helper for Feima authentication events.
 * Implements PII protection through hashing.
 */
export class FeimaTelemetryHelper {

	constructor(
		private readonly telemetryService: ITelemetryService
	) { }

	/**
	 * Hash user ID for telemetry (PII protection).
	 * Uses SHA-256 to create non-reversible hash.
	 *
	 * @param userId User ID to hash (e.g., "WeChat_openid123")
	 * @returns SHA-256 hash of user ID
	 */
	private hashUserId(userId: string): string {
		return getCachedSha256Hash(userId);
	}

	/**
	 * Send auth:started event.
	 * Fired when user initiates authentication flow.
	 */
	sendAuthStarted(): void {
		this.telemetryService.sendGHTelemetryEvent('feima/auth/started', {});
	}

	/**
	 * Send auth:callback_received event.
	 * Fired when OAuth2 callback URI is received.
	 *
	 * @param hasCode Whether callback contains authorization code
	 */
	sendAuthCallbackReceived(hasCode: boolean): void {
		this.telemetryService.sendGHTelemetryEvent('feima/auth/callback_received', {
			hasCode: hasCode.toString()
		});
	}

	/**
	 * Send auth:token_exchange_started event.
	 * Fired when exchanging authorization code for tokens.
	 */
	sendAuthTokenExchangeStarted(): void {
		this.telemetryService.sendGHTelemetryEvent('feima/auth/token_exchange_started', {});
	}

	/**
	 * Send auth:succeeded event.
	 * Fired when authentication completes successfully.
	 *
	 * @param userId User ID (will be hashed)
	 * @param durationMs Time from auth:started to auth:succeeded
	 */
	sendAuthSucceeded(userId: string, durationMs: number): void {
		this.telemetryService.sendGHTelemetryEvent('feima/auth/succeeded', {
			userIdHash: this.hashUserId(userId)
		}, {
			durationMs
		});
	}

	/**
	 * Send auth:failed event.
	 * Fired when authentication fails.
	 *
	 * @param errorType Type of error (timeout, network, etc.)
	 * @param durationMs Time from auth:started to failure
	 */
	sendAuthFailed(errorType: string, durationMs: number): void {
		this.telemetryService.sendGHTelemetryErrorEvent('feima/auth/failed', {
			errorType
		}, {
			durationMs
		});
	}

	/**
	 * Send auth:session_restored event.
	 * Fired when session is restored from storage.
	 *
	 * @param userId User ID (will be hashed)
	 * @param source Restoration source (storage or cross-instance-sync)
	 */
	sendAuthSessionRestored(userId: string, source: 'storage' | 'cross-instance-sync'): void {
		this.telemetryService.sendGHTelemetryEvent('feima/auth/session_restored', {
			userIdHash: this.hashUserId(userId),
			source
		});
	}

	/**
	 * Send auth:token_refreshed event.
	 * Fired when access token is refreshed.
	 *
	 * @param userId User ID (will be hashed)
	 * @param success Whether refresh succeeded
	 */
	sendAuthTokenRefreshed(userId: string, success: boolean): void {
		if (success) {
			this.telemetryService.sendGHTelemetryEvent('feima/auth/token_refreshed', {
				userIdHash: this.hashUserId(userId)
			});
		} else {
			this.telemetryService.sendGHTelemetryErrorEvent('feima/auth/token_refresh_failed', {
				userIdHash: this.hashUserId(userId)
			});
		}
	}
}
