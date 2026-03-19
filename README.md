# LinkedIn Sales Intelligence MCP

Remote MCP server for LinkedIn competitive intelligence and sales research.
Connects to **claude.ai** via Streamable HTTP + OAuth 2.1.

Built for BeeCommerce sales team to monitor competitors and detect buying signals.

## What it does

**16 read-only tools** for LinkedIn research (no posting, no commenting):

| Category | Tools |
|----------|-------|
| **Search** | `linkedin_search_people`, `linkedin_search_companies`, `linkedin_company_people` |
| **Activity** | `linkedin_person_activity` (posts, comments, shares) |
| **AI Classification** | `linkedin_intent_classify` (sales_pitch, buying_signal, job_posting, networking, irrelevant) |
| **Prospect DB** | `linkedin_prospect_save`, `linkedin_prospect_list`, `linkedin_prospect_scan` |
| **Company Monitoring** | `linkedin_company_save`, `linkedin_company_list` |
| **Feed** | `linkedin_activities_feed`, `linkedin_monitor_stats` |
| **Auth** | `linkedin_scraper_auth` (set li_at cookie) |

## Architecture

```
claude.ai (browser)
    │
    │ HTTPS POST /mcp (Streamable HTTP)
    │ OAuth 2.1 (Authorization Code + PKCE)
    │
    ▼
Traefik (TLS) → Node.js (Express + MCP SDK)
    ├── mcpAuthRouter (OAuth endpoints)
    ├── StreamableHTTPServerTransport
    ├── Voyager API client (li_at cookie, rate limited)
    ├── Gemini Flash (AI classification)
    └── SQLite (prospects.db + oauth.db)
```

## Production deployment

**Live at:** `https://mcp-linkedin.ai.beecommerce.pl`

### Server setup (VPS with Traefik)

1. **Clone and install**
```bash
ssh root@YOUR_SERVER
cd /opt
git clone https://github.com/gacabartosz/linkedin-sales-mcp.git mcp-linkedin
cd mcp-linkedin
npm install --omit=dev
npm run build
```

2. **Create `.env`**
```bash
cp .env.example .env
nano .env
```

Required variables:
```env
# Gemini API key for AI classification
GEMINI_API_KEY=AIzaSy...

# Random secret for OAuth token signing
OAUTH_SECRET=<random-64-chars>

# PIN that users enter to approve OAuth access
OAUTH_APPROVE_SECRET=your-secret-pin

# Public URL (must match DNS + TLS)
PUBLIC_URL=https://mcp-linkedin.ai.beecommerce.pl

# Server binding
PORT=3100
HOST=0.0.0.0
```

3. **Systemd service**
```bash
cat > /etc/systemd/system/mcp-linkedin.service << 'EOF'
[Unit]
Description=LinkedIn Sales Intelligence MCP Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mcp-linkedin
EnvironmentFile=/opt/mcp-linkedin/.env
ExecStart=/usr/bin/node /opt/mcp-linkedin/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mcp-linkedin
systemctl start mcp-linkedin
```

4. **Traefik routing** (file provider)
```yaml
# /srv/traefik/dynamic/mcp-linkedin.yml
http:
  routers:
    mcp-linkedin:
      rule: "Host(`mcp-linkedin.ai.beecommerce.pl`)"
      entryPoints:
        - websecure
      service: mcp-linkedin
      tls:
        certResolver: letsencrypt

  services:
    mcp-linkedin:
      loadBalancer:
        servers:
          - url: "http://YOUR_SERVER_IP:3100"
```

5. **DNS**
```
mcp-linkedin.ai.beecommerce.pl  A  YOUR_SERVER_IP  TTL 300
```

### Verify deployment
```bash
# Health check
curl https://mcp-linkedin.ai.beecommerce.pl/health

# OAuth metadata
curl https://mcp-linkedin.ai.beecommerce.pl/.well-known/oauth-authorization-server

# Protected resource metadata
curl https://mcp-linkedin.ai.beecommerce.pl/.well-known/oauth-protected-resource
```

## Connect from claude.ai

1. Go to **claude.ai** → Settings → Integrations → Add MCP connector
2. Enter URL: `https://mcp-linkedin.ai.beecommerce.pl/mcp`
3. OAuth flow will start — enter PIN when prompted
4. 16 tools appear in Claude's tool list
5. First step: call `linkedin_scraper_auth` with your li_at cookie from browser DevTools

### Getting your li_at cookie

1. Open LinkedIn in Chrome
2. DevTools (F12) → Application → Cookies → linkedin.com
3. Copy the value of `li_at`
4. In Claude: "Set my LinkedIn auth" → tool calls `linkedin_scraper_auth` with the cookie

## How Mike uses it (from transcript)

### Path 1: Monitor competitor salespeople

```
1. linkedin_search_companies → "Cognize" → find company
2. linkedin_company_save → add as direct_competitor
3. linkedin_company_people → company="cognize", role_keywords="sales growth"
4. linkedin_prospect_save → category="competitor_sales"
5. linkedin_prospect_scan → fetches their COMMENTS
6. linkedin_activities_feed → filter="sales_pitch" → see where they pitch
```

### Path 2: Detect buying intent

```
1. linkedin_search_people → keywords="e-commerce manager", location="poland"
2. linkedin_prospect_save → category="target_buyer"
3. linkedin_prospect_scan → fetches their POSTS
4. linkedin_activities_feed → filter="buying_signal" → see who needs a vendor
```

### Daily workflow

```
linkedin_prospect_scan          → scan all prospects for new activity
linkedin_activities_feed        → review buying signals and sales pitches
linkedin_monitor_stats          → check system stats
```

## Rate limiting & safety

| Limit | Value |
|-------|-------|
| Delay between requests | 3-7 seconds (randomized) |
| Max requests/hour | 30 |
| Max requests/day | 150 (hard cap) |
| Backoff on 429 | Exponential (60s, 120s, 240s...) |
| Fake accounts | ZERO — your own session only |

## AI Classification (Gemini Flash)

Classifies LinkedIn activity text into:

- **sales_pitch** — competitor offering services ("polecam się", "oferujemy")
- **buying_signal** — potential client seeking vendor ("szukam", "wdrożenie", "RFP")
- **job_posting** — company hiring e-commerce roles (growth signal)
- **networking** — general professional networking
- **irrelevant** — personal, lifestyle, unrelated

Uses keyword matching first (instant), falls back to Gemini AI for ambiguous cases.

## Tech stack

- **Runtime:** Node.js 18+
- **MCP SDK:** @modelcontextprotocol/sdk v1.27 (StreamableHTTPServerTransport)
- **Auth:** OAuth 2.1 with PKCE + Dynamic Client Registration (RFC 7591)
- **Database:** SQLite (better-sqlite3) — prospects, companies, activities, OAuth
- **AI:** Google Gemini Flash for intent classification
- **LinkedIn:** Voyager API (internal, li_at cookie auth)
- **Server:** Express 4 + Traefik reverse proxy + Let's Encrypt TLS

## License

MIT
