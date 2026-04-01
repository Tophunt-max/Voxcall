// VoxLink Payment Service
// Coin purchase simulation + transaction history management

import { appendToArray, StorageKeys } from "@/utils/storage";
import { CoinPlan } from "@/data/mockData";

export type TransactionType = "purchase" | "spend" | "bonus" | "refund" | "transfer" | "withdrawal";
export type TransactionStatus = "completed" | "pending" | "failed" | "refunded";

export interface CoinTransaction {
  id: string;
  type: TransactionType;
  title: string;
  description: string;
  amount: number;
  balanceAfter: number;
  timestamp: number;
  status: TransactionStatus;
  orderId?: string;
  planId?: string;
  hostId?: string;
  paymentMethod?: string;
  currency?: string;
  fiatAmount?: number;
}

export interface PurchaseResult {
  success: boolean;
  transaction?: CoinTransaction;
  newBalance?: number;
  error?: string;
}

export interface WithdrawResult {
  success: boolean;
  transaction?: CoinTransaction;
  newBalance?: number;
  error?: string;
}

const MOCK_DELAY = 1500;
function delay(ms = MOCK_DELAY) {
  return new Promise((r) => setTimeout(r, ms));
}

function generateOrderId() {
  return `ORD${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function generateTxId() {
  return `TX_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function purchaseCoins(
  plan: CoinPlan,
  currentBalance: number,
  paymentMethod = "card"
): Promise<PurchaseResult> {
  await delay();

  // Simulate 95% success rate
  if (Math.random() < 0.05) {
    return { success: false, error: "Payment failed. Please try again." };
  }

  const totalCoins = plan.coins + (plan.bonus ?? 0);
  const newBalance = currentBalance + totalCoins;

  const tx: CoinTransaction = {
    id: generateTxId(),
    type: "purchase",
    title: `Purchased ${plan.coins.toLocaleString()} Coins`,
    description: plan.bonus
      ? `+${plan.bonus} bonus coins included`
      : `Payment via ${paymentMethod}`,
    amount: totalCoins,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    status: "completed",
    orderId: generateOrderId(),
    planId: plan.id,
    paymentMethod,
    currency: plan.currency,
    fiatAmount: plan.price,
  };

  await appendToArray<CoinTransaction>(StorageKeys.COIN_HISTORY, tx);
  return { success: true, transaction: tx, newBalance };
}

export async function spendCoins(params: {
  amount: number;
  currentBalance: number;
  hostId: string;
  hostName: string;
  callDuration: number;
}): Promise<PurchaseResult> {
  const { amount, currentBalance, hostId, hostName, callDuration } = params;

  if (currentBalance < amount) {
    return { success: false, error: "Insufficient coins" };
  }

  const newBalance = currentBalance - amount;
  const mins = Math.floor(callDuration / 60);
  const secs = callDuration % 60;
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const tx: CoinTransaction = {
    id: generateTxId(),
    type: "spend",
    title: `Call with ${hostName}`,
    description: `Duration: ${durationStr}`,
    amount: -amount,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    status: "completed",
    hostId,
  };

  await appendToArray<CoinTransaction>(StorageKeys.COIN_HISTORY, tx);
  return { success: true, transaction: tx, newBalance };
}

export async function creditBonusCoins(params: {
  amount: number;
  currentBalance: number;
  reason: string;
}): Promise<PurchaseResult> {
  const newBalance = params.currentBalance + params.amount;
  const tx: CoinTransaction = {
    id: generateTxId(),
    type: "bonus",
    title: "Bonus Coins",
    description: params.reason,
    amount: params.amount,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    status: "completed",
  };

  await appendToArray<CoinTransaction>(StorageKeys.COIN_HISTORY, tx);
  return { success: true, transaction: tx, newBalance };
}

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

  // Minimum withdrawal: 100 coins
  if (params.amount < 100) {
    return { success: false, error: "Minimum withdrawal is 100 coins" };
  }

  const newBalance = params.currentBalance - params.amount;
  const tx: CoinTransaction = {
    id: generateTxId(),
    type: "withdrawal",
    title: "Earnings Withdrawal",
    description: `Via ${params.method} to ${params.accountDetails}`,
    amount: -params.amount,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    status: "pending",
    paymentMethod: params.method,
  };

  await appendToArray<CoinTransaction>(StorageKeys.COIN_HISTORY, tx);
  return { success: true, transaction: tx, newBalance };
}

export async function getTransactionHistory(): Promise<CoinTransaction[]> {
  const { getItem } = await import("@/utils/storage");
  const txs = await getItem<CoinTransaction[]>(StorageKeys.COIN_HISTORY);
  return (txs ?? []).sort((a, b) => b.timestamp - a.timestamp);
}

export function coinsToCurrency(coins: number, rate = 0.01): string {
  return `$${(coins * rate).toFixed(2)}`;
}

export function currencyToCoins(usd: number, rate = 100): number {
  return Math.floor(usd * rate);
}
