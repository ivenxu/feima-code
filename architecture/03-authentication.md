## Authentication System

### Overview

GitHub Copilot uses a **two-token authentication system** to separate user identity from API access:

1. **GitHub OAuth Token**: User-level authentication with GitHub
2. **Copilot Token**: API-level access token for language model requests

**Key Insight**: GitHub Copilot does NOT implement a custom authentication UI. It uses VS Code's built-in **Accounts Menu** (the profile icon in the Activity Bar) through the `github-authentication` extension that ships with VS Code.

### OAuth 2.0 Flow Breakdown

The authentication process follows the standard **OAuth 2.0 Authorization Code Flow** with PKCE (Proof Key for Code Exchange):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: OAuth 2.0 Authorization (User Authentication & Consent)        │
└──────────────────────────────────────────────────────────────────────────┘

1. Authorization Request (Browser)
   ┌──────────────────────────────────────────────────────────────┐
   │ VS Code opens browser to:                                    │
   │ https://github.com/login/oauth/authorize?                    │
   │   client_id=<vscode_client_id>                               │
   │   scope=user:email (or read:user+repo+workflow)              │
   │   redirect_uri=vscode://vscode.github-authentication         │
   │   state=<random_state>                                       │
   │   code_challenge=<pkce_challenge>                            │
   │   code_challenge_method=S256                                 │
   └──────────────────────────────────────────────────────────────┘
                            ↓
   ┌──────────────────────────────────────────────────────────────┐
   │ 👤 USER ACTION: Sign in to GitHub + Grant Permissions        │
   │                                                              │
   │ • User enters GitHub username/password (or uses SSO)         │
   │ • GitHub shows consent screen:                               │
   │   "VS Code wants to access:"                                 │
   │   ✓ Your email address (user:email)                         │
   │   ✓ Your repositories (repo) - if workspace features needed  │
   │ • User clicks "Authorize"                                    │
   └──────────────────────────────────────────────────────────────┘
                            ↓
2. Authorization Response (Redirect)
   ┌──────────────────────────────────────────────────────────────┐
   │ GitHub redirects to:                                         │
   │ vscode://vscode.github-authentication/did-authenticate?      │
   │   code=<authorization_code>                                  │
   │   state=<same_state>                                         │
   │                                                              │
   │ VS Code receives this via URI handler                        │
   └──────────────────────────────────────────────────────────────┘
                            ↓
3. Token Exchange (Backend)
   ┌──────────────────────────────────────────────────────────────┐
   │ POST https://github.com/login/oauth/access_token             │
   │ Headers:                                                     │
   │   Accept: application/json                                   │
   │ Body:                                                        │
   │   client_id=<vscode_client_id>                               │
   │   code=<authorization_code>                                  │
   │   code_verifier=<pkce_verifier>                              │
   │   redirect_uri=vscode://vscode.github-authentication         │
   │                                                              │
   │ Response:                                                    │
   │ {                                                           │
   │   access_token: "gho_...",   // GitHub OAuth Token         │
   │   token_type: "bearer",                                     │
   │   scope: "user:email"                                       │
   │ }                                                           │
   └──────────────────────────────────────────────────────────────┘
                            ↓
4. User Info Fetch
   ┌──────────────────────────────────────────────────────────────┐
   │ GET https://api.github.com/user                              │
   │ Authorization: Bearer gho_...                                │
   │                                                              │
   │ Response:                                                    │
   │ {                                                           │
   │   login: "username",                                        │
   │   id: 12345,                                                │
   │   email: "user@example.com"                                 │
   │ }                                                           │
   │                                                              │
   │ ✅ AuthenticationSession created and cached in VS Code       │
   └──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Copilot Token Exchange (Service-to-Service Authentication)     │
└──────────────────────────────────────────────────────────────────────────┘

5. Copilot Token Request (Automatic - No User Interaction)
   ┌──────────────────────────────────────────────────────────────┐
   │ POST https://api.github.com/copilot_internal/v2/token        │
   │ Authorization: token gho_...  (GitHub OAuth Token)           │
   │ Accept: application/json                                     │
   │ User-Agent: GitHubCopilot/1.143.0                           │
   │                                                              │
   │ Response:                                                    │
   │ {                                                           │
   │   token: "ghu_...",          // Copilot API token          │
   │   expires_at: 1234567890,    // ~4 hours from now          │
   │   refresh_in: 3600,          // Refresh after 1 hour       │
   │   sku: "business",           // Subscription type          │
   │   quota: {                   // Usage limits               │
   │     limit: 1000,                                            │
   │     remaining: 950,                                         │
   │     resetAt: 1234599999                                     │
   │   }                                                         │
   │ }                                                           │
   │                                                              │
   │ ✅ Copilot Token cached in extension                         │
   └──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: API Request (Language Model Access)                            │
└──────────────────────────────────────────────────────────────────────────┘

6. Chat Completion Request
   ┌──────────────────────────────────────────────────────────────┐
   │ POST https://api.githubcopilot.com/chat/completions          │
   │ Authorization: Bearer ghu_...  (Copilot Token)               │
   │ Content-Type: application/json                               │
   │ Copilot-Integration-Id: vscode-chat                          │
   │                                                              │
   │ Body:                                                        │
   │ {                                                           │
   │   messages: [{role: "user", content: "Explain this"}],      │
   │   model: "gpt-4o",                                          │
   │   stream: true,                                             │
   │   temperature: 0.7                                          │
   │ }                                                           │
   │                                                              │
   │ ✅ Streaming response with AI completion                     │
   └──────────────────────────────────────────────────────────────┘
