/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../util/vs/base/common/event';
import { ILogService } from '../../log/common/logService';
import { IFeimaQuota, IFeimaQuotaService } from '../common/feimaQuotaService';

/**
 * T095: Implement FeimaQuotaService class
 * Tracks API quota usage from response headers
 */
export class FeimaQuotaService implements IFeimaQuotaService {
	readonly _serviceBrand: undefined;

	private _quota: IFeimaQuota | undefined;
	private readonly _onDidChangeQuota = new Emitter<IFeimaQuota | undefined>();
	readonly onDidChangeQuota: Event<IFeimaQuota | undefined> = this._onDidChangeQuota.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		this._logService.debug('[Feima Quota] Service initialized');
	}

	getQuota(): IFeimaQuota | undefined {
		return this._quota;
	}

	/**
	 * T096-T098: Parse quota headers from API responses
	 * Expected headers:
	 * - X-Quota-Remaining: Number of remaining requests
	 * - X-Quota-Limit: Total quota limit
	 * - X-Quota-Reset: Reset timestamp (ISO 8601 or Unix timestamp)
	 */
	updateQuotaFromHeaders(headers: Record<string, string | string[] | undefined>): void {
		try {
			const remaining = this._parseHeaderAsNumber(headers['x-quota-remaining']);
			const limit = this._parseHeaderAsNumber(headers['x-quota-limit']);
			const resetDate = this._parseResetHeader(headers['x-quota-reset']);

			// If any header is missing, don't update quota
			if (remaining === null || limit === null || resetDate === null) {
				this._logService.debug(`[Feima Quota] Incomplete quota headers, skipping update (remaining=${headers['x-quota-remaining']}, limit=${headers['x-quota-limit']}, reset=${headers['x-quota-reset']})`);
				return;
			}

			// T099: Calculate quota used
			const used = limit - remaining;
			const usagePercent = (used / limit) * 100;

			const oldQuota = this._quota;
			this._quota = {
				limit,
				remaining,
				used,
				resetDate,
				unlimited: limit === 0, // 0 limit means unlimited
				usagePercent,
				lastUpdated: Date.now()
			};

			// Log quota update
			this._logService.debug(`[Feima Quota] Updated: limit=${limit}, remaining=${remaining}, used=${used}, usagePercent=${usagePercent.toFixed(1)}%, resetDate=${resetDate}`);

			// Only emit event if quota actually changed
			if (!this._quotasEqual(oldQuota, this._quota)) {
				// T100: Emit onDidChangeQuota event
				this._onDidChangeQuota.fire(this._quota);
			}
		} catch (error) {
			this._logService.error('[Feima Quota] Error parsing headers', error);
		}
	}

	/**
	 * T101: Restore quota from workspace state (persist across restarts)
	 */
	async restoreQuotaFromState(): Promise<IFeimaQuota | undefined> {
		// T101 Note: For now, we don't persist across restarts.
		// Quota will be re-fetched from API on each session.
		return undefined;
	}

	async saveQuotaToState(quota: IFeimaQuota): Promise<void> {
		// T101 Note: For now, we don't persist across restarts.
		// Quota will be re-fetched from API on each session.
	}

	private _parseHeaderAsNumber(header: string | string[] | undefined): number | null {
		if (!header) {
			return null;
		}

		const value = Array.isArray(header) ? header[0] : header;
		const num = parseInt(value, 10);
		return isNaN(num) ? null : num;
	}

	private _parseResetHeader(header: string | string[] | undefined): string | null {
		if (!header) {
			return null;
		}

		const value = Array.isArray(header) ? header[0] : header;

		// If it's a Unix timestamp, convert to ISO string
		const timestamp = parseInt(value, 10);
		if (!isNaN(timestamp) && timestamp > 0) {
			try {
				return new Date(timestamp * 1000).toISOString();
			} catch {
				return null;
			}
		}

		// Already ISO string or other format
		if (value) {
			try {
				// Validate it's a valid date
				new Date(value);
				return value;
			} catch {
				return null;
			}
		}

		return null;
	}

	private _quotasEqual(a: IFeimaQuota | undefined, b: IFeimaQuota | undefined): boolean {
		if (!a || !b) {
			return a === b;
		}
		return a.remaining === b.remaining && a.limit === b.limit;
	}

	dispose(): void {
		this._onDidChangeQuota.dispose();
	}
}
