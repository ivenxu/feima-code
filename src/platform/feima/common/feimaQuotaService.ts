/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../util/vs/base/common/event';
import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';

/**
 * Quota information from feima-api
 * T094: Define IFeimaQuota data model
 */
export interface IFeimaQuota {
	/** Maximum requests allowed in current period */
	readonly limit: number;
	/** Remaining requests available */
	readonly remaining: number;
	/** Total requests used in current period */
	readonly used: number;
	/** Date when quota resets (ISO 8601 string) */
	readonly resetDate: string;
	/** Whether user has unlimited quota (pro tier) */
	readonly unlimited: boolean;
	/** Percentage of quota used (0-100) */
	readonly usagePercent: number;
	/** Timestamp when quota was last updated */
	readonly lastUpdated: number;
}

/**
 * Service for tracking API quota usage
 * T093: Create IFeimaQuotaService interface
 */
export interface IFeimaQuotaService {
	readonly _serviceBrand: undefined;

	/**
	 * Get current quota information
	 */
	getQuota(): IFeimaQuota | undefined;

	/**
	 * Update quota from API response headers
	 * T096-T098: Parse X-Quota-* headers
	 */
	updateQuotaFromHeaders(headers: Record<string, string | string[] | undefined>): void;

	/**
	 * Event fired when quota changes
	 * T100: Emit onDidChangeQuota event
	 */
	readonly onDidChangeQuota: Event<IFeimaQuota | undefined>;

	/**
	 * Get quota from workspace state (persisted across restarts)
	 * T101: Store last known quota in workspace state
	 */
	restoreQuotaFromState(): Promise<IFeimaQuota | undefined>;

	/**
	 * Save quota to workspace state
	 */
	saveQuotaToState(quota: IFeimaQuota): Promise<void>;
}

export const IFeimaQuotaService = createDecorator<IFeimaQuotaService>('feimaQuotaService');
