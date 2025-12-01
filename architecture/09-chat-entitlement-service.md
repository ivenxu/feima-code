# Chat Entitlement Service Architecture

This document covers how VS Code manages GitHub Copilot user entitlements, quotas, and authentication state through the ChatEntitlementService. This is a critical component that bridges GitHub authentication with the Copilot experience, controlling feature availability and UI visibility across the entire workbench.

## Overview

The ChatEntitlementService is responsible for:
- **Entitlement Resolution**: Determining user's Copilot plan (Free, Pro, Business, Enterprise)
- **Quota Management**: Tracking usage limits for chat and code completions
- **Authentication State**: Monitoring GitHub sign-in status
- **Context Key Management**: Exposing entitlement data to VS Code's when-clause system for UI control
- **Sentiment Tracking**: Managing user preferences about Copilot visibility and enablement

**Component Breakdown**:
```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Workbench Layer                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │   UI Components (Consumers)                             │   │
│  │   - ChatWidget                                          │   │
│  │   - ChatInputPart                                       │   │
│  │   - ChatSetupContributions                              │   │
│  │   - ChatStatusBarEntry                                  │   │
│  │   - ModelPickerActionItem                               │   │
│  │   - ChatUsageWidget                                     │   │
│  │   - SettingsEditor                                      │   │
│  │                                                          │   │
│  │   Uses: entitlement, quotas, sentiment, anonymous       │   │
│  └─────────────────────────────────────────────────────┘   │
│                            ↓                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │   ChatEntitlementService (IChatEntitlementService)      │   │
│  │   - Registered as Eager Singleton                       │   │
│  │   - Exposes entitlement, quotas, sentiment, anonymous   │   │
│  │   - Manages Context Keys for when-clauses               │   │
│  │   - Provides Observable properties                      │   │
│  └─────────────────────────────────────────────────────┘   │
│         ↓                          ↓                            │
│  ┌──────────────────┐   ┌────────────────────────────┐         │
│  │ ChatEntitlement  │   │  ChatEntitlementRequests   │         │
│  │ Context          │   │  - Resolves entitlements   │         │
│  │ - Updates        │   │  - Fetches quotas          │         │
│  │   context keys   │   │  - Handles auth sessions   │         │
│  │ - Persists state │   │  - Makes API calls         │         │
│  └──────────────────┘   └────────────────────────────┘         │
│         ↓                          ↓                            │
│  ┌──────────────────┐   ┌────────────────────────────┐         │
│  │  Context Key     │   │  Authentication Service    │         │
│  │  Service         │   │  - onDidChangeSessions     │         │
│  │                  │   │  - getSessions()           │         │
│  │                  │   │  - createSession()         │         │
│  └──────────────────┘   └────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub APIs (External)                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │   Entitlement Endpoint                                  │   │
│  │   GET {entitlementUrl}/copilot_internal/user            │   │
│  │                                                          │   │
│  │   Response:                                             │   │
│  │   - copilot_plan: "individual" | "business" | ...       │   │
│  │   - access_type_sku: "free_limited_copilot" | ...       │   │
│  │   - organization_login_list: string[]                   │   │
│  │   - quota_snapshots: { chat, completions, ... }         │   │
│  │   - can_signup_for_limited: boolean                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Core Architecture

### 1. Service Structure

The ChatEntitlementService is composed of three main parts:

#### A. ChatEntitlementService (Main Service)

The primary service interface registered as an eager singleton.

```typescript
// src/vs/workbench/services/chat/common/chatEntitlementService.ts

export const IChatEntitlementService = createDecorator<IChatEntitlementService>('chatEntitlementService');

export interface IChatEntitlementService {
	_serviceBrand: undefined;

	// Entitlement properties
	readonly onDidChangeEntitlement: Event<void>;
	readonly entitlement: ChatEntitlement;
	readonly entitlementObs: IObservable<ChatEntitlement>;
	readonly organisations: string[] | undefined;
	readonly isInternal: boolean;
	readonly sku: string | undefined;

	// Quota properties
	readonly onDidChangeQuotaExceeded: Event<void>;
	readonly onDidChangeQuotaRemaining: Event<void>;
	readonly quotas: IQuotas;

	// Sentiment properties
	readonly onDidChangeSentiment: Event<void>;
	readonly sentiment: IChatSentiment;
	readonly sentimentObs: IObservable<IChatSentiment>;