```

**Key OAuth 2.0 Concepts**:

- **Authorization Code Flow**: Most secure OAuth flow, code exchanged server-side
- **PKCE (RFC 7636)**: Prevents authorization code interception attacks
- **Scopes**: Define permission boundaries (`user:email`, `repo`, `workflow`)
- **Consent Screen**: User explicitly grants permissions (shown by GitHub)
- **Access Token**: Long-lived GitHub token stored securely by VS Code
- **Refresh Token**: Not used (GitHub tokens don't expire unless revoked)

**User Interaction Points**:
1. **Sign In** (Phase 1, Step 1): User clicks "Sign in" button → Browser opens
2. **Authorize** (Phase 1, Step 1): User grants permissions on GitHub consent screen
3. **Scope Upgrade** (Phase 1): User may see additional consent for workspace features

**Automatic/Silent Operations** (No User Interaction):
- Phase 1, Steps 2-4: OAuth token exchange and user info fetch
- Phase 2: Copilot token exchange (uses existing GitHub token)
- Phase 3: All API requests (uses cached Copilot token)

### GitHub Authentication Provider Registration

The GitHub authentication provider is built into VS Code core and registered by the `github-authentication` extension that ships with VS Code.

#### Provider Registration in VS Code Core

**File: `vscode/extensions/github-authentication/package.json`**

```json
{
  "name": "github-authentication",
  "displayName": "GitHub Authentication",
  "description": "GitHub Authentication Provider",
  "version": "0.0.1",
  "publisher": "vscode",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [
    "onAuthenticationRequest:github"
  ],
  "contributes": {
    "authentication": [
      {
        "id": "github",
        "label": "GitHub"
      }
    ],
    "configuration": {
      "title": "GitHub Authentication",
      "properties": {
        "github.gitAuthentication": {
          "type": "boolean",
          "default": true,
          "description": "Use GitHub for Git authentication"
        },
        "github-enterprise.uri": {
          "type": "string",
          "default": "",
          "description": "GitHub Enterprise Server URI"
        }
      }
    }
  },
  "main": "./out/extension.js"
}
```

**Key Registration Elements**:
1. **Provider ID**: `"github"` - Used in `vscode.authentication.getSession('github', ...)`
2. **Activation Event**: `"onAuthenticationRequest:github"` - Extension activates when auth is needed
3. **Display Label**: `"GitHub"` - Shown in VS Code's Accounts menu
4. **Configuration**: Settings for enterprise servers and Git integration

#### Provider Implementation

**File: `vscode/extensions/github-authentication/src/github.ts`** (Real Source Code)

```typescript
export class GitHubAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private readonly _sessionChangeEmitter = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  private readonly _logger: Log;
  private readonly _githubServer: IGitHubServer;
  private readonly _keychain: Keychain;
  private _sessionsPromise: Promise<vscode.AuthenticationSession[]>;
  
  constructor(
    private readonly context: vscode.ExtensionContext,
    uriHandler: UriEventHandler,
    ghesUri?: vscode.Uri
  ) {
    const type = ghesUri ? AuthProviderType.githubEnterprise : AuthProviderType.github;
    
    // Keychain stores sessions in OS-level secure storage
    this._keychain = new Keychain(
      this.context,
      type === AuthProviderType.github
        ? `${type}.auth`
        : `${ghesUri?.authority}${ghesUri?.path}.ghes.auth`,
      this._logger
    );
    
    // GitHub server handles OAuth flows
    this._githubServer = new GitHubServer(
      this._logger,
      this._telemetryReporter,
      uriHandler,
      context.extension.extensionKind,
      ghesUri
    );
    
    // Load existing sessions from keychain
    this._sessionsPromise = this.readSessions();
    
    // Register provider with VS Code
    const supportedAuthorizationServers = ghesUri
      ? [vscode.Uri.joinPath(ghesUri, '/login/oauth')]
      : [vscode.Uri.parse('https://github.com/login/oauth')];
      
    vscode.authentication.registerAuthenticationProvider(
      type,
      this._githubServer.friendlyName,
      this,
      {
        supportsMultipleAccounts: true,
        supportedAuthorizationServers
      }
    );
  }
  
  get onDidChangeSessions() {
    return this._sessionChangeEmitter.event;
  }
  
  async getSessions(scopes: string[] | undefined): Promise<vscode.AuthenticationSession[]> {
    // GitHub doesn't care about scope order, so sort for comparison
    const sortedScopes = scopes?.sort() || [];
    const sessions = await this._sessionsPromise;
    
    // Filter by scopes if provided
    return sortedScopes.length
      ? sessions.filter(session => 
          arrayEquals([...session.scopes].sort(), sortedScopes)
        )
      : sessions;
  }
  
  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    const sortedScopes = [...scopes].sort();
    
    // GitHubServer.login() handles the OAuth flow
    // Returns the access token directly
    const token = await this._githubServer.login(sortedScopes.join(' '));
    
    // Convert token to session
    const session = await this.tokenToSession(token, scopes);
    
    // Store in keychain and update cache
    const sessions = await this._sessionsPromise;
    const sessionIndex = sessions.findIndex(s => 
      s.account.id === session.account.id && 
      arrayEquals([...s.scopes].sort(), sortedScopes)
    );
    
    const removed = [];
    if (sessionIndex > -1) {
      // Replace existing session with same account and scopes
      removed.push(...sessions.splice(sessionIndex, 1, session));
    } else {
      sessions.push(session);
    }
    
    await this.storeSessions(sessions);
    this._sessionChangeEmitter.fire({ added: [session], removed, changed: [] });
    
    return session;
  }
  
  private async tokenToSession(token: string, scopes: string[]): Promise<vscode.AuthenticationSession> {
    // Fetch user info from GitHub API
    const userInfo = await this._githubServer.getUserInfo(token);
    
    return {
      id: crypto.getRandomValues(new Uint32Array(2))
        .reduce((prev, curr) => prev += curr.toString(16), ''),
      accessToken: token,
      account: { 
        label: userInfo.accountName, 
        id: userInfo.id 
      },
      scopes
    };
  }
  
  async removeSession(id: string) {
    const sessions = await this._sessionsPromise;
    const sessionIndex = sessions.findIndex(session => session.id === id);
    
    if (sessionIndex > -1) {
      const session = sessions[sessionIndex];
      sessions.splice(sessionIndex, 1);
      
      await this.storeSessions(sessions);
      await this._githubServer.logout(session);
      
      this._sessionChangeEmitter.fire({ 
        added: [], 
        removed: [session], 
        changed: [] 
      });
    }
  }
  
  // Session storage using Keychain (OS secure storage)
  private async storeSessions(sessions: vscode.AuthenticationSession[]): Promise<void> {
    this._sessionsPromise = Promise.resolve(sessions);
    await this._keychain.setToken(JSON.stringify(sessions));
  }
  
  private async readSessions(): Promise<vscode.AuthenticationSession[]> {
    const storedSessions = await this._keychain.getToken();
    if (!storedSessions) {
      return [];
    }
    
    const sessionData = JSON.parse(storedSessions);
    
    // Verify each session is still valid
    const sessionPromises = sessionData.map(async (session: SessionData) => {
      try {
        // Verify token is still valid by fetching user info
        if (!session.account) {
          const userInfo = await this._githubServer.getUserInfo(session.accessToken);
          return {
            id: session.id,
            accessToken: session.accessToken,
            account: { 
              label: userInfo.accountName, 
              id: userInfo.id 
            },
            scopes: session.scopes
          };
        }
        return session;
      } catch (e) {
        // Remove invalid sessions
        if (e.message === 'Unauthorized') {
          return undefined;
        }
        throw e;
      }
    });
    
    const verifiedSessions = (await Promise.allSettled(sessionPromises))
      .filter(p => p.status === 'fulfilled' && p.value)
      .map(p => (p as PromiseFulfilledResult<vscode.AuthenticationSession>).value);
    
    return verifiedSessions;
  }
}
```

**File: `vscode/extensions/github-authentication/src/flows.ts`** (OAuth Flow Implementation)

```typescript
/**
 * URL Handler Flow - Uses vscode:// protocol for OAuth redirect
 * This is the primary flow for most VS Code instances
 * 
 * NOTE: This class is NOT exported. It's instantiated internally and 
 * consumed through the getFlows() factory function.
 */
