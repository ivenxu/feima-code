/*---------------------------------------------------------------------------------------------
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { getLanguage } from '../../../src/util/common/languages';
import { ssuite, stest } from '../../base/stest';
import { validate } from '../../base/validate';
import { fetchConversationScenarios } from '../../e2e/scenarioLoader';
import { generateScenarioTestRunner } from '../../e2e/scenarioTest';

ssuite({ title: 'feima-auth', subtitle: 'OAuth2 authentication flow', location: 'panel' }, (inputPath) => {

	const scenarioFolder = inputPath ?? path.join(__dirname, '..', 'test/scenarios/test-feima-auth');
	const scenarios = fetchConversationScenarios(scenarioFolder);

	for (const scenario of scenarios) {
		const language = scenario[0].getState?.().activeTextEditor?.document.languageId;
		stest({ description: scenario[0].json.description ?? scenario[0].question.replace('/feima-auth', ''), language: language ? getLanguage(language).languageId : undefined }, generateScenarioTestRunner(
			scenario,
			async (accessor, question, answer) => {
				// Validate that the response includes authentication guidance
				const containsAuthGuidance = validate(answer, [
					{ anyOf: ['sign in', 'login', 'authenticate', 'oauth'] },
					{ anyOf: ['feima', 'feima.ai'] }
				]);

				if (!containsAuthGuidance) {
					return { success: false, errorMessage: 'Response should include Feima authentication guidance' };
				}

				// Check for proper OAuth2 flow explanation
				const containsOAuthFlow = validate(answer, [
					{ anyOf: ['authorization', 'code', 'token'] },
					{ anyOf: ['redirect', 'callback', 'uri'] }
				]);

				if (!containsOAuthFlow) {
					return { success: false, errorMessage: 'Response should explain OAuth2 flow' };
				}

				// Validate configuration references
				if (scenario[0].json.keywords !== undefined) {
					const configValidation = validate(answer, scenario[0].json.keywords);
					if (configValidation) {
						return { success: false, errorMessage: configValidation };
					}
				}

				return { success: true, errorMessage: 'Feima authentication flow explained correctly' };
			}
		));
	}
});