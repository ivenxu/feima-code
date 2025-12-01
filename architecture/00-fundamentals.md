# Fundamental Architectures

This document describes the fundamental architectural patterns used throughout the VS Code AI extension ecosystem.

## Service Injection Architecture

The GitHub Copilot extension uses VS Code's dependency injection system to manage services.

### Service Registration

```typescript
// Service identifiers (similar to VS Code core services)
export const IAuthenticationService = createDecorator<IAuthenticationService>('authenticationService');
export const IFetchService = createDecorator<IFetchService>('fetchService');
export const IModelMetadataService = createDecorator<IModelMetadataService>('modelMetadataService');

// Service interfaces
export interface IAuthenticationService {
  getCopilotToken(): Promise<string>;
  getGitHubToken(): Promise<string>;
  onDidChangeAuthenticationStatus: Event<AuthenticationStatus>;
}

export interface IFetchService {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface IModelMetadataService {
  getModels(): Promise<LanguageModelChatMetadata[]>;
  onDidChangeModels: Event<void>;
}
```

### InstantiationService Usage

```typescript
// Extension activation
export async function activate(context: vscode.ExtensionContext) {
  // Create service collection
  const services = new ServiceCollection();

  // Register core services
  services.set(IAuthenticationService, new SyncDescriptor(AuthenticationService));
  services.set(IFetchService, new SyncDescriptor(FetchService));
  services.set(IModelMetadataService, new SyncDescriptor(ModelMetadataService));

  // Create instantiation service
  const instantiationService = new InstantiationService(services);

  // Instantiate language model provider (dependencies auto-injected)
  const languageModelProvider = instantiationService.createInstance(
    CopilotLanguageModelProvider
  );

  // Register provider
  const registration = vscode.lm.registerLanguageModelProvider(
    'copilot',
    'gpt-4o',
    languageModelProvider,
    {
      name: 'GPT 4o',
      version: '2024-05-13',
      maxInputTokens: 128000,
      maxOutputTokens: 4096
    }
  );

  context.subscriptions.push(registration);
}

// Provider class with injected dependencies
class CopilotLanguageModelProvider implements vscode.LanguageModelChatProvider {
  constructor(
    @IAuthenticationService private readonly authService: IAuthenticationService,
    @IFetchService private readonly fetchService: IFetchService,
    @IModelMetadataService private readonly modelMetadata: IModelMetadataService
  ) {}

  async provideLanguageModelChatResponse(
    messages: vscode.LanguageModelChatMessage[],
    options: vscode.LanguageModelChatRequestOptions,
    token: vscode.CancellationToken
  ): Promise<AsyncIterable<vscode.LanguageModelChatResponsePart>> {
    // Dependencies are automatically available
    const copilotToken = await this.authService.getCopilotToken();

    const response = await this.fetchService.fetch(
      'https://api.githubcopilot.com/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${copilotToken}`
        },
        body: JSON.stringify({...})
      }
    );

    return this.streamResponse(response, token);
  }
}
```

### Benefits of Service Injection

1. **Testability**: Easy to mock services for unit tests
2. **Separation of Concerns**: Each service has a single responsibility
3. **Reusability**: Services can be shared across extension
4. **Lazy Initialization**: Services created only when needed
5. **Clear Dependencies**: Constructor signatures show all dependencies

## Event Emission and Handling Architecture

Both VS Code core and the Copilot Chat extension use a standardized event system based on the `Emitter` class and `Event` interface from VS Code's `base/common/event.ts`.

### Core Event Pattern

The event pattern follows a publisher-subscriber model with strong typing and disposable subscriptions.

#### Basic Event Structure

```typescript
// VS Code's Event interface (from src/vs/base/common/event.ts)
export interface Event<T> {
	(listener: (e: T) => unknown, thisArgs?: any, disposables?: IDisposable[] | DisposableStore): IDisposable;
}

// Example service with events
export class MyService extends Disposable {
	// Private emitter - only the service can fire events
	private readonly _onDidChange = this._register(new Emitter<string>());

	// Public event - consumers can subscribe
	readonly onDidChange: Event<string> = this._onDidChange.event;

