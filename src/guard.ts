import { loadBankConfig, saveBankConfig, loadAccounts, saveAccounts, BankAccount, WhitelistEntry } from './config.js';
import * as crypto from 'crypto';

export interface PendingTransfer {
    challengeToken: string;
    sourceAccountId: string;
    recipientIban: string;
    beneficiaryName: string;
    amount: number;
    currency: string;
    memo: string;
    createdAt: string;
    expiresAt: string;
}

// In-memory pending challenges waiting for human dashboard approval
const pendingTransfers = new Map<string, PendingTransfer>();

export interface GuardCheckResult {
    allowed: boolean;
    reason?: string;
    requiresApproval: boolean;
    challengeToken?: string;
}

export class BankSecurityGuard {
    static async validateTransfer(
        sourceAccountId: string,
        recipientIban: string,
        amount: number,
        memo: string
    ): Promise<GuardCheckResult> {
        const config = await loadBankConfig();

        // 1. Emergency Freeze Check
        if (config.policy.emergencyFreeze) {
            return {
                allowed: false,
                reason: 'DEFCON-1 ALERT: Bank MCP is in Emergency Lockdown mode. All outbound transfers are frozen.',
                requiresApproval: false
            };
        }

        // 2. Amount sanitization
        if (amount <= 0 || isNaN(amount) || !isFinite(amount)) {
            return {
                allowed: false,
                reason: 'Invalid transfer amount specified.',
                requiresApproval: false
            };
        }

        // 3. Single Transfer Cap
        if (amount > config.policy.maxSingleTransferLimit) {
            return {
                allowed: false,
                reason: `Transfer amount (${amount}) exceeds maximum single transaction cap of ${config.policy.maxSingleTransferLimit}.`,
                requiresApproval: false
            };
        }

        // 4. Daily Cumulative Cap
        const todayStr = new Date().toISOString().split('T')[0];
        const spentToday = config.dailySpent[todayStr] || 0;
        if (spentToday + amount > config.policy.maxDailyCumulativeLimit) {
            return {
                allowed: false,
                reason: `Cumulative daily transfer cap exceeded. Spent today: ${spentToday}, Attempted: ${amount}, Max daily limit: ${config.policy.maxDailyCumulativeLimit}.`,
                requiresApproval: false
            };
        }

        // 5. Account Balance Check
        const accounts = await loadAccounts();
        const srcAcc = accounts.find(a => a.accountId === sourceAccountId || a.accountNumber === sourceAccountId || a.iban === sourceAccountId);
        if (!srcAcc) {
            return {
                allowed: false,
                reason: `Source account '${sourceAccountId}' not found.`,
                requiresApproval: false
            };
        }
        if (srcAcc.availableBalance < amount) {
            return {
                allowed: false,
                reason: `Insufficient funds. Available: ${srcAcc.availableBalance} ${srcAcc.currency}, Requested: ${amount}.`,
                requiresApproval: false
            };
        }

        // 6. Whitelist Enforcement
        const cleanIban = recipientIban.replace(/\s+/g, '').toUpperCase();
        let beneficiaryName = 'Unknown Recipient';

        if (config.policy.requireWhitelist) {
            const whitelisted = config.whitelist.find(w => w.ibanOrAccount.replace(/\s+/g, '').toUpperCase() === cleanIban && w.enabled);
            if (!whitelisted) {
                return {
                    allowed: false,
                    reason: `Security Block: Recipient IBAN/Account '${recipientIban}' is not on the authorized whitelist. Must be added via Dashboard.`,
                    requiresApproval: false
                };
            }
            beneficiaryName = whitelisted.beneficiaryName;
        }

        // 7. Human-In-The-Loop (HITL) Approval Requirement
        if (amount >= config.policy.humanApprovalThreshold) {
            const challengeToken = 'AUTH_' + crypto.randomBytes(16).toString('hex').toUpperCase();
            const now = new Date();
            const expires = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins expiry

            const pending: PendingTransfer = {
                challengeToken,
                sourceAccountId: srcAcc.accountId,
                recipientIban: cleanIban,
                beneficiaryName,
                amount,
                currency: srcAcc.currency,
                memo: memo.slice(0, 100),
                createdAt: now.toISOString(),
                expiresAt: expires.toISOString()
            };

            pendingTransfers.set(challengeToken, pending);

            return {
                allowed: false,
                requiresApproval: true,
                challengeToken,
                reason: `Transfer of ${amount} ${srcAcc.currency} exceeds human-approval threshold (${config.policy.humanApprovalThreshold}). Human owner must approve via Dashboard or submit approval token.`
            };
        }

        return {
            allowed: true,
            requiresApproval: false
        };
    }

    static async executeTransfer(
        sourceAccountId: string,
        recipientIban: string,
        amount: number,
        memo: string
    ): Promise<{ success: boolean; txId?: string; balanceAfter?: number; error?: string }> {
        const accounts = await loadAccounts();
        const srcAcc = accounts.find(a => a.accountId === sourceAccountId || a.accountNumber === sourceAccountId || a.iban === sourceAccountId);
        if (!srcAcc) return { success: false, error: 'Source account not found' };

        // Deduct balance
        srcAcc.availableBalance = parseFloat((srcAcc.availableBalance - amount).toFixed(2));
        await saveAccounts(accounts);

        // Update daily spent
        const config = await loadBankConfig();
        const todayStr = new Date().toISOString().split('T')[0];
        config.dailySpent[todayStr] = parseFloat(((config.dailySpent[todayStr] || 0) + amount).toFixed(2));
        await saveBankConfig(config);

        const txId = 'TXN_' + crypto.randomBytes(8).toString('hex').toUpperCase();
        return {
            success: true,
            txId,
            balanceAfter: srcAcc.availableBalance
        };
    }

    static getPendingTransfers(): PendingTransfer[] {
        return Array.from(pendingTransfers.values());
    }

    static async approvePendingTransfer(challengeToken: string): Promise<{ success: boolean; txId?: string; balanceAfter?: number; error?: string }> {
        const pending = pendingTransfers.get(challengeToken);
        if (!pending) {
            return { success: false, error: 'Challenge token not found or already executed.' };
        }

        if (new Date() > new Date(pending.expiresAt)) {
            pendingTransfers.delete(challengeToken);
            return { success: false, error: 'Challenge token has expired.' };
        }

        const res = await this.executeTransfer(
            pending.sourceAccountId,
            pending.recipientIban,
            pending.amount,
            pending.memo
        );

        pendingTransfers.delete(challengeToken);
        return res;
    }

    static rejectPendingTransfer(challengeToken: string): boolean {
        return pendingTransfers.delete(challengeToken);
    }
}

