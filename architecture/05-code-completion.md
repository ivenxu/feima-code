## Code Completion System

### Overview

While the Chat Participant API and Language Model API are designed for multi-turn conversational AI, **code completions operate through a completely separate system** optimized for speed and responsiveness. This section details how GitHub Copilot's inline completions (both suggestion boxes and continuous inline mode) are implemented and how they differ from the chat system.

**Key Distinction from Chat:**
- ❌ Code completions do NOT use user-selected language models
- ❌ Code completions do NOT use tool calling or agent mode
- ✅ Code completions use a **separate NES/Xtab backend** for speed optimization
- ✅ Code completions are registered via standard VS Code `languages.registerInlineCompletionItemProvider()` API
- ✅ Multiple extensions can provide competing completions (registry-based)

### User-Selectable Completion Models (Expert Mode)

**Feature**: "Change Completions Model"

GitHub Copilot provides a "Change Completions Model" command that allows users to select which model to use for completions, but this is different from the chat model selection system. This feature is experimental and available to:
- ✅ Individual plan users
- ✅ Internal GitHub employees
- ❌ GitHub Enterprise users (limited availability)

#### Model Selection UI

**Command**: `github.copilot.chat.openModelPicker`
**Category**: GitHub Copilot
**Availability**: Requires `github.copilot.extensionUnification.activated && !isWeb`

Users can access model selection via:
1. **Command Palette**: Press `Cmd+Shift+P` and search "Change Completions Model"
2. **Settings**: Configure `github.copilot.selectedCompletionModel` in settings.json
3. **GUI Picker**: VS Code Quick Pick shows available models with descriptions

#### Configuration Storage

The user's selected completion model is stored in VS Code settings:

```json
{
  "github.copilot.selectedCompletionModel": ""  // Empty = use default
}
```

**Configuration Details:**
- **Key**: `github.copilot.selectedCompletionModel`
- **Type**: string
- **Default Value**: `""` (empty string means use default/recommended model)
- **Possible Values**: Model IDs like `"gpt-4o"`, `"claude-3-5-sonnet"`, etc.
- **Storage**: VS Code user settings (encrypted via SecretStorage for API keys)

When a user selects a model:
1. Selection is persisted to settings
2. Completions cache is cleared (to avoid stale responses)
3. Async completion manager is reset
4. Next completion request uses the new model

#### Extension Activation

The completions system activates at startup via these events:

```json
{
  "activationEvents": [
    "onStartupFinished",
    "onLanguageModelChat:copilot",
    "onUri",
    "onFileSystem:ccreq",
    "onFileSystem:ccsettings"
  ]
}
```

**Event Explanations:**
| Event | Trigger | Purpose |
|-------|---------|---------|
| `onStartupFinished` | VS Code startup complete | Primary registration point for completions |
| `onLanguageModelChat:copilot` | Language model accessed | Ensure completions available when model requested |
| `onUri` | Special URI scheme | Handle OAuth and configuration URIs |
| `onFileSystem:ccreq` | Virtual file system | Custom request handling |
| `onFileSystem:ccsettings` | Virtual file system | Settings management |

The extension registers the completions provider during `onStartupFinished`, making it available immediately when users start coding.

#### Package.json Declarations

**Command Registration:**
```json
{
  "commands": [
    {
      "command": "github.copilot.chat.openModelPicker",
      "title": "Change Completions Model",
      "category": "GitHub Copilot",
      "enablement": "github.copilot.extensionUnification.activated && !isWeb"
    }
  ]
}
```

**Configuration Schema:**
```json
{
  "configuration": [
    {
      "title": "GitHub Copilot",
      "properties": {
        "github.copilot.selectedCompletionModel": {
          "type": "string",
          "default": "",
          "markdownDescription": "The currently selected completion model ID. To select from a list of available models, use the __\"Change Completions Model\"__ command. When empty, the default model is used."
        }
      }
    }
  ]
}
```