class UrlHandlerFlow implements IFlow {
  async trigger({
    scopes,
    baseUri,
    redirectUri,      // https://vscode.dev/redirect (GitHub's server)
    callbackUri,      // vscode://vscode.github-authentication/did-authenticate
    nonce,
    signInProvider,
    uriHandler,
    logger
  }: IFlowTriggerOptions): Promise<string> {
    // 1. Generate PKCE parameters (Proof Key for Code Exchange)
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    
    // 2. Set up handler to wait for OAuth callback
    const promise = uriHandler.waitForCode(logger, scopes, nonce, token);
    
    // 3. Build authorization URL
    const searchParams = new URLSearchParams([
      ['client_id', Config.gitHubClientId],
      ['redirect_uri', redirectUri.toString(true)],  // GitHub redirects here
      ['scope', scopes],
      ['state', encodeURIComponent(callbackUri.toString(true))],  // Then to VS Code
      ['code_challenge', codeChallenge],
      ['code_challenge_method', 'S256']
    ]);
    
    if (signInProvider) {
      searchParams.append('provider', signInProvider);
    }
    
    // 4. Open browser to GitHub OAuth page
    const uri = Uri.parse(baseUri.with({
      path: '/login/oauth/authorize',
      query: searchParams.toString()
    }).toString(true));
    await env.openExternal(uri);
    
    // 5. Wait for authorization code from callback
    const code = await promise;
    
    // 6. Exchange code for token
    // Uses GitHub's proxy endpoint or direct GitHub endpoint
    const proxyEndpoints = await commands.executeCommand('workbench.getCodeExchangeProxyEndpoints');
    const endpointUrl = proxyEndpoints?.github
      ? Uri.parse(`${proxyEndpoints.github}login/oauth/access_token`)
      : baseUri.with({ path: '/login/oauth/access_token' });
    
    const accessToken = await exchangeCodeForToken(
      logger, 
      endpointUrl, 
      redirectUri, 
      code, 
      codeVerifier
    );
    
    return accessToken;
  }
}

/**
 * Flow Registry - All available OAuth flows
 * Each flow has different capabilities and constraints
 */
const allFlows: IFlow[] = [
  new LocalServerFlow(),      // Desktop: localhost HTTP server
  new UrlHandlerFlow(),       // Most common: vscode:// URI handler
  new DeviceCodeFlow(),       // Fallback: manual code entry
  new PatFlow()               // Enterprise: Personal Access Token
];

/**
 * Factory function that selects appropriate OAuth flows based on:
 * - GitHub target (GitHub.com vs Enterprise)
 * - Extension host (Local, Remote, WebWorker)
 * - Client support (desktop, web, SSH)
 * - Configuration (client secret availability)
 * 
 * This is the ONLY exported API from flows.ts that consumers use.
 */