	// Anonymous mode properties
	readonly onDidChangeAnonymous: Event<void>;
	readonly anonymous: boolean;
	readonly anonymousObs: IObservable<boolean>;

	// Methods
	update(token: CancellationToken): Promise<void>;
}
```

**Registration**:
```typescript
registerSingleton(
	IChatEntitlementService,
	ChatEntitlementService,
	InstantiationType.Eager  // Ensures context keys are set ASAP
);
```

#### B. ChatEntitlementContext (State Management)

Manages context keys and persists state to storage.

```typescript
export class ChatEntitlementContext extends Disposable {
	private _state: IChatEntitlementContextState;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		// Bind all context keys
		this.canSignUpContextKey = ChatEntitlementContextKeys.Entitlement.canSignUp.bindTo(contextKeyService);
		this.signedOutContextKey = ChatEntitlementContextKeys.Entitlement.signedOut.bindTo(contextKeyService);
		this.freeContextKey = ChatEntitlementContextKeys.Entitlement.planFree.bindTo(contextKeyService);
		// ... more context keys

		// Restore state from storage
		this._state = this.storageService.getObject<IChatEntitlementContextState>(
			CHAT_ENTITLEMENT_CONTEXT_STORAGE_KEY,
			StorageScope.PROFILE
		) ?? { entitlement: ChatEntitlement.Unknown, organisations: undefined, sku: undefined };
	}

	async update(context: {
		entitlement?: ChatEntitlement;
		organisations?: string[];
		sku?: string;
		installed?: boolean;
		disabled?: boolean;
		// ... more properties
	}): Promise<void> {
		// Update internal state
		Object.assign(this._state, context);

		// Persist to storage
		this.storageService.store(
			CHAT_ENTITLEMENT_CONTEXT_STORAGE_KEY,
			this._state,
			StorageScope.PROFILE,
			StorageTarget.MACHINE
		);

		// Update context keys
		this.updateContextSync();
	}
}
```

#### C. ChatEntitlementRequests (API Client)

Handles authentication and API communication to resolve entitlements.

```typescript
export class ChatEntitlementRequests extends Disposable {
	constructor(
		private readonly context: ChatEntitlementContext,
		private readonly chatQuotasAccessor: IChatQuotasAccessor,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IRequestService private readonly requestService: IRequestService,
		// ... more services
	) {
		super();

		// Listen to authentication changes
		this._register(this.authenticationService.onDidChangeSessions(e => {
			if (e.providerId === ChatEntitlementRequests.providerId(this.configurationService)) {
				this.resolve();
			}
		}));

		// Initial resolution
		this.resolve();
	}
}
```

### 2. Entitlement Types

```typescript
export enum ChatEntitlement {
	/** Signed out */
	Unknown = 1,
	/** Signed in but not yet resolved */
	Unresolved = 2,
	/** Signed in and entitled to Free */
	Available = 3,
	/** Signed in but not entitled to Free */
	Unavailable = 4,
	/** Signed-up to Free */
	Free = 5,
	/** Signed-up to Pro */
	Pro = 6,
	/** Signed-up to Pro Plus */
	ProPlus = 7,
	/** Signed-up to Business */
	Business = 8,
	/** Signed-up to Enterprise */
	Enterprise = 9,
}
```

**Helper Function**:
```typescript
export function isProUser(chatEntitlement: ChatEntitlement): boolean {
	return chatEntitlement === ChatEntitlement.Pro ||
		chatEntitlement === ChatEntitlement.ProPlus ||
		chatEntitlement === ChatEntitlement.Business ||
		chatEntitlement === ChatEntitlement.Enterprise;
}
```

### 3. Context Keys

The service exposes extensive context keys for UI control via when-clauses:

```typescript
export namespace ChatEntitlementContextKeys {
	export const Setup = {
		hidden: new RawContextKey<boolean>('chatSetupHidden', false, true),
		installed: new RawContextKey<boolean>('chatSetupInstalled', false, true),
		disabled: new RawContextKey<boolean>('chatSetupDisabled', false, true),
		untrusted: new RawContextKey<boolean>('chatSetupUntrusted', false, true),
		later: new RawContextKey<boolean>('chatSetupLater', false, true),
		registered: new RawContextKey<boolean>('chatSetupRegistered', false, true)
	};