**Capabilities Requirement:**
```json
{
  "enabledApiProposals": [
    "inlineCompletionsAdditions"
  ]
}
```

The `inlineCompletionsAdditions` proposed API provides:
- Extended inline completion context
- Tool invocation hints
- Enhanced streaming support

#### How Model Selection Affects Behavior

When a user selects a completion model, the following happens:

1. **Model Cache Cleared**: In `modelPicker.ts`, when `setUserSelectedCompletionModel()` is called:
```typescript
async setUserSelectedCompletionModel(modelId: string | null): Promise<void> {
    // Store in settings
    await this.configurationService.updateSettings({
        'github.copilot.selectedCompletionModel': modelId || ''
    });
    
    // Clear caches immediately
    this.completionsCacheService.clear();  // Clear cached completions
    this.asyncCompletionManager.reset();   // Reset async completion state
    
    // Notify that model changed
    this._onDidChangeModel.fire(modelId);
}
```

2. **Next Request Uses New Model**: When the user types next, the completions provider sends a request that includes the selected model information (via server-side routing)

3. **Telemetry Logged**: Model selection events are tracked for analytics
```typescript
selectModel(model: ILanguageModelInfo): void {
    this.telemetryService.logUsage('completions.modelSelected', {
        modelId: model.id,
        family: model.family,
        vendor: model.vendor,
        timestamp: Date.now()
    });
    
    // Actually update
    this.setUserSelectedCompletionModel(model.id);
}
```

#### Important: Model Selection vs Endpoint Selection

**Key Insight**: User selects the **completion MODEL** but NOT the **API ENDPOINT**.

- ✅ User can select: `claude-3-5-sonnet` vs `gpt-4o` vs `gemini-1.5-pro`
- ❌ User CANNOT select: API backend (GitHub vs Azure vs custom)
- ❌ Endpoint is determined: Server-side (NES/Xtab backend routing)
- ❌ No `model` field in request body: ModelParams interface has optional model field but it's NOT populated

The completions endpoint URL comes from server configuration:
```typescript
const completionsUrl = await this.configService
    .getExperimentBasedConfig(
        ConfigKey.TeamInternal.InlineEditsCompletionsUrl
    );
// Returns: "https://api.github.com/..." or "https://nes.vscode-cdn.net/..."
// Determined server-side, NOT by local settings
```

#### FetchService Endpoint Override

The completions system uses the `ICompletionsFetchService` interface for HTTP requests. Extensions or custom builds can override endpoint handling through three mechanisms:

**1. Subclass Override Pattern:**
```typescript
// Extend CompletionsFetchService to intercept/modify requests
class CachingCompletionsFetchService extends CompletionsFetchService {
    // Override protected method
    protected async _fetchFromUrl(
        url: string,
        secretKey: string,
        body: ModelParams,
        requestId: string,
        token: CancellationToken
    ): Promise<Response> {
        // Check cache first
        const cached = this.cache.get(JSON.stringify(body));
        if (cached) return cached;
        
        // Make request
        const response = await super._fetchFromUrl(url, secretKey, body, requestId, token);
        
        // Cache result
        this.cache.set(JSON.stringify(body), response);
        return response;
    }
}

// Register override via DI
instantiationService.registerServiceFactory(
    ICompletionsFetchService,
    () => new CachingCompletionsFetchService(...)
);
```

**2. Header Customization via `headerOverrides` Parameter:**
```typescript
// In CompletionsProvider.ts line 91:
const response = await this.fetchService.fetch(
    url,
    secretKey,
    params,
    requestId,
    token,
    {
        // Optional header overrides
        'X-Custom-Header': 'custom-value',
        'X-Request-Context': 'inline-chat'
    }
);

// Merged in getHeaders():
private getHeaders(
    requestId: string,
    secretKey: string,
    headerOverrides: Record<string, string> = {}
): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'x-policy-id': 'nil',
        'Authorization': 'Bearer ' + secretKey,
        'X-Request-Id': requestId,
        'X-GitHub-Api-Version': '2025-04-01',
        ...headerOverrides,  // Override any headers above
    };
}
```

