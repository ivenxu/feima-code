## Internationalization and Localization (i18n/l10n)

### Overview

VS Code provides two complementary systems for localizing extension strings:

1. **`vscode.l10n` API** (Built-in, Stable) - For runtime localization in extension code
2. **`@vscode/l10n` Package** (Extension dependency) - For additional utilities and tooling
3. **`package.nls.json`** - For static contributions (commands, settings, etc.)

**Key Insight**: AI prompts (TSX files) are **NOT localized**. They remain in English and are sent directly to language models. Only user-facing UI strings are localized.

### Two Localization Systems

#### 1. Built-in `vscode.l10n` API (Stable since VS Code 1.73)

**Purpose**: Localize strings in TypeScript extension code at runtime.

**API Reference** (`vscode.d.ts`):
```typescript
export namespace l10n {
    /**
     * Marks a string for localization with index templating.
     * @example l10n.t('Hello {0}!', 'World');
     */
    function t(message: string, ...args: Array<string | number | boolean>): string;
    
    /**
     * Marks a string for localization with named templating.
     * @example l10n.t('Hello {name}', { name: 'Erich' });
     */
    function t(message: string, args: Record<string, any>): string;
    
    /**
     * Marks a string with translator comments.
     * @example l10n.t({ 
     *   message: 'Delete {0}?', 
     *   args: [fileName],
     *   comment: 'Confirmation dialog for file deletion' 
     * });
     */
    function t(options: {
        message: string;
        args?: Array<string | number | boolean> | Record<string, any>;
        comment: string | string[];
    }): string;
    
    /**
     * The bundle of localized strings (undefined if using default language).
     */
    const bundle: { [key: string]: string } | undefined;
    
    /**
     * URI of the localization bundle that has been loaded.
     */
    const uri: Uri | undefined;
}
```

**Usage in GitHub Copilot** (`defaultIntentRequestHandler.ts`):
```typescript
import * as vscode from 'vscode';

// Simple string
this.stream.markdown(vscode.l10n.t("Let me know if there's anything else I can help with!"));

// With placeholder
const message = vscode.l10n.t('The model unexpectedly did not return a response. Request ID: {0}', requestId);

// With named placeholder and comment
const description = vscode.l10n.t({
    message: 'Part of this attachment was not sent to the model due to context window limitations.',
    comment: 'Shown when file references are truncated'
});
```

#### 2. `@vscode/l10n` Package

**Purpose**: External package providing l10n utilities for extensions that run in environments without access to VS Code's built-in API (e.g., language servers, standalone Node processes).

**Installation**:
```bash
npm install @vscode/l10n
```

**Key Difference from `vscode.l10n`**:
- `@vscode/l10n`: Standalone package, can be used outside VS Code API context
- `vscode.l10n`: Built-in API, requires VS Code extension context

**Usage Pattern**:
```typescript
// Option 1: Use vscode.l10n (preferred in extension host)
import * as vscode from 'vscode';
const message = vscode.l10n.t('Hello {0}', name);

// Option 2: Use @vscode/l10n (for language servers, workers, etc.)
import * as l10n from '@vscode/l10n';
const message = l10n.t('Hello {0}', name);
```

**GitHub Copilot Usage**:
```typescript
// In chatParticipantRequestHandler.ts
import * as l10n from '@vscode/l10n';

const message = l10n.t(`Please specify a question when using this command.\n\nUsage: {0}`, usage);
```

**Why use `@vscode/l10n` instead of `vscode.l10n`?**
The Copilot extension likely uses `@vscode/l10n` for consistency across different execution contexts (extension host, language servers, web workers), though functionally they provide the same API.

#### 3. VS Code's Legacy `localize()` Function

**File**: `vscode-copilot-chat/src/util/vs/nls.ts` (copied from VS Code core)

**Purpose**: Backward compatibility with VS Code's internal localization system. Used in code ported from VS Code core.

```typescript
import { localize } from '../../../util/vs/nls';

// Usage
const message = localize('computingTools', 'Optimizing tool selection...');
```

**Key Difference**:
- `localize(key, message, ...args)`: Requires unique key for each string
- `l10n.t(message, ...args)`: Uses message as key (simpler, preferred for new code)

**Comparison**:
```typescript
// Legacy localize()
localize('sayHello', 'Hello {0}', name);  // Key: 'sayHello', message as fallback

// Modern l10n.t()
l10n.t('Hello {0}', name);  // Message is both key and fallback
```

### Localization Bundle Structure

#### Extension Configuration (`package.json`):
```json
{
    "name": "copilot-chat",
    "l10n": "./l10n",  // Directory containing translation bundles
    "contributes": {
        "commands": [
            {
                "command": "github.copilot.explainThis",
                "title": "%github.copilot.command.explainThis%"  // Reference to package.nls.json
            }
        ]
    }
}
```

