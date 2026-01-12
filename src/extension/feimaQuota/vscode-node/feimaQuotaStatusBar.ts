/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFeimaQuota, IFeimaQuotaService } from '../../../platform/feima/common/feimaQuotaService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

/**
 * T102-T108: Status bar item showing Feima quota usage
 * Displays current quota status and resets date
 */
export class FeimaQuotaStatusBar extends Disposable {
	private _statusBar: vscode.StatusBarItem | undefined;
	private _quota: IFeimaQuota | undefined;

	constructor(
		@IFeimaQuotaService private readonly _quotaService: IFeimaQuotaService,
		@ILogService private readonly _logService: ILogService
	) {
		super();

		// Create status bar item
		this._statusBar = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100 // Priority: show after other items
		);
		this._statusBar.command = 'feima.quota.showDetails';
		this._statusBar.tooltip = 'Click to see quota details';
		this._register(this._statusBar);

		// T103: Subscribe to quota changes
		this._register(
			this._quotaService.onDidChangeQuota((quota) => {
				this._quota = quota;
				this._updateStatusBar();
			})
		);

		// Initial update
		const initialQuota = this._quotaService.getQuota();
		if (initialQuota) {
			this._quota = initialQuota;
			this._updateStatusBar();
		}
	}

	private _updateStatusBar(): void {
		if (!this._statusBar) {
			return;
		}

		// T108: Check if status bar should be shown
		const showInStatusBar = vscode.workspace.getConfiguration('feima.quota').get<boolean>('showInStatusBar') ?? true;
		if (!showInStatusBar) {
			this._statusBar.hide();
			return;
		}

		if (!this._quota) {
			this._statusBar.hide();
			return;
		}

		const quota = this._quota;

		// T104: Update text: "X/Y requests (resets DATE)"
		const resetDate = new Date(quota.resetDate);
		const resetDateStr = resetDate.toLocaleDateString();
		let text: string;

		if (quota.unlimited) {
			text = `$(zap) Unlimited quota`;
		} else {
			text = `$(chart-bar) ${quota.used}/${quota.limit} requests (resets ${resetDateStr})`;
		}

		this._statusBar.text = text;

		// T105-T106: Set icon and color based on usage
		if (!quota.unlimited) {
			if (quota.usagePercent >= 100) {
				// T106: Show error icon when used >= 100%
				this._statusBar.color = new vscode.ThemeColor('errorForeground');
				this._statusBar.tooltip = `⛔ Quota exhausted (${quota.usagePercent.toFixed(0)}%). Resets on ${resetDateStr}`;
			} else if (quota.usagePercent >= 80) {
				// T105: Show warning icon when used > 80%
				this._statusBar.color = new vscode.ThemeColor('warningForeground');
				this._statusBar.tooltip = `⚠️  Quota warning (${quota.usagePercent.toFixed(0)}%). Resets on ${resetDateStr}`;
			} else {
				// Normal state
				this._statusBar.color = undefined;
				this._statusBar.tooltip = `Quota usage: ${quota.usagePercent.toFixed(0)}%. Resets on ${resetDateStr}`;
			}
		}

		this._statusBar.show();
		this._logService.debug(`[Feima Quota StatusBar] Updated: ${text}, usagePercent: ${quota.usagePercent}`);
	}

	override dispose(): void {
		super.dispose();
	}
}
