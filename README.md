# 🏦 BankMCP: Secure Model Context Protocol Banking Gateway

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Organization: RMAA Holdings](https://img.shields.io/badge/Organization-RMAA%20Holdings-purple.svg)](https://github.com/RMAAPK)
[![Framework: FastMCP](https://img.shields.io/badge/Framework-FastMCP%20TypeScript-teal.svg)](https://github.com/punkpeye/fastmcp)
[![Security: DMCPS Hardened](https://img.shields.io/badge/Security-DMCPS%20Grade%20Interceptor-red.svg)](https://github.com/RMAAPK/dmcps)

**BankMCP** (engineered and maintained by **RMAA Holdings**) is an ultra-secure, Model Context Protocol (MCP) banking gateway built on TypeScript and `FastMCP`. 

It enables AI Agents (Claude Desktop, ChatGPT, Gemini, ForgeAI) to query account balances, audit corporate ledgers, and prepare banking settlements **without the catastrophic risk of unauthorized fund drainage or prompt injection attacks**.

---

## 🛡️ DMCPS-Grade Security Rails

Bank APIs are high-consequence tools for autonomous agents. BankMCP adapts the hardened sandbox and dashboard interception architecture pioneered in [DMCPS](https://github.com/RMAAPK/dmcps):

```
+---------------------------------------------------------------------------------------+
|                                BANKMCP INTERCEPTOR ARCHITECTURE                       |
+---------------------------------------------------------------------------------------+
|   AI AGENT (Claude / GPT / Gemini)                                                    |
|         │                                                                             |
|         ▼  JSON-RPC (FastMCP / Stdio / Stream)                                        |
|   [BANKMCP SECURITY INTERCEPTOR] ──► Emergency Freeze Active? ──► [INSTANT BLOCK]     |
|         │                                                                             |
|         ├──► Non-Whitelisted IBAN? ─────────────────────────────► [INSTANT BLOCK]     |
|         ├──► Exceeds Transaction Cap ($500)? ───────────────────► [INSTANT BLOCK]     |
|         ├──► Exceeds Daily Cumulative Cap ($2,000)? ────────────► [INSTANT BLOCK]     |
|         │                                                                             |
|         ├──► Amount >= $100 (Human Gate)? ──────────────────────► [REQUIRES TOKEN]    |
|         │                                                             │               |
|         │                                                             ▼               |
|         │                                               [DMCPS SECURED DASHBOARD]     |
|         │                                               Human Owner Approves Token    |
|         │                                                             │               |
|         ▼                                                             │               |
|   [CORE BANKING / LEDGER EXECUTION] ◄─────────────────────────────────┘               |
+---------------------------------------------------------------------------------------+
```

### 1. Zero Direct Fund Drainage (Mathematical Whitelisting)
- The agent **cannot** transfer funds to arbitrary accounts or IBANs found in prompts.
- All recipients must pre-exist in the authorized Whitelist database, configured exclusively by a human administrator through the Web Dashboard.

### 2. Deterministic Velocity & Spending Caps
- **Single Transaction Cap:** Default `$500.00` maximum. Any single request above this is rejected at the schema level.
- **24-Hour Rolling Quota:** Cumulative daily transfers cannot exceed `$2,000.00`.

### 3. Human-In-The-Loop (HITL) Challenge Tokens
- Any transfer equal to or greater than `$100.00` generates a cryptographically signed challenge token (e.g. `AUTH_9B2A...`) with a 15-minute expiration.
- The transfer is held in a pending state until a human logs into the Dashboard to approve it, or provides the challenge token to the `submit_approval_token` tool.

### 4. Emergency Killswitch (DEFCON-1 Freeze)
- One-click freeze toggle on the dashboard immediately terminates all outbound transfer capabilities across all connected bank accounts.

---

## 🛠️ MCP Tools Exposed to AI

| Tool Name | Risk Level | Description |
| :--- | :--- | :--- |
| `list_accounts` | 🟢 Safe (Read) | Lists authorized bank accounts with balances and masked IBANs. |
| `get_account_balance` | 🟢 Safe (Read) | Real-time balance check for a specific corporate account ID. |
| `list_whitelisted_beneficiaries`| 🟢 Safe (Read) | Lists pre-approved recipient IBANs and their daily limits. |
| `transfer_funds` | 🔴 High (Gated)| Drafts/executes transfer through whitelist, caps, and HITL gate. |
| `submit_approval_token` | 🟡 Auth (Commit)| Submits human challenge token to finalize high-value transfer. |
| `get_security_status` | 🟢 Safe (Read) | Audits active daily spent quotas, limits, and lockdown status. |

---

## 🚀 Quickstart & Dashboard

### 1. Install Dependencies & Build
```bash
npm install
npm run build
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Edit `.env` to set your administrator credentials:
```env
PORT=8080
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password_here
MAX_TRANSACTION_LIMIT=500
MAX_DAILY_LIMIT=2000
REQUIRE_HUMAN_APPROVAL_ABOVE=100
```

### 3. Run the Security Gateway
```bash
npm start
```
The server will boot two coordinated services:
- **Admin Control Dashboard:** `http://localhost:8080/dashboard`
- **FastMCP Transport Gateway:** Stdio or Stream mode ready for MCP clients.

### 4. Run the Security Test Suite
```bash
npm test
```
```text
✔ BankSecurityGuard: Blocks non-whitelisted IBANs (16.9ms)
✔ BankSecurityGuard: Enforces Single Transfer Cap (7.0ms)
✔ BankSecurityGuard: Demands Human-In-The-Loop Approval Above Threshold (13.1ms)
✔ BankSecurityGuard: Emergency Freeze Kills All Transfers Instantly (7.4ms)
ℹ tests 4 | pass 4 | fail 0
```

---

## 📜 License
Released under the [MIT License](LICENSE) by **RMAA Holdings** & Contributors.