	// Method that fires the event
	public updateValue(newValue: string): void {
		// ... update internal state ...

		// Fire the event to notify all subscribers
		this._onDidChange.fire(newValue);
	}
}
```

#### Event Subscription

```typescript
// Consumer subscribing to events
class MyConsumer extends Disposable {
	constructor(
		@IMyService private readonly myService: IMyService
	) {
		super();

		// Subscribe to the event
		// The subscription is automatically disposed when this class is disposed
		this._register(myService.onDidChange(newValue => {
			console.log('Value changed to:', newValue);
		}));
	}
}
```

### VS Code Core Event Examples

VS Code's `ChatEntitlementService` demonstrates the standard event pattern:

```typescript
// src/vs/workbench/services/chat/common/chatEntitlementService.ts

export class ChatEntitlementService extends Disposable implements IChatEntitlementService {
	// Private emitters
	private readonly _onDidChangeQuotaExceeded = this._register(new Emitter<void>());
	private readonly _onDidChangeQuotaRemaining = this._register(new Emitter<void>());
	private readonly _onDidChangeAnonymous = this._register(new Emitter<void>());

	// Public events exposed to consumers
	readonly onDidChangeQuotaExceeded = this._onDidChangeQuotaExceeded.event;
	readonly onDidChangeQuotaRemaining = this._onDidChangeQuotaRemaining.event;
	readonly onDidChangeAnonymous = this._onDidChangeAnonymous.event;

	// Computed event using Event.map utility
	readonly onDidChangeEntitlement: Event<void> = Event.map(
		Event.filter(
			this.contextKeyService.onDidChangeContext,
			e => e.affectsSome(new Set([
				ChatEntitlementContextKeys.Entitlement.planPro.key,
				ChatEntitlementContextKeys.Entitlement.planBusiness.key,
				// ... more keys
			]))
		),
		() => { },  // Transform to void
		this._store
	);

	private acceptQuotas(quotas: IQuotas): void {
		const oldQuota = this._quotas;
		this._quotas = quotas;

		// Fire events based on changes
		const { changed: chatChanged } = this.compareQuotas(oldQuota.chat, quotas.chat);

		if (chatChanged.exceeded) {
			this._onDidChangeQuotaExceeded.fire();
		}

		if (chatChanged.remaining) {
			this._onDidChangeQuotaRemaining.fire();
		}
	}
}
```

### Event Utilities

VS Code provides powerful event combinators in `Event` namespace:

```typescript
// Event.map - Transform event data
const transformedEvent: Event<string> = Event.map(
	originalEvent,
	(data: number) => data.toString(),
	disposables
);

// Event.filter - Filter events by condition
const filteredEvent: Event<string> = Event.filter(
	originalEvent,
	(data: string) => data.length > 0,
	disposables
);

// Event.once - Fire only once
const onceEvent: Event<string> = Event.once(originalEvent);

// Event.debounce - Debounce rapid events
const debouncedEvent: Event<string> = Event.debounce(
	originalEvent,
	(last, current) => current,
	500  // ms delay
);

// Event.None - Null object pattern for events
class MyService {
	// Service that doesn't fire events
	readonly onDidChange: Event<void> = Event.None;
}
```

### Copilot Chat Extension Event Usage

The Copilot Chat extension follows the same patterns:

```typescript
// Example from extension service
export class CopilotLanguageModelProvider extends Disposable {
	private readonly _onDidChangeModels = this._register(new Emitter<void>());
	readonly onDidChangeModels: Event<void> = this._onDidChangeModels.event;

	private async refreshModels(): Promise<void> {
		// Fetch new models from API
		const newModels = await this.fetchModelsFromAPI();

		this._models = newModels;

		// Notify all subscribers that models changed
		this._onDidChangeModels.fire();
	}
}

// Consumer in the extension
class ModelPickerWidget extends Disposable {
	constructor(
		private readonly provider: CopilotLanguageModelProvider
	) {
		super();

		// React to model changes
		this._register(provider.onDidChangeModels(() => {
			this.refreshUI();
		}));
	}
}
```

### Event Lifecycle and Memory Management

**Critical Rules**:

1. **Always register disposables**: Use `this._register()` for emitters and subscriptions
2. **Emitters are private**: Only the class that owns data should fire events
3. **Events are public**: Consumers subscribe via public `Event<T>` properties
4. **Dispose properly**: Extend `Disposable` and register all subscriptions

```typescript
export class MyService extends Disposable {
	// ✅ CORRECT: Private emitter, registered for disposal
	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	// ❌ WRONG: Public emitter can be fired by anyone
	readonly onDidChange = new Emitter<string>();