export function getFlows(query: IFlowQuery): IFlow[] {
  const validFlows = allFlows.filter(flow => {
    let useFlow: boolean = true;
    
    // Filter by GitHub target
    switch (query.target) {
      case GitHubTarget.DotCom:
        useFlow &&= flow.options.supportsGitHubDotCom;
        break;
      case GitHubTarget.Enterprise:
        useFlow &&= flow.options.supportsGitHubEnterpriseServer;
        break;
      case GitHubTarget.HostedEnterprise:
        useFlow &&= flow.options.supportsHostedGitHubEnterprise;
        break;
    }
    
    // Filter by extension host runtime
    switch (query.extensionHost) {
      case ExtensionHost.Remote:
        useFlow &&= flow.options.supportsRemoteExtensionHost;
        break;
      case ExtensionHost.WebWorker:
        useFlow &&= flow.options.supportsWebWorkerExtensionHost;
        break;
    }
    
    // Filter by client secret requirement
    if (!Config.gitHubClientSecret) {
      useFlow &&= flow.options.supportsNoClientSecret;
    }
    
    // Filter by client support
    if (query.isSupportedClient) {
      useFlow &&= flow.options.supportsSupportedClients;
    } else {
      useFlow &&= flow.options.supportsUnsupportedClients;
    }
    
    return useFlow;
  });
  
  return validFlows;
}

/**
 * Exchanges authorization code for access token
 */
async function exchangeCodeForToken(
  logger: Log,
  endpointUri: Uri,
  redirectUri: Uri,
  code: string,
  codeVerifier: string
): Promise<string> {
  const clientSecret = Config.gitHubClientSecret;
  
  const body = new URLSearchParams([
    ['code', code],
    ['client_id', Config.gitHubClientId],
    ['redirect_uri', redirectUri.toString(true)],  // Must match authorization request
    ['client_secret', clientSecret],
    ['code_verifier', codeVerifier]  // PKCE verification
  ]);
  
  const result = await fetching(endpointUri.toString(true), {
    logger,
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString()
  });
  
  const json = await result.json();
  return json.access_token;
}
```

#### How GitHubServer Consumes the Flows

**File: `vscode/extensions/github-authentication/src/githubServer.ts`**

```typescript
export class GitHubServer implements IGitHubServer {
  async login(
    scopes: string, 
    signInProvider?: GitHubSocialSignInProvider,
    extraAuthorizeParameters?: Record<string, string>,
    existingLogin?: string
  ): Promise<string> {
    // Generate nonce and callback URI
    const nonce = crypto.getRandomValues(new Uint32Array(2))
      .reduce((prev, curr) => prev += curr.toString(16), '');
    
    // Construct callback URI following VS Code's URI routing convention:
    // Format: vscode://<extension-id>/<path>?<query>
    // - Scheme: vscode:// (or vscode-insiders://)
    // - Authority: Extension ID that registered the UriHandler
    // - Path: Route within the extension's handler
    // - Query: Parameters for the handler
    const callbackUri = await vscode.env.asExternalUri(
      vscode.Uri.parse(`${vscode.env.uriScheme}://vscode.github-authentication/did-authenticate?nonce=${encodeURIComponent(nonce)}`)
    );
    
    // Determine environment
    const supportedClient = isSupportedClient(callbackUri);
    const supportedTarget = isSupportedTarget(this._type, this._ghesUri);
    const isNodeEnvironment = typeof process !== 'undefined' && typeof process?.versions?.node === 'string';
    
    // Get appropriate flows based on environment
    const flows = getFlows({
      target: this._type === AuthProviderType.github
        ? GitHubTarget.DotCom
        : supportedTarget ? GitHubTarget.HostedEnterprise : GitHubTarget.Enterprise,
      extensionHost: isNodeEnvironment
        ? this._extensionKind === vscode.ExtensionKind.UI ? ExtensionHost.Local : ExtensionHost.Remote
        : ExtensionHost.WebWorker,
      isSupportedClient: supportedClient
    });
    
    // Try each flow in order until one succeeds
    let userCancelled = false;
    for (const flow of flows) {
      try {
        // If not first flow, prompt user to try alternative
        if (flow !== flows[0]) {
          await promptToContinue(flow.label);
        }
        
        // Trigger the flow (this is where UrlHandlerFlow.trigger() gets called)
        return await flow.trigger({
          scopes,
          callbackUri,
          nonce,
          signInProvider,
          extraAuthorizeParameters,
          baseUri: this.baseUri,
          logger: this._logger,
          uriHandler: this._uriHandler,
          enterpriseUri: this._ghesUri,
          redirectUri: vscode.Uri.parse(await this.getRedirectEndpoint()),
          existingLogin
        });
      } catch (e) {
        userCancelled = this.processLoginError(e);
        // Continue to next flow if this one failed
      }
    }
    
    throw new Error(userCancelled ? CANCELLATION_ERROR : 'No auth flow succeeded.');
  }
}
```

**Flow Selection Logic**:

The `getFlows()` function returns flows in priority order. For a typical desktop VS Code installation:

1. **LocalServerFlow** (first choice)
   - Spins up temporary HTTP server on `localhost:port`
   - Works best on desktop without remote connections
   - `redirect_uri` = `http://127.0.0.1:${port}/callback`

2. **UrlHandlerFlow** (second choice)
   - Uses `vscode://` protocol handler
   - Works on desktop, web, and remote scenarios
   - `redirect_uri` = `https://vscode.dev/redirect`
   - `callbackUri` = `vscode://vscode.github-authentication/did-authenticate`

3. **DeviceCodeFlow** (fallback)
   - User manually enters code from browser
   - Works when other flows fail (SSH, restricted networks)
   - No redirect required

4. **PatFlow** (enterprise only)
   - Personal Access Token manual entry
   - GitHub Enterprise Server scenarios
   - No OAuth flow, direct token input

**Key Points**:
- `UrlHandlerFlow` is **not exported** - consumers use `getFlows()` instead
- GitHubServer tries flows in order until one succeeds
- Flow selection is automatic based on environment detection
- Each flow implements the same `IFlow` interface with `trigger()` method