	export const Entitlement = {
		signedOut: new RawContextKey<boolean>('chatEntitlementSignedOut', false, true),
		canSignUp: new RawContextKey<boolean>('chatPlanCanSignUp', false, true),
		planFree: new RawContextKey<boolean>('chatPlanFree', false, true),
		planPro: new RawContextKey<boolean>('chatPlanPro', false, true),
		planProPlus: new RawContextKey<boolean>('chatPlanProPlus', false, true),
		planBusiness: new RawContextKey<boolean>('chatPlanBusiness', false, true),
		planEnterprise: new RawContextKey<boolean>('chatPlanEnterprise', false, true),
		organisations: new RawContextKey<string[]>('chatEntitlementOrganisations', undefined, true),
		internal: new RawContextKey<boolean>('chatEntitlementInternal', false, true),
		sku: new RawContextKey<string>('chatEntitlementSku', undefined, true),
	};

	export const chatQuotaExceeded = new RawContextKey<boolean>('chatQuotaExceeded', false, true);
	export const completionsQuotaExceeded = new RawContextKey<boolean>('completionsQuotaExceeded', false, true);
	export const chatAnonymous = new RawContextKey<boolean>('chatAnonymous', false, true);
}
```

## Complete Entitlement Resolution Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  1. Service Initialization (Eager)                               │
│     - ChatEntitlementService created at startup                  │
│     - Creates ChatEntitlementContext (lazy)                      │
│     - Creates ChatEntitlementRequests (lazy)                     │
│     - Binds context keys to IContextKeyService                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  2. Context Restoration                                          │
│     - ChatEntitlementContext reads from StorageService           │
│     - Restores last known entitlement state                      │
│     - Updates context keys with cached values                    │
│     - Sets: chatEntitlementSignedOut, chatPlanFree, etc.         │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  3. Authentication Check                                         │
│     - ChatEntitlementRequests.resolve() triggered                │
│     - Calls findMatchingProviderSession()                        │
│     - Queries IAuthenticationService.getSessions()               │
│     - Filters by provider and required scopes                    │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  4. Handle Authentication State                                  │
│                                                                  │
│  IF No Session Found:                                            │
│    - Update context: entitlement = Unknown (signed out)          │
│    - Set chatEntitlementSignedOut = true                         │
│    - Clear quota data                                            │
│    - Stop resolution                                             │
│                                                                  │
│  IF Session Found:                                               │
│    - Set entitlement = Unresolved (temporary)                    │
│    - Proceed to API resolution                                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  5. Entitlement API Request                                      │
│     GET {entitlementUrl}/copilot_internal/user                   │
│     Headers:                                                     │
│       Authorization: Bearer {session.accessToken}                │
│                                                                  │
│     Handles multiple sessions (in case token expired)            │
│     Tries each session until successful response                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  6. Parse API Response                                           │
│     {                                                            │
│       "access_type_sku": "free_limited_copilot",                 │
│       "copilot_plan": "individual",                              │
│       "organization_login_list": ["github", "microsoft"],        │
│       "can_signup_for_limited": false,                           │
│       "quota_snapshots": {                                       │
│         "chat": {                                                │
│           "entitlement": 50,                                     │
│           "remaining": 30,                                       │
│           "percent_remaining": 60,                               │
│           "overage_permitted": false,                            │
│           "unlimited": false                                     │
│         },                                                       │
│         "completions": { ... },                                  │
│         "premium_interactions": { ... }                          │
│       },                                                         │
│       "quota_reset_date": "2024-02-01"                           │
│     }                                                            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  7. Map Response to Entitlement Enum                             │
│                                                                  │
│     if (access_type_sku === 'free_limited_copilot')             │
│       → ChatEntitlement.Free                                     │
│     else if (can_signup_for_limited)                             │
│       → ChatEntitlement.Available                                │
│     else if (copilot_plan === 'individual')                      │
│       → ChatEntitlement.Pro                                      │
│     else if (copilot_plan === 'individual_pro')                  │
│       → ChatEntitlement.ProPlus                                  │
│     else if (copilot_plan === 'business')                        │
│       → ChatEntitlement.Business                                 │
│     else if (copilot_plan === 'enterprise')                      │
│       → ChatEntitlement.Enterprise                               │
│     else if (chat_enabled)                                       │
│       → ChatEntitlement.Pro (fallback for new plans)             │
│     else                                                         │
│       → ChatEntitlement.Unavailable                              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  8. Transform Quota Snapshots                                    │
│     toQuotas(response) → IQuotas:                                │
│       {                                                          │
│         resetDate: string,                                       │
│         resetDateHasTime: boolean,                               │
│         chat: IQuotaSnapshot,                                    │
│         completions: IQuotaSnapshot,                             │
│         premiumChat: IQuotaSnapshot                              │
│       }                                                          │
│                                                                  │
│     IQuotaSnapshot:                                              │
│       - total: number                                            │
│       - remaining: number                                        │
│       - percentRemaining: number                                 │
│       - overageEnabled: boolean                                  │
│       - overageCount: number                                     │
│       - unlimited: boolean                                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  9. Update State & Context Keys                                  │
│                                                                  │
│     ChatEntitlementContext.update({                              │
│       entitlement: ChatEntitlement.Free,                         │
│       organisations: ["github", "microsoft"],                    │
│       sku: "free_limited_copilot"                                │
│     })                                                           │
│                                                                  │
│     Updates context keys:                                        │
│       chatEntitlementSignedOut = false                           │
│       chatPlanFree = true                                        │
│       chatPlanPro = false                                        │
│       chatEntitlementOrganisations = ["github", "microsoft"]     │
│       chatEntitlementInternal = true (github in orgs)            │
│                                                                  │
│     Persists to StorageService (PROFILE scope)                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  10. Update Quotas                                               │
│      chatQuotasAccessor.acceptQuotas(quotas)                     │
│                                                                  │
│      Compares old vs new quotas:                                 │
│        - Fires onDidChangeQuotaExceeded if any quota hit 0%      │
│        - Fires onDidChangeQuotaRemaining on any change           │
│                                                                  │
│      Updates context keys:                                       │
│        chatQuotaExceeded = (chat.percentRemaining === 0)         │
│        completionsQuotaExceeded = (completions.percentRemaining === 0) │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  11. Fire Change Events                                          │
│       onDidChangeEntitlement.fire()                              │
│       onDidChangeSentiment.fire()                                │
│       onDidChangeQuotaExceeded.fire()                            │
│       onDidChangeQuotaRemaining.fire()                           │
│                                                                  │
│       → Consumers update UI accordingly                          │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  12. Log Telemetry                                               │
│       telemetryService.publicLog2('chatInstallEntitlement', {    │
│         entitlement: ChatEntitlement.Free,                       │
│         sku: "free_limited_copilot",                             │
│         quotaChat: 30,                                           │
│         quotaCompletions: 1500,                                  │
│         quotaResetDate: "2024-02-01"                             │
│       })                                                         │
└──────────────────────────────────────────────────────────────────┘
```