	// ❌ WRONG: Not registered, will leak memory
	private readonly _onDidChange = new Emitter<string>();
}

export class MyConsumer extends Disposable {
	constructor(service: MyService) {
		super();

		// ✅ CORRECT: Subscription registered for disposal
		this._register(service.onDidChange(data => {
			// handle event
		}));

		// ❌ WRONG: Subscription not registered, will leak
		service.onDidChange(data => {
			// handle event
		});
	}
}
```

### Advanced Event Patterns

#### Observable-backed Events

VS Code supports creating events from observables:

```typescript
import { observableFromEvent } from 'vs/base/common/observable';

export class ChatEntitlementService extends Disposable {
	readonly onDidChangeEntitlement: Event<void>;

	// Observable version of the same data
	readonly entitlementObs: IObservable<ChatEntitlement>;

	constructor() {
		// Define event first
		this.onDidChangeEntitlement = Event.map(/*...*/);

		// Create observable from event
		this.entitlementObs = observableFromEvent(
			this.onDidChangeEntitlement,
			() => this.entitlement  // Getter function
		);
	}
}
```

#### Event Delivery Queue

For performance-critical scenarios, events can use a delivery queue:

```typescript
const deliveryQueue = new EventDeliveryQueue();

const emitter1 = new Emitter<void>({ deliveryQueue });
const emitter2 = new Emitter<void>({ deliveryQueue });

// Events from both emitters will be batched and delivered in order
emitter1.fire();
emitter2.fire();
```

### Event Best Practices

1. **Use `Event.None` for null events**: Don't use `undefined` or `null`
2. **Pass `DisposableStore` to event utilities**: Prevents memory leaks
3. **Name events consistently**: `onDid*` for past tense, `onWill*` for future
4. **Keep event payloads small**: Avoid passing large objects
5. **Use void for notification events**: When no data needs to be passed

```typescript
// Good event naming
readonly onDidChangeValue: Event<string>;      // Past tense - value changed
readonly onWillSave: Event<void>;              // Future tense - about to save
readonly onDidReceiveMessage: Event<Message>;  // Past tense with data

// Event with no data
readonly onDidComplete: Event<void> = this._onDidComplete.event;

// Using Event.None
class StaticService {
	// This service never changes
	readonly onDidChange: Event<void> = Event.None;
}
```

## Extension Activation Architecture

The Copilot Chat extension follows VS Code's standard extension activation model, with the main entry point being the `activate` function.

### Extension Entry Point

VS Code reads the extension's `package.json` to determine activation events and the main entry file.

#### package.json Configuration

```json
{
	"name": "copilot-chat",
	"main": "./dist/extension",
	"activationEvents": [
		"onStartupFinished",
		"onLanguageModelChat:copilot",
		"onAuthenticationRequest:my-dummy-authentication",
		"onLanguageModelAccess:dummy",
		"onUri",
		"onFileSystem:ccreq",
		"onFileSystem:ccsettings"
	],
	"enabledApiProposals": [
		"extensionsAny",
		"newSymbolNamesProvider",
		"interactive",
		"codeActionAI",
		// ... more APIs
	]
}
```

**Activation Events Explained**:

- `onStartupFinished`: Activate after VS Code finishes starting (non-blocking)
- `onLanguageModelChat:copilot`: Activate when copilot language model is requested
- `onAuthenticationRequest:*`: Activate when specific auth provider is requested
- `onLanguageModelAccess:*`: Activate when language model access is needed
- `onUri`: Activate when extension handles a URI
- `onFileSystem:*`: Activate when custom file system is accessed

### Activation Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  1. VS Code Starts                                               │
│     - Scans extensions folder                                    │
│     - Reads package.json files                                   │
│     - Registers activation events                                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  2. Activation Event Fires                                       │
│     - User action triggers registered event                      │
│     - e.g., "onLanguageModelChat:copilot"                        │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  3. Extension Host Loads Extension                               │
│     - Creates extension context                                  │
│     - Loads main module (./dist/extension.js)                    │
│     - Measures code loading time                                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  4. Calls activate() Function                                    │
│     - Passes ExtensionContext as parameter                       │
│     - Extension sets up services and subscriptions               │
│     - Returns API object (optional)                              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  5. Extension is Active                                          │
│     - Can register providers, commands, etc.                     │
│     - Subscriptions added to context.subscriptions               │
│     - Services running                                           │
└──────────────────────────────────────────────────────────────────┘
```

