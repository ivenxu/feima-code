/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFeimaQuota, IFeimaQuotaService } from '../../../platform/feima/common/feimaQuotaService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

/**
 * T109-T114: Notifications for quota warnings and limits
 * Shows warnings at 80% and errors at 100% quota usage
 */
export class FeimaQuotaNotifications extends Disposable {
	private _lastNotificationTime: number = 0;
	private _notificationDebounce: number = 60 * 1000; // 1 minute
	private _lastQuotaPercent: number = 0;

	constructor(
		@IFeimaQuotaService private readonly _quotaService: IFeimaQuotaService,
		@ILogService private readonly _logService: ILogService
	) {
		super();

		// Subscribe to quota changes
		this._register(
			this._quotaService.onDidChangeQuota((quota) => {
				if (quota) {
					this._handleQuotaChange(quota);
				}
			})
		);
	}

	private _handleQuotaChange(quota: IFeimaQuota): void {
		// Don't show notifications for unlimited quota
		if (quota.unlimited) {
			return;
		}

		const now = Date.now();
		const usagePercent = quota.usagePercent;

		// T113: Block chat requests when quota exhausted (free tier only)
		if (usagePercent >= 100 && this._lastQuotaPercent < 100) {
			// Transition to exhausted state
			this._showQuotaExhaustedNotification(quota);
			this._lastQuotaPercent = usagePercent;
			return;
		}

		// T110: Show warning notification at 80% quota used
		if (usagePercent >= 80 && usagePercent < 100 && this._lastQuotaPercent < 80) {
			// Transition to warning state
			if (now - this._lastNotificationTime > this._notificationDebounce) {
				this._showWarningNotification(quota);
				this._lastNotificationTime = now;
			}
		}

		this._lastQuotaPercent = usagePercent;
	}

	private _showWarningNotification(quota: IFeimaQuota): void {
		const resetDate = new Date(quota.resetDate).toLocaleDateString();
		const usagePercent = quota.usagePercent.toFixed(0);

		this._logService.info(
			`[Feima Quota] Warning: ${usagePercent}% quota used (${quota.used}/${quota.limit} requests)`
		);

		// T110: Show warning notification
		vscode.window
			.showWarningMessage(
				`⚠️ Feima quota warning: You've used ${usagePercent}% of your ${quota.limit} requests. Resets on ${resetDate}.`,
				'Upgrade to Pro',
				'Dismiss'
			)
			.then((action) => {
				if (action === 'Upgrade to Pro') {
					// T112: Add "Upgrade to Pro" button action
					vscode.env.openExternal(vscode.Uri.parse('https://feima.ai/upgrade'));
				}
			});
	}

	private _showQuotaExhaustedNotification(quota: IFeimaQuota): void {
		const resetDate = new Date(quota.resetDate).toLocaleDateString();

		this._logService.warn(
			`[Feima Quota] Quota exhausted: ${quota.used}/${quota.limit} requests used. Resets on ${resetDate}`
		);

		// T111: Show error notification at 100% quota used
		// T114: Add error message: "Quota exhausted. Resets on [date] or upgrade to Pro"
		vscode.window
			.showErrorMessage(
				`❌ Feima quota exhausted (${quota.used}/${quota.limit} requests). Resets on ${resetDate} or upgrade to Pro.`,
				'Upgrade to Pro',
				'Dismiss'
			)
			.then((action) => {
				if (action === 'Upgrade to Pro') {
					// T112: Add "Upgrade to Pro" button in notifications
					vscode.env.openExternal(vscode.Uri.parse('https://feima.ai/upgrade'));
				}
			});
	}

	override dispose(): void {
		super.dispose();
	}
}