**3. Service Injection Pattern:**
```typescript
// CompletionsFetchService interface
export interface ICompletionsFetchService {
    fetch(
        url: string,
        secretKey: string,
        params: ModelParams,
        requestId: string,
        ct: CancellationToken,
        headerOverrides?: Record<string, string>
    ): Promise<Result<ResponseStream, CompletionsFetchFailure>>;
}

// Register alternative implementation
const customFetchService = new CustomCompletionsFetchService(/*...*/);
container.set(ICompletionsFetchService, customFetchService);

// Now CompletionsProvider automatically uses CustomCompletionsFetchService
// via dependency injection
```

**Use Cases for Endpoint Overrides:**
- Routing completions through corporate proxy
- Load balancing across multiple backends
- Adding telemetry/logging to requests
- Implementing custom authentication
- Testing with mock backends
- Fallback to alternative endpoints

### Architecture

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Code Completion System (GitHub Copilot)                        │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Editor - User Types                                      │  │
│  │  "function getUserById(id) {"                             │  │
│  └────────┬────────────────────────────────────────────────┘  │
│           │                                                     │
│           │ onDidChangeTextDocument                            │
│           ▼                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  InlineCompletionsSource.provideInlineCompletionItems()  │  │
│  │  (VS Code Core)                                           │  │
│  │                                                            │  │
│  │  • Gathers registered providers                           │  │
│  │    - GitHub Copilot                                       │  │
│  │    - Other extensions                                     │  │
│  │  • Calls each provider                                    │  │
│  │  • Debounces requests (default: 50ms)                     │  │
│  │  • Ranks results by score and latency                     │  │
│  └────────┬────────────────────────────────────────────────┘  │
│           │                                                     │
│           │ Calls registered providers in parallel             │
│           ▼                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  CompletionsCoreContribution (Copilot Extension)          │  │
│  │  File: src/extension/completions/                         │  │
│  │         vscode-node/completionsCoreContribution.ts       │  │
│  │                                                            │  │
│  │  languages.registerInlineCompletionItemProvider(          │  │
│  │    { pattern: '**' },                                     │  │
│  │    completionsProvider,                                   │  │
│  │    { debounceDelayMs: 0, excludes: ['github.copilot'] }   │  │
│  │  );                                                        │  │
│  │                                                            │  │
│  │  Key: excludes: ['github.copilot']                        │  │
│  │  Prevents built-in from conflicting                       │  │
│  └────────┬────────────────────────────────────────────────┘  │
│           │                                                     │
│           │ Calls provider.provideInlineCompletionItems()      │
│           ▼                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  CompletionsProvider (Copilot Extension)                  │  │
│  │  File: src/extension/completions/                         │  │
│  │         vscode-node/completionsProvider.ts               │  │
│  │                                                            │  │
│  │  async provideInlineCompletionItems(               │  │
│  │      document: TextDocument,                             │  │
│  │      position: Position,                                 │  │
│  │      context: InlineCompletionContext,                   │  │
│  │      token: CancellationToken                            │  │
│  │  ): Promise<InlineCompletionItem[]> {                    │  │
│  │      // 1. Get endpoint URL (NOT user-selected model)    │  │
│  │      const url = await configService                     │  │
│  │          .getExperimentBasedConfig(                       │  │
│  │              ConfigKey.TeamInternal                      │  │
│  │                  .InlineEditsCompletionsUrl              │  │
│  │          );                                               │  │
│  │      // Result: "https://api.github.com/..." or          │  │
│  │      //        "https://nes.vscode-cdn.net/..."          │  │
│  │      // Retrieved from server config, NOT local settings  │  │
│  │                                                            │  │
│  │      // 2. Gather document context                        │  │
│  │      const context = {                                    │  │
│  │          precedingText: document.getText(...)            │  │
│  │              .substring(0, position.character),          │  │
│  │          documentLanguage: document.languageId,          │  │
│  │          fileName: document.fileName,                    │  │
│  │          currentLines: getVisibleLines(document)         │  │
│  │      };                                                   │  │
│  │                                                            │  │
│  │      // 3. Build HTTP request to NES/Xtab endpoint       │  │
│  │      const body = {                                       │  │
│  │          prefix: context.precedingText,                   │  │
│  │          suffix: '',  // Usually empty for performance    │  │
│  │          doc: {                                           │  │
│  │              languageId: context.documentLanguage,        │  │
│  │              uri: document.uri.toString()                 │  │
│  │          },                                               │  │
│  │          // ❌ NOTE: NO 'model' field in request          │  │
│  │          // Server side determines optimization strategy  │  │
│  │      };                                                   │  │
│  │                                                            │  │
│  │      // 4. Make HTTP request                              │  │
│  │      const response = await fetch(url, {                 │  │
│  │          method: 'POST',                                 │  │
│  │          headers: {                                       │  │
│  │              'Authorization':                            │  │
│  │                  `Bearer ${await getAuthToken()}`       │  │
│  │          },                                               │  │
│  │          body: JSON.stringify(body)                       │  │
│  │      });                                                  │  │
│  │                                                            │  │
│  │      // 5. Parse and return completion items             │  │
│  │      const items = parseCompletionResponse(response);     │  │
│  │      return items;                                        │  │
│  │  }                                                         │  │
│  └────────┬────────────────────────────────────────────────┘  │
│           │                                                     │
│           │ Returns InlineCompletionItem[]                     │
│           ▼                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  InlineCompletionsSource (VS Code Core)                   │  │
│  │  • Ranks all provider results                             │  │
│  │  • Deduplicates similar completions                       │  │
│  │  • Selects top result (usually Copilot's)                 │  │
│  └────────┬────────────────────────────────────────────────┘  │
│           │                                                     │
│           │ Displays top completion                            │
│           ▼                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Editor - Inline Completion UI                            │  │
│  │  Shown: "return user || null;"  (grayed out)              │  │
│  │  User presses Tab to accept                               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architectural Differences: Completions vs Chat

| Aspect | Completions | Chat |
|--------|-----------|------|
| **Model Selection** | Server-side only | User-selected via model picker |
| **API Route** | NES/Xtab endpoint (`api.github.com/...`) | GitHub Models API |
| **Purpose** | Speed + responsiveness | Accuracy + reasoning |
| **Response Format** | Strings (code) | Streaming tokens via SSE |
| **Context Window** | Small (~500 tokens) | Large (~4000+ tokens) |
| **Tool Calling** | ❌ No | ✅ Yes |
| **Iterative Refinement** | ❌ No | ✅ Yes (tool loop) |
| **Registration Method** | `languages.registerInlineCompletionItemProvider()` | `vscode.chat.createChatParticipant()` |
| **Multi-provider Support** | ✅ Yes (via LanguageFeatureRegistry) | ✅ Yes (via provider registry) |

### Implementation Files

**File 1: `src/extension/completions/vscode-node/completionsCoreContribution.ts`**

This file registers the inline completions provider with VS Code.

```typescript
/**
 * Registers GitHub Copilot's inline completions provider.
 * This makes code suggestions appear as you type.
 */
export class CompletionsCoreContribution implements ICoreContribution {
    
    constructor(
        @ILanguagesService private languagesService: ILanguagesService,
        @ICompletionsService private completionsService: ICompletionsService
    ) { }
    
    register(context: ExtensionContext): IDisposable {
        // Create provider instance
        const provider = this.completionsService.createCompletionsProvider();
        
        // Register with VS Code
        // Key: `languages.registerInlineCompletionItemProvider()` is the standard API
        const registration = this.languagesService.registerInlineCompletionItemProvider(
            { pattern: '**' },  // Apply to all files
            provider,
            {
                // Debounce: don't spam requests while user is typing rapidly
                debounceDelayMs: 0,  // 0 = no debounce (fastest)
                
                // Excludes: prevent this extension's other providers from conflicting
                // 'github.copilot' is the extension ID of this extension
                excludes: ['github.copilot'],
                
                // Group ID: allows multiple providers with same groupId
                groupId: 'completions'
            }
        );
        
        return registration;
    }
}
```

**File 2: `src/extension/completions/vscode-node/completionsProvider.ts`**

This file implements the actual completion logic.

```typescript
/**
 * Provides inline code completions via GitHub's NES backend.
 */
export class CompletionsProvider implements InlineCompletionItemProvider {
    
    constructor(
        @IConfigurationService private configService: IConfigurationService,
        @IAuthenticationService private authService: IAuthenticationService,
        @ITelemetryService private telemetryService: ITelemetryService
    ) { }
    
    async provideInlineCompletionItems(
        document: TextDocument,
        position: Position,
        context: InlineCompletionContext,
        token: CancellationToken
    ): Promise<InlineCompletionItem[] | InlineCompletionList | null> {
        
        try {
            // ────────────────────────────────────────────────────────
            // Step 1: Get endpoint URL from server config
            // ────────────────────────────────────────────────────────
            const completionsUrl = await this.configService
                .getExperimentBasedConfig(
                    ConfigKey.TeamInternal.InlineEditsCompletionsUrl,
                    this.experimentationService
                );
            
            if (!completionsUrl) {
                return [];  // Feature not available in this region/config
            }
            
            // URL Examples:
            // - "https://api.github.com/completions/v1"
            // - "https://nes.vscode-cdn.net/completions"
            // The endpoint determines which model to use (NOT the extension)
            
            // ────────────────────────────────────────────────────────
            // Step 2: Gather document context
            // ────────────────────────────────────────────────────────
            
            // Get all text before cursor
            const fullText = document.getText();
            const offset = document.offsetAt(position);
            const precedingText = fullText.substring(0, offset);
            const followingText = fullText.substring(offset);
            
            // Get visible lines around cursor for context
            const visibleRange = editor.visibleRanges[0];
            const relevantContext = document.getText(visibleRange);
            
            // ────────────────────────────────────────────────────────
            // Step 3: Get authentication
            // ────────────────────────────────────────────────────────
            const token = await this.authService.getCopilotToken();
            if (!token) {
                return [];  // User not authenticated
            }
            
            // ────────────────────────────────────────────────────────
            // Step 4: Build request body
            // ────────────────────────────────────────────────────────
            const requestBody = {
                // Code context
                prefix: precedingText,          // What came before
                suffix: followingText,          // What comes after (rarely used)
                prompt: this.buildPrompt(document, position),
                
                // Document info
                doc: {
                    uri: document.uri.toString(),
                    languageId: document.languageId,
                    version: document.version
                },
                
                // Editor state
                cursor: {
                    line: position.line,
                    character: position.character
                },
                
                // ❌ IMPORTANT: NO 'model' field
                // Server determines model/backend based on:
                // - User's plan (free/pro/business)
                // - A/B experiments (testAlternativeBackend)
                // - Region and infrastructure
                // This is intentional - completions need server-side optimization
            };
            
            // ────────────────────────────────────────────────────────
            // Step 5: Make HTTP request
            // ────────────────────────────────────────────────────────
            const response = await fetch(completionsUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': `VSCodeCopilot/${version}`,
                    'X-Request-Id': generateUuid()
                },
                body: JSON.stringify(requestBody),
                signal: token.signal  // Respect cancellation
            });
            
            if (!response.ok) {
                this.telemetryService.logError('completions.fetch.error', {
                    status: response.status,
                    statusText: response.statusText
                });
                return [];
            }
            
            // ────────────────────────────────────────────────────────
            // Step 6: Parse response
            // ────────────────────────────────────────────────────────
            const json = await response.json();
            
            // Response format:
            // {
            //   "completions": [
            //     { "text": " return user || null;" },
            //     { "text": " return;" }
            //   ],
            //   "model": "copilot-internal"
            // }
            
            if (!json.completions || json.completions.length === 0) {
                return [];
            }
            
            // ────────────────────────────────────────────────────────
            // Step 7: Convert to VS Code format
            // ────────────────────────────────────────────────────────
            const items = json.completions.map(
                (completion: any, index: number) => new InlineCompletionItem(
                    completion.text,
                    new Range(position, position),  // Start with cursor position
                    {
                        preselect: index === 0,  // First item is default
                        sortText: String(index).padStart(10, '0')  // Preserve order
                    }
                )
            );
            
            // ────────────────────────────────────────────────────────
            // Step 8: Log telemetry
            // ────────────────────────────────────────────────────────
            this.telemetryService.logUsage('completions.provided', {
                language: document.languageId,
                count: items.length,
                model: json.model,
                latency: Date.now() - startTime
            });
            
            return items;
            
        } catch (error) {
            this.telemetryService.logError('completions.provider.error', error);
            return [];  // Fail gracefully - don't break typing
        }
    }
    
    private buildPrompt(document: TextDocument, position: Position): string {
        // Additional context for better completions
        // Examples:
        // - Import statements from top of file
        // - Class name if inside a class
        // - Function signature if inside a function
        
        const lines = document.getText().split('\n');
        const relevantLines: string[] = [];
        
        // Get imports
        for (const line of lines) {
            if (line.startsWith('import ') || line.startsWith('from ')) {
                relevantLines.push(line);
            }
            if (line.startsWith('class ')) {
                relevantLines.push(line);
                break;
            }
        }
        
        return relevantLines.join('\n');
    }
}
```

### How Other Extensions Can Override Completions

VS Code's `LanguageFeatureRegistry` pattern allows multiple extensions to provide inline completions. Here's how competing providers work together:

**Multiple Providers Scenario:**

```typescript
// Extension A: GitHub Copilot
context.subscriptions.push(
    languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        copilotProvider,
        { 
            debounceDelayMs: 0, 
            excludes: ['github.copilot'],
            groupId: 'completions'
        }
    )
);

// Extension B: Tabnine (hypothetically)
context.subscriptions.push(
    languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        tabnineProvider,
        { 
            debounceDelayMs: 50,  // Slightly higher debounce
            excludes: ['tabnine'],  // Exclude self
            groupId: 'completions'
        }
    )
);

// Extension C: Custom In-house Provider
context.subscriptions.push(
    languages.registerInlineCompletionItemProvider(
        { pattern: '**/*.internal.ts' },  // Only specific files
        internalProvider,
        { 
            debounceDelayMs: 100,
            excludes: ['company.internal-completions'],
            groupId: 'completions'
        }
    )
);
```

**How VS Code Coordinates:**

```typescript
// File: vscode/src/vs/workbench/api/common/inlineCompletions.ts
export interface InlineCompletionContext {
    trigger: InlineCompletionTriggerKind.Automatic | .Explicit;
}

export class InlineCompletionsSource {
    async provideInlineCompletionItems(
        document: TextDocument,
        position: Position,
        context: InlineCompletionContext,
        token: CancellationToken
    ): Promise<InlineCompletionList> {
        
        // 1. Fetch from all registered providers
        const allProviders = this.inlineCompletionItemProvider.all({
            language: document.languageId,
            scheme: document.uri.scheme
        });
        
        // 2. Call in parallel (not sequentially)
        const results = await Promise.all(
            allProviders.map(provider => 
                provider.provideInlineCompletionItems(
                    document, 
                    position, 
                    context, 
                    token
                )
            )
        );
        
        // 3. Flatten results from all providers
        let allItems: InlineCompletionItem[] = [];
        for (const result of results) {
            if (Array.isArray(result)) {
                allItems = allItems.concat(result);
            }
        }
        
        // 4. Rank by score and latency
        // VS Code uses:
        // - sortText: to preserve order
        // - preselect: to highlight default
        // - latency: faster providers weighted higher
        const ranked = this.rankResults(allItems);
        
        // 5. Deduplicate similar completions
        const deduplicated = this.deduplicateSimilar(ranked);
        
        // 6. Return top result (usually shown in UI)
        return {
            items: deduplicated.slice(0, 5),  // Top 5
            isIncomplete: false
        };
    }
}
```

**Result:**
- ✅ Multiple extensions can peacefully coexist
- ✅ Each calls their own API endpoint
- ✅ VS Code merges and ranks all results
- ✅ User sees best completion (usually Copilot's due to quality)
- ✅ Other extensions can provide completions to users who don't have Copilot

**Overriding Copilot Completions:**

An extension can override Copilot completions by:

1. **Registering for same file patterns**:
   ```typescript
   languages.registerInlineCompletionItemProvider(
       { pattern: '**' },  // Same pattern as Copilot
       myProvider
   );
   ```

2. **Returning higher-quality results** (VS Code picks best):
   ```typescript
   // If myProvider returns item with sortText: '00001'
   // and Copilot returns item with sortText: '00002'
   // myProvider's item is shown first
   ```

3. **Using specific patterns** (don't conflict globally):
   ```typescript
   languages.registerInlineCompletionItemProvider(
       { 
           pattern: '**/*.internal.ts',  // Only internal files
           scheme: 'file'
       },
       internalProvider
   );
   ```

### Why Completions Don't Use User-Selected Models

**Design Rationale:**

1. **Speed**: Completions must be fast (~50ms latency). User-selected models (Claude, GPT-4) add 100-200ms latency through LM API gateway
2. **Cost**: Thousands of completion requests per second; NES backend optimized for throughput
3. **Context Limits**: Completions work with small context (~500 tokens); chat models need larger context
4. **Latency Requirements**: User typing experience demands sub-100ms response; chat models designed for accuracy not speed

**Server-Side Optimization:**

The NES backend makes model selection decisions based on:
- User's plan tier (determines which model to use)
- A/B experiment groups (test faster model vs. slower but more accurate)
- Infrastructure load and regional availability
- Request queue depth

This gives GitHub the flexibility to:
- Upgrade models without extension changes
- Run A/B tests at scale
- Optimize for latency vs. accuracy by region
- Scale capacity without customer code changes

### Completions + Chat Working Together

```
┌──────────────────────────────┐
│ User typing code             │
└────────────┬─────────────────┘
             │
             ├─────────────────────────────┐
             │                             │
             ▼                             ▼
    ┌─────────────────┐        ┌──────────────────────┐
    │  Completions    │        │  Chat (if open)      │
    │  NES endpoint   │        │  Language Model API  │
    │  50ms latency   │        │  2-10s latency       │
    │  Single token   │        │  Multi-turn + tools  │
    │  Shown inline   │        │  Shown in panel      │
    └─────────────────┘        └──────────────────────┘
    
    Use Case:
    - Next line prediction
    - Autocomplete suggestions
    - Quick fixes
    
    Use Case:
    - Multi-line refactoring
    - Complex logic generation
    - With surrounding context
```

**Best Practices:**

1. **Completions**: Use for quick suggestions, autocomplete, next line
2. **Chat**: Use for explanations, multi-step tasks, tool calling
3. **Combined**: User can accept completion then ask follow-up in chat

### Testing & Metrics

**Telemetry Tracked for Completions:**

```typescript
telemetryService.logUsage('completions.provided', {
    language: document.languageId,  // 'typescript', 'python', etc.
    count: items.length,             // 1-5 typically
    model: json.model,               // 'copilot-internal', 'experimental-v2'
    latency: Date.now() - startTime,  // milliseconds
    accepted: user.selectedCompletion === 0,  // Did user accept?
    userMadeEdit: userEdited,        // Did they edit the completion?
    distanceFromTop: 150             // Characters from top of file
});
```

**Monitoring:**
- Acceptance rate (% of completions user accepts)
- Edit distance (edits per accepted completion)
- Latency percentiles (p50, p95, p99)
- Error rates by language and region

---

