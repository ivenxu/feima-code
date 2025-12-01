### 2. Chat Participant API (@workspace, @copilot, etc.)

#### End-to-End Interaction Flow (vscode-copilot-chat Example)

This diagram shows the complete request lifecycle when a user asks `@workspace explain this function` in VS Code's chat panel.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ USER ACTION                                                                  │
│ Types in chat: "@workspace explain how authentication works"                │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VS CODE CORE - Chat Widget (Main Thread)                                    │
│ File: src/vs/workbench/contrib/chat/browser/chatWidget.ts                   │
│                                                                              │
│ 1. Parse user input:                                                        │
│    • Participant: "@workspace"                                              │
│    • Command: (none)                                                        │
│    • Prompt: "explain how authentication works"                             │
│    • Variables: (auto-detected from #references)                            │
│                                                                              │
│ 2. Create ChatRequest object with:                                          │
│    • prompt: "explain how authentication works"                             │
│    • location: ChatLocation.Panel                                           │
│    • model: (user-selected model, e.g., GPT-4)                              │
│    • references: []                                                          │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ chatService.sendRequest()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VS CODE CORE - ChatService (Main Thread)                                    │
│ File: src/vs/workbench/contrib/chat/common/chatService.ts                   │
│                                                                              │
│ 1. Look up participant by ID: "github.copilot.workspace"                    │
│ 2. Gather conversation history from ChatModel                               │
│ 3. Create ChatContext with history                                          │
│ 4. Validate permissions                                                     │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ chatAgentService.invokeAgent()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VS CODE CORE - ChatAgentService (Main Thread)                               │
│ File: src/vs/workbench/contrib/chat/common/chatAgents.ts                    │
│                                                                              │
│ 1. Find registered participant by ID                                        │
│ 2. Get participant's request handler                                        │
│ 3. Create progress tracker for streaming                                    │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ RPC: Call extension host (IPC boundary)
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ EXTENSION HOST - ExtHostChatAgents                                          │
│ File: src/vs/workbench/api/common/extHostChatAgents.ts                      │
│                                                                              │
│ 1. Receive request from main thread                                         │
│ 2. Find handler by participant ID                                           │
│ 3. Create API objects (ChatRequest, ChatResponseStream)                     │
│ 4. Bridge progress callbacks across IPC                                     │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ handler(request, context, stream, token)
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - ChatAgents.getChatParticipantHandler()                │
│ File: src/extension/conversation/vscode-node/chatParticipants.ts            │
│ Layer 1: Registration & Routing                                             │
│                                                                              │
│ 1. Check privacy confirmation (for 3rd party models)                        │
│    • If needed, show confirmation UI and return                             │
│                                                                              │
│ 2. Check quota status                                                       │
│    • If quota exhausted, auto-switch to base model                          │
│    • Show warning message to user                                           │
│                                                                              │
│ 3. Signal interaction started (telemetry)                                   │
│                                                                              │
│ 4. Resolve intent ID:                                                       │
│    • Default for @workspace: Intent.Workspace                               │
│    • Check if slash command specified                                       │
│    • Map command to intent if present                                       │
│                                                                              │
│ 5. Create ChatParticipantRequestHandler                                     │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ new ChatParticipantRequestHandler()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - ChatParticipantRequestHandler.constructor()           │
│ File: src/extension/prompt/node/chatParticipantRequestHandler.ts            │
│ Layer 2: Intent Selection & Context                                         │
│                                                                              │
│ Constructor Phase:                                                           │
│ 1. Parse location (panel, editor, terminal, notebook)                       │
│                                                                              │
│ 2. Reconstruct Conversation from VS Code history:                           │
│    • Convert ChatRequestTurn[] → Turn[]                                     │
│    • Restore previous prompts, responses, metadata                          │
│    • Extract session ID from previous turns                                 │
│                                                                              │
│ 3. Infer document context (for inline chat):                                │
│    • Active file URI                                                        │
│    • Current selection range                                                │
│    • Language ID                                                            │
│                                                                              │
│ 4. Initialize telemetry tracking:                                           │
│    • Session ID                                                             │
│    • Message ID                                                             │
│    • Timing info                                                            │
│                                                                              │
│ 5. Create Turn for this request                                             │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ handler.getResult()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - ChatParticipantRequestHandler.getResult()             │
│ Layer 2: Intent Selection & Context (continued)                             │
│                                                                              │
│ 1. Check permissive auth requirement:                                       │
│    • Using workspace tool (@workspace or codebase tool)?                    │
│    • User has full repo access?                                             │
│    • If not, show auth upgrade confirmation                                 │
│                                                                              │
│ 2. Sanitize variables:                                                      │
│    • Check each reference against .copilotignore                            │
│    • Check against .gitignore                                               │
│    • Remove ignored files from references                                   │
│    • Also sanitize user message (remove file paths)                         │
│                                                                              │
│ 3. Get command details:                                                     │
│    • Look up command by intentId                                            │
│    • Validate command usage (check if args required)                        │
│                                                                              │
│ 4. Select Intent:                                                           │
│    • If command specified → use command.intent                              │
│    • If inline chat (editor) → use heuristics:                              │
│      - Empty line + cursor → Intent.Generate                                │
│      - Multi-line selection → Intent.Edit                                   │
│    • Else → Intent.Unknown (will detect from prompt)                        │
│                                                                              │
│ 5. Check if intent has custom handler:                                      │
│    • intent.handleRequest() exists? → Call it directly                      │
│    • Else → Create DefaultIntentRequestHandler                              │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ new DefaultIntentRequestHandler()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - DefaultIntentRequestHandler.constructor()             │
│ File: src/extension/prompt/node/defaultIntentRequestHandler.ts              │
│ Layer 3: Intent Execution                                                   │
│                                                                              │
│ Constructor:                                                                 │
│ • Store intent, conversation, request, stream, token                        │
│ • Store document context, location, telemetry builder                       │
│ • Get latest Turn from conversation                                         │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ handler.getResult()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - DefaultIntentRequestHandler.getResult()               │
│ Layer 3: Intent Execution (continued)                                       │
│                                                                              │
│ 1. Check for tool call limit cancellation                                   │
│                                                                              │
│ 2. Invoke Intent:                                                           │
│    intent.invoke({ location, documentContext, request })                    │
│    → Returns IIntentInvocation with:                                        │
│       • buildPrompt() function                                              │
│       • getAvailableTools() function                                        │
│       • endpoint configuration                                              │
│       • response processing config                                          │
│                                                                              │
│ 3. Store intent invocation metadata in turn                                 │
│                                                                              │
│ 4. Handle confirmations (if needed for destructive actions)                 │
│                                                                              │
│ 5. Run tool calling loop:                                                   │
│    → Delegates to DefaultToolCallingLoop                                    │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ runWithToolCalling()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - DefaultToolCallingLoop                                │
│ Layer 3: Agent Execution Loop                                               │
│                                                                              │
│ Initialization:                                                              │
│ • Create response stream participants (linkify, telemetry, etc.)            │
│ • Wire up event handlers (onDidBuildPrompt, onDidReceiveResponse)           │
│ • Create pause controller                                                   │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────┐            │
│ │ LOOP: Until done or max iterations (15)                      │            │
│ │                                                               │            │
│ │ Iteration N:                                                  │            │
│ │                                                               │            │
│ │ 1. BUILD PROMPT                                               │            │
│ │    • Call intentInvocation.buildPrompt()                     │            │
│ │    • Uses @vscode/prompt-tsx to render:                      │            │
│ │      - System message (intent-specific)                      │            │
│ │      - Conversation history                                  │            │
│ │      - Context (files, diagnostics, symbols)                 │            │
│ │      - Tool definitions (file_search, read_file, etc.)       │            │
│ │      - User message                                          │            │
│ │    • Count tokens, respect context window limits             │            │
│ │    • Fire onDidBuildPrompt event                             │            │
│ │                                                               │            │
│ │ 2. SEND TO LANGUAGE MODEL                                     │            │
│ │    • Get endpoint (Azure/GitHub/Anthropic)                   │            │
│ │    • Authenticate                                            │            │
│ │    • POST request with streaming                             │            │
│ │                                                               │            │
│ │ 3. PROCESS STREAMING RESPONSE                                 │            │
│ │    • Parse SSE (Server-Sent Events)                          │            │
│ │    • Extract chunks:                                         │            │
│ │      - Text: stream.markdown()                               │            │
│ │      - Tool calls: extract name, arguments                   │            │
│ │      - Citations: stream.reference()                         │            │
│ │    • Apply response stream participants:                     │            │
│ │      - Linkification (convert URLs/paths to links)           │            │
│ │      - Code block tracking                                   │            │
│ │      - Edit survival tracking (inline chat)                  │            │
│ │      - Telemetry collection                                  │            │
│ │    • Fire onDidReceiveResponse event                         │            │
│ │                                                               │            │
│ │ 4. EXECUTE TOOLS (if any tool calls)                         │            │
│ │    For each tool call:                                       │            │
│ │    • stream.prepareToolInvocation(toolName)                  │            │
│ │    • Execute tool:                                           │            │
│ │      - file_search: Search codebase                          │            │
│ │      - read_file: Read file contents                         │            │
│ │      - run_command: Execute shell command                    │            │
│ │      - etc.                                                  │            │
│ │    • Collect results                                         │            │
│ │    • Add results to conversation as ToolResultMessage        │            │
│ │                                                               │            │
│ │ 5. CHECK TERMINATION                                          │            │
│ │    Stop if:                                                  │            │
│ │    • No tool calls in response (final answer)                │            │
│ │    • Hit max iterations (15)                                 │            │
│ │    • User cancelled (token.isCancellationRequested)          │            │
│ │    • User paused interaction                                 │            │
│ │                                                               │            │
│ │    Continue if:                                              │            │
│ │    • Model made tool calls → Loop with results               │            │
│ │                                                               │            │
│ └──────────────────────────────────────────────────────────────┘            │
│                                                                              │
│ After Loop Completes:                                                        │
│ • Collect all tool call rounds                                              │
│ • Send tool calling telemetry                                               │
│ • Return result with metadata                                               │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ Return to DefaultIntentRequestHandler
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - DefaultIntentRequestHandler.getResult()               │
│                                                                              │
│ 6. Process Result:                                                          │
│    • Check response type (success, error, filtered, quota, etc.)            │
│    • Handle each case:                                                      │
│      - Success: Set turn status, send telemetry                             │
│      - OffTopic: Show rejection message                                     │
│      - QuotaExceeded: Show quota error with upgrade link                    │
│      - RateLimited: Show rate limit error with retry time                   │
│      - Filtered: Content filter triggered                                   │
│      - NetworkError: Connection issue                                       │
│      - etc.                                                                 │
│                                                                              │
│ 7. Update Turn:                                                             │
│    • Set response text                                                      │
│    • Set status (Success, Error, Cancelled, etc.)                           │
│    • Attach metadata (tool calls, token counts, etc.)                       │
│                                                                              │
│ 8. Show warnings:                                                           │
│    • If files were ignored: show message                                    │
│                                                                              │
│ 9. Return ChatResult                                                        │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ Return to ChatParticipantRequestHandler
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - ChatParticipantRequestHandler.getResult()             │
│                                                                              │
│ 6. Add endpoint information:                                                │
│    • result.details = "Claude 3.5 Sonnet • 3x"                              │
│                                                                              │
│ 7. Store conversation:                                                      │
│    • conversationStore.addConversation(turnId, conversation)                │
│    • Allows retrieval in future requests                                    │
│                                                                              │
│ 8. Add metadata:                                                            │
│    • modelMessageId                                                         │
│    • responseId                                                             │
│    • sessionId                                                              │
│    • agentId: "github.copilot.workspace"                                    │
│    • command: undefined                                                     │
│                                                                              │
│ 9. Return ICopilotChatResult                                                │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ Return to getChatParticipantHandler()
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VSCODE-COPILOT-CHAT - ChatAgents.getChatParticipantHandler()                │
│                                                                              │
│ Return vscode.ChatResult to VS Code                                         │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             │ RPC: Return to main thread (IPC boundary)
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ EXTENSION HOST - ExtHostChatAgents                                          │
│                                                                              │
│ • Convert ChatResult to wire format                                         │
│ • Send back to main thread                                                  │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VS CODE CORE - ChatAgentService                                             │
│                                                                              │
│ • Receive result from extension host                                        │
│ • Update ChatModel with response                                            │
│ • Store in conversation history                                             │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VS CODE CORE - ChatService                                                  │
│                                                                              │
│ • Update session state                                                      │
│ • Fire events (onDidPerformUserAction, etc.)                                │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VS CODE CORE - Chat Widget                                                  │
│                                                                              │
│ • Render final response in UI                                               │
│ • Show follow-up suggestions                                                │
│ • Enable thumbs up/down feedback                                            │
│ • Show "Regenerate" button                                                  │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ USER SEES RESPONSE                                                           │
│                                                                              │
│ Chat Panel shows:                                                            │
│ ┌────────────────────────────────────────────────────────────┐              │
│ │ @workspace                                              ⭐ 👎             │
│ │                                                                            │
│ │ The authentication system in this codebase uses JWT     │              │
│ │ tokens with OAuth 2.0. Here's how it works:             │              │
│ │                                                          │              │
│ │ [View auth.ts] [View middleware.ts]                     │              │
│ │                                                          │              │
│ │ Used tools:                                             │              │
│ │ • file_search - Searched for authentication files       │              │
│ │ • read_file - Read auth.ts, middleware.ts              │              │
│ └────────────────────────────────────────────────────────────┘              │
│                                                                              │
│ Follow-up suggestions:                                                       │
│ • "Show me how to add a new authentication method"                          │
│ • "Explain the token refresh mechanism"                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key Observations:**

1. **IPC Boundaries**: Request crosses from main thread → extension host → back to main thread multiple times for streaming

2. **Three-Layer Processing in Extension**:
   - Layer 1 (ChatAgents): Routing, quota, privacy
   - Layer 2 (ChatParticipantRequestHandler): Intent selection, context, sanitization
   - Layer 3 (DefaultIntentRequestHandler): Intent execution, tool calling, response processing

3. **Streaming**: Every `stream.markdown()` call flows back through all layers immediately - user sees real-time updates

4. **Tool Calling Loop**: Can iterate up to 15 times, each time:
   - Builds new prompt with tool results
   - Calls LLM again
   - Processes new response
   - Executes any new tool calls

5. **Context Window Management**: Prompt builder respects token limits, truncates conversation history if needed

6. **Error Handling**: 24+ error types handled at various layers with user-friendly messages

7. **Telemetry**: Tracked at every layer for product insights and A/B testing

8. **Conversation Persistence**: Full conversation stored and reconstructed on every request (VS Code doesn't maintain it)

---

#### Overview

The Chat Participant API allows extensions to create specialized AI assistants that appear in VS Code's native chat interface. When users type `@participantName`, your custom handler processes the request.

**Purpose:**
Chat participants are the primary way to create conversational AI features in VS Code. Unlike the Language Model Provider API (which provides the AI models), chat participants use those models to implement specific workflows and capabilities.

**Key Differences from Language Model Provider API:**

| Language Model Provider API | Chat Participant API |
|---------------------------|---------------------|
| Provides AI models | Uses AI models |
| Low-level: handles API calls | High-level: implements features |
| Example: GitHub Copilot extension | Example: @workspace, @terminal, @vscode |
| One per model vendor | Many per extension |
| Registered via `vscode.lm.registerChatModelProvider()` | Registered via `vscode.chat.createChatParticipant()` |

**Built-in Participants in VS Code:**
- `@workspace`: Answers questions about your codebase
- `@vscode`: Helps with VS Code features and settings
- `@terminal`: Assists with shell commands

**Use Cases:**

1. **Domain-Specific Assistants**: 
   - `@database`: SQL query helper
   - `@api`: REST API design assistant
   - `@security`: Code security scanner

2. **Workflow Automation**:
   - `@test`: Generates and runs tests
   - `@docs`: Creates documentation
   - `@refactor`: Code improvement suggestions

3. **Tool Integration**:
   - `@jira`: Manages issues
   - `@github`: PR reviews and repo management
   - `@docker`: Container management

4. **Learning & Education**:
   - `@tutor`: Interactive coding lessons
   - `@explain`: Detailed code explanations

**How It Works:**
1. User types `@yourParticipant explain this function` in chat
2. VS Code parses the message and routes to your handler
3. Your handler receives the request with context (selected code, workspace info, etc.)
4. You use `request.model.sendRequest()` to call any available language model
5. Stream responses back via the `ChatResponseStream` interface
6. VS Code renders the response with markdown, code blocks, buttons, etc.

#### Key Interfaces

**vscode.proposed.chatParticipantAdditions.d.ts:**

These interfaces define how chat participants interact with VS Code's chat system.

```typescript
/**
 * Represents a user's chat request to a participant.
 * Contains the prompt, selected model, context, and metadata.
 */
export interface ChatRequest {
    /**
     * Slash command used (e.g., /fix, /explain, /tests).
     * undefined if no command was specified.
     */
    readonly command: string | undefined;
    
    /**
     * The user's message after removing participant name and command.
     * Example: If user types "@workspace /explain how auth works"
     *          prompt = "how auth works"
     */
    readonly prompt: string;
    
    /**
     * Files, symbols, or URIs that user explicitly referenced with #.
     * Example: "@workspace explain #file:auth.ts #symbol:login"
     */
    readonly references: readonly ChatPromptReference[];
    
    /**
     * Where the chat was invoked: 'panel' (chat view) or 'editor' (inline)
     */
    readonly location: ChatLocation;
    
    /**
     * Retry count if user clicked "regenerate response" (starts at 0)
     */
    readonly attempt: number;
    
    /**
     * If true, VS Code will detect /commands automatically in the prompt
     */
    readonly enableCommandDetection: boolean;
    
    /**
     * The language model selected by the user (e.g., GPT-4, Claude 3.5).
     * Use model.sendRequest() to interact with this model.
     */
    readonly model: LanguageModelChat;
    
    // Private additions (chatParticipantPrivate) - not in stable API
    readonly id: string;              // Unique request ID
    readonly sessionId: string;       // Chat session ID (persists across requests)
    readonly locationData?: ChatLocationData;  // Detailed editor context
}

/**
 * Represents a registered chat participant.
 * Return this from vscode.chat.createChatParticipant() and configure its properties.
 */
export interface ChatParticipant {
    /**
     * Icon shown next to participant name in chat UI.
     * Can be a file URI, theme icon (e.g., $(robot)), or light/dark variants.
     */
    iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon;
    
    /**
     * Your main handler function - called when user sends a message to your participant.
     * This is where all the logic lives.
     */
    requestHandler: ChatRequestHandler;
    
    /**
     * Optional: Provide follow-up questions after each response.
     * Example: After explaining code, suggest "Would you like to see tests for this?"
     */
    followupProvider?: ChatFollowupProvider;
    
    /**
     * Event fired when user clicks thumbs up/down on your response.
     * Use for analytics and model improvement.
     */
    onDidReceiveFeedback: Event<ChatResultFeedback>;
}

/**
 * Your main request handler function.
 * This is called whenever a user sends a message to your participant.
 * 
 * @param request - The user's request with prompt, references, model selection
 * @param context - Conversation history and previous responses
 * @param response - Stream interface to send responses back to UI
 * @param token - Cancellation token (user can cancel long requests)
 * @returns Optional ChatResult with metadata (error info, model used, etc.)
 */
export type ChatRequestHandler = (
    request: ChatRequest,
    context: ChatContext,
    response: ChatResponseStream,
    token: CancellationToken
) => ProviderResult<ChatResult>;

/**
 * Interface for streaming responses back to the chat UI.
 * All methods update the UI immediately - users see responses in real-time.
 */
export interface ChatResponseStream {
    /**
     * Append markdown content to the response.
     * Supports full markdown syntax: bold, italic, code blocks, lists, tables, etc.
     * 
     * Example:
     *   stream.markdown('Here is the **solution**:\n```typescript\nconst x = 42;\n```');
     */
    markdown(value: string | MarkdownString): void;
    
    /**
     * Add a clickable link to a file or location.
     * Clicking opens the file/location in the editor.
     * 
     * Example:
     *   stream.anchor(vscode.Uri.file('/path/to/file.ts'), 'View implementation');
     */
    anchor(value: Uri | Location, title?: string): void;
    
    /**
     * Add an interactive button that executes a command when clicked.
     * 
     * Example:
     *   stream.button({
     *     title: 'Run Tests',
     *     command: 'workbench.action.tasks.runTask',
     *     arguments: ['npm test']
     *   });
     */
    button(command: Command): void;
    
    /**
     * Show a progress message above the response.
     * Useful for long-running operations: "Analyzing codebase...", "Running tests..."
     * 
     * Example:
     *   stream.progress('Searching workspace for similar code...');
     */
    progress(value: string): void;
    
    /**
     * Add a reference to a file or symbol that was used to generate the response.
     * Appears as a collapsible "References" section.
     * 
     * Example:
     *   stream.reference(vscode.Uri.file('/src/auth.ts'));
     */
    reference(value: Uri | Location): void;
    
    /**
     * Low-level method to push any ChatResponsePart.
     * Prefer specific methods above for better type safety.
     */
    push(part: ChatResponsePart): void;
    
    // Advanced features (chatParticipantAdditions)
    
    /**
     * Indicate that you're about to invoke a tool/function.
     * Shows "Using tool: <toolName>" in the UI.
     */
    prepareToolInvocation(toolName: string): void;
    
    /**
     * Attribute code snippets to their source (for AI-generated code).
     * Shows license info and original source.
     */
    codeCitation(value: Uri, license: string, snippet: string): void;
}

export namespace chat {
    export function createChatParticipant(
        id: string,
        handler: ChatRequestHandler
    ): ChatParticipant;
}
```

#### Real-World Implementation (from vscode-copilot-chat)

**Important**: GitHub Copilot does NOT use a simple handler function like the basic samples. Instead, it implements a **sophisticated three-layer architecture** with clear separation of concerns:

```
┌────────────────────────────────────────────────────────────────┐
│  Layer 1: ChatAgents - Participant Registration & Routing     │
│  File: src/extension/conversation/vscode-node/chatParticipants.ts
│  • Registers all participants (@copilot, @workspace, etc.)    │
│  • Routes requests to ChatParticipantRequestHandler           │
│  • Manages participant lifecycle and configuration            │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼ Creates handler for each request
┌────────────────────────────────────────────────────────────────┐
│  Layer 2: ChatParticipantRequestHandler - Intent Selection    │
│  File: src/extension/prompt/node/chatParticipantRequestHandler.ts
│  • Detects user intent (explain, fix, generate, etc.)         │
│  • Manages conversation history & context                     │
│  • Handles variable sanitization (respects .gitignore)        │
│  • Creates Intent objects and invokes them                    │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼ Delegates to intent-specific handler
┌────────────────────────────────────────────────────────────────┐
│  Layer 3: DefaultIntentRequestHandler - Intent Execution      │
│  File: src/extension/prompt/node/defaultIntentRequestHandler.ts
│  • Invokes specific intent (IIntent.invoke())                 │
│  • Builds prompt with context via @vscode/prompt-tsx          │
│  • Manages tool calling loops (agent mode)                    │
│  • Processes streaming responses                              │
│  • Handles errors and telemetry                               │
└────────────────────────────────────────────────────────────────┘
```

**Why This Architecture?**

GitHub Copilot handles complex scenarios that simple handlers can't:
1. **Multiple Participants**: @copilot, @workspace, @vscode, @terminal, @github
2. **Intent Detection**: Automatically detect if user wants to explain, fix, generate, or refactor code
3. **Tool Calling (Agent Mode)**: Multi-step reasoning with function calling (read files, run commands, etc.)
4. **Context Management**: Smart context gathering from workspace, editor selections, diagnostics
5. **Prompt Engineering**: Complex prompt construction with conversation history, system messages, and tool definitions
6. **Error Handling**: Graceful handling of rate limits, quota exhaustion, content filtering

---

#### Layer 1: ChatAgents - Participant Registration

**File: `src/extension/conversation/vscode-node/chatParticipants.ts`**

This class orchestrates the registration of all chat participants and routes requests to the appropriate handler.

**Responsibilities:**
- Creates and configures multiple participants (@copilot, @workspace, @vscode, etc.)
- Sets participant properties (icon, description, welcome message, etc.)
- Provides the bridge between VS Code's participant API and Copilot's intent system
- Handles authentication state changes and quota management

**Key Patterns:**
1. **Dependency Injection**: Uses `IInstantiationService` to create handlers with proper services
2. **Agent Factory**: `createAgent()` method encapsulates common participant creation logic
3. **Intent Mapping**: Maps each participant to a default intent (Intent.Unknown, Intent.Workspace, etc.)
4. **Dynamic Configuration**: Adjusts participant behavior based on user auth state and quota

```typescript
/**
 * Service that manages registration of all chat participants.
 * Instantiated once per extension activation.
 */
export class ChatAgentService implements IChatAgentService {
    private _lastChatAgents: ChatAgents | undefined;

    constructor(
        @IInstantiationService private readonly instantiationService: IInstantiationService,
    ) { }

    /**
     * Register all participants and return a disposable to clean up.
     * Called from extension activation.
     */
    register(): IDisposable {
        const chatAgents = this.instantiationService.createInstance(ChatAgents);
        chatAgents.register();
        this._lastChatAgents = chatAgents;
        return {
            dispose: () => {
                chatAgents.dispose();
                this._lastChatAgents = undefined;
            }
        };
    }
}

/**
 * Internal class that registers all the individual participants.
 */
class ChatAgents implements IDisposable {
    private readonly _disposables = new DisposableStore();

    constructor(
        @IOctoKitService private readonly octoKitService: IOctoKitService,
        @IAuthenticationService private readonly authenticationService: IAuthenticationService,
        @IInstantiationService private readonly instantiationService: IInstantiationService,
        @IUserFeedbackService private readonly userFeedbackService: IUserFeedbackService,
        @IEndpointProvider private readonly endpointProvider: IEndpointProvider,
        @IFeedbackReporter private readonly feedbackReporter: IFeedbackReporter,
        @IInteractionService private readonly interactionService: IInteractionService,
        @IChatQuotaService private readonly _chatQuotaService: IChatQuotaService,
        @IConfigurationService private readonly configurationService: IConfigurationService,
    ) { }

    dispose() {
        this._disposables.dispose();
    }

    /**
     * Register all chat participants.
     * Each participant gets its own icon, intent, and configuration.
     */
    register(): void {
        this.additionalWelcomeMessage = this.instantiationService.invokeFunction(getAdditionalWelcomeMessage);
        this._disposables.add(this.registerDefaultAgent());        // @copilot
        this._disposables.add(this.registerEditingAgent());        // Inline chat
        this._disposables.add(this.registerEditingAgent2());       // Agent mode
        this._disposables.add(this.registerEditingAgentEditor()); // Editor inline
        this._disposables.add(this.registerEditsAgent());          // @edits
        this._disposables.add(this.registerEditorDefaultAgent()); // Editor context
        this._disposables.add(this.registerNotebookEditorDefaultAgent()); // Notebook
        this._disposables.add(this.registerNotebookDefaultAgent());
        this._disposables.add(this.registerWorkspaceAgent());      // @workspace
        this._disposables.add(this.registerVSCodeAgent());         // @vscode
        this._disposables.add(this.registerTerminalAgent());       // @terminal
        this._disposables.add(this.registerTerminalPanelAgent());
    }

    /**
     * Factory method to create a participant with common configuration.
     * 
     * @param name - Participant name (e.g., 'copilot', 'workspace')
     * @param defaultIntentIdOrGetter - Intent to use when no command is specified
     * @param options - Additional configuration (custom ID, etc.)
     */
    private createAgent(
        name: string, 
        defaultIntentIdOrGetter: IntentOrGetter, 
        options?: { id?: string }
    ): vscode.ChatParticipant {
        const id = options?.id || getChatParticipantIdFromName(name);
        const onRequestPaused = new Relay<vscode.ChatParticipantPauseStateEvent>();
        
        // Create participant with handler
        const agent = vscode.chat.createChatParticipant(
            id, 
            this.getChatParticipantHandler(id, name, defaultIntentIdOrGetter, onRequestPaused.event)
        );
        
        // Wire up feedback events
        agent.onDidReceiveFeedback(e => {
            this.userFeedbackService.handleFeedback(e, id);
        });
        agent.onDidPerformAction(e => {
            this.userFeedbackService.handleUserAction(e, id);
        });
        
        // Support pause/resume
        if (agent.onDidChangePauseState) {
            onRequestPaused.input = agent.onDidChangePauseState;
        }
        
        return agent;
    }

    /**
     * Register the default @copilot participant.
     * This is the main conversational AI assistant.
     */
    private registerDefaultAgent(): IDisposable {
        // Dynamic intent selection based on experiment
        const intentGetter = (request: vscode.ChatRequest) => {
            if (this.configurationService.getExperimentBasedConfig(
                ConfigKey.TeamInternal.AskAgent, 
                this.experimentationService
            ) && request.model.capabilities.supportsToolCalling) {
                return Intent.AskAgent; // Use agent mode with tool calling
            }
            return Intent.Unknown; // Use standard chat mode
        };
        
        const defaultAgent = this.createAgent(defaultAgentName, intentGetter);
        defaultAgent.iconPath = new vscode.ThemeIcon('copilot');
        
        // Set up GitHub avatar as requester icon
        this.initDefaultAgentRequestorProps(defaultAgent);
        
        // Configure help text
        defaultAgent.helpTextPrefix = vscode.l10n.t(
            'You can ask me general programming questions, or chat with the following participants...'
        );
        
        // Add welcome message, title provider, and summarizer
        defaultAgent.additionalWelcomeMessage = this.additionalWelcomeMessage;
        defaultAgent.titleProvider = this.instantiationService.createInstance(ChatTitleProvider);
        defaultAgent.summarizer = this.instantiationService.createInstance(ChatSummarizerProvider);
        
        return defaultAgent;
    }

    /**
     * Register @workspace participant for codebase questions.
     */
    private registerWorkspaceAgent(): IDisposable {
        const workspaceAgent = this.createAgent(workspaceAgentName, Intent.Workspace);
        workspaceAgent.iconPath = new vscode.ThemeIcon('code');
        return workspaceAgent;
    }

    /**
     * Register @vscode participant for editor help.
     */
    private registerVSCodeAgent(): IDisposable {
        const useInsidersIcon = vscode.env.appName.includes('Insiders');
        const vscodeAgent = this.createAgent(vscodeAgentName, Intent.VSCode);
        vscodeAgent.iconPath = useInsidersIcon 
            ? new vscode.ThemeIcon('vscode-insiders') 
            : new vscode.ThemeIcon('vscode');
        return vscodeAgent;
    }

    /**
     * Register @terminal participant for shell assistance.
     */
    private registerTerminalAgent(): IDisposable {
        const terminalAgent = this.createAgent(terminalAgentName, Intent.Terminal);
        terminalAgent.iconPath = new vscode.ThemeIcon('terminal');
        return terminalAgent;
    }

    /**
     * Creates the actual handler function for a participant.
     * This is called by VS Code every time a user sends a message.
     * 
     * Returns a function that:
     * 1. Handles privacy confirmations (for 3rd party models)
     * 2. Manages quota exhaustion (auto-switch to base model)
     * 3. Creates ChatParticipantRequestHandler for intent detection
     * 4. Returns the result
     */
    private getChatParticipantHandler(
        id: string, 
        name: string, 
        defaultIntentIdOrGetter: IntentOrGetter,
        onRequestPaused: Event<vscode.ChatParticipantPauseStateEvent>
    ): vscode.ChatExtendedRequestHandler {
        return async (request, context, stream, token): Promise<vscode.ChatResult> => {
            
            // Step 1: Privacy confirmation for 3rd party models
            const privacyConfirmation = await this.requestPolicyConfirmation(request, stream);
            if (typeof privacyConfirmation === 'boolean') {
                return {}; // User needs to accept terms first
            }
            request = privacyConfirmation;
            
            // Step 2: Auto-switch to base model if quota exhausted
            request = await this.switchToBaseModel(request, stream);
            
            // Step 3: Signal interaction started (for telemetry)
            this.interactionService.startInteraction();
            
            // Step 4: Resolve intent ID
            const defaultIntentId = typeof defaultIntentIdOrGetter === 'function' ?
                defaultIntentIdOrGetter(request) :
                defaultIntentIdOrGetter;
            
            // Step 5: Map slash command to intent if present
            const commandsForAgent = agentsToCommands[defaultIntentId];
            const intentId = request.command && commandsForAgent ?
                commandsForAgent[request.command] :
                defaultIntentId;
            
            // Step 6: Create handler and process request
            const onPause = Event.chain(onRequestPaused, $ => 
                $.filter(e => e.request === request).map(e => e.isPaused)
            );
            
            const handler = this.instantiationService.createInstance(
                ChatParticipantRequestHandler, 
                context.history, 
                request, 
                stream, 
                token, 
                { agentName: name, agentId: id, intentId }, 
                onPause
            );
            
            return await handler.getResult();
        };
    }
    
    /**
     * Handle privacy confirmation for 3rd party models.
     * If endpoint.policy is not 'enabled', show confirmation UI.
     */
    private async requestPolicyConfirmation(
        request: vscode.ChatRequest, 
        stream: vscode.ChatResponseStream
    ): Promise<boolean | ChatRequest> {
        const endpoint = await this.endpointProvider.getChatEndpoint(request);
        if (endpoint.policy === 'enabled') {
            return request; // No confirmation needed
        }
        
        // Check if user already accepted
        if (request.acceptedConfirmationData?.[0]?.prompt && 
            (await endpoint.acceptChatPolicy())) {
            return { ...request, prompt: request.acceptedConfirmationData[0].prompt };
        }
        
        // Show confirmation UI
        stream.confirmation(
            `Enable ${endpoint.name} for all clients`, 
            endpoint.policy.terms, 
            { prompt: request.prompt }, 
            ['Enable']
        );
        return true; // Signal that confirmation was shown
    }
    
    /**
     * Auto-switch to base model if user exhausted premium quota.
     * Shows warning message explaining the switch.
     */
    private async switchToBaseModel(
        request: vscode.ChatRequest, 
        stream: vscode.ChatResponseStream
    ): Promise<ChatRequest> {
        const endpoint = await this.endpointProvider.getChatEndpoint(request);
        const baseEndpoint = await this.endpointProvider.getChatEndpoint('copilot-base');
        
        // Don't switch if: free model, BYOK, overages enabled, or quota not exhausted
        if (endpoint.multiplier === 0 || 
            request.model.vendor !== 'copilot' || 
            this._chatQuotaService.overagesEnabled || 
            !this._chatQuotaService.quotaExhausted) {
            return request;
        }
        
        // Get base model
        const baseLmModel = (await vscode.lm.selectChatModels({ 
            id: baseEndpoint.model, 
            family: baseEndpoint.family, 
            vendor: 'copilot' 
        }))[0];
        
        if (!baseLmModel) {
            return request;
        }
        
        // Switch model in UI
        await vscode.commands.executeCommand('workbench.action.chat.changeModel', { 
            vendor: baseLmModel.vendor, 
            id: baseLmModel.id, 
            family: baseLmModel.family 
        });
        
        // Show warning
        stream.warning(new vscode.MarkdownString(
            `You have exceeded your premium request allowance. ` +
            `We have automatically switched you to ${baseEndpoint.name}...`
        ));
        
        return { ...request, model: baseLmModel };
    }
}

type IntentOrGetter = Intent | ((request: vscode.ChatRequest) => Intent);
```

**Key Takeaways:**
1. ✅ **Service-Oriented Architecture**: Heavy use of dependency injection for testability
2. ✅ **Quota Management**: Graceful handling of rate limits and premium model exhaustion
3. ✅ **Privacy Controls**: Built-in confirmation flows for 3rd party model policies
4. ✅ **Dynamic Behavior**: Participants adjust based on auth state, experiments, and quotas
5. ✅ **Separation of Concerns**: Registration logic separate from request handling

---

#### Layer 2: ChatParticipantRequestHandler - Intent Selection

**File: `src/extension/prompt/node/chatParticipantRequestHandler.ts`**

This class is the bridge between the VS Code chat participant API and Copilot's intent-based architecture. It's created for **every single chat request** and handles:

**Core Responsibilities:**
1. **Intent Detection & Selection**: Determines what the user wants to do (explain, fix, generate code, etc.)
2. **Conversation Management**: Reconstructs conversation history from VS Code's chat context
3. **Context Gathering**: Collects document context (file, selection, language) for inline chat
4. **Variable Sanitization**: Filters out files that are in `.copilotignore` or `.gitignore`
5. **Permission Handling**: Manages permissive auth upgrades for workspace tools
6. **Error Handling**: Provides user-friendly error messages for empty commands, etc.

**Request Flow:**
```
VS Code Chat API (request arrives)
    ↓
ChatParticipantRequestHandler.constructor()
    • Parse request location (panel, editor, terminal)
    • Reconstruct conversation from history
    • Infer document context from editor state
    • Initialize telemetry tracking
    ↓
ChatParticipantRequestHandler.getResult()
    • Sanitize variables (respect .copilotignore)
    • Check if permissive auth needed
    • Select appropriate intent
    • Create DefaultIntentRequestHandler
    ↓
DefaultIntentRequestHandler.getResult()
    • Invoke intent
    • Build prompt
    • Execute tool calling loop
    • Process response
    ↓
Return ChatResult with metadata
```

**Key Code:**

```typescript
/**
 * Handles a single chat request:
 * 1) Selects intent based on participant and command
 * 2) Invokes intent via DefaultIntentRequestHandler
 * 
 * Created fresh for each user message.
 */
export class ChatParticipantRequestHandler {
    
    public readonly conversation: Conversation;
    private readonly location: ChatLocation;
    private readonly stream: ChatResponseStream;
    private readonly documentContext: IDocumentContext | undefined;
    private readonly intentDetector: IntentDetector;
    private readonly turn: Turn;
    private readonly chatTelemetry: ChatTelemetryBuilder;
    
    constructor(
        private readonly rawHistory: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>,
        private request: ChatRequest,
        stream: ChatResponseStream,
        private readonly token: CancellationToken,
        private readonly chatAgentArgs: IChatAgentArgs, // { agentName, agentId, intentId }
        private readonly onPaused: Event<boolean>,
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
        @ICommandService private readonly _commandService: ICommandService,
        @IIgnoreService private readonly _ignoreService: IIgnoreService,
        @IIntentService private readonly _intentService: IIntentService,
        @IConversationStore private readonly _conversationStore: IConversationStore,
        @ITabsAndEditorsService tabsAndEditorsService: ITabsAndEditorsService,
        @ILogService private readonly _logService: ILogService,
        @IAuthenticationService private readonly _authService: IAuthenticationService,
        @IAuthenticationChatUpgradeService private readonly _authenticationUpgradeService: IAuthenticationChatUpgradeService,
    ) {
        // Determine location (panel, editor, terminal, notebook)
        this.location = this.getLocation(request);
        
        // Create intent detector for telemetry
        this.intentDetector = this._instantiationService.createInstance(IntentDetector);
        
        // Filter stream to avoid duplicate references in editor
        this.stream = stream;
        if (request.location2 instanceof ChatRequestEditorData) {
            const documentUri = request.location2.document.uri;
            this.stream = ChatResponseStreamImpl.filter(stream, part => {
                if (part instanceof ChatResponseReferencePart || 
                    part instanceof ChatResponseProgressPart2) {
                    const uri = URI.isUri(part.value) ? part.value : part.value.uri;
                    return !isEqual(uri, documentUri);
                }
                return true;
            });
        }
        
        // Reconstruct conversation from VS Code history
        const { turns, sessionId } = _instantiationService.invokeFunction(
            accessor => addHistoryToConversation(accessor, rawHistory)
        );
        normalizeSummariesOnRounds(turns);
        const actualSessionId = sessionId ?? generateUuid();
        
        // Infer document context from editor (for inline chat)
        this.documentContext = IDocumentContext.inferDocumentContext(
            request, 
            tabsAndEditorsService.activeTextEditor, 
            turns
        );
        
        // Initialize telemetry
        this.chatTelemetry = this._instantiationService.createInstance(
            ChatTelemetryBuilder,
            Date.now(),
            actualSessionId,
            this.documentContext,
            turns.length === 0, // isFirstTurn
            this.request
        );
        
        // Create turn for this request
        const latestTurn = Turn.fromRequest(
            this.chatTelemetry.telemetryMessageId,
            this.request
        );
        
        this.conversation = new Conversation(actualSessionId, turns.concat(latestTurn));
        this.turn = latestTurn;
    }
    
    /**
     * Determine chat location from VS Code's location API.
     */
    private getLocation(request: ChatRequest): ChatLocation {
        if (request.location2 instanceof ChatRequestEditorData) {
            return ChatLocation.Editor;
        } else if (request.location2 instanceof ChatRequestNotebookData) {
            return ChatLocation.Notebook;
        }
        
        // Fallback to deprecated location API
        switch (request.location) {
            case VSChatLocation.Editor:
                return ChatLocation.Editor;
            case VSChatLocation.Panel:
                return ChatLocation.Panel;
            case VSChatLocation.Terminal:
                return ChatLocation.Terminal;
            default:
                return ChatLocation.Other;
        }
    }
    
    /**
     * Main entry point - processes the request and returns result.
     */
    async getResult(): Promise<ICopilotChatResult> {
        
        // Check if we need permissive auth for workspace tools
        if (await this._shouldAskForPermissiveAuth()) {
            return {
                metadata: {
                    modelMessageId: this.turn.responseId ?? '',
                    responseId: this.turn.id,
                    sessionId: this.conversation.sessionId,
                    agentId: this.chatAgentArgs.agentId,
                    command: this.request.command,
                }
            };
        }
        
        this._logService.trace(
            `[${ChatLocation.toStringShorter(this.location)}] chat request received`
        );
        
        try {
            // Sanitize variables - respect .copilotignore
            this.request = await this.sanitizeVariables();
            
            // Get command details if intent was specified
            const command = this.chatAgentArgs.intentId ?
                this._commandService.getCommand(this.chatAgentArgs.intentId, this.location) :
                undefined;
            
            // Validate command usage
            let result = this.checkCommandUsage(command);
            
            if (!result) {
                // Normal case: select intent and invoke it
                const history = this.conversation.turns.slice(0, -1);
                const intent = await this.selectIntent(command, history);
                
                let chatResult: Promise<ChatResult>;
                
                // Check if intent has custom handler
                if (typeof intent.handleRequest === 'function') {
                    // Intent implements its own handling (rare)
                    chatResult = intent.handleRequest(
                        this.conversation, 
                        this.request, 
                        this.stream, 
                        this.token, 
                        this.documentContext, 
                        this.chatAgentArgs.agentName, 
                        this.location, 
                        this.chatTelemetry, 
                        this.onPaused
                    );
                } else {
                    // Standard path: use DefaultIntentRequestHandler
                    const intentHandler = this._instantiationService.createInstance(
                        DefaultIntentRequestHandler, 
                        intent, 
                        this.conversation, 
                        this.request, 
                        this.stream, 
                        this.token, 
                        this.documentContext, 
                        this.location, 
                        this.chatTelemetry, 
                        undefined, // options
                        this.onPaused
                    );
                    chatResult = intentHandler.getResult();
                }
                
                // Collect intent detection telemetry
                if (!this.request.isParticipantDetected) {
                    this.intentDetector.collectIntentDetectionContextInternal(
                        this.turn.request.message,
                        this.request.enableCommandDetection ? intent.id : 'none',
                        new ChatVariablesCollection(this.request.references),
                        this.location,
                        history,
                        this.documentContext?.document
                    );
                }
                
                result = await chatResult;
                
                // Add endpoint information to result
                const endpoint = await this._endpointProvider.getChatEndpoint(this.request);
                result.details = this._authService.copilotToken?.isNoAuthUser ?
                    `${endpoint.name}` :
                    `${endpoint.name} • ${endpoint.multiplier ?? 0}x`;
            }
            
            // Store conversation for future retrieval
            this._conversationStore.addConversation(this.turn.id, this.conversation);
            
            // Add fixed metadata shape to result
            mixin(result, {
                metadata: {
                    modelMessageId: this.turn.responseId ?? '',
                    responseId: this.turn.id,
                    sessionId: this.conversation.sessionId,
                    agentId: this.chatAgentArgs.agentId,
                    command: this.request.command
                }
            } satisfies ICopilotChatResult, true);
            
            return result as ICopilotChatResult;
            
        } catch (err) {
            throw err;
        }
    }
    
    /**
     * Select the appropriate intent for this request.
     * 
     * Priority:
     * 1. Command explicitly specified (e.g., /explain)
     * 2. Location-specific heuristics (inline chat)
     * 3. Unknown intent (uses LLM to determine intent)
     */
    private async selectIntent(
        command: CommandDetails | undefined, 
        history: Turn[]
    ): Promise<IIntent> {
        
        // If command specified, use its intent
        if (command?.intent) {
            return command.intent;
        }
        
        // Special logic for inline chat (editor location)
        if (this.location === ChatLocation.Editor) {
            let preferredIntent: Intent | undefined;
            
            // First-turn heuristics
            if (this.documentContext && 
                this.request.attempt === 0 && 
                history.length === 0) {
                
                const selection = this.documentContext.selection;
                const line = this.documentContext.document.lineAt(selection.start.line);
                
                // Empty line with cursor → suggest generate
                if (selection.isEmpty && line.text.trim() === '') {
                    preferredIntent = Intent.Generate;
                }
                // Multi-line selection → suggest edit
                else if (!selection.isEmpty && 
                         selection.start.line !== selection.end.line) {
                    preferredIntent = Intent.Edit;
                }
            }
            
            if (preferredIntent) {
                return this._intentService.getIntent(preferredIntent, this.location) 
                    ?? this._intentService.unknownIntent;
            }
        }
        
        // Default: use unknown intent (will detect from user message)
        return this._intentService.unknownIntent;
    }
    
    /**
     * Check if command was used correctly (not empty when args required).
     */
    private checkCommandUsage(command: CommandDetails | undefined): ChatResult | undefined {
        if (command?.intent && 
            !(command.intent.commandInfo?.allowsEmptyArgs ?? true) && 
            !this.turn.request.message) {
            
            const commandAgent = getAgentForIntent(command.intent.id as Intent, this.location);
            let usage = '';
            if (commandAgent) {
                usage = `@${commandAgent.agent} `;
                if (commandAgent.command) {
                    usage += ` /${commandAgent.command}`;
                }
                usage += ` ${command.details}`;
            }
            
            const message = l10n.t(
                `Please specify a question when using this command.\n\nUsage: {0}`, 
                usage
            );
            const chatResult = { errorDetails: { message } };
            this.turn.setResponse(
                TurnStatus.Error, 
                { type: 'meta', message }, 
                undefined, 
                chatResult
            );
            return chatResult;
        }
    }
    
    /**
     * Filter out references to ignored files (.copilotignore, .gitignore).
     */
    private async sanitizeVariables(): Promise<ChatRequest> {
        const variablePromises = this.request.references.map(async (ref) => {
            const uri = isLocation(ref.value) ? ref.value.uri : 
                        URI.isUri(ref.value) ? ref.value : 
                        undefined;
            
            if (!uri || uri.scheme === Schemas.untitled) {
                return ref;
            }
            
            let removeVariable;
            try {
                removeVariable = await this._ignoreService.isCopilotIgnored(uri);
            } catch {
                // File might not exist or be virtual - that's OK
            }
            
            if (removeVariable && ref.range) {
                // Also sanitize the user message (remove file path)
                this.turn.request.message = 
                    this.turn.request.message.slice(0, ref.range[0]) + 
                    this.turn.request.message.slice(ref.range[1]);
            }
            
            return removeVariable ? null : ref;
        });
        
        const newVariables = coalesce(await Promise.all(variablePromises));
        return { ...this.request, references: newVariables };
    }
    
    /**
     * Check if we need to prompt for permissive auth.
     * Required when using workspace tools without full repo access.
     */
    private async _shouldAskForPermissiveAuth(): Promise<boolean> {
        // User already confirmed auth
        const findConfirmRequest = this.request.acceptedConfirmationData?.find(
            ref => ref?.authPermissionPrompted
        );
        if (findConfirmRequest) {
            this.request = await this._authenticationUpgradeService.handleConfirmationRequest(
                this.stream, 
                this.request, 
                this.rawHistory
            );
            this.turn.request.message = this.request.prompt;
            return false;
        }
        
        // Check if using workspace tool
        const isWorkspaceCall = 
            this.request.toolReferences.some(ref => ref.name === ContributedToolName.Codebase) ||
            this.chatAgentArgs.agentId === getChatParticipantIdFromName(workspaceAgentName);
        
        // Show confirmation if needed
        if (isWorkspaceCall && 
            await this._authenticationUpgradeService.shouldRequestPermissiveSessionUpgrade()) {
            this._authenticationUpgradeService.showPermissiveSessionUpgradeInChat(
                this.stream, 
                this.request
            );
            return true;
        }
        
        return false;
    }
}

/**
 * Helper: Reconstruct Conversation object from VS Code's chat history.
 * VS Code stores history as ChatRequestTurn[] | ChatResponseTurn[],
 * but we need our internal Conversation/Turn model.
 */
export function addHistoryToConversation(
    accessor: ServicesAccessor, 
    history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>
): { turns: Turn[]; sessionId: string | undefined } {
    
    const instaService = accessor.get(IInstantiationService);
    const turns: Turn[] = [];
    let sessionId: string | undefined;
    let previousChatRequestTurn: ChatRequestTurn | undefined;
    
    for (const entry of history) {
        if (entry instanceof ChatRequestTurn) {
            previousChatRequestTurn = entry;
        } else {
            // Try to find existing Turn from conversation store
            const existingTurn = instaService.invokeFunction(
                findExistingTurnFromVSCodeChatHistoryTurn, 
                entry
            );
            
            if (existingTurn) {
                turns.push(existingTurn);
            } else if (previousChatRequestTurn) {
                // Create Turn from request/response pair
                const deserializedTurn = instaService.invokeFunction(
                    createTurnFromVSCodeChatHistoryTurns, 
                    previousChatRequestTurn, 
                    entry
                );
                previousChatRequestTurn = undefined;
                turns.push(deserializedTurn);
            }
            
            // Extract session ID from metadata
            const copilotResult = entry.result as ICopilotChatResultIn;
            if (typeof copilotResult.metadata?.sessionId === 'string') {
                sessionId = copilotResult.metadata.sessionId;
            }
        }
    }
    
    return { turns, sessionId };
}
```

**Key Insights:**

1. **Ephemeral Handler**: A new `ChatParticipantRequestHandler` is created for **every chat message**. It's not a long-lived object.

2. **History Reconstruction**: VS Code doesn't maintain our `Conversation` object across requests - we rebuild it from `context.history` each time.

3. **Smart Intent Selection**: The handler uses heuristics (location, selection state, first turn) to guess user intent before even calling the LLM.

4. **Security**: `.copilotignore` and `.gitignore` are enforced at this layer - ignored files never reach the LLM.

5. **Telemetry**: Tracks everything - intent detection accuracy, model usage, context size, etc.

6. **Error Handling**: Validates command usage and provides helpful error messages before invoking expensive LLM calls.

---

#### Layer 3: DefaultIntentRequestHandler - Intent Execution

**File: `src/extension/prompt/node/defaultIntentRequestHandler.ts`**

This is where the **actual work happens**. The `DefaultIntentRequestHandler` is the execution engine for most intents in GitHub Copilot. It:

**Core Responsibilities:**
1. **Intent Invocation**: Calls `IIntent.invoke()` to get the intent-specific configuration
2. **Prompt Building**: Uses `@vscode/prompt-tsx` to build structured prompts with context
3. **Tool Calling Loop**: Manages multi-turn agent execution (tool calls, results, follow-ups)
4. **Response Processing**: Handles streaming responses, applies edits, shows progress
5. **Error Management**: Graceful handling of quota limits, cancellations, content filtering
6. **Telemetry**: Comprehensive tracking of request lifecycle and outcomes

**What is an Intent?**

An **Intent** (`IIntent` interface) represents a specific capability that Copilot can perform:

```typescript
export interface IIntent {
    readonly id: string;                    // e.g., 'explain', 'fix', 'generate'
    readonly description: string;           // User-facing description
    readonly locations: ChatLocation[];     // Where it can be used (panel, editor)
    readonly commandInfo?: IIntentSlashCommandInfo; // Slash command config
    
    /**
     * Called when this intent is selected.
     * Returns an IIntentInvocation that configures:
     * - How to build the prompt
     * - Which tools are available
     * - How to process the response
     */
    invoke(context: IIntentInvocationContext): Promise<IIntentInvocation>;
    
    /**
     * Optional: custom request handler (bypasses default flow)
     */
    handleRequest?(
        conversation: Conversation,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: CancellationToken,
        documentContext: IDocumentContext | undefined,
        agentName: string,
        location: ChatLocation,
        chatTelemetry: ChatTelemetryBuilder,
        onPaused: Event<boolean>,
    ): Promise<vscode.ChatResult>;
}

export interface IIntentInvocation {
    readonly intent: IIntent;
    readonly location: ChatLocation;
    readonly endpoint: IChatEndpoint;        // Which model to use
    
    /**
     * Build the prompt (system message, user messages, context).
     * Uses @vscode/prompt-tsx for structured prompt construction.
     */
    buildPrompt(
        context: IBuildPromptContext,
        progress: vscode.Progress<...>,
        token: CancellationToken
    ): Promise<IBuildPromptResult>;
    
    /**
     * Optional: specify which tools are available for this intent.
     */
    getAvailableTools?(): vscode.LanguageModelToolInformation[] | undefined;
    
    /**
     * Optional: custom response processing (parse special formats, etc.)
     */
    processResponse?(/* ... */): AsyncIterable<IResponsePart>;
    
    /**
     * Optional: modify error messages for this intent.
     */
    modifyErrorDetails?(
        errorDetails: vscode.ChatErrorDetails, 
        response: ChatResponse
    ): vscode.ChatErrorDetails;
}
```

**Examples of Intents:**
- **ExplainIntent**: Explains selected code with context from surrounding functions
- **FixIntent**: Fixes errors using diagnostic information
- **GenerateIntent**: Generates new code with inferred types and patterns
- **EditCode2Intent** (Plan Mode): Handles complex multi-file edits in `ChatLocation.EditingSession` (Copilot Edits)
- **TestIntent**: Creates unit tests with proper mocking and assertions
- **WorkspaceIntent**: Answers questions using codebase search and semantic analysis

Each intent customizes:
- System prompt (e.g., "You are an expert code explainer")
- Context gathering (e.g., include related functions for explain, include test framework for tests)
- Available tools (e.g., workspace search for @workspace, terminal commands for @terminal)
- Response format (e.g., code blocks vs markdown)

**Execution Flow:**

```
DefaultIntentRequestHandler.getResult()
    ↓
1. Invoke intent
    intent.invoke() → returns IIntentInvocation
    ↓
2. Handle confirmations (if needed)
    User might need to confirm destructive actions
    ↓
3. Run tool calling loop
    ↓
    ┌─────────────────────────────────────────┐
    │  Tool Calling Loop (Agent Mode)         │
    │  ┌───────────────────────────────────┐  │
    │  │ 1. Build Prompt                   │  │
    │  │    • System message               │  │
    │  │    • Conversation history         │  │
    │  │    • Context (files, diagnostics) │  │
    │  │    • Tool definitions             │  │
    │  └───────────────────────────────────┘  │
    │           ↓                              │
    │  ┌───────────────────────────────────┐  │
    │  │ 2. Call Language Model            │  │
    │  │    • Send request                 │  │
    │  │    • Stream response chunks       │  │
    │  └───────────────────────────────────┘  │
    │           ↓                              │
    │  ┌───────────────────────────────────┐  │
    │  │ 3. Process Response               │  │
    │  │    • Parse markdown               │  │
    │  │    • Extract tool calls           │  │
    │  │    • Show progress                │  │
    │  └───────────────────────────────────┘  │
    │           ↓                              │
    │  ┌───────────────────────────────────┐  │
    │  │ 4. Execute Tools (if any)         │  │
    │  │    • Run file_search              │  │
    │  │    • Read files                   │  │
    │  │    • Execute commands             │  │
    │  └───────────────────────────────────┘  │
    │           ↓                              │
    │  ┌───────────────────────────────────┐  │
    │  │ 5. Check if done                  │  │
    │  │    • No more tool calls?          │  │
    │  │    • Hit iteration limit?         │  │
    │  │    • User cancelled?              │  │
    │  └───────────────────────────────────┘  │
    │           ↓                              │
    │    Loop back to step 1 with tool results│
    └─────────────────────────────────────────┘
    ↓
4. Process final result
    • Handle errors (quota, filtering, etc.)
    • Set turn response with status
    • Add telemetry
    ↓
Return ChatResult
```

**Key Code:**

```typescript
/**
 * Handles intent execution with tool calling support.
 * Created once per request by ChatParticipantRequestHandler.
 */
export class DefaultIntentRequestHandler {
    
    private readonly turn: Turn;
    private _editSurvivalTracker: IEditSurvivalTrackingSession;
    private _loop!: DefaultToolCallingLoop;
    
    constructor(
        private readonly intent: IIntent,
        private readonly conversation: Conversation,
        protected readonly request: ChatRequest,
        protected readonly stream: ChatResponseStream,
        private readonly token: CancellationToken,
        protected readonly documentContext: IDocumentContext | undefined,
        private readonly location: ChatLocation,
        private readonly chatTelemetryBuilder: ChatTelemetryBuilder,
        private readonly handlerOptions: IDefaultIntentRequestHandlerOptions = { 
            maxToolCallIterations: 15 
        },
        private readonly onPaused: Event<boolean>,
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
        @IConversationOptions private readonly options: IConversationOptions,
        @ITelemetryService private readonly _telemetryService: ITelemetryService,
        @ILogService private readonly _logService: ILogService,
        @ISurveyService private readonly _surveyService: ISurveyService,
        @IRequestLogger private readonly _requestLogger: IRequestLogger,
        @IEditSurvivalTrackerService private readonly _editSurvivalTrackerService: IEditSurvivalTrackerService,
        @IAuthenticationService private readonly _authenticationService: IAuthenticationService,
    ) {
        this.turn = conversation.getLatestTurn();
    }
    
    /**
     * Main entry point - execute the intent and return result.
     */
    async getResult(): Promise<ChatResult> {
        
        // Handle tool call limit cancellation
        if (isToolCallLimitCancellation(this.request)) {
            this.stream.markdown(l10n.t("Let me know if there's anything else I can help with!"));
            return {};
        }
        
        try {
            if (this.token.isCancellationRequested) {
                return CanceledResult;
            }
            
            // Step 1: Invoke the intent to get configuration
            this._logService.trace('Processing intent');
            const intentInvocation = await this.intent.invoke({ 
                location: this.location, 
                documentContext: this.documentContext, 
                request: this.request 
            });
            if (this.token.isCancellationRequested) {
                return CanceledResult;
            }
            this._logService.trace('Processed intent');
            
            // Store intent invocation metadata
            this.turn.setMetadata(new IntentInvocationMetadata(intentInvocation));
            
            // Step 2: Handle confirmations (destructive actions)
            const confirmationResult = await this.handleConfirmationsIfNeeded();
            if (confirmationResult) {
                return confirmationResult;
            }
            
            // Step 3: Run the tool calling loop
            const resultDetails = await this._requestLogger.captureInvocation(
                this.request, 
                () => this.runWithToolCalling(intentInvocation)
            );
            
            let chatResult = resultDetails.chatResult || {};
            
            // Signal usage for surveys
            this._surveyService.signalUsage(
                `${this.location === ChatLocation.Editor ? 'inline' : 'panel'}.${this.intent.id}`, 
                this.documentContext?.document.languageId
            );
            
            // Extract final response message
            const responseMessage = resultDetails.toolCallRounds.at(-1)?.response ?? '';
            
            // Add tool call metadata
            const metadataFragment: Partial<IResultMetadata> = {
                toolCallRounds: resultDetails.toolCallRounds,
                toolCallResults: this._collectRelevantToolCallResults(
                    resultDetails.toolCallRounds, 
                    resultDetails.toolCallResults
                ),
            };
            mixin(chatResult, { metadata: metadataFragment }, true);
            
            // Step 4: Process the final result
            const baseModelTelemetry = createTelemetryWithId();
            chatResult = await this.processResult(
                resultDetails.response, 
                responseMessage, 
                chatResult, 
                metadataFragment, 
                baseModelTelemetry, 
                resultDetails.toolCallRounds
            );
            
            // Allow intent to modify error details
            if (chatResult.errorDetails && intentInvocation.modifyErrorDetails) {
                chatResult.errorDetails = intentInvocation.modifyErrorDetails(
                    chatResult.errorDetails, 
                    resultDetails.response
                );
            }
            
            // Show warning if files were ignored
            if (resultDetails.hadIgnoredFiles) {
                this.stream.markdown(HAS_IGNORED_FILES_MESSAGE);
            }
            
            return chatResult;
            
        } catch (err) {
            if (err instanceof ToolCallCancelledError) {
                this.turn.setResponse(
                    TurnStatus.Cancelled, 
                    { message: err.message, type: 'meta' }, 
                    undefined, 
                    {}
                );
                return {};
            } else if (isCancellationError(err)) {
                return CanceledResult;
            } else if (err instanceof EmptyPromptError) {
                return {};
            }
            
            // Log and report unexpected errors
            this._logService.error(err);
            this._telemetryService.sendGHTelemetryException(err, 'Error');
            
            const errorMessage = (<Error>err).message;
            const chatResult = { errorDetails: { message: errorMessage } };
            this.turn.setResponse(
                TurnStatus.Error, 
                { message: errorMessage, type: 'meta' }, 
                undefined, 
                chatResult
            );
            return chatResult;
        }
    }
    
    /**
     * Create response stream participants for tracking and processing.
     * These intercept the response stream to:
     * - Track code blocks (for stests)
     * - Track edit survival (did user keep the AI edits?)
     * - Linkify URLs and file paths
     * - Collect telemetry on emitted components
     */
    private makeResponseStreamParticipants(
        intentInvocation: IIntentInvocation
    ): ResponseStreamParticipant[] {
        
        const participants: ResponseStreamParticipant[] = [];
        
        // 1. Track code blocks
        participants.push(stream => {
            const codeBlockTrackingResponseStream = 
                this._instantiationService.createInstance(
                    CodeBlockTrackingChatResponseStream, 
                    stream, 
                    intentInvocation.codeblocksRepresentEdits
                );
            return ChatResponseStreamImpl.spy(
                codeBlockTrackingResponseStream,
                v => v,
                () => {
                    const codeBlocksMetaData = codeBlockTrackingResponseStream.finish();
                    this.turn.setMetadata(codeBlocksMetaData);
                }
            );
        });
        
        // 2. Track edit survival (inline chat only)
        if (this.documentContext && this.location === ChatLocation.Editor) {
            participants.push(stream => {
                const firstTurnWithAIEditCollector = 
                    this.conversation.turns.find(
                        turn => turn.getMetadata(CopilotInteractiveEditorResponse)?.editSurvivalTracker
                    );
                
                this._editSurvivalTracker = 
                    firstTurnWithAIEditCollector?.getMetadata(CopilotInteractiveEditorResponse)?.editSurvivalTracker 
                    ?? this._editSurvivalTrackerService.initialize(this.documentContext.document.document);
                
                return ChatResponseStreamImpl.spy(stream, value => {
                    if (value instanceof ChatResponseTextEditPart) {
                        this._editSurvivalTracker.collectAIEdits(value.edits);
                    }
                });
            });
        }
        
        // 3. Linkify URLs and file paths
        if (!intentInvocation.linkification?.disable) {
            participants.push(stream => {
                const linkStream = this._instantiationService.createInstance(
                    ResponseStreamWithLinkification, 
                    { requestId: this.turn.id, references: this.turn.references }, 
                    stream, 
                    intentInvocation.linkification?.additionaLinkifiers ?? [], 
                    this.token
                );
                return ChatResponseStreamImpl.spy(linkStream, p => p, () => {
                    this._loop.telemetry.markAddedLinks(linkStream.totalAddedLinkCount);
                });
            });
        }
        
        // 4. General telemetry
        participants.push(stream => ChatResponseStreamImpl.spy(stream, (part) => {
            if (part instanceof ChatResponseMarkdownPart) {
                this._loop.telemetry.markEmittedMarkdown(part.value);
            }
            if (part instanceof ChatResponseTextEditPart) {
                this._loop.telemetry.markEmittedEdits(part.uri, part.edits);
            }
        }));
        
        return participants;
    }
    
    /**
     * Run the tool calling loop.
     * This is the core agent execution engine.
     */
    private async runWithToolCalling(
        intentInvocation: IIntentInvocation
    ): Promise<IInternalRequestResult> {
        
        const store = new DisposableStore();
        
        // Create tool calling loop
        const loop = this._loop = store.add(
            this._instantiationService.createInstance(
                DefaultToolCallingLoop,
                {
                    conversation: this.conversation,
                    intent: this.intent,
                    invocation: intentInvocation,
                    toolCallLimit: this.handlerOptions.maxToolCallIterations,
                    onHitToolCallLimit: this.handlerOptions.confirmOnMaxToolIterations !== false
                        ? ToolCallLimitBehavior.Confirm 
                        : ToolCallLimitBehavior.Stop,
                    request: this.request,
                    documentContext: this.documentContext,
                    streamParticipants: this.makeResponseStreamParticipants(intentInvocation),
                    temperature: this.handlerOptions.temperature ?? this.options.temperature,
                    location: this.location,
                    overrideRequestLocation: this.handlerOptions.overrideRequestLocation,
                    interactionContext: this.documentContext?.document.uri,
                    responseProcessor: typeof intentInvocation.processResponse === 'function' 
                        ? intentInvocation as IResponseProcessor 
                        : undefined,
                },
                this.chatTelemetryBuilder,
            )
        );
        
        // Wire up events
        store.add(Event.once(loop.onDidBuildPrompt)(
            this._sendInitialChatReferences, 
            this
        ));
        
        const responseHandlers: Promise<unknown>[] = [];
        store.add(loop.onDidReceiveResponse(res => {
            const promise = this._onDidReceiveResponse(res);
            responseHandlers.push(promise);
            return promise;
        }, this));
        
        const pauseCtrl = store.add(new PauseController(this.onPaused, this.token));
        
        try {
            // Run the loop!
            const result = await loop.run(this.stream, pauseCtrl);
            
            // Send tool calling telemetry
            if (!result.round.toolCalls.length || 
                result.response.type !== ChatFetchResponseType.Success) {
                loop.telemetry.sendToolCallingTelemetry(
                    result.toolCallRounds, 
                    result.availableTools, 
                    this.token.isCancellationRequested ? 'cancelled' : result.response.type
                );
            }
            
            result.chatResult ??= {};
            if ((result.chatResult.metadata as IResultMetadata)?.maxToolCallsExceeded) {
                loop.telemetry.sendToolCallingTelemetry(
                    result.toolCallRounds, 
                    result.availableTools, 
                    'maxToolCalls'
                );
            }
            
            // Add all metadata
            result.chatResult = this.resultWithMetadatas(result.chatResult);
            return { ...result, lastRequestTelemetry: loop.telemetry };
            
        } finally {
            await Promise.allSettled(responseHandlers);
            store.dispose();
        }
    }
    
    /**
     * Process the final result and determine status.
     */
    private async processResult(
        fetchResult: ChatResponse, 
        responseMessage: string, 
        chatResult: ChatResult, 
        metadataFragment: Partial<IResultMetadata>, 
        baseModelTelemetry: ConversationalBaseTelemetryData, 
        rounds: IToolCallRound[]
    ): Promise<ChatResult> {
        
        switch (fetchResult.type) {
            case ChatFetchResponseType.Success:
                return await this.processSuccessfulFetchResult(
                    responseMessage, 
                    fetchResult.requestId, 
                    chatResult, 
                    baseModelTelemetry, 
                    rounds
                );
                
            case ChatFetchResponseType.OffTopic:
                this.stream.markdown(this.options.rejectionMessage);
                this.turn.setResponse(
                    TurnStatus.OffTopic, 
                    { message: this.options.rejectionMessage, type: 'offtopic-detection' }, 
                    baseModelTelemetry.properties.messageId, 
                    {}
                );
                return {};
                
            case ChatFetchResponseType.Canceled:
            case ChatFetchResponseType.QuotaExceeded:
            case ChatFetchResponseType.RateLimited:
            case ChatFetchResponseType.BadRequest:
            case ChatFetchResponseType.NetworkError:
            case ChatFetchResponseType.Failed:
            case ChatFetchResponseType.Filtered:
            case ChatFetchResponseType.PromptFiltered:
            case ChatFetchResponseType.AgentUnauthorized:
            case ChatFetchResponseType.AgentFailedDependency:
            case ChatFetchResponseType.Length:
            case ChatFetchResponseType.NotFound:
            case ChatFetchResponseType.Unknown:
            case ChatFetchResponseType.ExtensionBlocked:
                const errorDetails = getErrorDetailsFromChatFetchError(
                    fetchResult, 
                    (await this._authenticationService.getCopilotToken()).copilotPlan
                );
                const result = { errorDetails, metadata: metadataFragment };
                this.turn.setResponse(
                    this.getStatusFromFetchResult(fetchResult), 
                    undefined, 
                    baseModelTelemetry.properties.messageId, 
                    result
                );
                return result;
                
            case ChatFetchResponseType.InvalidStatefulMarker:
                throw new Error('unreachable'); // Retried within endpoint
        }
    }
    
    private async processSuccessfulFetchResult(
        appliedText: string, 
        requestId: string, 
        chatResult: ChatResult, 
        baseModelTelemetry: ConversationalBaseTelemetryData, 
        rounds: IToolCallRound[]
    ): Promise<ChatResult> {
        
        // Validate we got a non-empty response
        if (appliedText.length === 0 && !rounds.some(r => r.toolCalls.length)) {
            const message = l10n.t(
                'The model unexpectedly did not return a response. Request ID: {0}', 
                requestId
            );
            this.turn.setResponse(
                TurnStatus.Error, 
                { type: 'meta', message }, 
                baseModelTelemetry.properties.messageId, 
                chatResult
            );
            return { errorDetails: { message } };
        }
        
        // Success!
        this.turn.setResponse(
            TurnStatus.Success, 
            { type: 'model', message: appliedText }, 
            baseModelTelemetry.properties.messageId, 
            chatResult
        );
        
        baseModelTelemetry.markAsDisplayed();
        
        // Send detailed telemetry
        sendModelMessageTelemetry(
            this._telemetryService,
            this.conversation,
            this.location,
            appliedText,
            requestId,
            this.documentContext?.document,
            baseModelTelemetry,
            this.getModeName()
        );
        
        return chatResult;
    }
    
    private getModeName(): string {
        return this.request.modeInstructions2 ? 'custom' :
            this.intent.id === 'editAgent' ? 'agent' :
            (this.intent.id === 'edit' || this.intent.id === 'edit2') ? 'edit' :
            'ask';
    }
}
```

**Tool Calling Loop (Agent Mode):**

The `DefaultToolCallingLoop` class (also in this file) implements the agent execution loop:

```typescript
class DefaultToolCallingLoop extends ToolCallingLoop<IDefaultToolLoopOptions> {
    public telemetry!: ChatTelemetry;
    
    constructor(
        options: IDefaultToolLoopOptions,
        telemetryBuilder: ChatTelemetryBuilder,
        @IInstantiationService instantiationService: IInstantiationService,
        @ILogService logService: ILogService,
        @IRequestLogger requestLogger: IRequestLogger,
        @IEndpointProvider endpointProvider: IEndpointProvider,
        @IAuthenticationChatUpgradeService authenticationChatUpgradeService: IAuthenticationChatUpgradeService,
        @ITelemetryService telemetryService: ITelemetryService,
        @IToolGroupingService private readonly toolGroupingService: IToolGroupingService,
        @IExperimentationService private readonly _experimentationService: IExperimentationService,
        @ICopilotTokenStore private readonly _copilotTokenStore: ICopilotTokenStore,
    ) {
        super(options, instantiationService, endpointProvider, logService, requestLogger, authenticationChatUpgradeService, telemetryService);
        
        // Initialize telemetry when prompt is built
        this._register(this.onDidBuildPrompt(({ result, tools, promptTokenLength }) => {
            this.telemetry = telemetryBuilder.makeRequest(
                options.intent!,
                options.location,
                options.conversation,
                result.messages,
                promptTokenLength,
                result.references,
                options.invocation.endpoint,
                result.telemetryData ?? [],
                tools.length
            );
        }));
    }
    
    // Inherits from ToolCallingLoop:
    // - buildPrompt(): Build prompt with conversation history + context + tool definitions
    // - sendRequest(): Send to language model
    // - processResponse(): Parse streaming response
    // - executeTools(): Run tool calls (file_search, read_file, etc.)
    // - checkTermination(): Decide if we're done or need another iteration
}
```

**Key Insights:**

1. **Separation of Concerns**: 
   - `IIntent` defines WHAT to do (explain, fix, generate)
   - `IIntentInvocation` defines HOW to do it (prompts, tools, processing)
   - `DefaultIntentRequestHandler` orchestrates the execution

2. **Flexible Architecture**: Intents can:
   - Provide custom `buildPrompt()` logic (different system messages, context gathering)
   - Specify which tools are available (`getAvailableTools()`)
   - Process responses specially (`processResponse()` for structured output)
   - Implement their own handler entirely (`handleRequest()`)

3. **Tool Calling as Default**: The loop supports multi-turn agent execution out of the box. Most intents just define prompts and let the agent figure out what tools to call.

4. **Comprehensive Error Handling**: 24+ error types handled gracefully with user-friendly messages.

5. **Telemetry Everywhere**: Every step tracked for product insights and A/B testing.

6. **Production Hardened**: Handles quota exhaustion, rate limits, content filtering, cancellation, network errors, etc.

---

#### Summary: Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: ChatAgents                                            │
│  Responsibility: Registration & Routing                         │
│  • Creates participants (@copilot, @workspace, etc.)            │
│  • Handles auth, quota, privacy                                 │
│  • Routes to Layer 2                                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: ChatParticipantRequestHandler                         │
│  Responsibility: Intent Selection & Context                     │
│  • Selects intent (explain, fix, generate)                      │
│  • Gathers context (files, diagnostics, selections)             │
│  • Sanitizes variables (.copilotignore)                         │
│  • Routes to Layer 3                                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: DefaultIntentRequestHandler                           │
│  Responsibility: Intent Execution                               │
│  • Invokes intent (IIntent.invoke())                            │
│  • Builds prompt with @vscode/prompt-tsx                        │
│  • Runs tool calling loop (agent mode)                          │
│  • Processes streaming responses                                │
│  • Handles errors and telemetry                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why This Matters for Your Extension:**

- **Start Simple**: You don't need all three layers! For basic participants, use the simple handler pattern from `chat-sample`
- **Scale Gradually**: As complexity grows, adopt patterns from GitHub Copilot's architecture
- **Intent System**: If you have multiple capabilities, consider an intent-based architecture
- **Tool Calling**: For agent-like behavior, use the Language Model API's built-in tool calling
- **Context Management**: Learn from how Copilot gathers and sanitizes context
- **Error Handling**: Study the comprehensive error handling patterns

---

#### VS Code Core - Chat Service

**File: `src/vs/workbench/contrib/chat/common/chatService.ts`**

This is VS Code's core orchestration service for chat interactions. It sits between the chat UI and participant implementations.

**Responsibilities:**
1. **Message Parsing**: Breaks down user input into components (@participant, /command, variables, plain text)
2. **Participant Resolution**: Finds the appropriate chat participant to handle the request
3. **Context Gathering**: Collects relevant workspace context (files, selections, diagnostics)
4. **Request Lifecycle**: Manages request creation, execution, cancellation, and retry
5. **Session Management**: Maintains conversation history across multiple turns

**Service Architecture:**
```
ChatWidget (UI)
    ↓ user sends message
ChatService (orchestrator)
    ↓ parse and route
ChatAgentService (participant registry)
    ↓ invoke handler
Extension's ChatRequestHandler
    ↓ use model
LanguageModelService
```

**Key Methods:**
- `sendRequest()`: Main entry point for new chat messages
- `resendRequest()`: Handles "regenerate response" button clicks
- `cancelCurrentRequestForSession()`: Stops in-progress requests

**Why This Matters:**
Understanding ChatService helps you:
- Debug why your participant isn't being called
- See what context is automatically provided
- Understand request lifecycle for telemetry
- Know when to use `context.history` vs. maintaining your own state

```typescript
/**
 * Core service managing chat sessions, requests, and participant orchestration.
 * This is the central hub for all chat activity in VS Code.
 */
export interface IChatService {
    sendRequest(
        sessionResource: URI,
        message: string,
        options?: IChatSendRequestOptions
    ): Promise<IChatSendRequestData | undefined>;
    
    resendRequest(
        request: IChatRequestModel,
        options?: IChatSendRequestOptions
    ): Promise<void>;
    
    cancelCurrentRequestForSession(sessionResource: URI): void;
}

export class ChatService implements IChatService {
    async sendRequest(
        sessionResource: URI,
        message: string,
        options?: IChatSendRequestOptions
    ): Promise<IChatSendRequestData | undefined> {
        // 1. Parse message (extract @participant, /command, variables)
        const parsed = this.chatParserService.parseChatRequest(message);
        
        // 2. Get agent (participant) handler
        const agent = this.chatAgentService.getAgent(parsed.agentId);
        if (!agent) {
            throw new Error(`Chat participant not found: ${parsed.agentId}`);
        }
        
        // 3. Gather context (files, editor selection, workspace info)
        const context = await this.gatherContext(parsed, options);
        
        // 4. Create request model
        const request = model.addRequest(parsed, context, attempt);
        
        // 5. Invoke agent handler
        const result = await agent.invoke(request, progress, history, token);
        
        // 6. Update model with result
        model.setResponse(request, result);
        
        return { requestId: request.id };
    }
}
```

#### Chat Agent Registration (Main Thread)

**File: `src/vs/workbench/api/browser/mainThreadChatAgents2.ts`**

This class is the main thread bridge for chat participant registration. It validates and registers participant implementations from extensions.

**Why This Validation Exists:**

VS Code requires chat participants to be **declared in package.json** before they can be registered. This ensures:
1. Users can see available participants before activating the extension
2. VS Code can show participant metadata (name, icon, commands) without loading the extension
3. Security: prevents malicious extensions from hijacking existing participant names
4. Performance: lazy loading - extension only activates when participant is actually used

**package.json Declaration Example:**
```json
{
  "contributes": {
    "chatParticipants": [{
      "id": "myext.agent",
      "name": "agent",
      "description": "Helps with coding tasks",
      "commands": [
        {
          "name": "fix",
          "description": "Fix code issues"
        },
        {
          "name": "explain",
          "description": "Explain code"
        }
      ]
    }]
  }
}
```

**Registration Flow:**
```
Extension activates
    ↓
Calls vscode.chat.createChatParticipant('myext.agent', handler)
    ↓ RPC
MainThreadChatAgents2.$registerAgent(handle, id, metadata)
    ↓ Validates
ChatAgentService.getAgentsByName(id) - checks package.json
    ↓ If valid
ChatAgentService.updateAgent(id, implementation)
    ↓
Ready to handle user requests
```

```typescript
/**
 * Main thread side of chat agent (participant) registration.
 * Bridges between extension host and core chat services.
 */
@extHostNamedCustomer(MainContext.MainThreadChatAgents2)
export class MainThreadChatAgents2 {
    /**
     * Called when extension calls vscode.chat.createChatParticipant().
     * Validates declaration and registers the implementation.
     */
    async $registerAgent(
        handle: number,                          // Unique handle for this registration
        extension: ExtensionIdentifier,           // Which extension owns this
        id: string,                               // Participant ID (e.g., "github.copilot")
        metadata: IExtensionChatAgentMetadata     // Name, description, etc.
    ): Promise<void> {
        // CRITICAL: Verify agent is declared in package.json
        // This prevents runtime registration of undeclared participants
        const staticAgents = this.chatAgentService.getAgentsByName(id);
        if (!staticAgents.length) {
            throw new Error(
                `chatParticipant must be declared in package.json contributes.chatParticipants: ${id}`
            );
        }
        
        // Register implementation
        const impl: IChatAgentImplementation = {
            invoke: async (request, progress, history, token) => {
                // Bridge to extension host
                return await this._proxy.$invokeAgent(
                    handle,
                    request,
                    { history },
                    progress,
                    token
                );
            },
            
            provideFollowups: async (request, result, history, token) => {
                return await this._proxy.$provideFollowups(
                    handle,
                    request,
                    result,
                    history,
                    token
                );
            }
        };
        
        this.chatAgentService.updateAgent(id, impl);
    }
}
```

---

### 3. Agent Mode / Tool Calling

#### Overview

Tool Calling (also called Function Calling) enables language models to invoke external functions during their response generation. This transforms passive chat assistants into **autonomous agents** that can perform actions.

**Purpose:**
Instead of just generating text, models can:
- Search your workspace for relevant code
- Read file contents
- Execute terminal commands
- Create/edit files
- Run tests
- Query APIs
- Multi-step reasoning (use one tool result to decide next tool)

**How It Works (The Agent Loop):**
```
1. User: "Create a REST API for user management"
   ↓
2. Model thinks: "I need to see the project structure first"
   → Returns: ToolCall(name="list_files", args={path: "./src"})
   ↓
3. VS Code executes tool, gets: ["controllers/", "models/", "routes/"]
   → Sends result back to model
   ↓
4. Model thinks: "I'll create the user controller"
   → Returns: ToolCall(name="create_file", args={path: "./src/controllers/user.ts", content: "..."})
   ↓
5. VS Code creates file
   → Model continues or finishes
```

**Models Supporting Tools:**
- ✅ GPT-4, GPT-4 Turbo, GPT-4o (OpenAI)
- ✅ Claude 3 Opus, Claude 3.5 Sonnet (Anthropic)
- ✅ Gemini 1.5 Pro (Google)
- ❌ GPT-3.5 Turbo (limited support)
- ❌ Most open-source models (unless specifically trained)

**Use Cases:**

1. **Code Generation Agents**:
   - Analyze existing code → Generate new code → Run tests → Fix errors
   
2. **Debugging Assistants**:
   - Read error logs → Find relevant code → Suggest fixes → Apply changes
   
3. **Refactoring Agents**:
   - Analyze code quality → Identify issues → Apply refactorings → Verify tests pass
   
4. **Documentation Generators**:
   - Read source files → Extract APIs → Generate markdown → Create examples

5. **Multi-Step Workflows**:
   - User: "Deploy to staging"
   - Agent: Run tests → Build → Check environment → Deploy → Verify health

**Architecture:**
```
Chat Participant
    ↓ calls model with tools
Language Model
    ↓ returns tool call
VS Code Tool Registry
    ↓ executes tool
Tool Implementation (your extension or built-in)
    ↓ returns result
Language Model (continues reasoning)
```

#### Key Interfaces

**vscode.proposed.chatParticipantAdditions.d.ts:**

```typescript
/**
 * Represents a tool call request from the language model.
 * When the model wants to use a tool, it returns this instead of text.
 */
export interface LanguageModelToolCallPart {
    /**
     * Unique identifier for this specific tool invocation.
     * Used to match tool results back to the original call.
     */
    readonly callId: string;
    
    /**
     * Name of the tool to invoke (e.g., "search_workspace", "create_file")
     */
    readonly name: string;
    
    /**
     * Arguments to pass to the tool, as JSON object.
     * Must conform to the tool's inputSchema.
     * Example: { "path": "./src", "query": "class User" }
     */
    readonly input: object;
}

/**
 * Tool execution result sent back to the model.
 * The model uses this information to continue its reasoning.
 */
export interface LanguageModelToolResultPart {
    /**
     * Must match the callId from LanguageModelToolCallPart.
     * This links the result to the original tool call.
     */
    readonly callId: string;
    
    /**
     * The result content. Can be text or structured data.
     * Model will interpret this to make next decision.
     * Example: "Found 5 files matching query", or file contents
     */
    readonly content: (LanguageModelTextPart | LanguageModelPromptTsxPart)[];
}

/**
 * Definition of a tool that can be called by language models.
 * Tools extend what AI models can do beyond just text generation.
 */
export interface LanguageModelChatTool {
    /**
     * Unique tool identifier. Use descriptive names like "search_files", "run_tests".
     * Models use this name when deciding which tool to call.
     */
    readonly name: string;
    
    /**
     * Human-readable description of what the tool does.
     * CRITICAL: The model reads this to decide when to use your tool.
     * Be specific and clear!
     * 
     * Good: "Searches the workspace for files matching a glob pattern and returns file paths"
     * Bad: "Search files"
     */
    readonly description: string;
    
    /**
     * JSON Schema defining the tool's input parameters.
     * The model generates arguments conforming to this schema.
     * 
     * Example:
     * {
     *   type: 'object',
     *   properties: {
     *     query: { type: 'string', description: 'Search query' },
     *     maxResults: { type: 'number', default: 10 }
     *   },
     *   required: ['query']
     * }
     */
    readonly inputSchema?: object;  // JSON Schema
    
    /**
     * Implementation function that executes when model calls this tool.
     * This is YOUR code that performs the actual work.
     * 
     * @param options - Contains input arguments and context
     * @param token - Cancellation token
     * @returns Tool result (text, data, or error)
     */
    invoke(options: LanguageModelToolInvocationOptions, token: CancellationToken): 
        ProviderResult<LanguageModelToolResult>;
}

export namespace lm {
    export const tools: readonly LanguageModelChatTool[];
    
    export function invokeTool(
        name: string,
        options: LanguageModelToolInvocationOptions,
        token: CancellationToken
    ): Thenable<LanguageModelToolResult>;
}
```

#### Implementation Example: Complete Tool Definition

This example shows how to create a complete, production-ready tool that searches the workspace.

**Tool Purpose:** Allow the AI model to search for files in the workspace by name or pattern.

**When Model Uses This:**
- User asks: "Find all TypeScript test files"
- User asks: "Show me components related to authentication"
- Agent needs to understand project structure before making changes

```typescript
/**
 * Tool that searches for files in the workspace.
 * Used by AI models to explore project structure and find relevant files.
 */
const searchTool: vscode.LanguageModelChatTool = {
    // Tool identifier - model uses this in tool calls
    name: 'search_workspace',
    
    // Description - CRITICAL for model decision-making
    // The better your description, the more accurately the model uses your tool
    description: 'Search for files and code in the workspace. ' +
                 'Use this to find files by name, extension, or path pattern. ' +
                 'Returns a list of matching file paths. ' +
                 'Useful before reading files or understanding project structure.',
    
    // JSON Schema - defines expected input format
    inputSchema: {
        type: 'object',
        properties: {
            query: { 
                type: 'string', 
                description: 'Search query - can be filename, extension, or text to match in path'
            },
            filePattern: { 
                type: 'string', 
                description: 'Optional glob pattern (e.g., "**/*.ts", "src/**")',
                default: '**/*'
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results to return',
                default: 20,
                minimum: 1,
                maximum: 100
            }
        },
        required: ['query']  // query is mandatory, others are optional
    },
    
    // Implementation - the actual work happens here
    invoke: async (options, token) => {
        // Extract and validate inputs
        const { query, filePattern = '**/*', maxResults = 20 } = options.input as any;
        
        try {
            // Check cancellation before expensive operation
            if (token.isCancellationRequested) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Search cancelled')
                ]);
            }
            
            // Perform search using VS Code API
            const results = await vscode.workspace.findFiles(
                filePattern,
                '**/node_modules/**',  // Exclude node_modules
                maxResults
            );
            
            // Filter by query string
            const filtered = results.filter(uri => 
                uri.path.toLowerCase().includes(query.toLowerCase())
            ).slice(0, maxResults);
            
            // Format results for model consumption
            if (filtered.length === 0) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `No files found matching "${query}" with pattern "${filePattern}"`
                    )
                ]);
            }
            
            // Return formatted list of files
            const fileList = filtered
                .map(uri => vscode.workspace.asRelativePath(uri))
                .join('\\n');
            
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Found ${filtered.length} file(s) matching "${query}":\\n${fileList}`
                )
            ]);
            
        } catch (error) {
            // Handle errors gracefully - model needs to know what went wrong
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Error searching workspace: ${error.message}`
                )
            ]);
        }
    }
};

// Register tool globally (accessible to all participants)
// Tool names should be prefixed with extension ID to avoid conflicts
vscode.lm.registerTool('myext_search', searchTool);

/**
 * Using Tools in Chat Participants
 * 
 * This example shows how to create a chat participant that uses tools
 * for autonomous, multi-step operations (agent mode).
 */

// Chat participant handler with tool support
const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
    // Show initial progress
    stream.progress('Analyzing your request...');
    
    // Prepare messages for model with system instructions
    const messages = [
        vscode.LanguageModelChatMessage.User(
            'You are a helpful coding assistant. Use available tools to help the user.'
        ),
        vscode.LanguageModelChatMessage.User(request.prompt)
    ];
    
    // Get available tools (can be registered by any extension)
    const tools = [
        vscode.lm.tools.find(t => t.name === 'myext_search'),
        vscode.lm.tools.find(t => t.name === 'vscode_readFile'),
        vscode.lm.tools.find(t => t.name === 'vscode_createFile')
    ].filter(Boolean);
    
    // Send request WITH tools enabled - this enables agent mode
    // The model will now autonomously decide when to use tools
    const chatResponse = await request.model.sendRequest(
        messages,
        {
            tools: tools,
            // Auto: model decides when to use tools (recommended)
            // Required: model MUST use at least one tool
            toolMode: vscode.LanguageModelChatToolMode.Auto
        },
        token
    );
    
    // Process streaming response with tool calls
    // This loop handles both text responses and tool invocations
    for await (const part of chatResponse.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
            // Regular text response from model - stream to UI
            stream.markdown(part.value);
            
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
            // Model wants to use a tool! This is the agent behavior.
            
            // Show progress to user
            stream.prepareToolInvocation(part.name);
            stream.progress(`Using tool: ${part.name}...`);
            
            // Invoke the tool
            // VS Code finds the registered tool and executes it
            const result = await vscode.lm.invokeTool(
                part.name,
                {
                    input: part.input,              // Tool arguments from model
                    requestId: request.id,
                    toolInvocationToken: request.toolInvocationToken
                },
                token
            );
            
            // Optionally show tool result to user
            stream.markdown(`\\n*Tool result: ${result.content[0].value}*\\n`);
            
            // IMPORTANT: The tool result is automatically sent back to the model
            // Model continues reasoning with this new information
            // This enables multi-turn agent loops:
            //   1. Model calls search_workspace → gets file list
            //   2. Model calls read_file on interesting files → gets contents
            //   3. Model generates response based on file contents
        }
    }
    
    return { metadata: { toolsUsed: tools.map(t => t.name) } };
};
```

**Built-in VS Code Tools:**

VS Code provides several built-in tools that any chat participant can use:

| Tool Name | Description | Use Case |
|-----------|-------------|----------|
| `vscode_readFile` | Read file contents | Understanding existing code |
| `vscode_createFile` | Create new files | Code generation |
| `vscode_editFile` | Modify existing files | Refactoring, bug fixes |
| `vscode_executeCommand` | Run VS Code commands | Trigger actions (format, run tests) |
| `vscode_searchWorkspace` | Semantic search | Find relevant code |
| `vscode_getDiagnostics` | Get errors/warnings | Debugging assistance |

**Best Practices for Tool Design:**

1. **Descriptive Names**: Use `verb_noun` pattern (`search_files`, `run_tests`, not `search` or `tool1`)
2. **Clear Descriptions**: Models read these - be specific about what the tool does and when to use it
3. **Detailed Schema**: More schema detail = better model understanding and fewer errors
4. **Error Handling**: Always return meaningful errors - model needs to understand what went wrong
5. **Performance**: Keep tools fast (<2 seconds) or model may timeout
6. **Idempotency**: Same input should give same output when possible
7. **Security**: Validate all inputs - models can make mistakes or be manipulated
8. **Prefix Names**: Use `yourext_toolname` to avoid conflicts with other extensions

**Example Multi-Step Agent Workflow:**

```
User: "Fix the bug in UserController"
    ↓
Model: "I need to find the file first"
    → Calls: search_workspace({ query: "UserController" })
    ← Result: "Found: src/controllers/UserController.ts"
    ↓
Model: "Let me read the file"
    → Calls: read_file({ path: "src/controllers/UserController.ts" })
    ← Result: [file contents with bug]
    ↓
Model: "I see the bug on line 42. Let me fix it"
    → Calls: edit_file({ path: "...", line: 42, newCode: "..." })
    ← Result: "File updated successfully"
    ↓
Model: "I've fixed the null pointer bug by adding a null check"
```

---

## Request Flow: Method-Level Sequence

### Scenario 1: User sends "@copilot explain this code" in Chat Panel

```
User Input → Chat Panel UI
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 1. ChatWidget (src/vs/workbench/contrib/chat/browser/chatWidget.ts)│
│    - acceptInput(message: string)                                 │
│    - Parse: participant=copilot, command=undefined, prompt="explain..."│
└───────────────┬───────────────────────────────────────────────────┘
                │ Call chatService.sendRequest()
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 2. ChatService (src/vs/workbench/contrib/chat/common/chatServiceImpl.ts)│
│    async sendRequest(sessionResource, message, options) {         │
│      // Parse message                                             │
│      const parsed = this.chatParserService.parseChatRequest(msg); │
│      // Result: { agentId: 'github.copilot', prompt: '...', ...} │
│                                                                    │
│      // Get agent                                                 │
│      const agent = this.chatAgentService.getAgent(parsed.agentId);│
│                                                                    │
│      // Gather context                                            │
│      const context = await this.gatherContext(parsed, options);   │
│      // Collects: active editor, selection, diagnostics, etc.    │
│                                                                    │
│      // Create request                                            │
│      const request = model.addRequest(parsed, context, attempt);  │
│                                                                    │
│      // Invoke agent                                              │
│      const result = await agent.invoke(request, progress, ...);   │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ Call agent.invoke()
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 3. ChatAgentService (src/vs/workbench/contrib/chat/common/chatAgents.ts)│
│    agent.invoke(request, progress, history, token) {              │
│      // This calls the extension-registered implementation        │
│      return this._impl.invoke(request, progress, history, token); │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ IPC to Extension Host
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 4. MainThreadChatAgents2 (mainThreadChatAgents2.ts)              │
│    // Bridge between main thread and extension host              │
│    invoke: async (request, progress, history, token) => {         │
│      return await this._proxy.$invokeAgent(handle, request, ...); │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ RPC Call
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 5. ExtHostChatAgents2 (Extension Host)                           │
│    $invokeAgent(handle, request, context, progress, token) {      │
│      const agent = this._agents.get(handle);                      │
│      return agent.handler(request, context, stream, token);       │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ Call user's handler
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 6. YOUR EXTENSION - Chat Participant Handler                     │
│    async handler(request, context, stream, token) {               │
│      // Build prompt with context                                 │
│      const messages = [                                           │
│        vscode.LanguageModelChatMessage.User(systemPrompt),        │
│        vscode.LanguageModelChatMessage.User(request.prompt)       │
│      ];                                                            │
│                                                                    │
│      // Call language model                                       │
│      const response = await request.model.sendRequest(            │
│        messages,                                                   │
│        { tools: myTools },                                         │
│        token                                                       │
│      );                                                            │
│                                                                    │
│      // Stream response to UI                                     │
│      for await (const fragment of response.text) {                │
│        stream.markdown(fragment);  ◄─── Updates UI in real-time  │
│      }                                                             │
│                                                                    │
│      return { metadata: { ... } };                                │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ Call vscode.lm.sendRequest()
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 7. ExtHostLanguageModels (Extension Host)                        │
│    sendRequest(messages, options, token) {                        │
│      // Find provider for selected model                          │
│      const provider = this._providers.get(modelId);               │
│                                                                    │
│      // Call main thread via proxy                                │
│      return this._proxy.$sendChatRequest(                         │
│        modelId, messages, options, progress, token                │
│      );                                                            │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ RPC Call to Main Thread
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 8. MainThreadLanguageModels (Main Thread)                        │
│    $sendChatRequest(modelId, messages, options, progress, token) {│
│      return this.languageModelsService.sendChatRequest(           │
│        modelId, messages, options, progress, token                │
│      );                                                            │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ Call service
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 9. LanguageModelsService (languageModels.ts)                     │
│    sendChatRequest(modelId, messages, options, progress, token) { │
│      const provider = this._providers.get(modelId);               │
│      return provider.provideChatResponse(                         │
│        messages, options, progress, token                         │
│      );                                                            │
│    }                                                               │
└───────────────┬───────────────────────────────────────────────────┘
                │ Back to Extension Host via RPC
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ 10. YOUR EXTENSION - LanguageModelProvider                       │
│     provideLanguageModelChatResponse(...) {                       │
│       // 1. Get auth token                                        │
│       const token = await this.auth.getSession();                 │
│                                                                    │
│       // 2. Call Azure OpenAI / GitHub Models / etc.             │
│       const response = await fetch(endpoint, {                    │
│         method: 'POST',                                           │
│         headers: { 'Authorization': `Bearer ${token}` },          │
│         body: JSON.stringify({ model, messages, stream: true })   │
│       });                                                          │
│                                                                    │
│       // 3. Stream response via progress.report()                │
│       for await (const chunk of response.body) {                  │
│         const data = parseSSE(chunk);                             │
│         progress.report(new LanguageModelTextPart(data.content)); │
│         // ▲ This flows back through all layers to Chat UI       │
│       }                                                            │
│     }                                                              │
└───────────────────────────────────────────────────────────────────┘
                │ Progress updates flow back
                ▼
        Chat UI renders streaming response
```

---

### Scenario 2: User types prompt with Agent model selected

This scenario shows the complete interaction when a user types "Create a REST API for user management" in the chat with Claude 3.5 Sonnet (Agent) selected as the model.

```
┌─────────────┐
│   User      │
└─────┬───────┘
      │ Types: "Create a REST API for user management"
      │ Model selected: Claude 3.5 Sonnet (copilot/claude-3-5-sonnet)
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Chat Panel UI (ChatWidget)                                              │
│ src/vs/workbench/contrib/chat/browser/chatWidget.ts                    │
├─────────────────────────────────────────────────────────────────────────┤
│ acceptInput(message: string)                                            │
│   └─> Parse input                                                       │
│       • participant: (none - using default)                             │
│       • prompt: "Create a REST API for user management"                 │
│       • model: claude-3-5-sonnet                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ chatService.sendRequest(sessionUri, message, options)
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ChatService                                                             │
│ src/vs/workbench/contrib/chat/common/chatServiceImpl.ts                │
├─────────────────────────────────────────────────────────────────────────┤
│ async sendRequest(sessionResource, message, options) {                  │
│   1. Parse message                                                      │
│      parsed = chatParserService.parseChatRequest(message)               │
│      Result: {                                                          │
│        agentId: undefined,  // No @participant specified                │
│        command: undefined,   // No /command                             │
│        prompt: "Create a REST API...",                                  │
│        model: "claude-3-5-sonnet"                                       │
│      }                                                                   │
│                                                                          │
│   2. Resolve agent (use default since no @participant)                  │
│      agent = chatAgentService.getDefaultAgent()                         │
│      // Returns: @copilot participant                                   │
│                                                                          │
│   3. Gather context                                                     │
│      context = {                                                        │
│        activeEditor: vscode.window.activeTextEditor,                    │
│        selection: editor.selection,                                     │
│        diagnostics: vscode.languages.getDiagnostics(),                  │
│        workspaceFiles: vscode.workspace.workspaceFolders,               │
│        history: previousChatMessages                                    │
│      }                                                                   │
│                                                                          │
│   4. Create request model                                               │
│      request = chatModel.addRequest(parsed, context, attempt=0)         │
│      requestId = generateUuid()                                         │
│                                                                          │
│   5. Invoke agent                                                       │
│      result = await agent.invoke(request, progress, history, token)     │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ agent.invoke(request, progress, history, token)
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ChatAgentService                                                        │
│ src/vs/workbench/contrib/chat/common/chatAgents.ts                     │
├─────────────────────────────────────────────────────────────────────────┤
│ agent.invoke(request, progress, history, token) {                       │
│   // Delegate to extension-registered implementation                    │
│   return this._implementation.invoke(request, progress, history, token);│
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ IPC: Call ExtHost proxy
                      │ $invokeAgent(handle, request, context, progress, token)
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ MainThreadChatAgents2 (Main Thread - UI Process)                       │
│ src/vs/workbench/api/browser/mainThreadChatAgents2.ts                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Implementation registered for @copilot:                                 │
│ {                                                                        │
│   invoke: async (request, progress, history, token) => {                │
│     // Bridge to extension host                                         │
│     this._pendingProgress.set(request.requestId, {                      │
│       progress,      // Callback for streaming updates                  │
│       chatSession    // Current chat session                            │
│     });                                                                  │
│                                                                          │
│     return await this._proxy.$invokeAgent(                              │
│       handle: 123,  // Extension handle                                 │
│       request: {                                                         │
│         id: "req-uuid-123",                                             │
│         sessionId: "session-uuid-456",                                  │
│         prompt: "Create a REST API...",                                 │
│         model: "claude-3-5-sonnet",                                     │
│         attempt: 0,                                                      │
│         references: [...context.files],                                 │
│         locationData: { editor, selection }                             │
│       },                                                                 │
│       context: { history: [...] },                                      │
│       progress: progressCallback,                                       │
│       token                                                             │
│     );                                                                   │
│   }                                                                      │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ RPC to Extension Host
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ExtHostChatAgents2 (Extension Host Process - Node.js/Web Worker)       │
│ src/vs/workbench/api/node/extHostChatAgents2.ts                        │
├─────────────────────────────────────────────────────────────────────────┤
│ $invokeAgent(handle, request, context, progress, token) {               │
│   const agent = this._agents.get(handle);  // Get @copilot             │
│                                                                          │
│   // Create stream adapter                                              │
│   const stream = {                                                       │
│     markdown: (text) => progress.report({ kind: 'markdown', text }),    │
│     progress: (msg) => progress.report({ kind: 'progress', msg }),      │
│     reference: (uri) => progress.report({ kind: 'reference', uri }),    │
│     button: (cmd) => progress.report({ kind: 'button', command: cmd })  │
│   };                                                                     │
│                                                                          │
│   // Call user's handler                                                │
│   return agent.requestHandler(request, context, stream, token);         │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ Call extension's chat participant handler
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GitHub Copilot Extension - Chat Participant Handler                    │
│ vscode-copilot-chat/src/extension/conversation/                        │
│   copilotChatParticipant.ts                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ async handler(request, context, stream, token) {                        │
│   // 1. Show progress                                                   │
│   stream.progress('Analyzing your request...');                         │
│                                                                          │
│   // 2. Gather additional context                                       │
│   const workspace = await analyzeWorkspace();                           │
│   const codeContext = await getRelevantCode(request.locationData);      │
│                                                                          │
│   // 3. Build prompt with system instructions                           │
│   const systemPrompt = `You are GitHub Copilot, an AI coding assistant.│
│     Current task: Help create a REST API.                               │
│     Workspace: ${workspace.name}                                        │
│     Available tools: create_file, edit_file, run_command`;              │
│                                                                          │
│   const messages = [                                                    │
│     vscode.LanguageModelChatMessage.User(systemPrompt),                 │
│     vscode.LanguageModelChatMessage.User(request.prompt),               │
│     ...formatHistory(context.history)                                   │
│   ];                                                                     │
│                                                                          │
│   // 4. Select model (already specified by user)                        │
│   const [model] = await vscode.lm.selectChatModels({                    │
│     id: request.model  // "claude-3-5-sonnet"                           │
│   });                                                                    │
│                                                                          │
│   // 5. Prepare tools for agent mode                                    │
│   const tools = [                                                        │
│     vscode.lm.tools.find(t => t.name === 'vscode_createFile'),          │
│     vscode.lm.tools.find(t => t.name === 'vscode_editFile'),            │
│     vscode.lm.tools.find(t => t.name === 'vscode_runCommand'),          │
│     vscode.lm.tools.find(t => t.name === 'vscode_searchWorkspace')      │
│   ].filter(Boolean);                                                     │
│                                                                          │
│   // 6. Send request to language model with tools enabled               │
│   stream.progress('Thinking...');                                       │
│                                                                          │
│   const chatResponse = await model.sendRequest(                         │
│     messages,                                                            │
│     {                                                                    │
│       tools: tools,                                                      │
│       toolMode: vscode.LanguageModelChatToolMode.Auto                   │
│     },                                                                   │
│     token                                                               │
│   );                                                                     │
│                                                                          │
│   // 7. Process streaming response                                      │
│   for await (const part of chatResponse.stream) {                       │
│     if (part instanceof vscode.LanguageModelTextPart) {                 │
│       stream.markdown(part.value);  // ◄─ Streams to UI                │
│                                                                          │
│     } else if (part instanceof vscode.LanguageModelToolCallPart) {      │
│       // Model wants to use a tool                                      │
│       stream.progress(`Using tool: ${part.name}`);                      │
│       stream.prepareToolInvocation(part.name);                          │
│                                                                          │
│       // Execute tool                                                   │
│       const result = await vscode.lm.invokeTool(                        │
│         part.name,                                                       │
│         {                                                                │
│           input: part.input,                                            │
│           requestId: request.id,                                        │
│           toolInvocationToken: request.toolInvocationToken              │
│         },                                                               │
│         token                                                           │
│       );                                                                 │
│                                                                          │
│       // Send tool result back to model for next iteration              │
│       // (VS Code handles this in subsequent model call)                │
│     }                                                                    │
│   }                                                                      │
│                                                                          │
│   return { metadata: { modelUsed: 'claude-3-5-sonnet' } };              │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ model.sendRequest(messages, options, token)
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ExtHostLanguageModels (Extension Host)                                 │
│ src/vs/workbench/api/common/extHostLanguageModels.ts                   │
├─────────────────────────────────────────────────────────────────────────┤
│ async sendRequest(messages, options, token) {                           │
│   // Find model info                                                    │
│   const modelInfo = this._models.get('claude-3-5-sonnet');              │
│   // { vendor: 'copilot', family: 'claude-3', version: '3.5-sonnet' }  │
│                                                                          │
│   // Validate tool support                                              │
│   if (options.tools && !modelInfo.supportsTools) {                      │
│     throw new Error('Model does not support tools');                    │
│   }                                                                      │
│                                                                          │
│   // Create progress adapter for streaming                              │
│   const progressAdapter = new LanguageModelResponseStream();            │
│                                                                          │
│   // Call main thread via RPC                                           │
│   await this._proxy.$sendChatRequest(                                   │
│     modelId: 'copilot/claude-3-5-sonnet',                               │
│     messages: messages.map(m => ({                                      │
│       role: m.role,  // 'user' or 'assistant'                           │
│       content: m.content                                                │
│     })),                                                                 │
│     options: {                                                           │
│       tools: options.tools?.map(t => ({                                 │
│         name: t.name,                                                    │
│         description: t.description,                                     │
│         inputSchema: t.inputSchema                                      │
│       })),                                                               │
│       toolMode: 'auto',                                                  │
│       requestInitiator: 'chat-participant'                              │
│     },                                                                   │
│     progressToken: progressAdapter.token,                               │
│     token                                                               │
│   );                                                                     │
│                                                                          │
│   return progressAdapter.getResponse();                                 │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ RPC to Main Thread
                      │ $sendChatRequest(modelId, messages, options, progress, token)
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ MainThreadLanguageModels (Main Thread)                                 │
│ src/vs/workbench/api/browser/mainThreadLanguageModels.ts               │
├─────────────────────────────────────────────────────────────────────────┤
│ async $sendChatRequest(modelId, messages, options, progress, token) {   │
│   // Delegate to language models service                                │
│   return await this.languageModelsService.sendChatRequest(              │
│     modelId: 'copilot/claude-3-5-sonnet',                               │
│     messages,                                                            │
│     options,                                                             │
│     progress: (part) => {                                               │
│       // Forward progress back to extension host                        │
│       this._proxy.$reportProgress(progress, part);                      │
│     },                                                                   │
│     token                                                               │
│   );                                                                     │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ Call service
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ LanguageModelsService (VS Code Core)                                   │
│ src/vs/workbench/contrib/chat/common/languageModels.ts                 │
├─────────────────────────────────────────────────────────────────────────┤
│ async sendChatRequest(modelId, messages, options, progress, token) {    │
│   // 1. Find provider for model                                         │
│   const provider = this._providers.get('copilot');                      │
│   if (!provider) {                                                       │
│     throw new Error('Language model provider not found: copilot');      │
│   }                                                                      │
│                                                                          │
│   // 2. Get model info                                                  │
│   const model = provider.getModel('claude-3-5-sonnet');                 │
│   if (!model) {                                                          │
│     throw new Error('Model not found: claude-3-5-sonnet');              │
│   }                                                                      │
│                                                                          │
│   // 3. Check quotas and permissions                                    │
│   await this.checkQuota(provider, model);                               │
│                                                                          │
│   // 4. Call provider's implementation                                  │
│   return await provider.provideChatResponse(                            │
│     model,                                                               │
│     messages,                                                            │
│     options,                                                             │
│     progress,                                                            │
│     token                                                               │
│   );                                                                     │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ Back to Extension Host (provider is implemented there)
                      │ RPC: $provideChatResponse(handle, model, messages, options, progress, token)
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GitHub Copilot Extension - LanguageModelAccess                         │
│ vscode-copilot-chat/src/extension/conversation/vscode-node/            │
│   languageModelAccess.ts                                                │
├─────────────────────────────────────────────────────────────────────────┤
│ async _provideLanguageModelChatResponse(                                │
│   model: { id: 'claude-3-5-sonnet', ... },                              │
│   messages: readonly LanguageModelChatRequestMessage[],                 │
│   options: ProvideLanguageModelChatResponseOptions,                     │
│   progress: Progress<LanguageModelResponsePart>,                        │
│   token: CancellationToken                                              │
│ ): Promise<void> {                                                       │
│                                                                          │
│   // 1. Get authentication token                                        │
│   const session = await this.authenticationService.getSession(          │
│     ['user:email', 'copilot']                                           │
│   );                                                                     │
│   const authToken = session.accessToken;                                │
│                                                                          │
│   // 2. Get endpoint URL                                                │
│   const endpoint = await this.endpointService.getEndpoint();            │
│   // Returns: "https://api.githubcopilot.com/chat/completions"         │
│   //      or: "https://your-azure.openai.azure.com/..."                │
│                                                                          │
│   // 3. Format tools for API                                            │
│   const tools = options.tools?.map(tool => ({                           │
│     type: 'function',                                                    │
│     function: {                                                          │
│       name: tool.name,                                                   │
│       description: tool.description,                                    │
│       parameters: tool.inputSchema || {}                                │
│     }                                                                    │
│   }));                                                                   │
│                                                                          │
│   // 4. Make HTTP request to AI service                                 │
│   const response = await fetch(endpoint, {                              │
│     method: 'POST',                                                      │
│     headers: {                                                           │
│       'Authorization': `Bearer ${authToken}`,                           │
│       'Content-Type': 'application/json',                               │
│       'X-Request-Id': generateRequestId(),                              │
│       'Copilot-Integration-Id': 'vscode-chat'                           │
│     },                                                                   │
│     body: JSON.stringify({                                              │
│       model: 'claude-3-5-sonnet-20241022',  // Anthropic model ID      │
│       messages: messages.map(m => ({                                    │
│         role: m.role === 'user' ? 'user' : 'assistant',                 │
│         content: m.content                                              │
│       })),                                                               │
│       stream: true,                                                      │
│       tools: tools,                                                      │
│       tool_choice: options.toolMode === 'auto' ? 'auto' : undefined,   │
│       max_tokens: 4096,                                                  │
│       temperature: 0.7                                                   │
│     })                                                                   │
│   });                                                                    │
│                                                                          │
│   if (!response.ok) {                                                    │
│     throw new Error(`API error: ${response.status} ${response.statusText}`);│
│   }                                                                      │
│                                                                          │
│   // 5. Stream response via Server-Sent Events (SSE)                    │
│   const reader = response.body.getReader();                             │
│   const decoder = new TextDecoder();                                    │
│   let buffer = '';                                                       │
│                                                                          │
│   while (true) {                                                         │
│     if (token.isCancellationRequested) {                                │
│       reader.cancel();                                                  │
│       break;                                                            │
│     }                                                                    │
│                                                                          │
│     const { done, value } = await reader.read();                        │
│     if (done) break;                                                     │
│                                                                          │
│     buffer += decoder.decode(value, { stream: true });                  │
│     const lines = buffer.split('\n');                                   │
│     buffer = lines.pop() || '';                                         │
│                                                                          │
│     for (const line of lines) {                                         │
│       if (!line.startsWith('data: ')) continue;                         │
│       if (line === 'data: [DONE]') continue;                            │
│                                                                          │
│       const data = JSON.parse(line.slice(6));                           │
│       const delta = data.choices[0]?.delta;                             │
│                                                                          │
│       if (delta?.content) {                                             │
│         // Text content from model                                      │
│         progress.report(                                                │
│           new LanguageModelTextPart(delta.content)                      │
│         );                                                               │
│         // ▲ This flows back through all layers to Chat UI             │
│                                                                          │
│       } else if (delta?.tool_calls) {                                   │
│         // Model is calling a tool                                      │
│         for (const toolCall of delta.tool_calls) {                      │
│           if (toolCall.function) {                                      │
│             progress.report(                                            │
│               new LanguageModelToolCallPart(                            │
│                 toolCall.id,                                            │
│                 toolCall.function.name,                                 │
│                 JSON.parse(toolCall.function.arguments)                 │
│               )                                                          │
│             );                                                           │
│             // ▲ This triggers tool execution in the chat handler      │
│           }                                                              │
│         }                                                                │
│       }                                                                  │
│     }                                                                    │
│   }                                                                      │
│                                                                          │
│   // 6. Log telemetry                                                   │
│   this.telemetryService.logUsage('languageModel.request', {             │
│     model: 'claude-3-5-sonnet',                                         │
│     tokensUsed: response.headers.get('X-Token-Count'),                  │
│     duration: Date.now() - startTime                                    │
│   });                                                                    │
│ }                                                                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ Progress reports flow back through all layers:
                      │ ExtHostLanguageModels → MainThreadLanguageModels
                      │ → LanguageModelsService → ChatService → ChatWidget
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Chat UI Updates (Real-time)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│ Each progress.report() call results in:                                 │
│                                                                          │
│ 1. Text Chunks: Rendered as markdown in chat message                    │
│    "I'll help you create a REST API for user management..."             │
│                                                                          │
│ 2. Tool Calls: Shown as "Using tool: create_file"                       │
│    progress indicator with tool name                                    │
│                                                                          │
│ 3. Tool Results: Displayed after tool execution                         │
│    "✓ Created file: src/api/users.ts"                                   │
│                                                                          │
│ 4. References: Shown as clickable links                                 │
│    "📄 src/api/users.ts"                                                │
│                                                                          │
│ 5. Buttons: Interactive commands                                        │
│    [Open File] [Run Tests] [Deploy]                                     │
│                                                                          │
│ All updates appear immediately as streaming chunks arrive               │
└─────────────────────────────────────────────────────────────────────────┘

Timeline (approximate):
─────────────────────────────────────────────────────────────────────────
0ms    │ User presses Enter
10ms   │ ChatWidget.acceptInput() called
15ms   │ ChatService.sendRequest() - parsing complete
20ms   │ Agent resolved (@copilot), context gathered
25ms   │ IPC to Extension Host
30ms   │ Extension handler starts
50ms   │ Progress: "Analyzing your request..."  ◄─ First UI update
100ms  │ model.sendRequest() called
150ms  │ RPC to MainThreadLanguageModels
200ms  │ LanguageModelAccess starts HTTP request
400ms  │ First SSE chunk received from API
410ms  │ First text appears in UI: "I'll help you..."  ◄─ Streaming starts
500ms  │ Tool call detected: create_file
510ms  │ UI shows: "Using tool: create_file"
600ms  │ Tool executed, file created
610ms  │ UI shows: "✓ Created file: src/api/users.ts"
800ms  │ More text: "Here's the implementation..."
3000ms │ Final text chunk received
3010ms │ UI shows: [Open File] button
3020ms │ Response complete, handler returns
─────────────────────────────────────────────────────────────────────────
```

**Key Observations:**

1. **Streaming is Real-time**: Every `progress.report()` call immediately updates the UI
2. **Tool Execution is Automatic**: When model returns a tool call, it's automatically invoked
3. **Multi-turn with Tools**: After tool execution, results can be sent back to model for next iteration
4. **Cross-process Communication**: Data flows through multiple IPC/RPC boundaries efficiently
5. **Agent Model Capability**: Claude 3.5 Sonnet supports tool calling, enabling autonomous workflows

---

## Key Implementation Files

### VS Code Core
| File | Purpose |
|------|---------|
| `src/vs/workbench/contrib/chat/common/languageModels.ts` | LanguageModelsService - manages providers |
| `src/vs/workbench/contrib/chat/common/chatService.ts` | ChatService - orchestrates chat requests |
| `src/vs/workbench/api/browser/mainThreadLanguageModels.ts` | Main thread bridge for language models |
| `src/vs/workbench/api/browser/mainThreadChatAgents2.ts` | Main thread bridge for chat participants |
| `src/vs/workbench/contrib/chat/browser/chatWidget.ts` | Chat UI widget |
| `src/vscode-dts/vscode.proposed.chatProvider.d.ts` | Language Model Provider API types |
| `src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts` | Chat Participant API types |

### GitHub Copilot Extension
| File | Purpose |
|------|---------|
| `src/extension/conversation/vscode-node/languageModelAccess.ts` | Language model provider implementation |
| `src/extension/conversation/conversation.contribution.ts` | Chat participant registration |
| `src/extension/conversation/copilotChatParticipant.ts` | @copilot participant |
| `src/extension/conversation/workspaceChatParticipant.ts` | @workspace participant |
| `src/extension/mcp/` | Model Context Protocol integration |

---

## Code Snippets from Real Implementation

### 1. Extension Activation (GitHub Copilot)

```typescript
// Simplified from vscode-copilot-chat/src/extension/extension/vscode/extension.ts
export async function activate(context: vscode.ExtensionContext) {
    // 1. Initialize authentication
    const authService = new AuthenticationService();
    
    // 2. Initialize language model provider
    const languageModelAccess = new LanguageModelAccess(
        authService,
        endpointService,
        telemetryService
    );
    
    // Register language models (gpt-4, claude, etc.)
    const models = [
        { id: 'gpt-4', name: 'GPT-4', vendor: 'copilot', family: 'gpt-4' },
        { id: 'gpt-4o', name: 'GPT-4o', vendor: 'copilot', family: 'gpt-4o' },
        { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', vendor: 'copilot', family: 'claude-3' },
        // ... more models
    ];
    
    context.subscriptions.push(
        languageModelAccess.registerLanguageModelProvider(models)
    );
    
    // 3. Register chat participants
    registerCopilotChatParticipant(context);
    registerWorkspaceChatParticipant(context);
    
    // 4. Register tools for agent mode
    registerChatTools(context);
}
```

### 2. Language Model API Usage (Extension consuming Copilot)

```typescript
// Any extension can use the language models provided by Copilot
async function askAI(prompt: string) {
    // 1. Select a model
    const [model] = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: 'gpt-4o'
    });
    
    if (!model) {
        throw new Error('Model not available');
    }
    
    // 2. Build messages
    const messages = [
        vscode.LanguageModelChatMessage.User(prompt)
    ];
    
    // 3. Send request
    const response = await model.sendRequest(messages, {}, token);
    
    // 4. Collect response
    let result = '';
    for await (const fragment of response.text) {
        result += fragment;
    }
    
    return result;
}
```

### 3. Package.json Declaration (Chat Participant)

```json
{
  "contributes": {
    "chatParticipants": [
      {
        "id": "myext.assistant",
        "name": "assistant",
        "description": "AI assistant for your extension",
        "isSticky": true,
        "commands": [
          {
            "name": "explain",
            "description": "Explain the selected code"
          },
          {
            "name": "fix",
            "description": "Fix problems in the code"
          }
        ]
      }
    ]
  },
  "activationEvents": [
    "onChatParticipant:myext.assistant"
  ],
  "enabledApiProposals": [
    "chatProvider",
    "chatParticipantAdditions",
    "chatParticipantPrivate",
    "languageModels"
  ]
}
```

---

## Summary: How to Build a Copilot-like Extension

### Step 1: Implement Language Model Provider

```typescript
class MyLanguageModelProvider implements vscode.LanguageModelChatProvider {
    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Call your AI service (OpenAI, Anthropic, local model, etc.)
        const response = await yourAIService.chat({
            model: model.id,
            messages: messages,
            stream: true
        });
        
        // Stream back to VS Code
        for await (const chunk of response) {
            progress.report(new vscode.LanguageModelTextPart(chunk.text));
        }
    }
}

// Register
vscode.lm.registerChatModelProvider('myext', new MyLanguageModelProvider(), models);
```

### Step 2: Create Chat Participants

```typescript
const participant = vscode.chat.createChatParticipant('myext.agent', async (request, context, stream, token) => {
    // Handle user request
    stream.progress('Thinking...');
    
    // Use language model
    const response = await request.model.sendRequest([
        vscode.LanguageModelChatMessage.User(request.prompt)
    ], {}, token);
    
    for await (const chunk of response.text) {
        stream.markdown(chunk);
    }
});
```

### Step 3: Add Agent Capabilities (Optional)

```typescript
// Register tools
vscode.lm.registerTool('myext_search', {
    name: 'search',
    description: 'Search workspace',
    invoke: async (options, token) => {
        const results = await performSearch(options.input);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(results))
        ]);
    }
});

// Use tools in participant
const response = await request.model.sendRequest(messages, {
    tools: vscode.lm.tools,
    toolMode: vscode.LanguageModelChatToolMode.Auto
}, token);
```

---