#### Static String Translations (`package.nls.json`):
```json
{
    "github.copilot.command.explainThis": "Explain",
    "github.copilot.command.fixThis": "Fix",
    "github.copilot.viewsWelcome.signIn": {
        "message": "Sign in to enable features powered by GitHub Copilot.\n\n[Sign in](command:workbench.action.chat.triggerSetupForceSignIn)",
        "comment": [
            "{Locked='['}",
            "{Locked='](command:workbench.action.chat.triggerSetupForceSignIn)'}"
        ]
    }
}
```

**Usage in `package.json`**:
- `%key%` syntax references strings from `package.nls.json`
- Used for: command titles, setting descriptions, view titles, etc.
- **Not used in TypeScript code** - only in JSON contributions

#### Runtime String Translations (`l10n/bundle.l10n.{locale}.json`):

**Structure**:
```
extension-root/
  l10n/
    bundle.l10n.json         # English (default)
    bundle.l10n.ja.json      # Japanese
    bundle.l10n.zh-cn.json   # Simplified Chinese
    bundle.l10n.de.json      # German
```

**Example** (`l10n/bundle.l10n.ja.json`):
```json
{
    "Hello": "こんにちは",
    "Hello {0}": "こんにちは {0}",
    "Hello {name}": "こんにちは {name}",
    "Let me know if there's anything else I can help with!": "他に何かお手伝いできることがあればお知らせください！"
}
```

**How it Works**:
1. Extension calls: `vscode.l10n.t('Hello {0}', 'World')`
2. VS Code checks: `vscode.env.language` (e.g., "ja")
3. Loads: `l10n/bundle.l10n.ja.json` if exists
4. Looks up: `"Hello {0}"` key → `"こんにちは {0}"`
5. Substitutes: `{0}` → `"World"` → Returns: `"こんにちは World"`
6. Fallback: If no translation found, returns original English message

### String Templating Patterns

#### Index-based Placeholders:
```typescript
// Code
l10n.t('Hello {0}, you have {1} messages', userName, messageCount);

// Translation (ja)
{
    "Hello {0}, you have {1} messages": "{0}さん、{1}件のメッセージがあります"
}

// Output (ja): "Taro さん、5件のメッセージがあります"
```

#### Named Placeholders (Recommended):
```typescript
// Code
l10n.t('Hello {name}, you have {count} messages', { name: userName, count: messageCount });

// Translation (ja)
{
    "Hello {name}, you have {count} messages": "{name}さん、{count}件のメッセージがあります"
}

// Output (ja): "Taro さん、5件のメッセージがあります"
```

**Advantages of Named Placeholders**:
- Clearer intent for translators
- Order-independent (critical for languages with different word order)
- Self-documenting code

### Localization Workflow

#### 1. Development (Write Code)
```typescript
// Use l10n.t() for all user-facing strings
this.stream.markdown(vscode.l10n.t('Processing your request...'));

// Add comments for complex strings
const message = vscode.l10n.t({
    message: 'Delete {count} files?',
    args: { count: fileCount },
    comment: 'Confirmation dialog for bulk file deletion'
});
```

#### 2. String Extraction (Build Time)
```bash
# Install l10n tooling
npm install --save-dev @vscode/l10n-dev

# Extract strings from code
npx @vscode/l10n-dev export -o ./l10n ./src

# Generates: l10n/bundle.l10n.json with all English strings
```

**Generated** (`l10n/bundle.l10n.json`):
```json
{
    "Processing your request...": "Processing your request...",
    "Delete {count} files?": {
        "message": "Delete {count} files?",
        "comment": ["Confirmation dialog for bulk file deletion"]
    }
}
```

#### 3. Translation (External)
- Send `bundle.l10n.json` to translators
- Receive back `bundle.l10n.{locale}.json` files
- Place in `l10n/` directory

#### 4. Runtime (VS Code)
- Automatically loads correct bundle based on `vscode.env.language`
- No code changes needed

### AI Prompts Are NOT Localized

**Critical Distinction**: Prompt TSX files (system instructions, user messages) are **not localized** and remain in English.

**Example Prompt** (`codebaseAgentPrompt.tsx`):
```tsx
export class CodebaseAgentPrompt extends PromptElement<Props> {
    async render(state: void, sizing: PromptSizing) {
        return (
            <>
                <InstructionMessage>
                    <Tag name='instructions'>
                        You are a code search expert.<br />
                        A developer needs to find some code in their codebase...
                    </Tag>
                </InstructionMessage>
            </>
        );
    }
}
```

**Why Prompts Aren't Localized**:

1. **AI Model Language**: Most high-quality models (GPT-4, Claude, etc.) perform best with English prompts
2. **Consistency**: Ensures predictable behavior across all locales
3. **Maintenance**: Single prompt version is easier to test and optimize
4. **Context**: User queries may be in any language; prompt language doesn't restrict this

**User Experience Flow**:
```
User (Japanese): "このコードを説明して" (Explain this code)
    ↓
Extension: Detects user language from VS Code settings
    ↓
Prompt (English): "You are an AI coding assistant. Explain the following code..."
    ↓
AI Model: Processes English prompt + user's Japanese query
    ↓
Response (Japanese): "このコードは..." (This code...)
    ↓
UI Messages (Japanese): l10n.t('Processing...') → "処理中..."
```