## Key Consumers

### 1. Chat Setup Contributions

Controls whether to show setup dialogs, built-in agents, or full Copilot functionality.

```typescript
// src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts

export class ChatSetupContribution extends Disposable {
	constructor(
		@IChatEntitlementService chatEntitlementService: ChatEntitlementService,
		// ...
	) {
		const context = chatEntitlementService.context?.value;

		const updateRegistration = () => {
			// Show agents only if not hidden and not disabled
			if (!context.state.hidden && !context.state.disabled) {
				// Register default agents for panel, terminal, notebook, inline
				// ...

				// Show built-in agents if not installed OR signed out
				if (
					!context.state.installed ||
					context.state.entitlement === ChatEntitlement.Unknown ||
					context.state.entitlement === ChatEntitlement.Unresolved
				) {
					// Register built-in @vscode agent
					// ...
				}
			} else {
				// Clear all agent registrations
				// ...
			}
		};

		this._register(Event.runAndSubscribe(context.onDidChange, () => updateRegistration()));
	}
}
```

### 2. Chat Widget

Shows anonymous usage warnings and quota exceeded messages.

```typescript
// src/vs/workbench/contrib/chat/browser/chatWidget.ts

export class ChatWidget extends Disposable {
	constructor(
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		// ...
	) {
		super();

		// Re-render welcome view when anonymous mode changes
		this._register(this.chatEntitlementService.onDidChangeAnonymous(() =>
			this._welcomeRenderScheduler.schedule()
		));
	}

	private renderWelcomeViewContentIfNeeded(): void {
		// Show anonymous rate limited warning
		if (this.chatEntitlementService.anonymous && !this.chatEntitlementService.sentiment.installed) {
			this.renderAnonymousRateLimitedPart();
		}
	}

	private shouldShowQuotaExceeded(): boolean {
		return !this.chatEntitlementService.sentiment.installed &&
			this.chatEntitlementService.quotas.chat?.percentRemaining === 0;
	}
}
```

