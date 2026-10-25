import * as fs from 'fs/promises';
import * as path from 'path';

export interface WhitelistEntry {
    ibanOrAccount: string;
    beneficiaryName: string;
    bankName: string;
    dailyLimit: number;
    enabled: boolean;
    addedAt: string;
}

export interface SecurityPolicy {
    maxSingleTransferLimit: number;
    maxDailyCumulativeLimit: number;
    humanApprovalThreshold: number;
    requireWhitelist: boolean;
    emergencyFreeze: boolean;
}

export interface BankAccount {
    accountId: string;
    accountNumber: string;
    iban: string;
    holderName: string;
    currency: string;
    availableBalance: number;
    accountType: 'CHECKING' | 'SAVINGS' | 'BUSINESS';
}

export interface BankConfig {
    policy: SecurityPolicy;
    whitelist: WhitelistEntry[];
    dailySpent: { [dateStr: string]: number };
}

const DATA_DIR = process.env.DATA_DIR || './data';
const CONFIG_FILE = path.join(DATA_DIR, 'bank_config.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

const DEFAULT_POLICY: SecurityPolicy = {
    maxSingleTransferLimit: 500,
    maxDailyCumulativeLimit: 2000,
    humanApprovalThreshold: 100,
    requireWhitelist: true,
    emergencyFreeze: false,
};

export async function ensureDataDir(): Promise<void> {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch {
        // Exists
    }
}

export async function loadBankConfig(): Promise<BankConfig> {
    await ensureDataDir();
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        const defaultConfig: BankConfig = {
            policy: DEFAULT_POLICY,
            whitelist: [
                {
                    ibanOrAccount: 'PK36MEZN0001234567890123',
                    beneficiaryName: 'Meezan Operational Vault',
                    bankName: 'Meezan Bank',
                    dailyLimit: 1000,
                    enabled: true,
                    addedAt: new Date().toISOString()
                },
                {
                    ibanOrAccount: 'GB29NWBK60161331926819',
                    beneficiaryName: 'RMAA Corporate UK',
                    bankName: 'NatWest',
                    dailyLimit: 2000,
                    enabled: true,
                    addedAt: new Date().toISOString()
                }
            ],
            dailySpent: {}
        };
        await fs.writeFile(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
    }
}

export async function saveBankConfig(config: BankConfig): Promise<void> {
    await ensureDataDir();
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function loadAccounts(): Promise<BankAccount[]> {
    await ensureDataDir();
    try {
        const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        const defaultAccounts: BankAccount[] = [
            {
                accountId: 'acc_main_corp',
                accountNumber: '1002938475',
                iban: 'PK36MEZN0001002938475001',
                holderName: 'RMAA Holdings LLC',
                currency: 'USD',
                availableBalance: 48500.00,
                accountType: 'BUSINESS'
            },
            {
                accountId: 'acc_ops_liquid',
                accountNumber: '2004958371',
                iban: 'GB29NWBK6016132004958371',
                holderName: 'RMAA Global Operations',
                currency: 'USD',
                availableBalance: 12450.50,
                accountType: 'CHECKING'
            }
        ];
        await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(defaultAccounts, null, 2));
        return defaultAccounts;
    }
}

export async function saveAccounts(accounts: BankAccount[]): Promise<void> {
    await ensureDataDir();
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

