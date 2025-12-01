## Bring Your Own Key (BYOK)

### Overview

**BYOK (Bring Your Own Key)** allows users to connect their own AI model API keys instead of using GitHub's provided models. This enables:
- Using enterprise Azure OpenAI deployments
- Accessing local models via Ollama
- Connecting to third-party providers (Anthropic, OpenRouter, etc.)
- Bypassing GitHub Copilot quotas with direct API access

**Availability**: BYOK is only available for:
- ✅ Individual plan users
- ✅ Internal GitHub users
- ❌ GitHub Enterprise users (not supported)

**File: `vscode-copilot-chat/src/extension/byok/common/byokProvider.ts`**
```typescript
export function isBYOKEnabled(copilotToken: ExtendedTokenInfo): boolean {
    const isGHE = copilotToken.organization?.isGitHubEnterprise;
    return (copilotToken.isInternal || copilotToken.isIndividual) && !isGHE;
}
```

### Built-in BYOK Providers

GitHub Copilot ships with **9 built-in BYOK providers**:

| Provider | Auth Type | Base URL | Features |
|----------|-----------|----------|----------|
| **OpenAI** | GlobalApiKey | `https://api.openai.com/v1` | GPT-4o, GPT-4o-mini, o1 |
| **Anthropic** | GlobalApiKey | `https://api.anthropic.com/v1` | Claude 3.5 Sonnet, Opus, Haiku |
| **Google Gemini** | GlobalApiKey | `https://generativelanguage.googleapis.com/v1` | Gemini 1.5 Pro, Flash |
| **Groq** | GlobalApiKey | `https://api.groq.com/openai/v1` | Fast inference for Llama, Mixtral |
| **xAI** | GlobalApiKey | `https://api.x.ai/v1` | Grok models |
| **OpenRouter** | GlobalApiKey | `https://openrouter.ai/api/v1` | Access to 200+ models |
| **Ollama** | None | `http://localhost:11434/v1` | Local models (no API key) |
| **Azure OpenAI** | PerModelDeployment | Custom | Enterprise deployments |
| **CustomOAI** | PerModelDeployment | Custom | Any OpenAI-compatible endpoint |

**Authentication Types**:

```typescript
export enum BYOKAuthType {
    /** Single API key for all models (e.g., OpenAI, Anthropic) */
    GlobalApiKey = 'GlobalApiKey',
    
    /** Separate config per model (e.g., Azure with multiple deployments) */
    PerModelDeployment = 'PerModelDeployment',
    
    /** No authentication required (e.g., local Ollama) */
    None = 'None'
}
```