### Extension Activation Implementation

The Copilot Chat extension has a layered activation structure:

#### Node.js Extension Entry Point

```typescript
// src/extension/extension/vscode-node/extension.ts

export function activate(context: ExtensionContext, forceActivation?: boolean) {
	return baseActivate({
		context,
		registerServices,
		contributions: vscodeNodeContributions,
		configureDevPackages,
		forceActivation
	});
}
```

#### Base Activation (Shared)

```typescript
// src/extension/extension/vscode/extension.ts

export async function baseActivate(configuration: IExtensionActivationConfiguration) {
	const context = configuration.context;

	// 1. Check extension mode
	if (context.extensionMode === ExtensionMode.Test && !configuration.forceActivation) {
		return context;  // Skip activation in tests
	}

	// 2. Version compatibility check
	const isStableVsCode = !(env.appName.includes('Insiders') || env.appName.includes('Exploration'));
	if (context.extension.packageJSON.isPreRelease && isStableVsCode) {
		// Prevent pre-release extension in stable VS Code
		commands.executeCommand('setContext', 'github.copilot.interactiveSession.switchToReleaseChannel', true);
		return context;
	}

	// 3. Configure localization
	if (vscodeL10n.bundle) {
		l10n.config({ contents: vscodeL10n.bundle });
	}

	// 4. Dev environment setup
	if (!isProduction) {
		configuration.configureDevPackages?.();  // Load .env, source maps
	}

	// 5. Create instantiation service (DI container)
	const instantiationService = createInstantiationService(configuration);

	// 6. Initialize experimentation service
	await instantiationService.invokeFunction(async accessor => {
		const expService = accessor.get(IExperimentationService);
		await expService.hasTreatments();  // Ensure cache is fresh
	});

	// 7. Load contributions (features)
	const contributions = instantiationService.createInstance(
		ContributionCollection,
		configuration.contributions
	);
	context.subscriptions.push(contributions);

	// Wait for activation blockers
	await contributions.waitForActivationBlockers();

	// 8. Return API for other extensions
	return {
		getAPI(version: number) {
			if (version > CopilotExtensionApi.version) {
				throw new Error('Invalid Copilot Chat extension API version');
			}
			return instantiationService.createInstance(CopilotExtensionApi);
		}
	};
}
```

### Extension Context

VS Code provides an `ExtensionContext` object with useful APIs:

```typescript
export interface ExtensionContext {
	// Paths
	readonly extensionPath: string;
	readonly extensionUri: Uri;
	readonly storagePath: string | undefined;
	readonly globalStoragePath: string;
	readonly logPath: string;

	// State management
	readonly globalState: Memento;
	readonly workspaceState: Memento;
	readonly secrets: SecretStorage;

	// Subscriptions
	readonly subscriptions: { dispose(): any }[];

	// Metadata
	readonly extensionMode: ExtensionMode;
	readonly extension: Extension<any>;

	// Utilities
	asAbsolutePath(relativePath: string): string;
}
```

#### Using Extension Context

```typescript
export function activate(context: vscode.ExtensionContext) {
	// Store persistent data
	context.globalState.update('lastUsed', Date.now());

	// Store secrets
	await context.secrets.store('apiKey', userToken);

	// Register disposables for cleanup
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('myView', treeProvider)
	);

	// Get extension paths
	const configPath = context.asAbsolutePath('config/settings.json');

	// Access extension metadata
	console.log('Extension version:', context.extension.packageJSON.version);
}
```

### Activation Timing

VS Code measures extension activation performance:

```typescript
// From src/vs/workbench/api/common/extHostExtensionService.ts

class ExtensionActivationTimesBuilder {
	private _codeLoadingStart: number;    // Module require() starts
	private _codeLoadingStop: number;     // Module require() completes
	private _activateCallStart: number;   // activate() function called
	private _activateCallStop: number;    // activate() function returns
	private _activateResolveStart: number; // Async activation starts
	private _activateResolveStop: number;  // Async activation completes

	public build(): ExtensionActivationTimes {
		return new ExtensionActivationTimes(
			this._startup,
			this._delta(this._codeLoadingStart, this._codeLoadingStop),
			this._delta(this._activateCallStart, this._activateCallStop),
			this._delta(this._activateResolveStart, this._activateResolveStop)
		);
	}
}
```

