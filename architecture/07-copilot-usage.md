# Copilot Usage and Quota Architecture

This document details how VS Code tracks, fetches, and displays GitHub Copilot usage and quota information.

## Overview

Contrary to typical extension architecture where the extension owns the entire feature, **Copilot Usage reporting is a hybrid implementation**:
1. **VS Code Core** (`ChatEntitlementService`): Responsible for fetching user entitlements and quota status directly from GitHub APIs.
2. **VS Code Core** (`ChatStatus`): Renders the "Copilot Usage" UI in the status bar.
3. **Copilot Extension** (`ChatQuotaService`): Monitors real-time usage via API response headers to handle immediate rate limiting.

## 1. Usage Reporting Architecture

Usage is tracked **server-side** by GitHub. The client (VS Code) does not calculate token usage itself for billing purposes; it only fetches the current state from the server.

### Data Source: `copilot_internal/user`

The primary source of truth is the `copilot_internal/user` endpoint.

**Request**:
```http
GET https://api.github.com/copilot_internal/user
Authorization: Bearer <github_oauth_token>
```

**Response (Simplified)**:
```json
{
  "quota_snapshots": {
    "chat": {
      "entitlement": 50,
      "remaining": 42,
      "percent_remaining": 84,
      "overage_permitted": false,
      "unlimited": false
    },
    "completions": {
      "entitlement": -1, // Unlimited
      "remaining": -1,
      "unlimited": true
    },
    "premium_interactions": {
      "entitlement": 100,
      "remaining": 95,
      "percent_remaining": 95
    }
  },
  "quota_reset_date": "2025-12-01T00:00:00Z"
}
```

### Core Implementation: `ChatEntitlementService`

VS Code Core implements `ChatEntitlementService` to fetch and cache this data.

```typescript
// src/vs/workbench/services/chat/common/chatEntitlementService.ts

export class ChatEntitlementService extends Disposable implements IChatEntitlementService {
    // ...
    private async resolveEntitlement(sessions: AuthenticationSession[], token: CancellationToken): Promise<IEntitlements> {
        // 1. Call the API
        const response = await this.request(this.getEntitlementUrl(), 'GET', undefined, sessions, token);
        const entitlementsResponse = await asJson<IEntitlementsResponse>(response);

        // 2. Parse Quotas
        const quotas = this.toQuotas(entitlementsResponse);
        
        // 3. Update State & Context Keys
        this.update({
            entitlement: entitlementsResponse.entitlement,
            quotas,
            // ...
        });
        
        return this.state;
    }
}
```

## 2. Real-Time Updates via Headers

While the Core service polls for general status, the **Copilot Extension** monitors individual API responses for real-time quota updates. GitHub sends quota snapshots in HTTP headers.

**Headers**:
- `x-quota-snapshot-chat`
- `x-quota-snapshot-premium_interactions`

**Extension Implementation**:
```typescript
// src/platform/chat/common/chatQuotaServiceImpl.ts

export class ChatQuotaService extends Disposable implements IChatQuotaService {
    processQuotaHeaders(headers: IHeaders): void {
        const quotaHeader = headers.get('x-quota-snapshot-chat');
        if (!quotaHeader) return;

        // Parse URL encoded string: "ent=50&rem=42&ov=0&ovPerm=false"
        const params = new URLSearchParams(quotaHeader);
        
        this._quotaInfo = {
            quota: parseInt(params.get('ent') || '0', 10),
            used: ...,
            // ...
        };
    }
}
```

## 3. The Copilot Usage UI

The "Copilot Usage" UI is triggered by the **Copilot Status Bar Item**.

### Trigger Mechanism
1. **Status Bar Item**: Created by `ChatStatusContribution` in VS Code Core.
2. **User Action**: Clicking the Copilot icon (or `{ }` icon) opens the Chat Status flyout.
3. **Rendering**: `ChatStatus.ts` renders the usage section if quotas are available.

### UI Rendering Logic

The UI dynamically renders based on the quotas fetched by `ChatEntitlementService`.

```typescript
// src/vs/workbench/contrib/chat/browser/chatStatus.ts

show(token: CancellationToken): HTMLElement {
    // ...
    const { chat: chatQuota, completions: completionsQuota } = this.chatEntitlementService.quotas;

    if (chatQuota || completionsQuota) {
        // 1. Add Separator
        addSeparator(localize('usageTitle', "Copilot Usage"), toAction({
            id: 'workbench.action.manageCopilot',
            label: localize('quotaLabel', "Manage Chat"),
            // ...
        }));

        // 2. Render Indicators
        if (chatQuota) {
            this.createQuotaIndicator(element, disposables, chatQuota, "Chat messages");
        }
        if (completionsQuota) {
            this.createQuotaIndicator(element, disposables, completionsQuota, "Inline Suggestions");
        }

        // 3. Render Reset Date
        if (resetDate) {
            element.appendChild($('div.description', ..., `Allowance resets ${resetDate}`));
        }
    }
}
```

### Visual Components
- **Quota Indicator**: A progress bar or text showing remaining usage.
- **Upgrade Button**: If the user is on a Free plan and running low on quota (`percentRemaining <= 25`), an "Upgrade to Copilot Pro" button is shown.
- **Manage Action**: Links to GitHub settings to manage the subscription.

## Summary of Call Chain

1. **Initialization**: `ChatEntitlementService` (Core) starts and fetches initial entitlement from `copilot_internal/user`.
2. **Status Bar**: `ChatStatusContribution` (Core) shows the Copilot icon.
3. **User Click**: Triggers `ChatStatus.show()`.
4. **Rendering**: `ChatStatus` reads `ChatEntitlementService.quotas` and builds the DOM elements for "Copilot Usage".
5. **Updates**: 
    - **Polling**: `ChatEntitlementService` refreshes periodically.
    - **Real-time**: Extension `ChatQuotaService` reads headers from chat responses -> updates internal state (though UI is primarily driven by Core service).

## 4. Registration and Extensibility

### Registration
The status bar item is registered as a **Workbench Contribution** in the VS Code Core.

```typescript
// src/vs/workbench/contrib/chat/browser/chat.contribution.ts
registerWorkbenchContribution2(ChatStatusBarEntry.ID, ChatStatusBarEntry, WorkbenchPhase.BlockRestore);
```

The `ChatEntitlementService` is registered as a **Singleton** service.

```typescript
// src/vs/workbench/services/chat/common/chatEntitlementService.ts
registerSingleton(IChatEntitlementService, ChatEntitlementService, InstantiationType.Eager);
```

### Overriding the System
Since `ChatEntitlementService` and `ChatStatusBarEntry` are core components registered as singletons/contributions, **they cannot be directly overridden** by an extension.

If you need to provide a custom usage UI (e.g., for a different provider or custom enterprise logic):

1.  **Hide the Default UI**:
    Users can hide the built-in status bar item via the context menu ("Hide 'Copilot Status'").
    
2.  **Implement Custom UI**:
    Create a VS Code extension that registers its own `StatusBarItem`.
    ```typescript
    const myItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myItem.text = "$(copilot) Custom Usage";
    myItem.show();
    ```

3.  **Implement Custom Fetching**:
    Your extension must implement its own logic to fetch usage data, as it cannot inject behavior into the private `ChatEntitlementService`.
