import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { loadAccounts, loadBankConfig, saveBankConfig } from './config.js';
import { BankSecurityGuard } from './guard.js';
import { createDashboardRouter } from './dashboard.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// Initialize FastMCP
const mcp = new FastMCP({
    name: 'BankMCP-Secure-Fintech-Gateway',
    version: '1.0.0'
});

// -------------------------------------------------------------
// MCP TOOL DEFINITIONS (WITH DMCPS-GRADE SECURITY INTERCEPTORS)
// -------------------------------------------------------------

// Tool 1: List Accounts (Safe Read-Only)
mcp.addTool({
    name: 'list_accounts',
    description: 'List all authorized corporate and checking bank accounts with available balances and IBANs.',
    parameters: z.object({}),
    execute: async () => {
        const accounts = await loadAccounts();
        const config = await loadBankConfig();

        if (config.policy.emergencyFreeze) {
            return JSON.stringify({
                status: 'WARNING',
                notice: 'EMERGENCY LOCKDOWN IS ACTIVE. Outbound transfers are prohibited.',
                accounts: accounts.map(a => ({
                    accountId: a.accountId,
                    holderName: a.holderName,
                    currency: a.currency,
                    balance: a.availableBalance,
                    type: a.accountType
                }))
            }, null, 2);
        }

        return JSON.stringify(accounts.map(a => ({
            accountId: a.accountId,
            accountNumber: '****' + a.accountNumber.slice(-4),
            iban: a.iban.slice(0, 4) + '****' + a.iban.slice(-4),
            holderName: a.holderName,
            currency: a.currency,
            availableBalance: a.availableBalance,
            accountType: a.accountType
        })), null, 2);
    }
});

// Tool 2: Check Specific Account Balance (Safe Read-Only)
mcp.addTool({
    name: 'get_account_balance',
    description: 'Retrieve real-time available balance for a specific bank account ID.',
    parameters: z.object({
        accountId: z.string().describe('The ID of the bank account (e.g. acc_main_corp)')
    }),
    execute: async (args) => {
        const accounts = await loadAccounts();
        const acc = accounts.find(a => a.accountId === args.accountId);
        if (!acc) {
            return `Error: Account '${args.accountId}' not found in authorized ledger.`;
        }
        return `Account: ${acc.holderName} (${acc.accountId})\nAvailable Balance: ${acc.availableBalance} ${acc.currency}\nType: ${acc.accountType}`;
    }
});

// Tool 3: List Whitelisted Beneficiaries (Safe Read-Only)
mcp.addTool({
    name: 'list_whitelisted_beneficiaries',
    description: 'List all pre-approved recipient IBANs and entities that the AI agent is allowed to transfer funds to.',
    parameters: z.object({}),
    execute: async () => {
        const config = await loadBankConfig();
        const active = config.whitelist.filter(w => w.enabled);
        return JSON.stringify(active.map(w => ({
            beneficiaryName: w.beneficiaryName,
            ibanOrAccount: w.ibanOrAccount,
            bankName: w.bankName,
            dailyCap: w.dailyLimit
        })), null, 2);
    }
});

// Tool 4: Request Bank Transfer (Intercepted by Spending Guard & HITL)
mcp.addTool({
    name: 'transfer_funds',
    description: 'Initiate a bank transfer. Note: Strictly gated by spending limits and whitelist policy. Transfers above threshold require human token approval.',
    parameters: z.object({
        sourceAccountId: z.string().describe('The source account ID (e.g. acc_main_corp)'),
        recipientIban: z.string().describe('The destination IBAN or account number'),
        amount: z.number().positive().describe('The amount to transfer in account currency'),
        memo: z.string().max(100).optional().describe('Payment reference or memo (max 100 chars)')
    }),
    execute: async (args) => {
        const memo = args.memo || 'AI Agent Automated Settlement';
        const check = await BankSecurityGuard.validateTransfer(
            args.sourceAccountId,
            args.recipientIban,
            args.amount,
            memo
        );

        if (!check.allowed) {
            if (check.requiresApproval) {
                return JSON.stringify({
                    status: 'REQUIRES_HUMAN_APPROVAL',
                    challengeToken: check.challengeToken,
                    message: check.reason,
                    instructions: `Transfer drafted for ${args.amount}. The human supervisor must approve token '${check.challengeToken}' on the BankMCP Dashboard (http://localhost:${PORT}/dashboard) or provide it to 'submit_approval_token'.`
                }, null, 2);
            }
            return JSON.stringify({
                status: 'BLOCKED_BY_POLICY',
                error: check.reason
            }, null, 2);
        }

        // Direct execution (within micro-limit and whitelisted)
        const res = await BankSecurityGuard.executeTransfer(
            args.sourceAccountId,
            args.recipientIban,
            args.amount,
            memo
        );

        return JSON.stringify({
            status: 'EXECUTED_SUCCESSFULLY',
            transactionId: res.txId,
            sourceAccountId: args.sourceAccountId,
            amountSent: args.amount,
            balanceRemaining: res.balanceAfter,
            timestamp: new Date().toISOString()
        }, null, 2);
    }
});