**What Gets Localized vs Not**:

| String Type | Localized? | System | Example |
|-------------|-----------|--------|---------|
| Command titles | ✅ Yes | `package.nls.json` | "Explain" → "説明" |
| Setting descriptions | ✅ Yes | `package.nls.json` | "Enable feature" → "機能を有効化" |
| Error messages | ✅ Yes | `vscode.l10n.t()` | "Request failed" → "リクエストが失敗しました" |
| Progress indicators | ✅ Yes | `vscode.l10n.t()` | "Processing..." → "処理中..." |
| Status messages | ✅ Yes | `vscode.l10n.t()` | "Done" → "完了" |
| **AI system prompts** | ❌ No | TSX (English) | "You are an AI assistant..." |
| **AI instructions** | ❌ No | TSX (English) | "Follow these rules..." |
| **Tool descriptions** | ❌ No | TSX (English) | "Use file_search to..." |

### Best Practices

#### 1. Always Localize User-Facing Strings
```typescript
// ✅ Good: Localized
stream.markdown(vscode.l10n.t('Request completed successfully'));

// ❌ Bad: Hardcoded English
stream.markdown('Request completed successfully');
```

#### 2. Use Named Placeholders for Clarity
```typescript
// ✅ Good: Named placeholders
l10n.t('Found {count} results in {file}', { count: results.length, file: fileName });

// ⚠️ Acceptable but less clear
l10n.t('Found {0} results in {1}', results.length, fileName);
```

#### 3. Provide Translator Comments
```typescript
// ✅ Good: Comment helps translators understand context
l10n.t({
    message: 'Commit',
    comment: 'Button label for git commit action (verb, not noun)'
});

// ❌ Bad: Ambiguous without context
l10n.t('Commit');  // Could be noun or verb in English
```

#### 4. Keep Prompts in English
```tsx
// ✅ Good: Prompt stays in English
<InstructionMessage>
    You are an expert programmer. Help the user with their coding task.
</InstructionMessage>

// ❌ Bad: Don't localize prompts
<InstructionMessage>
    {l10n.t('You are an expert programmer...')}  // Unnecessary and harmful
</InstructionMessage>
```

#### 5. Avoid String Concatenation
```typescript
// ✅ Good: Single localizable string with placeholder
l10n.t('File {name} was deleted', { name: fileName });

// ❌ Bad: Concatenation breaks localization
l10n.t('File ') + fileName + l10n.t(' was deleted');
```

#### 6. Extract Strings Early
```typescript
// ✅ Good: Use l10n.t() from day one
const message = vscode.l10n.t('Loading model...');

// ❌ Bad: Planning to add later (often forgotten)
const message = 'Loading model...';  // TODO: localize
```

### Testing Localization

#### 1. Test with Pseudo-Locale
```typescript
// VS Code has built-in pseudo-localization for testing
// Set "locale": "qps-ploc" in argv.json
// Strings appear as: "［Ｌｏａｄｉｎｇ　ｍｏｄｅｌ．．．］"
```

#### 2. Verify String Extraction
```bash
# Extract strings
npx @vscode/l10n-dev export -o ./l10n ./src

# Verify bundle.l10n.json contains all strings
cat l10n/bundle.l10n.json
```

#### 3. Test Missing Translations
```typescript
// Missing translations should gracefully fall back to English
// Test by deleting a key from bundle.l10n.ja.json
```

### Common Pitfalls

1. **Localizing AI Prompts**: Don't do it! Keep prompts in English for consistency
2. **Late Localization**: Adding l10n after development is painful; start from day one
3. **String Concatenation**: Breaks translation; use placeholders instead
4. **Ambiguous Strings**: "Save" could be verb or noun; add comments
5. **Dynamic Keys**: Don't compute keys at runtime; l10n needs static analysis
6. **Markdown in Strings**: Translators may break formatting; use placeholders

### Localization Summary

**For Extension Developers**:
- ✅ Use `vscode.l10n.t()` for all UI strings (messages, errors, progress)
- ✅ Use `%key%` in `package.json` + `package.nls.json` for contributions
- ✅ Provide translator comments for ambiguous strings
- ✅ Use named placeholders `{name}` over indexed `{0}`
- ❌ Don't localize AI prompts (TSX files)
- ❌ Don't concatenate localized strings

**For AI Extension Developers**:
- **User Interface**: Fully localized (buttons, messages, errors)
- **AI Prompts**: English only (system messages, instructions, tool descriptions)
- **User Input**: Accepted in any language (AI models handle this naturally)
- **AI Output**: Follows user's language (models detect and respond appropriately)

This dual approach ensures:
- Consistent, optimized AI behavior (English prompts)
- Localized user experience (native language UI)
- Global accessibility (users can work in their preferred language)

---