### BYOK Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ BYOK SYSTEM ARCHITECTURE                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Extension Activation                                            │
│ File: byokContribution.ts                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Check isBYOKEnabled(copilotToken)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Provider Registration (if enabled)                              │
│                                                                 │
│ for each provider in [Ollama, Anthropic, Groq, ...]:           │
│   const provider = new ProviderClass(                           │
│       byokStorageService,    // Secure key storage             │
│       configurationService,  // Settings                       │
│       fetcherService         // HTTP client                    │
│   );                                                            │
│                                                                 │
│   vscode.lm.registerLanguageModelChatProvider(                 │
│       vendorName,            // e.g., "openrouter"             │
│       provider               // Implementation                  │
│   );                                                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Fetch known models from CDN
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Model Capabilities Discovery                                    │
│                                                                 │
│ GET https://main.vscode-cdn.net/extensions/copilotChat.json    │
│                                                                 │
│ Response:                                                       │
│ {                                                               │
│   "knownModels": {                                             │
│     "openai": {                                                │
│       "gpt-4o": {                                              │
│         "name": "GPT-4o",                                      │
│         "toolCalling": true,                                   │
│         "vision": true,                                        │
│         "maxInputTokens": 128000,                              │
│         "maxOutputTokens": 16384                               │
│       }                                                         │
│     },                                                          │
│     "openrouter": { ... }                                       │
│   }                                                             │
│ }                                                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ User selects model in picker
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Model Selection Flow                                            │
│                                                                 │
│ 1. User opens model picker (Cmd+Shift+P → Select Model)        │
│ 2. VS Code calls: provider.provideLanguageModelChatInformation()│
│ 3. Provider checks for API key:                                │
│    • No key? → Show "Configure API Key" option                 │
│    • Has key? → Return available models                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ If no API key
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ API Key Management                                              │
│ File: baseOpenAICompatibleProvider.ts                          │
│                                                                 │
│ async updateAPIKey(): Promise<void> {                          │
│     // Prompt user for API key                                 │
│     const key = await vscode.window.showInputBox({             │
│         prompt: "Enter your OpenRouter API key",               │
│         password: true  // Hide input                           │
│     });                                                         │
│                                                                 │
│     // Store securely                                          │
│     await this.byokStorageService.storeAPIKey(                 │
│         'openrouter',                                           │
│         key,                                                    │
│         BYOKAuthType.GlobalApiKey                              │
│     );                                                          │
│                                                                 │
│     // Refresh model list                                      │
│     await this.refreshModels();                                │
│ }                                                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ API key stored
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Secure Storage (VS Code SecretStorage)                         │
│ File: byokStorageService.ts                                    │
│                                                                 │
│ Key Format: "byok.{provider}.apiKey"                           │
│ Example: "byok.openrouter.apiKey"                              │
│                                                                 │
│ Storage Backend:                                                │
│ • macOS: Keychain                                              │
│ • Windows: Credential Manager                                  │
│ • Linux: Secret Service API (gnome-keyring)                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ User makes chat request
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Request Flow (OpenRouter Example)                              │
│                                                                 │
│ 1. User: "@workspace explain this code"                        │
│ 2. Chat widget → ChatService → ChatAgentService                │
│ 3. Extension requests model:                                   │
│    const models = await vscode.lm.selectChatModels({           │
│        vendor: 'openrouter',                                    │
│        family: 'anthropic/claude-3.5-sonnet'                   │
│    });                                                          │
│ 4. Send request:                                               │
│    const stream = await models[0].sendRequest(messages, {}, token);│
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ VS Code routes to provider
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ OpenRouter Provider Implementation                             │
│ File: openRouterProvider.ts                                    │
│                                                                 │
│ async provideLanguageModelChatResponse(                        │
│     messages: LanguageModelChatMessage[],                      │
│     options: LanguageModelChatRequestOptions,                  │
│     progress: Progress<LanguageModelChatResponsePart>,         │
│     token: CancellationToken                                   │
│ ): Promise<void> {                                             │
│     // 1. Get API key from secure storage                      │
│     const apiKey = await this.byokStorageService.getAPIKey(    │
│         'openrouter'                                            │
│     );                                                          │
│                                                                 │
│     // 2. Build OpenAI-compatible request                      │
│     const request = {                                          │
│         model: 'anthropic/claude-3.5-sonnet',                  │
│         messages: messages.map(m => ({                         │
│             role: m.role,                                      │
│             content: m.content                                 │
│         })),                                                    │
│         stream: true,                                          │
│         tools: options.tools  // Function calling              │
│     };                                                          │
│                                                                 │
│     // 3. Make HTTP request                                    │
│     const response = await fetch(                              │
│         'https://openrouter.ai/api/v1/chat/completions',       │
│         {                                                       │
│             method: 'POST',                                    │
│             headers: {                                         │
│                 'Authorization': `Bearer ${apiKey}`,           │
│                 'Content-Type': 'application/json',            │
│                 'HTTP-Referer': 'https://vscode.dev',          │
│                 'X-Title': 'VS Code Copilot'                   │
│             },                                                  │
│             body: JSON.stringify(request)                      │
│         }                                                       │
│     );                                                          │
│                                                                 │
│     // 4. Stream response chunks                               │
│     for await (const chunk of response.body) {                 │
│         const data = parseSSE(chunk);                          │
│         if (data.choices[0].delta.content) {                   │
│             progress.report(                                   │
│                 new vscode.LanguageModelTextPart(              │
│                     data.choices[0].delta.content              │
│                 )                                               │
│             );                                                  │
│         }                                                       │
│     }                                                           │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### OpenRouter Provider Deep Dive

**File: `vscode-copilot-chat/src/extension/byok/vscode-node/openRouterProvider.ts`**

OpenRouter is a **unified API gateway** to 200+ AI models from various providers. GitHub Copilot includes built-in support.

```typescript
export class OpenRouterLMProvider extends BaseOpenAICompatibleLMProvider {
    constructor(
        @IBYOKStorageService byokStorageService: IBYOKStorageService,
        @IConfigurationService configurationService: IConfigurationService,
        @IFetcherService fetcherService: IFetcherService
    ) {
        super(
            'OpenRouter',                           // Display name
            'https://openrouter.ai/api/v1',        // Base URL
            BYOKAuthType.GlobalApiKey,             // Auth type
            byokStorageService,
            configurationService,
            fetcherService
        );
    }
    
    /** Override to fetch live model list from OpenRouter API */
    protected async getAllModels(): Promise<BYOKKnownModels> {
        const apiKey = await this.byokStorageService.getAPIKey('openrouter');
        if (!apiKey) {
            return {}; // No models if not authenticated
        }
        
        // Fetch models with tool support
        const response = await this.fetcherService.fetch(
            'https://openrouter.ai/api/v1/models?supported_parameters=tools',
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );
        
        const json = await response.json();
        const models: BYOKKnownModels = {};
        
        // Parse model capabilities
        for (const model of json.data) {
            models[model.id] = {
                name: model.name,
                toolCalling: model.supported_parameters?.includes('tools'),
                vision: model.architecture?.modality?.includes('image'),
                maxInputTokens: model.context_length,
                maxOutputTokens: model.max_completion_tokens || 4096
            };
        }
        
        return models;
    }
}
```

**Key Features**:
1. **Live Model Discovery**: Fetches current model list from OpenRouter API (not static CDN)
2. **Tool Support Detection**: Filters models that support function calling
3. **Vision Detection**: Identifies multimodal models
4. **Context Length**: Uses accurate token limits for each model
5. **Unified Billing**: Single API key for all 200+ models

**Example Models Available via OpenRouter**:
- `anthropic/claude-3.5-sonnet` - Claude 3.5 Sonnet (200K context)
- `openai/gpt-4o` - GPT-4o (128K context)
- `google/gemini-pro-1.5` - Gemini 1.5 Pro (2M context)
- `meta-llama/llama-3.1-405b-instruct` - Llama 3.1 405B
- `mistralai/mixtral-8x22b-instruct` - Mixtral 8x22B

### CustomOAI Provider (LiteLLM Support)

**File: `vscode-copilot-chat/src/extension/byok/vscode-node/customOAIProvider.ts`**

The **CustomOAI provider** enables connecting to **any OpenAI-compatible endpoint**, including:
- LiteLLM proxy servers
- LocalAI
- Ollama with OpenAI compatibility mode
- Custom fine-tuned models
- Self-hosted inference servers

**Configuration** (settings.json):
```json
{
  "github.copilot.chat.customOAIModels": {
    "litellm-claude": {
      "name": "LiteLLM Claude",
      "url": "http://localhost:4000/v1/chat/completions",
      "toolCalling": true,
      "vision": false,
      "maxInputTokens": 100000,
      "maxOutputTokens": 8192,
      "requiresAPIKey": true,
      "requestHeaders": {
        "X-Custom-Header": "value"
      }
    },
    "local-llama": {
      "name": "Local Llama 3.1",
      "url": "http://localhost:8080/v1/chat/completions",
      "toolCalling": true,
      "vision": false,
      "maxInputTokens": 32000,
      "maxOutputTokens": 4096,
      "requiresAPIKey": false
    }
  }
}
```

**Implementation**:
```typescript
export class CustomOAIBYOKModelProvider implements BYOKModelProvider {
    private _models: Map<string, CustomOAIModelConfig> = new Map();
    
    constructor(
        @IBYOKStorageService private byokStorageService: IBYOKStorageService,
        @IConfigurationService private configurationService: IConfigurationService
    ) {
        // Load models from settings
        this.loadModelsFromConfig();
        
        // Watch for config changes
        configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(ConfigKey.CustomOAIModels)) {
                this.loadModelsFromConfig();
            }
        });
    }
    
    async provideLanguageModelChatInformation(): Promise<LanguageModelChatInformation[]> {
        const models: LanguageModelChatInformation[] = [];
        
        for (const [modelId, config] of this._models) {
            // Check API key if required
            if (config.requiresAPIKey) {
                const apiKey = await this.byokStorageService.getAPIKey(
                    'customoai',
                    modelId  // Per-model API key
                );
                if (!apiKey) {
                    continue; // Skip models without API key
                }
            }
            
            models.push({
                id: modelId,
                name: config.name,
                family: 'custom',
                maxInputTokens: config.maxInputTokens,
                maxOutputTokens: config.maxOutputTokens,
                capabilities: {
                    toolCalling: config.toolCalling,
                    vision: config.vision
                }
            });
        }
        
        return models;
    }
    
    async provideLanguageModelChatResponse(
        messages: LanguageModelChatMessage[],
        options: LanguageModelChatRequestOptions,
        progress: Progress<LanguageModelChatResponsePart>,
        token: CancellationToken
    ): Promise<void> {
        const modelId = options.model.id;
        const config = this._models.get(modelId);
        
        // Get API key if required
        let apiKey: string | undefined;
        if (config.requiresAPIKey) {
            apiKey = await this.byokStorageService.getAPIKey('customoai', modelId);
        }
        
        // Build request
        const request = {
            model: modelId,  // Pass through to backend
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            })),
            stream: true,
            tools: options.tools
        };
        
        // Resolve URL (handle version patterns)
        const url = this.resolveCustomOAIUrl(config.url);
        
        // Build headers
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...config.requestHeaders  // Custom headers
        };
        
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        
        // Make request
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(request)
        });
        
        // Stream response (same as OpenRouter)
        for await (const chunk of response.body) {
            const data = parseSSE(chunk);
            if (data.choices[0].delta.content) {
                progress.report(
                    new vscode.LanguageModelTextPart(
                        data.choices[0].delta.content
                    )
                );
            }
        }
    }
    
    /** Resolve URL patterns like {v}/chat/completions → /v1/chat/completions */
    private resolveCustomOAIUrl(url: string): string {
        // Replace version placeholder
        url = url.replace('{v}', 'v1');
        
        // Add default path if base URL only
        if (!url.includes('/chat/completions')) {
            url = url.replace(/\/$/, '') + '/v1/chat/completions';
        }
        
        return url;
    }
}
```

**LiteLLM Integration Example**:

1. **Start LiteLLM proxy**:
```bash
# Install
pip install litellm[proxy]

# Configure config.yaml
cat > config.yaml <<EOF
model_list:
  - model_name: claude-3.5-sonnet
    litellm_params:
      model: anthropic/claude-3.5-sonnet
      api_key: sk-ant-...
      
  - model_name: gpt-4o
    litellm_params:
      model: gpt-4o
      api_key: sk-...
EOF

# Start proxy
litellm --config config.yaml --port 4000
```

2. **Configure VS Code**:
```json
{
  "github.copilot.chat.customOAIModels": {
    "litellm-claude": {
      "name": "Claude via LiteLLM",
      "url": "http://localhost:4000/v1/chat/completions",
      "toolCalling": true,
      "vision": false,
      "maxInputTokens": 200000,
      "maxOutputTokens": 8192,
      "requiresAPIKey": false  // LiteLLM handles auth
    },
    "litellm-gpt4": {
      "name": "GPT-4o via LiteLLM",
      "url": "http://localhost:4000/v1/chat/completions",
      "toolCalling": true,
      "vision": true,
      "maxInputTokens": 128000,
      "maxOutputTokens": 16384,
      "requiresAPIKey": false
    }
  }
}
```

3. **Use in Chat**:
- Open model picker (Cmd+Shift+P → "Select Model")
- Select "Claude via LiteLLM"
- Chat normally - requests go through LiteLLM proxy

### BYOK vs Marketplace Extensions

**Built-in BYOK Providers** (Recommended):
- ✅ No installation required
- ✅ Maintained by GitHub
- ✅ Consistent UX
- ✅ Secure credential storage
- ✅ Covers 90% of use cases

**Marketplace Extensions** (When Needed):
- Custom authentication flows (OAuth, SSO)
- Provider-specific features (embeddings, fine-tuning)
- Unsupported providers (Cohere, AI21, etc.)
- Custom UI/UX requirements

**Available Marketplace Extensions**:
| Extension | Provider | Installs | Rating |
|-----------|----------|----------|--------|
| `johnny-zhao.oai-compatible-copilot` | OpenAI-compatible | 3,190 | ⭐⭐⭐⭐⭐ |
| `khaled.vscode-openrouter-extension` | OpenRouter | 7,443 | N/A |
| `vivswan.litellm-vscode-chat` | LiteLLM | 36 | N/A |
| `huggingface.huggingface-vscode-chat` | Hugging Face | 7,012 | ⭐⭐⭐⭐⭐ |
| `arifum.bedrock-vscode-chat` | AWS Bedrock | 193 | N/A |

**Recommendation for most users**: Use built-in BYOK providers. They support OpenRouter (200+ models) and CustomOAI (LiteLLM integration) without installing anything.

### BYOK Security Best Practices

1. **Secure Credential Storage**: Use VS Code's `SecretStorage` API (backed by OS keychain/credential manager)
2. **API Key Rotation**: Implement token refresh logic similar to Copilot Token manager
3. **Scope Minimization**: Request minimum permissions needed
4. **Secure Transport**: Always use HTTPS for API endpoints
5. **Rate Limiting**: Respect provider rate limits to avoid suspension
6. **Audit Logging**: Log API usage for compliance and troubleshooting

---


### BYOK Security Best Practices

1. **API Key Storage**:
   - ✅ Use `SecretStorage` API (OS-level encryption)
   - ❌ Never store in settings.json or plaintext files
   - ✅ Prompt with `password: true` to hide input

2. **Key Rotation**:
   - Provide "Update API Key" command
   - Clear key on signout/uninstall
   - Support environment variable injection

3. **Quota Monitoring**:
   - Track usage per provider
   - Warn users before hitting limits
   - Cache responses when possible

4. **Request Validation**:
   - Sanitize user input
   - Respect model token limits
   - Handle rate limiting gracefully

5. **Error Handling**:
   - Don't expose API keys in error messages
   - Log requests without sensitive data
   - Provide clear error messages for auth failures

---