### Why redirect_uri Points to vscode.dev, Not vscode://

**The Two-Step Redirect Process**:

VS Code uses a **two-step redirect** because the OAuth `redirect_uri` parameter must be a publicly accessible HTTPS URL that GitHub can reach:

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: User authorizes on GitHub                              │
│ https://github.com/login/oauth/authorize?                       │
│   client_id=...                                                 │
│   redirect_uri=https://vscode.dev/redirect  ← Must be HTTPS!   │
│   state=vscode://vscode.github-authentication/did-authenticate  │
│   code_challenge=...                                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: GitHub redirects to vscode.dev                         │
│ https://vscode.dev/redirect?                                    │
│   code=abc123                                                   │
│   state=vscode://vscode.github-authentication/did-authenticate  │
│                                                                 │
│ This is a public web server that GitHub CAN reach              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: vscode.dev redirects to vscode:// protocol            │
│ vscode://vscode.github-authentication/did-authenticate?         │
│   code=abc123                                                   │
│   nonce=xyz                                                     │
│                                                                 │
│ This launches/activates VS Code on the user's machine          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: VS Code receives the code via URI handler              │
│ Extension extracts code and exchanges for access token          │
└─────────────────────────────────────────────────────────────────┘
```

**Why This Is Necessary**:

1. **OAuth Spec Requirement**: GitHub's OAuth implementation requires `redirect_uri` to be a publicly accessible HTTPS URL for security
2. **Custom Protocol Limitation**: `vscode://` is a custom protocol handler that only works locally - GitHub's servers cannot redirect directly to it
3. **Security**: The vscode.dev proxy is a trusted Microsoft server that:
   - Validates the OAuth state parameter
   - Prevents tampering with the authorization code
   - Ensures the redirect goes to the correct VS Code instance

**Alternative Flow (Local Server)**:

For desktop VS Code instances, there's also a `LocalServerFlow` that spins up a temporary HTTP server on `localhost`:

```typescript
class LocalServerFlow implements IFlow {
  async trigger(options: IFlowTriggerOptions): Promise<string> {
    // Start local server on random port
    const server = new LoopbackAuthServer(logger, portTimeout);
    await server.start();
    
    const redirectUri = `http://127.0.0.1:${server.port}/callback`;
    
    // Build OAuth URL with local redirect
    const searchParams = new URLSearchParams([
      ['client_id', Config.gitHubClientId],
      ['redirect_uri', redirectUri],  // localhost can be accessed by browser
      ['scope', scopes],
      // ...
    ]);
    
    // Open browser
    await env.openExternal(authUri);
    
    // Wait for callback to local server
    const code = await server.waitForOAuthCallback();
    
    // Exchange code for token
    return await exchangeCodeForToken(logger, endpoint, redirectUri, code, codeVerifier);
  }
}
```

This flow works when:
- Running VS Code desktop (not web)
- Running on local machine (not remote SSH)
- Can open a port on localhost

**Summary**: The `redirect_uri` parameter in OAuth MUST point to an HTTPS URL that GitHub can reach. Since `vscode://` is a local protocol, VS Code uses `https://vscode.dev/redirect` as an intermediary that then redirects to the local `vscode://` URI handler.

### Is vscode.dev/redirect Public?

You might wonder: *"Can I use `https://vscode.dev/redirect` for my own extension's OAuth flow?"*

**Short Answer**: It is **not officially supported** for third-party use.

1.  **Internal Design**: This service is designed and maintained by Microsoft specifically for VS Code's built-in authentication extensions (`github-authentication` and `microsoft-authentication`).
2.  **No Public Contract**: There is no documented API or guarantee that this service will remain generic. Microsoft could add allowlists (restricting it to specific extension IDs) or change the protocol at any time.
3.  **Risk**: Relying on it creates a dependency on an undocumented Microsoft service. If it changes, your extension breaks.

**Recommendation for Extension Authors**:
If you need an OAuth redirect service:
- **Host your own**: Set up a simple static page or serverless function (e.g., `https://auth.my-extension.com/callback`) that redirects to `vscode://...`.
- **Use Localhost**: For desktop-only extensions, many providers support `http://127.0.0.1` redirects.
- **Use Providers with Native Support**: Some providers (like Auth0) support custom URL schemes natively.

### The Role of Client Secret in Token Exchange

You noticed this line in `exchangeCodeForToken`:
```typescript
const clientSecret = Config.gitHubClientSecret;
```

**Why is it needed?**
In the OAuth 2.0 Authorization Code Flow, there are two distinct steps:

1.  **Authorization (Frontend)**: The user grants permission.
    *   Result: An **Authorization Code** (temporary, short-lived).
    *   This happens in the browser (public).
    *   Anyone who intercepts the redirect could theoretically see this code.

2.  **Token Exchange (Backend)**: The app exchanges the code for an Access Token.
    *   Result: An **Access Token** (long-lived, powerful).
    *   This happens via a direct HTTP POST request to GitHub.
    *   **Crucial Security Check**: GitHub needs to know that the app asking for the token is *actually* the real VS Code app, not an attacker who stole the authorization code.

**The Client Secret acts as the application's password.**
Only the real VS Code application (or its backend) knows this secret. By including it in the request, VS Code proves its identity to GitHub.

```
┌─────────────────────────────────────────────────────────────────┐
│ Token Exchange Request                                         │
│ POST https://github.com/login/oauth/access_token                │
├─────────────────────────────────────────────────────────────────┤
│ client_id:     <public_id>      (Who am I?)                     │
│ code:          <auth_code>      (What permission did I get?)    │
│ client_secret: <SECRET_KEY>     (Proof that I am really me!)    │
└─────────────────────────────────────────────────────────────────┘
```