**Timing Breakdown**:

1. **Code Loading Time**: Time to `require()` the extension module
2. **Activate Call Time**: Synchronous execution of `activate()` function
3. **Activate Resolve Time**: Time for async operations in `activate()` to complete

### VS Code Extension Host Activation Process

The activation process is handled by VS Code's Extension Host:

```typescript
// Simplified from src/vs/workbench/api/common/extHostExtensionService.ts

private async _doActivateExtension(
	extensionDescription: IExtensionDescription,
	reason: ExtensionActivationReason
): Promise<ActivatedExtension> {
	// 1. Log activation start
	this._logService.info(
		`ExtensionService#_doActivateExtension ${extensionDescription.identifier.value}, ` +
		`startup: ${reason.startup}, activationEvent: '${reason.activationEvent}'`
	);

	// 2. Get entry point from package.json
	const entryPoint = this._getEntryPoint(extensionDescription);
	if (!entryPoint) {
		return Promise.resolve(new EmptyExtension(ExtensionActivationTimes.NONE));
	}

	// 3. Load the module
	const activationTimesBuilder = new ExtensionActivationTimesBuilder(reason.startup);
	const [extensionModule, context] = await Promise.all([
		this._loadCommonJSModule(extensionDescription, entryPoint, activationTimesBuilder),
		this._loadExtensionContext(extensionDescription, extensionInternalStore)
	]);

	// 4. Call activate() function
	performance.mark(`code/extHost/willActivateExtension/${extensionDescription.identifier.value}`);
	const activatedExtension = await this._callActivate(
		extensionDescription.identifier,
		extensionModule,
		context,
		extensionInternalStore,
		activationTimesBuilder
	);
	performance.mark(`code/extHost/didActivateExtension/${extensionDescription.identifier.value}`);

	// 5. Log activation times
	this._mainThreadExtensionsProxy.$onDidActivateExtension(
		extensionDescription.identifier,
		activationTimes.codeLoadingTime,
		activationTimes.activateCallTime,
		activationTimes.activateResolvedTime,
		reason
	);

	return activatedExtension;
}

private static _callActivate(
	logService: ILogService,
	extensionId: ExtensionIdentifier,
	extensionModule: IExtensionModule,
	context: vscode.ExtensionContext,
	extensionInternalStore: IDisposable,
	activationTimesBuilder: ExtensionActivationTimesBuilder
): Promise<ActivatedExtension> {
	if (typeof extensionModule.activate === 'function') {
		try {
			activationTimesBuilder.activateCallStart();

			// Call the extension's activate function
			const activateResult: Promise<IExtensionAPI> = extensionModule.activate.apply(
				globalThis,
				[context]
			);

			activationTimesBuilder.activateCallStop();
			activationTimesBuilder.activateResolveStart();

			return Promise.resolve(activateResult).then((value) => {
				activationTimesBuilder.activateResolveStop();
				return new ActivatedExtension(
					false,
					null,
					activationTimesBuilder.build(),
					extensionModule,
					value,
					toDisposable(() => {
						extensionInternalStore.dispose();
						dispose(context.subscriptions);
					})
				);
			});
		} catch (err) {
			return Promise.reject(err);
		}
	} else {
		// Extension has no activate function
		return Promise.resolve(
			new ActivatedExtension(
				false,
				null,
				ExtensionActivationTimes.NONE,
				extensionModule,
				undefined,
				extensionInternalStore
			)
		);
	}
}
```

### How VS Code Enters the Extension

VS Code's activation flow is orchestrated by several components:

#### 1. Main Thread (Renderer Process)

```typescript
// src/vs/workbench/services/extensions/common/abstractExtensionService.ts

export class AbstractExtensionService {
	// User action or API call triggers activation
	public activateByEvent(
		activationEvent: string,
		activationKind: ActivationKind = ActivationKind.Normal
	): Promise<void> {
		// Record activation event
		this._allRequestedActivateEvents.add(activationEvent);

		if (!this._registry.containsActivationEvent(activationEvent)) {
			// No extension interested in this event
			return NO_OP_VOID_PROMISE;
		}

		// Delegate to all extension hosts
		return this._activateByEvent(activationEvent, activationKind);
	}

