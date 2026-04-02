// VoxLink Host — Earnings & Withdrawal Service
// Hosts earn coins per minute from calls; they can withdraw earnings

import { appendToArray, getItem, StorageKeys } from "@/utils/storage";

export type TransactionType = "earning" | "bonus" | "withdrawal" | "adjustment";
export type TransactionStatus = "completed" | "pending" | "failed" | "refunded";

export interface EarningTransaction {
  id: string;
  type: TransactionType;
  title: string;
  description: string;
  amount: number;
  balanceAfter: number;
  timestamp: number;
  status: TransactionStatus;
  orderId?: string;
  userId?: string;
  userName?: string;
  callDuration?: number;
  paymentMethod?: string;
  currency?: string;
}

export interface EarningResult {
  success: boolean;
  transaction?: EarningTransaction;
  newBalance?: number;
  error?: string;
}

export interface WithdrawResult {
  success: boolean;
  transaction?: EarningTransaction;
  newBalance?: number;
  error?: string;
}

const MOCK_DELAY = 1500;
function delay(ms = MOCK_DELAY) {
  return new Promise((r) => setTimeout(r, ms));
}

function generateTxId() {
  return `TX_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateOrderId() {
  return `WD${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

// ─── Record Call Earning ──────────────────────────────────────────────────────

export async function recordCallEarning(params: {
  coinsEarned: number;
  currentBalance: number;
  userId: string;
  userName: string;
  callDuration: number;
}): Promise<EarningResult> {
  const { coinsEarned, currentBalance, userId, userName, callDuration } = params;
  const newBalance = currentBalance + coinsEarned;
  const mins = Math.floor(callDuration / 60);
  const secs = callDuration % 60;
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const tx: EarningTransaction = {
    id: generateTxId(),
    type: "earning",
    title: `Call with ${userName}`,
    description: `Duration: ${durationStr}`,
    amount: coinsEarned,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    status: "completed",
    userId,
    userName,
    callDuration,
  };

  await appendToArray<EarningTransaction>(StorageKeys.COIN_HISTORY, tx);
  return { success: true, transaction: tx, newBalance };
}

// ─── Credit Bonus ─────────────────────────────────────────────────────────────

export async function creditBonus(params: {
  amount: number;
  currentBalance: number;
  reason: string;
}): Promise<EarningResult> {
  const newBalance = params.currentBalance + params.amount;
  const tx: EarningTransaction = {
    id: generateTxId(),
    type: "bonus",
    title: "Bonus Reward",
    description: params.reason,
    amount: params.amount,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    status: "completed",
  };
  await appendToArray<EarningTransaction>(StorageKeys.COIN_HISTORY, tx);
  return { success: true, transaction: tx, newBalance };
}

// ─── Withdraw Earnings ────────────────────────────────────────────────────────

export const MINIMUM_WITHDRAWAL = 500;
export const COIN_TO_INR_RATE = 0.5;
export const COIN_TO_USD_RATE = 0.006;

export async function withdrawEarnings(params: {
  amount: number;
  currentBalance: number;
  method: string;
  accountDetails: string;
}): Promise<WithdrawResult> {
  await delay(2000);

  if (params.currentBalance < params.amount) {
    return { success: false, error: "Insufficient balance" };
  }
  if (params.amount < MINIMUM_WITHDRAWAL) {
    return { success: false, error: `Minimum withdrawal is ${MINIMUM_WITHDRAWAL} coins` };
  }

  const newBalance = params.currentBalance - params.amount;
  const tx: EarningTransaction = {
    id: generateTxId(),
    type: "withdrawal",
    title: "Earnings Withdrawal",
    description: `Via ${params.method} to ${params.accountDetails}`,
    amount: -params.amount,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    status: "pending",
    orderId: generateOrderId(),
    paymentMethod: params.method,
  };

  await appendToArray<EarningTransaction>(StorageKeys.COIN_HISTORY, tx);
  return { success: true, transaction: tx, newBalance };
}

// ─── Transaction History ──────────────────────────────────────────────────────

export async function getTransactionHistory(): Promise<EarningTransaction[]> {
  const txs = await getItem<EarningTransaction[]>(StorageKeys.COIN_HISTORY);
  return (txs ?? []).sort((a, b) => b.timestamp - a.timestamp);
}

export async function getTotalEarnings(): Promise<number> {
  const txs = await getTransactionHistory();
  return txs
    .filter((t) => t.type === "earning" || t.type === "bonus")
    .reduce((sum, t) => sum + t.amount, 0);
}

// ─── Conversion Helpers ───────────────────────────────────────────────────────

export function coinsToINR(coins: number): string {
  return `₹${(coins * COIN_TO_INR_RATE).toFixed(2)}`;
}

export function coinsToUSD(coins: number): string {
  return `$${(coins * COIN_TO_USD_RATE).toFixed(2)}`;
}
