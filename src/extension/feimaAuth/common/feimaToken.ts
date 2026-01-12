/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rich token class for Feima JWT tokens.
 * Provides expiration checking and refresh logic.
 */
export class FeimaToken {
	private readonly payload: FeimaJWTPayload;

	constructor(
		public readonly accessToken: string,
		public readonly refreshToken: string | undefined,
		public readonly expiresAt: number,  // Unix timestamp in milliseconds
		public readonly issuedAt: number,   // Unix timestamp in milliseconds
		public readonly userId: string
	) {
		// Parse JWT payload for additional metadata
		try {
			const parts = accessToken.split('.');
			if (parts.length === 3) {
				const payload = parts[1];
				// Add padding if needed for Base64 decoding
				const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
				const decoded = Buffer.from(paddedPayload, 'base64').toString('utf8');
				this.payload = JSON.parse(decoded);
			} else {
				// Fallback: create minimal payload from constructor params
				this.payload = {
					sub: userId,
					exp: Math.floor(expiresAt / 1000),
					iat: Math.floor(issuedAt / 1000)
				};
			}
		} catch (e) {
			// Fallback: create minimal payload from constructor params
			this.payload = {
				sub: userId,
				exp: Math.floor(expiresAt / 1000),
				iat: Math.floor(issuedAt / 1000)
			};
		}
	}

	/**
	 * Check if token has expired.
	 * @returns true if current time > expiration time
	 */
	isExpired(): boolean {
		return Date.now() > this.expiresAt;
	}

	/**
	 * Check if token needs refresh (5 minutes before expiration).
	 * @returns true if token expires within 5 minutes
	 */
	needsRefresh(): boolean {
		// Refresh 5 minutes before expiry
		return Date.now() > this.expiresAt - 5 * 60 * 1000;
	}

	/**
	 * Get user email from JWT payload if available.
	 */
	get email(): string | undefined {
		return this.payload.email;
	}

	/**
	 * Get user name from JWT payload if available.
	 */
	get name(): string | undefined {
		return this.payload.name;
	}

	/**
	 * Get issuer from JWT payload.
	 */
	get issuer(): string | undefined {
		return this.payload.iss;
	}
}

/**
 * Standard JWT payload structure for Feima tokens.
 */
interface FeimaJWTPayload {
	iss?: string;      // Issuer: "https://auth.feima.ai"
	sub: string;       // User ID: "WeChat_openid123" or "Weibo_uid456"
	aud?: string;      // Client ID: "vscode-client"
	exp: number;       // Expiration timestamp (seconds)
	iat: number;       // Issued at timestamp (seconds)
	scope?: string;    // OAuth2 scopes: "openid profile email"
	email?: string;    // User email (if available)
	name?: string;     // User display name
	picture?: string;  // User avatar URL
}

/**
 * Stored token data structure (saved in VS Code secrets).
 * Stores FeimaToken metadata instead of raw OAuth2 response.
 */
export interface IStoredTokenData {
	accessToken: string;
	refreshToken: string | undefined;
	expiresAt: number;
	issuedAt: number;
	userId: string;
	sessionId: string;
	accountId: string;
	accountLabel: string;
}
