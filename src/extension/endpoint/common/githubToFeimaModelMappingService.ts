/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';

export const IGitHubToFeimaModelMappingService = createDecorator<IGitHubToFeimaModelMappingService>('githubToFeimaModelMappingService');

/**
 * Service for mapping GitHub model families/IDs to Feima model IDs.
 *
 * This consolidates all GitHub→Feima model translations in one place,
 * used by both chat and inline completion flows.
 *
 * Mapping Strategy:
 * - Maps both GitHub canonical families ('copilot-fast', 'copilot-base')
 *   and resolved model IDs ('gpt-4o-mini', 'gpt-41-copilot')
 * - Returns undefined for unmapped models (allowing fallback logic to proceed)
 * - All mappings point to free-tier Feima models where possible
 */
export interface IGitHubToFeimaModelMappingService {
	readonly _serviceBrand: undefined;

	/**
	 * Get the Feima model ID for a given GitHub model family or ID.
	 * @param githubModelOrFamily GitHub model ID (e.g., 'gpt-4o-mini') or family (e.g., 'copilot-fast')
	 * @returns Feima model ID if mapping exists, undefined otherwise
	 */
	getFeimaModel(githubModelOrFamily: string): string | undefined;

	/**
	 * Check if a model has a Feima equivalent.
	 * @param githubModelOrFamily GitHub model ID or family
	 * @returns True if mapping exists
	 */
	hasFeimaMapping(githubModelOrFamily: string): boolean;

	/**
	 * Get all GitHub models that have Feima mappings.
	 * @returns Array of GitHub model IDs/families
	 */
	getMappedGitHubModels(): string[];
}

/**
 * Production implementation of model mapping service.
 */
export class GitHubToFeimaModelMappingService implements IGitHubToFeimaModelMappingService {

	declare readonly _serviceBrand: undefined;

	/**
	 * GitHub → Feima model mapping.
	 *
	 * Maps both:
	 * 1. GitHub canonical families: 'copilot-fast', 'copilot-base'
	 * 2. Resolved model IDs: 'gpt-4o-mini', 'gpt-41-copilot'
	 *
	 * Target models are selected from #file:001_initial_schema.py:
	 * - qwen-flash: Free tier, 1M context, ultra-fast
	 * - qwen-coder-turbo: Free tier (assumed), specialized for code
	 */
	private readonly _modelMap: Map<string, string> = new Map([
		// GitHub canonical families → Feima free-tier models
		['copilot-fast', 'qwen3'],
		['copilot-base', 'qwen3'],
		['gpt-4.1', 'qwen3'],              // Premium model family → Feima default

		// GitHub resolved model IDs → Feima equivalents
		['gpt-4o-mini', 'qwen3'],          // Lightweight model → fast Feima model
		['gpt-41-copilot', 'qwen-coder-turbo'], // Code-specialized → coder turbo
	]);

	getFeimaModel(githubModelOrFamily: string): string | undefined {
		return this._modelMap.get(githubModelOrFamily);
	}

	hasFeimaMapping(githubModelOrFamily: string): boolean {
		return this._modelMap.has(githubModelOrFamily);
	}

	getMappedGitHubModels(): string[] {
		return Array.from(this._modelMap.keys());
	}
}