### 3. Status Bar Entry

Shows Copilot icon with quota warnings.

```typescript
// src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusEntry.ts

export class ChatStatusBarEntry extends Disposable {
	constructor(
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		// ...
	) {
		super();

		this._register(this.chatEntitlementService.onDidChangeQuotaExceeded(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeSentiment(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => this.update()));
	}

	private getEntryProps(): IStatusbarEntry {
		let text = '$(copilot)';
		let kind: StatusbarEntryKind | undefined;

		// Show warning if quota exceeded
		if (this.chatEntitlementService.quotas.chat?.percentRemaining === 0) {
			kind = 'warning';
			text = '$(copilot-warning)';
		}

		return { text, kind, ariaLabel: 'Copilot status', command: 'chat.action.openStatus' };
	}
}
```

### 4. Model Picker

Controls which models are available and shows upgrade prompts.

```typescript
// src/vs/workbench/contrib/chat/browser/modelPicker/modelPickerActionItem.ts

export class ModelPickerActionItem extends ActionWidgetDropdownActionViewItem {
	constructor(
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService,
		// ...
	) {
		// Filter models based on entitlement
		const showUpgradeLink =
			chatEntitlementService.entitlement === ChatEntitlement.Free ||
			chatEntitlementService.entitlement === ChatEntitlement.Pro ||
			chatEntitlementService.entitlement === ChatEntitlement.ProPlus;

		// Show "Add Premium Models" for Free users
		if (chatEntitlementService.entitlement === ChatEntitlement.Free) {
			additionalActions.push({
				id: 'moreModels',
				label: 'Add Premium Models',
				run: () => commandService.executeCommand('workbench.action.chat.upgradePlan')
			});
		}
	}
}
```

### 5. Chat Usage Widget

Displays quota details in management interface.

```typescript
// src/vs/workbench/contrib/chat/browser/chatManagement/chatUsageWidget.ts

export class ChatUsageWidget extends Disposable {
	constructor(
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService
	) {
		super();

		this._register(this.chatEntitlementService.onDidChangeQuotaRemaining(() => this.render()));
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => this.render()));
	}

	private render(): void {
		const { chat, completions, premiumChat, resetDate } = this.chatEntitlementService.quotas;

		// Render quota bars with percentages
		if (chat) {
			this.renderQuotaItem('Chat messages', chat);
		}
		if (completions) {
			this.renderQuotaItem('Inline Suggestions', completions);
		}
		if (premiumChat) {
			this.renderQuotaItem('Premium requests', premiumChat);
		}

		// Show reset date
		if (resetDate) {
			this.renderResetDate(resetDate);
		}
	}
}
```

### 6. Settings Editor

Shows Copilot section based on entitlement.

```typescript
// src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts

export class SettingsEditor2 extends EditorPane {
	constructor(
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		// ...
	) {
		// Listen for entitlement changes to update settings visibility
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => {
			this.updateCopilotSettingsVisibility();
		}));
	}
}
```

### 7. Language Models Service

Uses entitlement to filter available models.

```typescript
// src/vs/workbench/contrib/chat/common/languageModels.ts

export class LanguageModelsService implements ILanguageModelsService {
	constructor(
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		// ...
	) {
		// Filter models based on user's entitlement
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => {
			this._onDidChangeLanguageModels.fire({ added: [], removed: [] });
		}));
	}

	selectLanguageModels(selector: LanguageModelChatSelector): string[] {
		const entitlement = this.chatEntitlementService.entitlement;

		// Filter out premium models for Free users
		return this._models
			.filter(model => this.isModelAccessible(model, entitlement))
			.map(m => m.identifier);
	}
}
```

## Impact Analysis

### When User Is NOT Signed In (GitHub Authentication)

**Entitlement State**: `ChatEntitlement.Unknown` (signed out)

**Context Keys**:
```typescript
chatEntitlementSignedOut = true
chatPlanFree = false
chatPlanPro = false
// ... all plan context keys = false
```

**Impact on Features**:

1. **Chat Interface**:
   - If `chat.allowAnonymousAccess` is enabled → Shows anonymous mode with limited features
   - Otherwise → Shows sign-in prompt in chat panel
   - Setup agent (@copilot) triggers sign-in dialog

