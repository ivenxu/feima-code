/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Re-export Feima configuration interfaces from platform layer.
 * Extension layer should import from here for consistency.
 */
export type {
	IFeimaConfigData, IOAuth2Endpoints
} from '../../../platform/feima/common/feimaConfigService';

export {
	DEFAULT_FEIMA_CONFIG, IFeimaConfigService
} from '../../../platform/feima/common/feimaConfigService';

