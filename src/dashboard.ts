import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { loadBankConfig, saveBankConfig, loadAccounts, saveAccounts, WhitelistEntry } from './config.js';
import { BankSecurityGuard } from './guard.js';

export function createDashboardRouter(): express.Router {
    const router = express.Router();

    const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

    // Basic Auth Middleware
    const basicAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.setHeader('WWW-Authenticate', 'Basic realm="BankMCP Dashboard"');
            return res.status(401).send('Authentication required');
        }

        const auth = Buffer.from(authHeader.split(' ')[1] || '', 'base64').toString().split(':');
        const user = auth[0];
        const pass = auth[1];

        if (user === ADMIN_USER && pass === ADMIN_PASS) {
            return next();
        }

        res.setHeader('WWW-Authenticate', 'Basic realm="BankMCP Dashboard"');
        return res.status(401).send('Invalid credentials');
    };

    router.use(basicAuth);

    // Dashboard UI
    router.get('/', async (req, res) => {
        const config = await loadBankConfig();
        const accounts = await loadAccounts();
        const pending = BankSecurityGuard.getPendingTransfers();

        const todayStr = new Date().toISOString().split('T')[0];
        const spentToday = config.dailySpent[todayStr] || 0;

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>BankMCP - Security & Whitelist Dashboard</title>
            <style>
                :root {
                    --bg: #0f172a;
                    --card: #1e293b;
                    --text: #f8fafc;
                    --accent: #38bdf8;
                    --danger: #ef4444;
                    --success: #22c55e;
                    --warning: #f59e0b;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    background: var(--bg);
                    color: var(--text);
                    margin: 0;
                    padding: 24px;
                }
                .container { max-width: 1000px; margin: 0 auto; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 24px; }
                h1 { margin: 0; font-size: 24px; display: flex; align-items: center; gap: 8px; }
                .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
                .badge-danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
                .badge-success { background: rgba(34, 197, 94, 0.2); color: var(--success); border: 1px solid var(--success); }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
                .card { background: var(--card); border: 1px solid #334155; border-radius: 8px; padding: 20px; }
                .card h3 { margin-top: 0; font-size: 16px; color: #94a3b8; }
                .val { font-size: 28px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-top: 12px; }
                th, td { text-align: left; padding: 12px; border-bottom: 1px solid #334155; font-size: 14px; }
                th { color: #94a3b8; font-weight: 500; }
                button, .btn { background: var(--accent); color: #000; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
                .btn-danger { background: var(--danger); color: #fff; }
                .btn-warning { background: var(--warning); color: #000; }
                input, select { background: #0f172a; border: 1px solid #334155; color: #fff; padding: 8px 12px; border-radius: 4px; width: 100%; box-sizing: border-box; margin-bottom: 8px; }
                .form-row { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 8px; align-items: center; margin-top: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🏦 BankMCP - Security Control Center</h1>
                    <div>
                        ${config.policy.emergencyFreeze ? 
                            '<span class="badge badge-danger">EMERGENCY LOCKDOWN ACTIVE</span>' : 
                            '<span class="badge badge-success">SYSTEM HEALTHY</span>'}
                    </div>
                </div>

                <div class="grid">
                    <div class="card">
                        <h3>Today\'s Cumulative Outbound</h3>
                        <div class="val">$${spentToday.toLocaleString()} <span style="font-size: 14px; color: #94a3b8;">/ $${config.policy.maxDailyCumulativeLimit.toLocaleString()}</span></div>
                    </div>
                    <div class="card">
                        <h3>Single Transfer Cap</h3>
                        <div class="val">$${config.policy.maxSingleTransferLimit.toLocaleString()}</div>
                    </div>
                    <div class="card">
                        <h3>Human Approval Gate</h3>
                        <div class="val">$${config.policy.humanApprovalThreshold.toLocaleString()}</div>
                    </div>
                </div>

                <!-- Emergency Lockdown Toggle -->
                <div class="card" style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong style="font-size: 16px;">Emergency Killswitch</strong>
                        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 13px;">Instantly freeze all AI outbound transfers across all connected bank accounts.</p>
                    </div>
                    <form action="/dashboard/toggle-freeze" method="POST">
                        <button type="submit" class="${config.policy.emergencyFreeze ? 'btn' : 'btn-danger'}">
                            ${config.policy.emergencyFreeze ? 'Deactivate Freeze' : 'TRIGGER EMERGENCY FREEZE'}
                        </button>
                    </form>
                </div>

                <!-- Pending Human Authorization -->
                <div class="card" style="margin-bottom: 24px;">
                    <h3>Pending Human-In-The-Loop Approvals (${pending.length})</h3>
                    ${pending.length === 0 ? '<p style="color: #64748b; font-size: 14px;">No transfers currently waiting for approval.</p>' : `
                        <table>
                            <thead>
                                <tr>
                                    <th>Token</th>
                                    <th>Recipient</th>
                                    <th>Amount</th>
                                    <th>Memo</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${pending.map(p => `
                                    <tr>
                                        <td><code>${p.challengeToken}</code></td>
                                        <td>${p.beneficiaryName} <br><small style="color: #64748b;">${p.recipientIban}</small></td>
                                        <td><strong>${p.amount} ${p.currency}</strong></td>
                                        <td>${p.memo || '-'}</td>
                                        <td>
                                            <form action="/dashboard/approve-transfer" method="POST" style="display:inline;">
                                                <input type="hidden" name="token" value="${p.challengeToken}">
                                                <button type="submit" class="btn">Approve</button>
                                            </form>
                                            <form action="/dashboard/reject-transfer" method="POST" style="display:inline;">
                                                <input type="hidden" name="token" value="${p.challengeToken}">
                                                <button type="submit" class="btn btn-danger">Reject</button>
                                            </form>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>

                <!-- Whitelisted IBANs & Beneficiaries -->
                <div class="card" style="margin-bottom: 24px;">
                    <h3>Authorized Beneficiary Whitelist (AI cannot send to unlisted IBANs)</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Beneficiary Name</th>
                                <th>IBAN / Account</th>
                                <th>Bank</th>
                                <th>Daily Cap</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${config.whitelist.map((w, idx) => `
                                <tr>
                                    <td><strong>${w.beneficiaryName}</strong></td>
                                    <td><code>${w.ibanOrAccount}</code></td>
                                    <td>${w.bankName}</td>
                                    <td>$${w.dailyLimit}</td>
                                    <td>${w.enabled ? '<span class="badge badge-success">ACTIVE</span>' : '<span class="badge badge-danger">DISABLED</span>'}</td>
                                    <td>
                                        <form action="/dashboard/delete-whitelist" method="POST" style="display:inline;">
                                            <input type="hidden" name="index" value="${idx}">
                                            <button type="submit" class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;">Remove</button>
                                        </form>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>

                    <form action="/dashboard/add-whitelist" method="POST" style="margin-top: 20px;">
                        <h4 style="margin: 0 0 10px 0;">Add New Beneficiary</h4>
                        <div class="form-row">
                            <input type="text" name="beneficiaryName" placeholder="Beneficiary Name" required>
                            <input type="text" name="iban" placeholder="IBAN / Account" required>
                            <input type="text" name="bankName" placeholder="Bank Name" required>
                            <input type="number" name="dailyLimit" placeholder="Daily Limit ($)" value="1000" required>
                            <button type="submit" class="btn">Add to Whitelist</button>
                        </div>
                    </form>
                </div>

                <!-- Account Balances -->
                <div class="card">
                    <h3>Connected Bank Accounts</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Account ID</th>
                                <th>Account Holder</th>
                                <th>Type</th>
                                <th>Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${accounts.map(a => `
                                <tr>
                                    <td><code>${a.accountId}</code></td>
                                    <td>${a.holderName}</td>
                                    <td>${a.accountType}</td>
                                    <td><strong>$${a.availableBalance.toLocaleString()} ${a.currency}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </body>
        </html>
        `;

        res.send(html);
    });

    // Form handlers
    router.post('/toggle-freeze', async (req, res) => {
        const config = await loadBankConfig();
        config.policy.emergencyFreeze = !config.policy.emergencyFreeze;
        await saveBankConfig(config);
        res.redirect('/dashboard');
    });

    router.post('/approve-transfer', async (req, res) => {
        const { token } = req.body;
        if (token) {
            await BankSecurityGuard.approvePendingTransfer(token);
        }
        res.redirect('/dashboard');
    });

    router.post('/reject-transfer', async (req, res) => {
        const { token } = req.body;
        if (token) {
            BankSecurityGuard.rejectPendingTransfer(token);
        }
        res.redirect('/dashboard');
    });

    router.post('/add-whitelist', async (req, res) => {
        const { beneficiaryName, iban, bankName, dailyLimit } = req.body;
        if (beneficiaryName && iban) {
            const config = await loadBankConfig();
            config.whitelist.push({
                beneficiaryName,
                ibanOrAccount: iban.replace(/\s+/g, '').toUpperCase(),
                bankName: bankName || 'Generic Bank',
                dailyLimit: parseFloat(dailyLimit) || 1000,
                enabled: true,
                addedAt: new Date().toISOString()
            });
            await saveBankConfig(config);
        }
        res.redirect('/dashboard');
    });

    router.post('/delete-whitelist', async (req, res) => {
        const { index } = req.body;
        const config = await loadBankConfig();
        const idx = parseInt(index, 10);
        if (!isNaN(idx) && idx >= 0 && idx < config.whitelist.length) {
            config.whitelist.splice(idx, 1);
            await saveBankConfig(config);
        }
        res.redirect('/dashboard');
    });

    return router;
}