2. **Agent Registration**:
   - Built-in @vscode agent is registered (fallback functionality)
   - Default agents (@workspace, @terminal, etc.) may still be available depending on configuration
   - Full Copilot agents are NOT registered

3. **Model Picker**:
   - No models are available
   - Shows "Sign in to use Copilot" message

4. **Inline Suggestions (Code Completions)**:
   - Completions are disabled
   - Extension activation may be blocked

5. **Status Bar**:
   - Shows Copilot icon with "Sign in" tooltip
   - Click opens authentication dialog

6. **Context Keys Impact on UI**:
   ```typescript
   // package.json contributions with when clauses:
   {
     "command": "workbench.action.chat.setup",
     "when": "chatEntitlementSignedOut" // Visible when signed out
   },
   {
     "command": "workbench.action.chat.open",
     "when": "!chatSetupHidden && !chatEntitlementSignedOut" // Hidden when signed out
   }
   ```

7. **Welcome Views**:
   - Chat panel shows "Get Started with Copilot" welcome view
   - Includes sign-in button and feature overview

### When User Has Exhausted Quota

**Entitlement State**: `ChatEntitlement.Free` (or Pro/Business/Enterprise)
**Quota State**: `quotas.chat.percentRemaining === 0`

**Context Keys**:
```typescript
chatQuotaExceeded = true
chatPlanFree = true // (example for Free tier)
```

**Impact on Features**:

1. **Chat Input**:
   - Input field is disabled
   - Placeholder text: "Monthly quota exceeded"
   - Cannot send new messages

2. **Quota Exceeded Message**:
   - Inline banner appears in chat view:
     ```
     "You've reached your monthly limit of 50 messages"
     [Upgrade Plan] [Learn More]
     ```
   - Different messages for Free vs Pro users:
     - Free: "Upgrade to Pro for unlimited messages"
     - Pro: "Enable overages" or "Your quota resets on {date}"

3. **Status Bar**:
   - Shows warning icon: `$(copilot-warning)`
   - Tooltip: "Copilot quota exceeded. Resets {date}"
   - Opens quota details on click

4. **Model Picker**:
   - Still accessible but non-functional
   - Shows quota warning when attempting to change models

5. **Code Completions (Inline Suggestions)**:
   - If `completionsQuotaExceeded = true`, completions are disabled
   - Status bar indicator shows "Completions paused (quota)"

6. **Anonymous Users**:
   - Different behavior: shows rate limiting message instead of quota message
   - Prompts to sign in for full access

7. **Context Keys Impact on Actions**:
   ```typescript
   {
     "command": "workbench.action.chat.upgradePlan",
     "when": "chatQuotaExceeded && chatPlanFree" // Only for Free users
   },
   {
     "command": "workbench.action.chat.manageOverages",
     "when": "chatQuotaExceeded && chatPlanPro" // Only for Pro users
   }
   ```

8. **Quota Reset Display**:
   - All quota-related UI shows reset date
   - Format: "Resets February 1, 2024" or "Resets February 1, 2024 at 9:00 AM" (if time available)
   - Countdown timer may be shown in status dashboard

### Recovery Flows

**For Signed Out Users**:
```
1. User clicks "Sign in" → Opens GitHub authentication
2. authenticationService.createSession() called
3. User completes GitHub OAuth flow
4. authenticationService.onDidChangeSessions fires
5. ChatEntitlementRequests.resolve() triggered
6. API resolves entitlement
7. UI updates with full functionality
```

**For Quota Exceeded Users**:
```
1. User waits for reset date
   → Service periodically checks quota (on window focus, hourly timer)
   → Quota resets automatically
   → onDidChangeQuotaRemaining fires
   → UI re-enables

OR

2. User clicks "Upgrade Plan"
   → Opens upgrade URL in browser
   → User completes upgrade process
   → Manually refreshes VS Code or waits for auth session refresh
   → API returns new entitlement
   → UI unlocks premium features
```

## Potential Provider Pattern Feature Request

### Current Limitation

The ChatEntitlementService is **tightly coupled to GitHub authentication and Copilot APIs**. This creates challenges for:

1. **Third-party AI providers** (Anthropic, OpenAI, local models) wanting to integrate with VS Code
2. **Enterprise deployments** with custom entitlement systems
3. **Testing and development** requiring mock entitlement providers
4. **Multi-vendor scenarios** where different extensions provide different AI capabilities