**Wait, didn't you say extensions shouldn't have secrets?**
Yes! And this highlights a special privilege of the built-in `github-authentication` extension:
*   It is a **First-Party Extension** built by Microsoft.
*   The `Config.gitHubClientSecret` is injected at build time or retrieved from a secure internal service.
*   Third-party extensions **cannot** safely do this because their code is public. They must use a backend server (proxy) to hold the secret and perform this exchange.

### Security Deep Dive: Client Secrets in Native Apps

You asked: *"What is the security posture of storing the client secret on the client side?"*

**1. The Reality: It's Not a "Secret"**
In the context of a native application (like VS Code) distributed to millions of users, a "Client Secret" is **impossible to keep truly secret**.
- Anyone can decompile the Electron app.
- Anyone can inspect the network traffic.
- The secret is effectively "obfuscated," not "secured."

**2. Why is it done then?**
The OAuth 2.0 specification (RFC 8252 for Native Apps) acknowledges this limitation.
- **Purpose**: The secret here doesn't prove "I am a trusted backend." It proves "I am the official VS Code application" (to a reasonable degree of effort).
- **Risk Acceptance**: GitHub and Microsoft accept the risk that someone *could* extract this secret and impersonate the VS Code app to GitHub.
- **Impact**: If an attacker steals this secret, they can pretend to be VS Code. They **cannot** access user data without the user *also* signing in and granting consent.

