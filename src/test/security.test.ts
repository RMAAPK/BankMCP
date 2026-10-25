import test from 'node:test';
import assert from 'node:assert/strict';
import { BankSecurityGuard } from '../guard.js';
import { loadBankConfig, saveBankConfig, loadAccounts, saveAccounts } from '../config.js';

test('BankSecurityGuard: Blocks non-whitelisted IBANs', async () => {
    const config = await loadBankConfig();
    config.policy.requireWhitelist = true;
    config.policy.emergencyFreeze = false;
    await saveBankConfig(config);

    const check = await BankSecurityGuard.validateTransfer(
        'acc_main_corp',
        'CH9300000000000000000', // Unlisted Swiss IBAN
        50,
        'Malicious prompt transfer'
    );

    assert.equal(check.allowed, false);
    assert.match(check.reason || '', /not on the authorized whitelist/);
});

test('BankSecurityGuard: Enforces Single Transfer Cap', async () => {
    const config = await loadBankConfig();
    config.policy.maxSingleTransferLimit = 500;
    config.policy.requireWhitelist = false;
    config.policy.emergencyFreeze = false;
    await saveBankConfig(config);

    const check = await BankSecurityGuard.validateTransfer(
        'acc_main_corp',
        'PK36MEZN0001234567890123',
        10000, // Exceeds 500 cap
        'Excessive transfer'
    );

    assert.equal(check.allowed, false);
    assert.match(check.reason || '', /exceeds maximum single transaction cap/);
});

test('BankSecurityGuard: Demands Human-In-The-Loop Approval Above Threshold', async () => {
    const config = await loadBankConfig();
    config.policy.humanApprovalThreshold = 100;
    config.policy.maxSingleTransferLimit = 500;
    config.policy.requireWhitelist = true;
    config.policy.emergencyFreeze = false;
    await saveBankConfig(config);

    const check = await BankSecurityGuard.validateTransfer(
        'acc_main_corp',
        'PK36MEZN0001234567890123', // Whitelisted
        250, // Between 100 and 500 -> triggers HITL
        'Settlement payment'
    );

    assert.equal(check.allowed, false);
    assert.equal(check.requiresApproval, true);
    assert.ok(check.challengeToken?.startsWith('AUTH_'));

    // Test Human Approval Execution
    const approvalRes = await BankSecurityGuard.approvePendingTransfer(check.challengeToken!);
    assert.equal(approvalRes.success, true);
    assert.ok(approvalRes.txId?.startsWith('TXN_'));
});

test('BankSecurityGuard: Emergency Freeze Kills All Transfers Instantly', async () => {
    const config = await loadBankConfig();
    config.policy.emergencyFreeze = true; // Lockdown
    await saveBankConfig(config);

    const check = await BankSecurityGuard.validateTransfer(
        'acc_main_corp',
        'PK36MEZN0001234567890123',
        10,
        'Tiny transfer'
    );

    assert.equal(check.allowed, false);
    assert.match(check.reason || '', /Emergency Lockdown mode/);

    // Reset
    config.policy.emergencyFreeze = false;
    await saveBankConfig(config);
});

