import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, base, polygon, arbitrum, sepolia } from "wagmi/chains";

// WalletConnect Project ID is publishable. Replace with your own from https://cloud.reown.com.
// Injected wallets (MetaMask, Coinbase, Brave) work without it; WalletConnect QR needs a real ID.
export const WALLETCONNECT_PROJECT_ID = "REPLACE_WITH_WALLETCONNECT_PROJECT_ID";

export const SUPPORTED_CHAINS = [mainnet, base, polygon, arbitrum, sepolia] as const;

export const CHAIN_LABELS: Record<number, string> = {
  [mainnet.id]: "Ethereum",
  [base.id]: "Base",
  [polygon.id]: "Polygon",
  [arbitrum.id]: "Arbitrum",
  [sepolia.id]: "Sepolia (testnet)",
};

// USDC contract addresses per chain (native USDC, not bridged where possible)
export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  [mainnet.id]: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [polygon.id]: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  [arbitrum.id]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  [sepolia.id]: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

export const NATIVE_SYMBOLS: Record<number, string> = {
  [mainnet.id]: "ETH",
  [base.id]: "ETH",
  [polygon.id]: "MATIC",
  [arbitrum.id]: "ETH",
  [sepolia.id]: "ETH",
};

export const wagmiConfig = getDefaultConfig({
  appName: "BMaGlass Pay",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: SUPPORTED_CHAINS as any,
  ssr: false,
});