	private _activateByEvent(
		activationEvent: string,
		activationKind: ActivationKind
	): Promise<void> {
		// Fire onWillActivateByEvent
		const result = Promise.all(
			this._extensionHostManagers.map(manager =>
				manager.activateByEvent(activationEvent, activationKind)
			)
		).then(() => { });

		this._onWillActivateByEvent.fire({
			event: activationEvent,
			activation: result
		});

		return result;
	}
}
```

#### 2. Extension Host Manager (Main Thread)

```typescript
// src/vs/workbench/services/extensions/common/extensionHostManager.ts

export class ExtensionHostManager extends Disposable {
	public activateByEvent(
		activationEvent: string,
		activationKind: ActivationKind
	): Promise<void> {
		// Check if we've already activated for this event
		if (!this._cachedActivationEvents.has(activationEvent)) {
			this._cachedActivationEvents.set(
				activationEvent,
				this._activateByEvent(activationEvent, activationKind)
			);
		}
		return this._cachedActivationEvents.get(activationEvent)!;
	}

	private async _activateByEvent(
		activationEvent: string,
		activationKind: ActivationKind
	): Promise<void> {
		const proxy = await this._proxy;  // RPC proxy to extension host
		if (!proxy) {
			return;
		}

		// Check if any extension listens to this event
		if (!this._extensionHost.extensions!.containsActivationEvent(activationEvent)) {
			this._resolvedActivationEvents.add(activationEvent);
			return;
		}

		// RPC call to extension host process
		await proxy.activateByEvent(activationEvent, activationKind);
		this._resolvedActivationEvents.add(activationEvent);
	}
}
```

#### 3. Extension Host (Separate Process)

```typescript
// src/vs/workbench/api/common/extHostExtensionActivator.ts

export class ExtensionsActivator implements IDisposable {
	public async activateByEvent(
		activationEvent: string,
		startup: boolean
	): Promise<void> {
		// Check if already activated
		if (this._alreadyActivatedEvents[activationEvent]) {
			return;
		}

		// Find all extensions interested in this event
		const extensions: ActivationIdAndReason[] = [];
		for (const desc of this._registry.getAllExtensionDescriptions()) {
			if (this._activationEventReader.readActivationEvents(desc).includes(activationEvent)) {
				extensions.push({
					id: desc.identifier,
					reason: { startup, activationEvent, extensionId: desc.identifier }
				});
			}
		}

		// Activate all interested extensions
		await this._activateExtensions(extensions);

		this._alreadyActivatedEvents[activationEvent] = true;
	}

	private async _activateExtensions(
		extensions: ActivationIdAndReason[]
	): Promise<void> {
		// Handle dependencies and activate
		const operations = extensions
			.filter(p => !this.isActivated(p.id))
			.map(ext => this._handleActivationRequest(ext));

		await Promise.all(operations.map(op => op.wait()));
	}
}
```

### Complete Activation Example

Here's a complete example showing proper activation patterns:

```typescript
// Extension entry point
export function activate(context: vscode.ExtensionContext) {
	// 1. Initialize services with DI
	const services = new ServiceCollection();
	services.set(IAuthService, new SyncDescriptor(AuthService));
	services.set(IModelService, new SyncDescriptor(ModelService));

	const instantiationService = new InstantiationService(services);

	// 2. Create service instances
	const authService = instantiationService.createInstance(AuthService);
	const modelService = instantiationService.createInstance(ModelService);

	// 3. Register for cleanup
	context.subscriptions.push(authService, modelService);

	// 4. Register providers
	const languageModelProvider = instantiationService.createInstance(
		CopilotLanguageModelProvider
	);

	context.subscriptions.push(
		vscode.lm.registerLanguageModelProvider(
			'copilot',
			'gpt-4o',
			languageModelProvider,
			metadata
		)
	);

	// 5. Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('copilot.askQuestion', async () => {
			// Command implementation
		})
	);

	// 6. Setup event listeners
	context.subscriptions.push(
		authService.onDidChangeAuthStatus(() => {
			// Handle auth changes
		})
	);

	// 7. Return API for other extensions (optional)
	return {
		getAPI(version: number): ICopilotAPI {
			return instantiationService.createInstance(CopilotExtensionApi);
		}
	};
}

// Deactivation cleanup
export function deactivate() {
	// Cleanup is automatic via context.subscriptions
	// But can add custom logic here
	console.log('Copilot Chat extension deactivated');
}