**3. Who Populates It?**
- **Component**: The VS Code Build System (Microsoft's internal CI/CD pipeline).
- **When**: At **Build Time**, just before the release is published.
- **Mechanism**:
    - The open-source repository (`microsoft/vscode`) contains a placeholder or `undefined` in `config.ts`.
    - During the official build, a secure task injects the real secret (likely from a secure vault) into the `product.json` or directly into the extension's code.
    - This is why you can't run the full GitHub Auth flow when building VS Code from source (OSS) without providing your own Client ID/Secret.

### Is Client Secret Actually Used? (Yes, unfortunately)

You asked: *"I doubt that it's actually used... PKCE is designed for clients to not use secrets."*

**1. Confirmation: It IS Used**
The code in `flows.ts` explicitly enforces it for the standard web flow:

```typescript
// src/flows.ts
async function exchangeCodeForToken(...) {
    const clientSecret = Config.gitHubClientSecret;
    if (!clientSecret) {
        // This throws an error if the secret is missing!
        throw new Error('No client secret configured for GitHub authentication.');
    }
    // ...
}
```

**2. Why is it required with PKCE?**
You are technically correct: **Standard OAuth 2.0** allows Public Clients (like mobile apps) to use PKCE *without* a client secret.
*   **However**, GitHub's specific implementation of OAuth 2.0 for "OAuth Apps" **does not support** a secret-free Authorization Code flow.
*   GitHub requires the `client_secret` for the web-based flow (`UrlHandlerFlow`), even if PKCE is present.
*   **Exception**: The **Device Code Flow** (`DeviceCodeFlow`) does *not* require a client secret, which is why it's marked as `supportsNoClientSecret: true`.

**Conclusion**:
This is a limitation of the **GitHub API**, not a choice by VS Code. To provide the smooth "Sign in with Browser" experience (instead of the clunky Device Code flow), VS Code *must* embed the secret, accepting the "obfuscated security" trade-off.

### PKCE Implementation Confirmation

You asked: *"Confirm PKCE is also used in github-authentication."*

**Yes, PKCE is actively used.** Even though the Client Secret is required by GitHub, VS Code *also* implements PKCE (Proof Key for Code Exchange) as an additional security layer.

**Evidence in `flows.ts`**:

1.  **Generation**:
    The `UrlHandlerFlow` and `LocalServerFlow` generate the PKCE verifier and challenge before starting the flow.
    ```typescript
    // src/flows.ts -> UrlHandlerFlow.trigger
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    ```

2.  **Authorization Request**:
    The `code_challenge` is sent to GitHub during the initial redirect.
    ```typescript
    const searchParams = new URLSearchParams([
        // ...
        ['code_challenge', codeChallenge],
        ['code_challenge_method', 'S256']
    ]);
    ```

3.  **Token Exchange**:
    The `code_verifier` is sent back to GitHub to prove we initiated the request.
    ```typescript
    // src/flows.ts -> exchangeCodeForToken
    const body = new URLSearchParams([
        ['code', code],
        ['client_id', Config.gitHubClientId],
        ['redirect_uri', redirectUri.toString(true)],
        ['client_secret', clientSecret], // Secret is STILL sent
        ['code_verifier', codeVerifier]  // PKCE Verifier is ALSO sent
    ]);
    ```

**Why both?**
Using PKCE along with a Client Secret provides **Defense in Depth**.
- **Client Secret**: Authenticates the *Application* (VS Code).
- **PKCE**: Protects the *Authorization Code* from interception (Authorization Code Injection attacks). Even if an attacker steals the auth code from the redirect URI, they cannot exchange it for a token without the `code_verifier` which is held in memory by the VS Code process.

#### VS Code URI Routing and Extension Handlers

VS Code uses a **URI routing convention** where each extension can register a single `UriHandler` to receive callbacks from external sources (OAuth, deep links, etc.).

**URI Format Convention**:
```
vscode://<extension-id>/<path>?<query-parameters>

Examples:
- vscode://vscode.github-authentication/did-authenticate?code=abc123&nonce=xyz
- vscode://GitHub.vscode-pull-request-github/pr/123
- vscode://publisher.extension-name/action/do-something
```

**Components**:
1. **Scheme**: `vscode://` (or `vscode-insiders://` for Insiders builds)
2. **Authority**: Extension ID that registered the handler (format: `publisher.extension-name`)
3. **Path**: Route within the extension's handler (extension decides how to interpret)
4. **Query**: Parameters passed to the handler

**How Extensions Register URI Handlers**:

```typescript
// File: vscode/extensions/github-authentication/src/extension.ts
export async function activate(context: vscode.ExtensionContext) {
  // 1. Create a URI handler instance
  const uriHandler = new UriEventHandler();
  
  // 2. Register it with VS Code (only ONE handler per extension)
  context.subscriptions.push(
    vscode.window.registerUriHandler(uriHandler)
  );
  
  // 3. Pass handler to authentication provider
  context.subscriptions.push(
    new GitHubAuthenticationProvider(context, uriHandler)
  );
}

// File: vscode/extensions/github-authentication/src/github.ts
export class UriEventHandler extends vscode.EventEmitter<vscode.Uri> 
  implements vscode.UriHandler {
  
  private readonly _pendingNonces = new Map<string, string[]>();
  private readonly _codeExchangePromises = new Map<string, { promise: Promise<string>; cancel: vscode.EventEmitter<void> }>();
  
  // VS Code calls this method when a URI with this extension's ID is opened
  public handleUri(uri: vscode.Uri) {
    // Fire event to notify ALL listeners (OAuth flows waiting for callback)
    // This is the event emission that triggers the listener set up in waitForCode()
    this.fire(uri);
  }
  
  // OAuth flows call this to wait for the callback
  // This is THE LISTENER - it registers itself to receive URI events
  public async waitForCode(
    logger: Log, 
    scopes: string, 
    nonce: string, 
    token: vscode.CancellationToken
  ): Promise<string> {
    // Store nonce for validation (multiple OAuth flows can be active)
    const existingNonces = this._pendingNonces.get(scopes) || [];
    this._pendingNonces.set(scopes, [...existingNonces, nonce]);
    
    // Create or reuse a promise that listens to URI events
    // Key insight: One promise per scope combination (allows concurrent flows)
    let codeExchangePromise = this._codeExchangePromises.get(scopes);
    if (!codeExchangePromise) {
      // promiseFromEvent() creates a listener on this.event (the EventEmitter)
      // It will call handleEvent() adapter for each URI that fires
      codeExchangePromise = promiseFromEvent(
        this.event,                      // Event source: this UriEventHandler's events
        this.handleEvent(logger, scopes) // Adapter: processes each URI event
      );
      this._codeExchangePromises.set(scopes, codeExchangePromise);
    }
    
    try {
      // Wait for URI callback with timeout and cancellation support
      return await Promise.race([
        codeExchangePromise.promise,     // Resolves when valid URI received
        new Promise<string>((_, reject) => 
          setTimeout(() => reject(TIMED_OUT_ERROR), 300_000) // 5min timeout
        ),
        promiseFromEvent<void, string>(
          token.onCancellationRequested, 
          (_, __, reject) => { reject(USER_CANCELLATION_ERROR); }
        ).promise                         // User cancellation
      ]);
    } finally {
      // Cleanup: Remove nonce and cancel listener
      this._pendingNonces.delete(scopes);
      codeExchangePromise?.cancel.fire();
      this._codeExchangePromises.delete(scopes);
    }
  }
  
  // THIS IS THE ACTUAL LISTENER LOGIC (PromiseAdapter)
  // Called for EVERY URI event fired by handleUri()
  private handleEvent(logger: Log, scopes: string): PromiseAdapter<vscode.Uri, string> {
    return (uri: vscode.Uri, resolve, reject) => {
      // Parse query parameters from the URI
      const query = new URLSearchParams(uri.query);
      const code = query.get('code');     // OAuth authorization code
      const nonce = query.get('nonce');   // Security nonce
      
      // Validation 1: Authorization code must be present
      if (!code) {
        reject(new Error('No code'));
        return;
      }
      
      // Validation 2: Nonce must exist
      if (!nonce) {
        reject(new Error('No nonce'));
        return;
      }
      
      // Validation 3: Nonce must match one we're expecting for these scopes
      // This prevents:
      // - Replay attacks (old nonces rejected)
      // - Cross-scope interference (nonce for scope A won't work for scope B)
      const acceptedNonces = this._pendingNonces.get(scopes) || [];
      if (!acceptedNonces.includes(nonce)) {
        // Common scenario: User triggered OAuth with scope A, then scope B
        // Callback for scope A arrives while waiting for scope B
        // This listener ignores it and waits for the correct one
        logger.info('Nonce not found in accepted nonces. Skipping this execution...');
        return; // Don't resolve or reject - keep waiting for correct URI
      }
      
      // Success! We have a valid authorization code
      resolve(code);
    };
  }
}

/**
 * promiseFromEvent Utility (from common/utils.ts)
 * 
 * This creates a promise that resolves when an event fires with valid data.
 * The adapter function is called for EACH event until it resolves/rejects.
 */
function promiseFromEvent<T, U>(
  event: Event<T>,                    // Event to listen to
  adapter: PromiseAdapter<T, U>       // Function called for each event
): { promise: Promise<U>; cancel: EventEmitter<void> } {
  let subscription: Disposable;
  const cancel = new EventEmitter<void>();
  
  return {
    promise: new Promise<U>((resolve, reject) => {
      // Allow external cancellation
      cancel.event(_ => reject('Cancelled'));
      
      // Subscribe to the event
      subscription = event((value: T) => {
        try {
          // Call adapter with (eventData, resolve, reject)
          // Adapter decides whether to resolve/reject/ignore this event
          Promise.resolve(adapter(value, resolve, reject)).catch(reject);
        } catch (error) {
          reject(error);
        }
      });
    }).then(
      (result: U) => {
        subscription.dispose();  // Clean up listener on success
        return result;
      },
      error => {
        subscription.dispose();  // Clean up listener on error
        throw error;
      }
    ),
    cancel
  };
}
```

**How VS Code Routes URIs to Extensions**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: External source opens URI                              │
│ vscode://vscode.github-authentication/did-authenticate?code=... │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: OS hands URI to VS Code                                │
│ • Browser or web server redirects to vscode:// protocol        │
│ • OS recognizes vscode:// as registered protocol handler       │
│ • OS launches/activates VS Code with the URI                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: VS Code Core URI Service processes URI                 │
│ • Parse URI: vscode://vscode.github-authentication/...         │
│ • Extract authority: "vscode.github-authentication"            │
│ • Look up extension by ID in registry                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Route to Extension's UriHandler                        │
│ • Find registered UriHandler for extension ID                  │
│ • Call: handler.handleUri(uri)                                 │
│ • Handler receives full URI with path + query                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Extension processes URI                                │
│ • Parse path: "/did-authenticate"                              │
│ • Parse query: "code=abc123&nonce=xyz"                         │
│ • Route to appropriate internal handler                        │
│ • Extract authorization code                                   │
│ • Resolve waiting OAuth flow promise                           │
└─────────────────────────────────────────────────────────────────┘
```

**Key Design Principles**:

1. **One Handler Per Extension**: Each extension can register exactly ONE `UriHandler`
   - Prevents conflicts and simplifies routing
   - Extension is responsible for internal path routing

2. **Authority = Extension ID**: The URI authority MUST match the extension's ID
   - Format: `publisher.extension-name`
   - Example: `vscode.github-authentication` (publisher: `vscode`, name: `github-authentication`)
   - VS Code verifies extension is installed before routing

3. **Path-Based Internal Routing**: Extensions use the path component for internal routing
   - GitHub auth: `/did-authenticate` for OAuth callbacks
   - Can use different paths for different features:
     ```
     vscode://extension-id/oauth/callback
     vscode://extension-id/deep-link/feature
     vscode://extension-id/action/command
     ```

4. **Query Parameters**: Used for passing data to handlers
   - OAuth: `?code=...&state=...&nonce=...`
   - Deep links: `?resource=...&action=...`
   - Arbitrary key-value pairs

### Architecture Decision: Generic API vs. Generic Implementation

You might ask: *"Since `github-authentication` is just an OAuth flow, why doesn't VS Code provide a generic `createOAuthProvider()` API instead of forcing extensions to implement all this logic?"*

The answer lies in **Security** and **Protocol Complexity**.

#### 1. The "Client Secret" Problem
OAuth 2.0 (Confidential Client) requires a **Client Secret** to exchange the authorization code for an access token.
- **Extension Code is Public**: Extensions run on the user's machine. Any "secret" embedded in the code can be extracted.
- **Backend Requirement**: To keep the secret safe, you need a backend server to perform the token exchange.
- **VS Code's Solution**: Microsoft runs a dedicated backend service for the `github-authentication` and `microsoft-authentication` extensions. They cannot generically host secrets for *every* third-party extension.

#### 2. The "Redirect URI" Problem
OAuth providers require registering a specific **Redirect URI**.
- **Ownership**: The domain `vscode.dev` is owned by Microsoft. GitHub trusts it.
- **Generic Extensions**: If I build "GitLab Auth", I need `gitlab.com` to redirect to *my* server or a URI I control. Microsoft can't generically allow any extension to use `vscode.dev/redirect` without strict validation, or it becomes an open redirect vulnerability.

#### 3. Protocol Variability
While OAuth 2.0 is a standard, implementations vary wildly:
- **GitHub**: Supports Device Flow, PKCE, Enterprise instances.
- **Google**: Different discovery documents, strict redirect rules.
- **Custom**: Proprietary headers, non-standard token formats.

**The VS Code Approach**:
VS Code provides the **Interface** (`AuthenticationProvider`), not the **Implementation**.

- **The API**: `vscode.authentication.registerAuthenticationProvider`
  - Defines *contracts*: `getSessions`, `createSession`, `removeSession`.
  - Agnostic to *how* you authenticate (OAuth, PAT, SSH, proprietary).
  
- **The Implementation**: Extensions (like `github-authentication`)
  - Handle the specific protocol details (OAuth, PKCE).
  - Manage the specific security requirements (Client Secrets, Redirects).
  - Store tokens securely (Keychain).

This gives developers maximum flexibility (you can implement a provider that reads a file, or hits a proprietary API) while keeping the core VS Code API clean and secure.

#### 4. Community Examples
This architecture enables the community to build providers for any service:
- **GitLab Authentication**: Implements `AuthenticationProvider` for GitLab.com and self-hosted instances.
- **Azure Account**: Implements `AuthenticationProvider` for Microsoft Entra ID.
- **3rd Party**: Any extension can register a provider (e.g., "Login with Auth0", "Login with Okta") as long as they handle the protocol details.

**The "Generic OAuth" Extension Idea**:
Technically, someone *could* write a "Generic OAuth" extension that takes a JSON config (Client ID, Auth URL, Token URL) and tries to handle the flow. However, it would still face the **Client Secret** issue. It would only work for:
1. **Public Clients** (no secret required) - less secure, often disabled by providers.
2. **PKCE-only Clients** - supported by some (like GitHub), but not all.
3. **Implicit Flow** - deprecated and insecure.

VS Code chooses to provide the **secure primitive** (the API) rather than a **leaky abstraction** (a generic OAuth handler).