### Proposed Provider Pattern

To make VS Code's AI infrastructure vendor-neutral, a provider pattern similar to Language Model Providers could be introduced:

#### A. Interface Definition

```typescript
// src/vs/workbench/services/chat/common/chatEntitlementProvider.ts

export interface IChatEntitlementProvider {
	/**
	 * Unique identifier for this provider (e.g., 'github-copilot', 'anthropic-claude')
	 */
	readonly id: string;

	/**
	 * Display name for UI (e.g., 'GitHub Copilot', 'Anthropic Claude')
	 */
	readonly displayName: string;

	/**
	 * Fired when entitlements change (e.g., user signs in, quota refreshes)
	 */
	readonly onDidChangeEntitlement: Event<void>;

	/**
	 * Resolve the current user's entitlement
	 */
	resolveEntitlement(token: CancellationToken): Promise<IEntitlementInfo>;

	/**
	 * Optional: Get current quota information
	 */
	getQuotas?(token: CancellationToken): Promise<IQuotaInfo>;

	/**
	 * Optional: Sign in the user
	 */
	signIn?(options?: ISignInOptions): Promise<IAuthenticationSession>;

	/**
	 * Optional: Sign out the user
	 */
	signOut?(): Promise<void>;
}

export interface IEntitlementInfo {
	/**
	 * Entitlement tier (maps to existing ChatEntitlement enum)
	 */
	tier: 'free' | 'pro' | 'business' | 'enterprise' | 'unavailable' | 'unknown';

	/**
	 * Whether the user is currently authenticated
	 */
	authenticated: boolean;

	/**
	 * Optional: User organization affiliations
	 */
	organisations?: string[];

	/**
	 * Optional: SKU or plan identifier
	 */
	sku?: string;

	/**
	 * Optional: Custom metadata
	 */
	metadata?: Record<string, any>;
}

export interface IQuotaInfo {
	chat?: IQuotaSnapshot;
	completions?: IQuotaSnapshot;
	[feature: string]: IQuotaSnapshot | undefined;
}
```

#### B. Extension Point

```typescript
// package.json
{
	"contributes": {
		"chatEntitlementProviders": [
			{
				"id": "github-copilot",
				"displayName": "GitHub Copilot"
			}
		]
	},
	"activationEvents": [
		"onChatEntitlementProvider:github-copilot"
	]
}
```

#### C. Registration API (Proposed VS Code API)

```typescript
// vscode.proposed.chatEntitlement.d.ts

export namespace chat {
	/**
	 * Register a chat entitlement provider
	 */
	export function registerEntitlementProvider(
		providerId: string,
		provider: ChatEntitlementProvider
	): Disposable;
}

export interface ChatEntitlementProvider {
	/**
	 * Resolve the current user's entitlement
	 */
	resolveEntitlement(token: CancellationToken): ProviderResult<ChatEntitlementInfo>;

	/**
	 * Event fired when entitlements change
	 */
	onDidChangeEntitlement?: Event<void>;
}

export interface ChatEntitlementInfo {
	tier: 'free' | 'pro' | 'business' | 'enterprise' | 'unavailable' | 'unknown';
	authenticated: boolean;
	quotas?: {
		chat?: QuotaSnapshot;
		completions?: QuotaSnapshot;
	};
}
```

#### D. Multi-Provider Service Architecture

```typescript
// src/vs/workbench/services/chat/common/chatEntitlementService.ts (refactored)

export class ChatEntitlementService extends Disposable implements IChatEntitlementService {

	private readonly providers = new Map<string, IChatEntitlementProvider>();
	private activeProviderId: string | undefined;

	registerProvider(provider: IChatEntitlementProvider): IDisposable {
		this.providers.set(provider.id, provider);

		// Listen to provider changes
		const listener = provider.onDidChangeEntitlement(() => {
			if (this.activeProviderId === provider.id) {
				this.resolveActiveProvider();
			}
		});

		return toDisposable(() => {
			this.providers.delete(provider.id);
			listener.dispose();
		});
	}

	setActiveProvider(providerId: string): void {
		if (!this.providers.has(providerId)) {
			throw new Error(`Unknown provider: ${providerId}`);
		}
		this.activeProviderId = providerId;
		this.resolveActiveProvider();
	}

	private async resolveActiveProvider(): Promise<void> {
		const providerId = this.activeProviderId;
		if (!providerId) {
			return;
		}

		const provider = this.providers.get(providerId);
		if (!provider) {
			return;
		}

		const entitlement = await provider.resolveEntitlement(CancellationToken.None);
		const quotas = await provider.getQuotas?.(CancellationToken.None);

		// Update context keys and state
		this.updateFromProviderInfo(entitlement, quotas);
	}
}
```