// Tool 5: Submit Human Approval Token
mcp.addTool({
    name: 'submit_approval_token',
    description: 'Submit an approval challenge token granted by the human supervisor to finalize a drafted high-value transfer.',
    parameters: z.object({
        challengeToken: z.string().describe('The challenge token (e.g. AUTH_XXXXXXXXXX)')
    }),
    execute: async (args) => {
        const res = await BankSecurityGuard.approvePendingTransfer(args.challengeToken);
        if (!res.success) {
            return JSON.stringify({
                status: 'APPROVAL_FAILED',
                error: res.error
            }, null, 2);
        }
        return JSON.stringify({
            status: 'TRANSFER_COMPLETED_BY_APPROVAL',
            transactionId: res.txId,
            balanceRemaining: res.balanceAfter,
            timestamp: new Date().toISOString()
        }, null, 2);
    }
});

// Tool 6: Check System Security Status
mcp.addTool({
    name: 'get_security_status',
    description: 'Check active spending caps, daily used quota, and emergency lockdown status.',
    parameters: z.object({}),
    execute: async () => {
        const config = await loadBankConfig();
        const todayStr = new Date().toISOString().split('T')[0];
        const spentToday = config.dailySpent[todayStr] || 0;

        return JSON.stringify({
            emergencyFreezeActive: config.policy.emergencyFreeze,
            requireWhitelist: config.policy.requireWhitelist,
            maxSingleTransferCap: config.policy.maxSingleTransferLimit,
            maxDailyCumulativeCap: config.policy.maxDailyCumulativeLimit,
            humanApprovalThreshold: config.policy.humanApprovalThreshold,
            spentToday,
            remainingDailyQuota: Math.max(0, config.policy.maxDailyCumulativeLimit - spentToday),
            whitelistedBeneficiariesCount: config.whitelist.filter(w => w.enabled).length
        }, null, 2);
    }
});

// -------------------------------------------------------------
// DUAL SERVER MOUNT: Express Dashboard + FastMCP SSE
// -------------------------------------------------------------
const app = express();

app.use(helmet({
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Dashboard Route
app.use('/dashboard', createDashboardRouter());

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'BankMCP', timestamp: new Date().toISOString() });
});

// Root redirects to dashboard
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// Start Express Dashboard Server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🏦 BankMCP (Secure Agent Banking Gateway) Initialized`);
    console.log(`🛡️ Dashboard:  http://localhost:${PORT}/dashboard`);
    console.log(`🔑 Credentials: Defined in .env (ADMIN_USERNAME / ADMIN_PASSWORD)`);
    console.log(`📡 Health:     http://localhost:${PORT}/health`);
    console.log(`=======================================================`);
});

// FastMCP Transport Runner
if (process.env.MCP_TRANSPORT === 'httpStream') {
    mcp.start({
        transportType: 'httpStream',
        httpStream: {
            endpoint: '/mcp',
            port: PORT + 1
        }
    });
    console.log(`📡 FastMCP Stream Server listening on port ${PORT + 1}`);
} else {
    // Default Stdio
    mcp.start({ transportType: 'stdio' });
}