### Benefits of Provider Pattern

1. **Vendor Neutrality**:
   - Multiple AI providers can coexist
   - Users can switch between providers
   - Each provider manages its own authentication and quotas

2. **Enterprise Flexibility**:
   - Custom entitlement systems can be integrated
   - LDAP/Active Directory authentication
   - Internal quota management systems

3. **Testing & Development**:
   - Mock providers for testing
   - Development mode with unlimited quotas
   - Easier to test entitlement flows

4. **Extensibility**:
   - Third-party extensions can provide AI capabilities
   - Community-contributed providers
   - Open-source AI model integration

5. **Consistent User Experience**:
   - Same UI patterns across providers
   - Unified quota management
   - Consistent context keys and when-clauses

### Migration Path

**Phase 1: Internal Refactoring**
- Refactor existing `ChatEntitlementService` to use provider pattern internally
- GitHub Copilot remains the default provider
- No API changes exposed to extensions

**Phase 2: Proposed API**
- Introduce `vscode.chat.registerEntitlementProvider` proposed API
- Allow extensions to experiment with custom providers
- Gather feedback from extension authors

**Phase 3: Stable API**
- Finalize API based on feedback
- Document best practices
- Provide sample implementations

**Phase 4: Multi-Provider UI**
- Add provider selection to settings
- Show active provider in status bar
- Allow switching between providers

### Challenges & Considerations

1. **Security**:
   - How to ensure provider authenticity?
   - Prevent malicious providers from hijacking entitlements

2. **User Experience**:
   - How to handle conflicts between multiple providers?
   - Clear communication about active provider

3. **Context Keys**:
   - Provider-specific context keys vs. unified keys
   - Backwards compatibility with existing when-clauses

4. **Quota Aggregation**:
   - Should quotas from multiple providers be combined or separate?
   - How to display multi-provider quotas in UI?

5. **Authentication**:
   - Should providers use VS Code's IAuthenticationService?
   - Or allow custom authentication flows?

### Example: Anthropic Provider Implementation

```typescript
// hypothetical extension: anthropic-vscode

export function activate(context: vscode.ExtensionContext) {
	const provider: vscode.ChatEntitlementProvider = {
		async resolveEntitlement(token) {
			const session = await vscode.authentication.getSession('anthropic', ['api:read'], { createIfNone: false });

			if (!session) {
				return { tier: 'unknown', authenticated: false };
			}

			// Call Anthropic API to check plan
			const response = await fetch('https://api.anthropic.com/v1/account', {
				headers: { 'Authorization': `Bearer ${session.accessToken}` }
			});
			const data = await response.json();

			return {
				tier: data.plan === 'pro' ? 'pro' : 'free',
				authenticated: true,
				quotas: {
					chat: {
						total: data.monthly_chat_limit,
						remaining: data.chat_remaining,
						percentRemaining: (data.chat_remaining / data.monthly_chat_limit) * 100,
						overageEnabled: data.overage_allowed,
						overageCount: 0,
						unlimited: false
					}
				}
			};
		},

		onDidChangeEntitlement: authChangeEvent
	};

	const registration = vscode.chat.registerEntitlementProvider('anthropic-claude', provider);
	context.subscriptions.push(registration);
}
```

## Summary

The ChatEntitlementService is a cornerstone of VS Code's Copilot integration, managing:

- **Authentication state** through IAuthenticationService integration
- **Entitlement resolution** via GitHub API calls
- **Quota tracking** for chat and completions
- **Context key management** for UI control throughout the workbench
- **State persistence** across sessions
- **Event propagation** to consumers

Its tight coupling to GitHub creates challenges for extensibility. A **provider pattern** would enable:
- Multi-vendor AI support
- Enterprise customization
- Easier testing and development
- Community-contributed integrations

This would align with VS Code's existing provider patterns for Language Models, Authentication, and other extensible services, creating a more flexible and open AI platform.
